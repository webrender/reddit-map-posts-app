import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {
  type Context,
  media,
  reddit,
  redis,
  runWithContext,
} from '@devvit/web/server'
import type {T2, T3, UiResponse} from '@devvit/web/shared'
import {
  type AddPinReq,
  type AddPinRsp,
  type CreateMapPostReq,
  type CreateMapPostRsp,
  DefaultAreaFormName,
  type DefaultAreaFormReq,
  DefaultAreaPickFormName,
  type DefaultAreaPickFormReq,
  type DeleteIndexPostRsp,
  type DeletePinReq,
  type DeletePinRsp,
  type DeletePostRsp,
  Endpoint,
  type ErrorRsp,
  type GetIndexRsp,
  type GetMapRsp,
  IndexPageSize,
  type IndexPostFormReq,
  NewPostFormName,
  type NewPostFormReq,
  type Pin,
  PlacesKeyFormName,
  type PlacesKeyFormReq,
  PostTitleMaxLen,
  type SearchPlacesRsp,
  type UpdatePinReq,
  type UpdatePinRsp,
} from '../shared/api.ts'
import type {MapData} from './db.ts'
import {onReq} from './server.ts'

const OWNER = 't2_owner' as T2
const POST = 't3_123' as T3
/** Mirrors the install-scoped key `db.ts` writes the Places API key under. */
const PLACES_KEY = 'places-api-key'
/** And the one it writes the Default Area under. */
const AREA_KEY = 'default-area'

let server: Server
let serverURL: string
const redisValues = new Map<string, string>()
const redisHashes = new Map<string, Map<string, string>>()
const redisSets = new Map<string, Map<string, number>>()
const redisGet = redis.get.bind(redis)
const redisSet = redis.set.bind(redis)
const redisHGet = redis.hGet.bind(redis)
const redisHSet = redis.hSet.bind(redis)
const redisHGetAll = redis.hGetAll.bind(redis)
const redisHDel = redis.hDel.bind(redis)
const redisDel = redis.del.bind(redis)
const redisZAdd = redis.zAdd.bind(redis)
const redisZIncrBy = redis.zIncrBy.bind(redis)
const redisZRange = redis.zRange.bind(redis)
const redisZRem = redis.zRem.bind(redis)
const redisWatch = redis.watch.bind(redis)
const getPostById = reddit.getPostById.bind(reddit)
const mediaUpload = media.upload.bind(media)
const submitCustomPost = reddit.submitCustomPost.bind(reddit)
const getModerators = reddit.getModerators.bind(reddit)
const originalFetch = globalThis.fetch
let requestUserId: T2 = OWNER
let submittedPostTitle: string | undefined
/** Which `post.entrypoints` key the last submitted post asked to render. */
let submittedPostEntry: string | undefined
/** The key the server presented to Google on the last place search. */
let placesApiKeySent: string | null = null
/** How Google answers the next place request; 0 means the request throws. */
let placesRspStatus = 200
/** Every external URL the server fetched, with the headers it forwarded. */
let upstreamReqs: {url: string; headers: Headers}[] = []
/** The places Google answers a text search with, whatever was searched for. */
let placesRspPlaces: unknown[] = []
/** Makes Google refuse any search carrying a `locationBias`, and only those. */
let placesRejectBias = false
/** Every text search the server made, as Google would have received it. */
let placesReqs: {fieldMask: string | null; body: PlacesReqBody}[] = []

type PlacesReqBody = {
  textQuery?: string
  maxResultCount?: number
  locationBias?: {
    rectangle: {
      low: {latitude: number; longitude: number}
      high: {latitude: number; longitude: number}
    }
  }
}

/**
 * One place as Google returns it, with every field either search asks for. A
 * viewport is Google's own rectangle for the place — the thing a Default Area
 * is made of.
 */
const CENTRAL_PARK = {
  displayName: {text: 'Central Park'},
  formattedAddress: 'New York, NY, USA',
  location: {latitude: 40.785091, longitude: -73.968285},
  viewport: {
    low: {latitude: 40.764, longitude: -73.9819},
    high: {latitude: 40.8003, longitude: -73.9498},
  },
}

/** The two places one word means, which is what the pick form is for. */
const SPRINGFIELD_IL = {
  displayName: {text: 'Springfield'},
  formattedAddress: 'Springfield, IL, USA',
  viewport: {
    low: {latitude: 39.6907, longitude: -89.7343},
    high: {latitude: 39.8607, longitude: -89.5807},
  },
}
const SPRINGFIELD_MA = {
  displayName: {text: 'Springfield'},
  formattedAddress: 'Springfield, MA, USA',
  viewport: {
    low: {latitude: 42.0501, longitude: -72.6204},
    high: {latitude: 42.1585, longitude: -72.4636},
  },
}

const TILE_BYTES = Uint8Array.from([0x1a, 0x00, 0xff, 0x80, 0x0a])
const TILE_ETAG = '"tile-v1"'

before(async () => {
  redis.get = async key => redisValues.get(key)
  redis.set = async (key, value) => {
    redisValues.set(key, value)
    return 'OK'
  }
  // Redis `del` does not care what type the key holds, and neither does this:
  // `dbDeleteMap` deletes a string key and a hash key in the same breath.
  redis.del = async (...keys) => {
    for (const key of keys) {
      redisValues.delete(key)
      redisHashes.delete(key)
      redisSets.delete(key)
    }
  }
  redis.hGet = async (key, field) => redisHashes.get(key)?.get(field)
  redis.hSet = async (key, fieldValues) => {
    let hash = redisHashes.get(key)
    if (!hash) {
      hash = new Map()
      redisHashes.set(key, hash)
    }
    for (const [field, value] of Object.entries(fieldValues))
      hash.set(field, value)
    return Object.keys(fieldValues).length
  }
  redis.hGetAll = async key =>
    Object.fromEntries(redisHashes.get(key) ?? new Map())
  redis.hDel = async (key, fields) => {
    const hash = redisHashes.get(key)
    if (!hash) return 0
    let deleted = 0
    for (const field of fields) if (hash.delete(field)) deleted++
    return deleted
  }
  redis.zAdd = async (key, ...members) => {
    const set = redisSet_(key)
    let added = 0
    for (const {member, score} of members) {
      if (!set.has(member)) added++
      set.set(member, score)
    }
    return added
  }
  redis.zIncrBy = async (key, member, value) => {
    const set = redisSet_(key)
    const score = (set.get(member) ?? 0) + value
    set.set(member, score)
    return score
  }
  // Only the rank-ordered whole-set read the index does; `start`/`stop` beyond
  // that are not exercised and are not pretended to work.
  redis.zRange = async key =>
    [...(redisSets.get(key) ?? new Map())]
      .map(([member, score]) => ({member, score}))
      .sort((a, b) => a.score - b.score)
  redis.zRem = async (key, members) => {
    const set = redisSets.get(key)
    if (!set) return 0
    let removed = 0
    for (const member of members) if (set.delete(member)) removed++
    return removed
  }
  // A transaction, as far as these tests are concerned: queues each write
  // against the same mocked methods above and runs them in order on `exec()`.
  // There is no concurrent writer in a single-threaded test to invalidate a
  // WATCH, so `exec()` always "succeeds" — the retry path in `dbDeletePin` is
  // real production behavior this mock has no way to exercise.
  redis.watch = (async () => {
    const ops: (() => Promise<unknown>)[] = []
    const tx = {
      multi: async () => {},
      exec: async () => {
        const results: unknown[] = []
        for (const op of ops) results.push(await op())
        return results
      },
      set: async (key: string, value: string) => {
        ops.push(() => redis.set(key, value))
        return tx
      },
      hSet: async (key: string, fieldValues: {[field: string]: string}) => {
        ops.push(() => redis.hSet(key, fieldValues))
        return tx
      },
      hDel: async (key: string, fields: string[]) => {
        ops.push(() => redis.hDel(key, fields))
        return tx
      },
      zAdd: async (
        key: string,
        ...members: {member: string; score: number}[]
      ) => {
        ops.push(() => redis.zAdd(key, ...members))
        return tx
      },
      zIncrBy: async (key: string, member: string, value: number) => {
        ops.push(() => redis.zIncrBy(key, member, value))
        return tx
      },
    }
    return tx
  }) as unknown as typeof redis.watch
  reddit.getPostById = (async (t3: T3) => {
    const post = redditPosts.get(t3)
    if (!post) throw Error(`no such post: ${t3}`)
    return {...post, delete: async () => void deletedPosts.push(t3)}
  }) as unknown as typeof reddit.getPostById
  media.upload = async ({url}) => ({
    mediaId: 'media1',
    mediaUrl: `https://i.redd.it/uploaded?src=${encodeURIComponent(url)}`,
  })
  reddit.submitCustomPost = (async (
    opts: Parameters<typeof reddit.submitCustomPost>[0],
  ) => {
    submittedPostTitle = opts.title
    submittedPostEntry = opts.entry
    return {
      id: POST,
      url: `https://reddit.com/r/test_sub/comments/${POST}`,
    }
  }) as unknown as typeof reddit.submitCustomPost
  // Reddit is asked about one named user, and answers with a listing that is
  // empty when they do not moderate here.
  reddit.getModerators = ((opts: {
    subredditName: string
    username?: string
  }) => ({
    all: async () => {
      if (moderatorsUnreadable) throw Error('reddit is down')
      return moderators
        .filter(
          mod =>
            mod.subredditName === opts.subredditName &&
            (!opts.username || mod.username === opts.username),
        )
        .map(mod => ({username: mod.username}))
    },
  })) as unknown as typeof reddit.getModerators
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (`${url}` === 'https://places.googleapis.com/v1/places:searchText') {
      const headers = new Headers(init?.headers)
      placesApiKeySent = headers.get('X-Goog-Api-Key')
      const body = JSON.parse(`${init?.body}`) as PlacesReqBody
      placesReqs.push({fieldMask: headers.get('X-Goog-FieldMask'), body})
      if (placesRspStatus === 0) throw new TypeError('network error')
      if (placesRspStatus !== 200)
        return new Response('{}', {status: placesRspStatus})
      // Standing in for a rectangle Google will not take: the search itself is
      // fine, and the same one without the bias would have worked.
      if (placesRejectBias && body.locationBias)
        return new Response('{}', {status: 400})
      return new Response(JSON.stringify({places: placesRspPlaces}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      })
    }

    const {host, pathname} = new URL(`${url}`)
    if (host === 'tiles.openfreemap.org') {
      const headers = new Headers(init?.headers)
      upstreamReqs.push({url: `${url}`, headers})

      if (pathname === '/missing.pbf') return new Response('', {status: 404})
      if (headers.get('if-none-match') === TILE_ETAG) {
        return new Response(undefined, {
          status: 304,
          headers: {ETag: TILE_ETAG},
        })
      }
      return new Response(TILE_BYTES, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-protobuf',
          // fetch() decodes the body, so the proxy must not re-advertise this.
          'Content-Encoding': 'gzip',
          'Cache-Control': 'public, max-age=86400',
          ETag: TILE_ETAG,
          'Set-Cookie': 'upstream=1',
        },
      })
    }

    return originalFetch(url, init)
  }) as typeof fetch

  server = createServer(async (req, rsp) => {
    await runWithContext(
      {
        appName: 'map-posts',
        postId: POST,
        subredditName: 'test_sub',
        userId: requestUserId,
        username: 'username',
      } as unknown as Context,
      () => onReq(req, rsp),
    )
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const info = server.address() as AddressInfo
  serverURL = `http://127.0.0.1:${info.port}`
})

after(async () => {
  redis.get = redisGet
  redis.set = redisSet
  redis.hGet = redisHGet
  redis.hSet = redisHSet
  redis.hGetAll = redisHGetAll
  redis.hDel = redisHDel
  redis.del = redisDel
  redis.zAdd = redisZAdd
  redis.zIncrBy = redisZIncrBy
  redis.zRange = redisZRange
  redis.zRem = redisZRem
  redis.watch = redisWatch
  reddit.getPostById = getPostById
  media.upload = mediaUpload
  reddit.submitCustomPost = submitCustomPost
  reddit.getModerators = getModerators
  globalThis.fetch = originalFetch
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => {
  redisValues.clear()
  redisHashes.clear()
  redisSets.clear()
  redditPosts.clear()
  deletedPosts = []
  requestUserId = OWNER
  redisValues.set(PLACES_KEY, 'test-api-key')
  placesApiKeySent = null
  placesRspStatus = 200
  placesRspPlaces = [CENTRAL_PARK]
  placesRejectBias = false
  placesReqs = []
  submittedPostTitle = undefined
  submittedPostEntry = undefined
  upstreamReqs = []
  moderators = []
  moderatorsUnreadable = false
})

/** What Reddit will say about a post id, for the reads an Index Post makes. */
const redditPosts = new Map<T3, {score: number; removed: boolean}>()
/** Every post the app asked Reddit to delete, in order. */
let deletedPosts: T3[] = []
/** Who moderates what, as Reddit would answer it. */
let moderators: {username: string; subredditName: string}[] = []
/** When set, every moderator read throws, standing for an unreachable Reddit. */
let moderatorsUnreadable = false

/** Makes the user each request is made as a moderator of this subreddit. */
function seedModerator(): void {
  moderators.push({username: 'username', subredditName: 'test_sub'})
}

/** Gives the subreddit a Default Area, as the pick form would leave one. */
function seedArea(): void {
  redisValues.set(
    AREA_KEY,
    JSON.stringify({
      name: 'Springfield, IL, USA',
      bounds: {west: -89.7343, south: 39.6907, east: -89.5807, north: 39.8607},
    }),
  )
}

/** A toast's words, whichever of its two shapes the response used. */
function toastText(ui: UiResponse): string {
  if (typeof ui.showToast === 'string') return ui.showToast
  return ui.showToast?.text ?? ''
}

/** Marks a post id as owned by a Map, which is what makes it a Map Post. */
function seedOwnedMap(t3: T3): void {
  redisValues.set(`owner:${t3}`, OWNER)
}

function redisSet_(key: string): Map<string, number> {
  let set = redisSets.get(key)
  if (!set) {
    set = new Map()
    redisSets.set(key, set)
  }
  return set
}

/** An indexed Map Post, as `dbCreateMap` and the Pin routes would leave it. */
function seedIndexed(
  t3: T3,
  opts: {
    title: string
    author: string
    createdAt: number
    pins?: number
    /** The cached upvote count the Top Sort orders by. */
    score?: number
  },
): void {
  redisSet_('index').set(t3, opts.createdAt)
  redisSet_('index-pins').set(t3, opts.pins ?? 1)
  if (opts.score !== undefined) redisSet_('index-score').set(t3, opts.score)
  let meta = redisHashes.get('index-meta')
  if (!meta) {
    meta = new Map()
    redisHashes.set('index-meta', meta)
  }
  meta.set(
    t3,
    JSON.stringify({
      title: opts.title,
      author: opts.author,
      createdAt: opts.createdAt,
    }),
  )
}

/** Teaches the Reddit mock about a post; without this, reads of it throw. */
function seedRedditPost(
  t3: T3,
  opts?: {score?: number; removed?: boolean},
): void {
  redditPosts.set(t3, {
    score: opts?.score ?? 0,
    removed: opts?.removed ?? false,
  })
}

function getIndex(params?: {
  q?: string
  sort?: string
  page?: number
}): Promise<Response> {
  const search = new URLSearchParams()
  if (params?.q !== undefined) search.set('q', params.q)
  if (params?.sort !== undefined) search.set('sort', params.sort)
  if (params?.page !== undefined) search.set('page', `${params.page}`)
  return fetch(`${serverURL}/${Endpoint.GetIndex}?${search}`)
}

function seedMap(map: MapData): void {
  redisValues.set(`owner:${POST}`, map.ownerId)
  const hash = new Map<string, string>()
  for (const pin of map.pins) hash.set(pin.id, JSON.stringify(pin))
  redisHashes.set(`pins:${POST}`, hash)
}

function postJson(endpoint: Endpoint, body: unknown): Promise<Response> {
  return fetch(`${serverURL}/${endpoint}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  })
}

test('get map: 404 when the post has no map yet', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(rsp.status, 404)
  assert.deepEqual<ErrorRsp>(await rsp.json(), {
    error: 'map not found',
    status: 404,
  })
})

test('get map: owner viewing their own map', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(rsp.status, 200)
  assert.deepEqual<GetMapRsp>(await rsp.json(), {
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
    isOwner: true,
  })
})

test('get map: viewer who is not the owner', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = 't2_viewer' as T2

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as GetMapRsp
  assert.equal(body.isOwner, false)
})

test('add pin: owner adds a pin with only the required fields', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Coffee Shop'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as AddPinRsp
  assert.equal(body.pin.title, 'Coffee Shop')
  assert.deepEqual(body.pin.location, {lat: 10, lng: 20})
  assert.equal(typeof body.pin.id, 'string')
  assert.ok(body.pin.id.length > 0)
  assert.equal(body.pin.category, undefined)
  assert.equal(body.pin.description, undefined)

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await getRsp.json()) as GetMapRsp
  assert.equal(map.pins.length, 1)
  assert.equal(map.pins[0]?.title, 'Coffee Shop')
})

test('add pin: owner adds a pin with every optional field', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {
    location: {lat: 10, lng: 20},
    title: 'Coffee Shop',
    category: 'Food',
    description: 'Great espresso',
    link: 'https://example.com',
  }
  const rsp = await postJson(Endpoint.AddPin, req)
  const body = (await rsp.json()) as AddPinRsp
  assert.equal(body.pin.category, 'Food')
  assert.equal(body.pin.description, 'Great espresso')
  assert.equal(body.pin.link, 'https://example.com')
})

test('add pin: image data URL is uploaded and stored as the hosted URL', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {
    location: {lat: 10, lng: 20},
    title: 'Coffee Shop',
    imageDataUrl: 'data:image/png;base64,AAAA',
  }
  const rsp = await postJson(Endpoint.AddPin, req)
  const body = (await rsp.json()) as AddPinRsp
  assert.equal(
    body.pin.imageUrl,
    'https://i.redd.it/uploaded?src=data%3Aimage%2Fpng%3Bbase64%2CAAAA',
  )
})

test('add pin: a place search pin is marked as one', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {
    location: {lat: 10, lng: 20},
    title: 'Central Park',
    fromPlaceSearch: true,
  }
  const rsp = await postJson(Endpoint.AddPin, req)
  const body = (await rsp.json()) as AddPinRsp
  assert.equal(body.pin.fromPlaceSearch, true)
})

test('add pin: a manually dropped pin is not marked as a place search pin', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'My Spot'}
  const rsp = await postJson(Endpoint.AddPin, req)
  const body = (await rsp.json()) as AddPinRsp
  assert.equal(body.pin.fromPlaceSearch, undefined)
})

test('add pin: a non-owner is forbidden', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = 't2_viewer' as T2

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Coffee Shop'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 403)
  const body = (await rsp.json()) as ErrorRsp
  assert.equal(body.error, 'not authorized')
})

test('add pin: 404 when the post has no map yet', async () => {
  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Coffee Shop'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 404)
})

test('update pin: owner updates title and location, other fields untouched', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Old Name',
        category: 'Food',
      },
    ],
  })

  const req: UpdatePinReq = {
    id: 'p1',
    title: 'New Name',
    location: {lat: 5, lng: 6},
  }
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as UpdatePinRsp
  assert.equal(body.pin.title, 'New Name')
  assert.deepEqual(body.pin.location, {lat: 5, lng: 6})
  assert.equal(body.pin.category, 'Food')
})

test('update pin: a place search pin cannot be moved', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Central Park',
        fromPlaceSearch: true,
      },
    ],
  })

  const req: UpdatePinReq = {id: 'p1', location: {lat: 5, lng: 6}}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 400)
  const body = (await rsp.json()) as ErrorRsp
  assert.equal(body.error, 'a place search pin cannot be moved')

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await getRsp.json()) as GetMapRsp
  assert.deepEqual(map.pins[0]?.location, {lat: 1, lng: 2})
})

test('update pin: a place search pin still takes its other fields', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Central Park',
        fromPlaceSearch: true,
      },
    ],
  })

  const req: UpdatePinReq = {id: 'p1', description: 'Worth the walk'}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as UpdatePinRsp
  assert.equal(body.pin.description, 'Worth the walk')
  assert.equal(body.pin.fromPlaceSearch, true)
  assert.deepEqual(body.pin.location, {lat: 1, lng: 2})
})

test('update pin: an empty string clears an optional field', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [
      {id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe', category: 'Food'},
    ],
  })

  const req: UpdatePinReq = {id: 'p1', category: ''}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  const body = (await rsp.json()) as UpdatePinRsp
  assert.equal(body.pin.category, undefined)
})

test('update pin: a new image data URL replaces the stored image', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        imageUrl: 'https://i.redd.it/old',
      },
    ],
  })

  const req: UpdatePinReq = {
    id: 'p1',
    imageDataUrl: 'data:image/png;base64,BBBB',
  }
  const rsp = await postJson(Endpoint.UpdatePin, req)
  const body = (await rsp.json()) as UpdatePinRsp
  assert.equal(
    body.pin.imageUrl,
    'https://i.redd.it/uploaded?src=data%3Aimage%2Fpng%3Bbase64%2CBBBB',
  )
})

test('update pin: removeImage clears the stored image', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        imageUrl: 'https://i.redd.it/old',
      },
    ],
  })

  const req: UpdatePinReq = {id: 'p1', removeImage: true}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  const body = (await rsp.json()) as UpdatePinRsp
  assert.equal(body.pin.imageUrl, undefined)
})

test('update pin: a non-owner is forbidden', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  requestUserId = 't2_viewer' as T2

  const req: UpdatePinReq = {id: 'p1', title: 'Hijacked'}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 403)
})

test('update pin: 404 when the pin id does not exist', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: UpdatePinReq = {id: 'missing', title: 'x'}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 404)
})

test('delete pin: owner removes a pin', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [
      {id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'},
      {id: 'p2', location: {lat: 3, lng: 4}, title: 'Park'},
    ],
  })

  const req: DeletePinReq = {id: 'p1'}
  const rsp = await postJson(Endpoint.DeletePin, req)
  assert.equal(rsp.status, 200)
  assert.deepEqual<DeletePinRsp>(await rsp.json(), {ok: true})

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await getRsp.json()) as GetMapRsp
  assert.deepEqual(
    map.pins.map(pin => pin.id),
    ['p2'],
  )
})

test('delete pin: a non-owner is forbidden', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  requestUserId = 't2_viewer' as T2

  const req: DeletePinReq = {id: 'p1'}
  const rsp = await postJson(Endpoint.DeletePin, req)
  assert.equal(rsp.status, 403)

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await getRsp.json()) as GetMapRsp
  assert.equal(map.pins.length, 1)
})

test('search places: returns place name and coordinates', async () => {
  const rsp = await fetch(
    `${serverURL}/${Endpoint.SearchPlaces}?q=Central+Park`,
  )
  assert.equal(rsp.status, 200)
  assert.deepEqual<SearchPlacesRsp>(await rsp.json(), {
    results: [
      {name: 'Central Park', location: {lat: 40.785091, lng: -73.968285}},
    ],
  })
})

test('search places: empty query returns no results', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.SearchPlaces}`)
  assert.equal(rsp.status, 200)
  assert.deepEqual<SearchPlacesRsp>(await rsp.json(), {results: []})
})

test('search places: 503 when the subreddit has no API key configured', async () => {
  redisValues.delete(PLACES_KEY)

  const rsp = await fetch(
    `${serverURL}/${Endpoint.SearchPlaces}?q=Central+Park`,
  )
  assert.equal(rsp.status, 503)
})

test("every form the app shows satisfies Devvit's own field rules", async () => {
  for (const endpoint of [
    Endpoint.OnMenuNewPost,
    Endpoint.OnMenuPlacesKey,
    Endpoint.OnMenuDefaultArea,
  ]) {
    const rsp = await fetch(`${serverURL}/${endpoint}`, {method: 'POST'})
    assertValidForm((await rsp.json()) as UiResponse, endpoint)
  }

  // The one form no menu item shows: the pick is raised by a search that found
  // more than one place, so it is reached here the way a moderator reaches it.
  seedModerator()
  placesRspPlaces = [SPRINGFIELD_IL, SPRINGFIELD_MA]
  const req: DefaultAreaFormReq = {place: 'Springfield'}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  assertValidForm((await rsp.json()) as UiResponse, Endpoint.OnFormDefaultArea)
})

/**
 * Devvit validates forms only when one is shown, and reports a violation as a
 * bare string that its error handler then chokes on — so an invalid form
 * reaches a moderator as an unhandled TypeError. These are the rules from
 * `assertValidFormFields`, checked here where they cost nothing.
 */
function assertValidForm(ui: UiResponse, label: string): void {
  const fields = ui.showForm?.form.fields ?? []
  assert.notEqual(fields.length, 0, `${label} showed no fields`)

  const names = new Set<string>()
  for (const field of fields) {
    const name = 'name' in field ? field.name : ''
    assert.equal(names.has(name), false, `${label} repeats "${name}"`)
    names.add(name)
    if (field.type === 'string' && field.isSecret) {
      assert.equal(
        field.scope,
        'app',
        `${label} field "${name}" is secret without scope "app"`,
      )
    }
  }
}

test('places key menu action: reports that a key is stored, never the key', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnMenuPlacesKey}`, {
    method: 'POST',
  })
  assert.equal(rsp.status, 200)

  const ui = (await rsp.json()) as UiResponse
  assert.equal(ui.showForm?.name, PlacesKeyFormName)
  // The stored key is readable right here on the server, so the point of the
  // assertion is that it went nowhere near the response.
  assert.equal(JSON.stringify(ui).includes('test-api-key'), false)
  assert.match(ui.showForm?.form.description ?? '', /A key is stored/)

  const field = ui.showForm?.form.fields[0]
  assert.equal(field?.type === 'string' && field.isSecret, true)
  // Devvit rejects the whole form without this, and says so only at runtime.
  assert.equal(field?.type === 'string' && field.scope, 'app')
  assert.equal(
    field && 'defaultValue' in field ? field.defaultValue : undefined,
    undefined,
  )
})

test('places key menu action: says so when no key is stored', async () => {
  redisValues.delete(PLACES_KEY)

  const rsp = await fetch(`${serverURL}/${Endpoint.OnMenuPlacesKey}`, {
    method: 'POST',
  })
  const ui = (await rsp.json()) as UiResponse
  assert.match(ui.showForm?.form.description ?? '', /No key is stored/)
})

test('places key form: stores a trimmed key that search then uses', async () => {
  seedModerator()
  redisValues.delete(PLACES_KEY)

  const req: PlacesKeyFormReq = {key: '  fresh-api-key  '}
  const rsp = await postJson(Endpoint.OnFormPlacesKey, req)
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(PLACES_KEY), 'fresh-api-key')

  // The key is only ever observable by the effect it has on a search.
  const searchRsp = await fetch(
    `${serverURL}/${Endpoint.SearchPlaces}?q=Central+Park`,
  )
  assert.equal(searchRsp.status, 200)
  assert.equal(placesApiKeySent, 'fresh-api-key')
})

test('places key form: a blank key leaves the stored one alone', async () => {
  seedModerator()
  const req: PlacesKeyFormReq = {key: '   '}
  const rsp = await postJson(Endpoint.OnFormPlacesKey, req)
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(PLACES_KEY), 'test-api-key')
})

test('places key form: removing wins over anything typed alongside it', async () => {
  seedModerator()
  const req: PlacesKeyFormReq = {key: 'ignored-key', remove: true}
  const rsp = await postJson(Endpoint.OnFormPlacesKey, req)
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(PLACES_KEY), undefined)

  const searchRsp = await fetch(
    `${serverURL}/${Endpoint.SearchPlaces}?q=Central+Park`,
  )
  assert.equal(searchRsp.status, 503)
})

test('places key form: a key Google rejects is not stored', async () => {
  seedModerator()
  placesRspStatus = 403

  const req: PlacesKeyFormReq = {key: 'bad-api-key'}
  const rsp = await postJson(Endpoint.OnFormPlacesKey, req)
  assert.equal(rsp.status, 200)

  const ui = (await rsp.json()) as UiResponse
  assert.match(
    typeof ui.showToast === 'object' ? (ui.showToast.text ?? '') : '',
    /rejected/,
  )
  // The key that was already working is still the one stored.
  assert.equal(redisValues.get(PLACES_KEY), 'test-api-key')
})

test("places key form: a spent quota is not the key's fault, so it stores", async () => {
  seedModerator()
  placesRspStatus = 429

  const req: PlacesKeyFormReq = {key: 'rate-limited-key'}
  const rsp = await postJson(Endpoint.OnFormPlacesKey, req)
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(PLACES_KEY), 'rate-limited-key')
})

test('places key form: stores an unverifiable key without claiming it works', async () => {
  seedModerator()
  placesRspStatus = 0

  const req: PlacesKeyFormReq = {key: 'unchecked-key'}
  const rsp = await postJson(Endpoint.OnFormPlacesKey, req)
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(PLACES_KEY), 'unchecked-key')

  const ui = (await rsp.json()) as UiResponse
  const toast = typeof ui.showToast === 'object' ? ui.showToast : undefined
  assert.match(toast?.text ?? '', /could not be reached/)
  // Not a success: the moderator is told the check did not happen.
  assert.equal(toast?.appearance, undefined)
})

test('places key form: removing a key asks Google nothing', async () => {
  seedModerator()
  placesRspStatus = 403

  const req: PlacesKeyFormReq = {remove: true}
  const rsp = await postJson(Endpoint.OnFormPlacesKey, req)
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(PLACES_KEY), undefined)
  assert.equal(placesApiKeySent, null)
})

test('places key form: a reader who does not moderate is forbidden', async () => {
  // `devvit.json` hides the menu item that raises this form from a
  // non-moderator, but that is a menu, not a guard — this route must refuse
  // the submission itself.
  const req: PlacesKeyFormReq = {key: 'stolen-key'}
  const rsp = await postJson(Endpoint.OnFormPlacesKey, req)
  assert.equal(rsp.status, 403)
  assert.equal(redisValues.get(PLACES_KEY), 'test-api-key')
})

test('default area menu action: offers to name a place when none is stored', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnMenuDefaultArea}`, {
    method: 'POST',
  })
  assert.equal(rsp.status, 200)

  const ui = (await rsp.json()) as UiResponse
  assert.equal(ui.showForm?.name, DefaultAreaFormName)
  assert.match(ui.showForm?.form.description ?? '', /whole world/)
})

test('default area menu action: reports the area that is stored', async () => {
  seedArea()

  const rsp = await fetch(`${serverURL}/${Endpoint.OnMenuDefaultArea}`, {
    method: 'POST',
  })
  const ui = (await rsp.json()) as UiResponse
  // The area is not a secret the way the API key is: everyone can see where
  // the maps open, so the moderator is told which place it is.
  assert.match(ui.showForm?.form.description ?? '', /Springfield, IL, USA/)
})

test('default area menu action: says which setting comes first without a key', async () => {
  redisValues.delete(PLACES_KEY)

  const rsp = await fetch(`${serverURL}/${Endpoint.OnMenuDefaultArea}`, {
    method: 'POST',
  })
  const ui = (await rsp.json()) as UiResponse
  assert.equal(ui.showForm, undefined)
  assert.match(toastText(ui), /Places API key/)
})

test('default area form: a single match is stored without a second form', async () => {
  seedModerator()
  const req: DefaultAreaFormReq = {place: 'Central Park'}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  assert.equal(rsp.status, 200)

  const ui = (await rsp.json()) as UiResponse
  assert.equal(ui.showForm, undefined, 'one match is not a choice')
  assert.match(toastText(ui), /Central Park — New York, NY, USA/)
  assert.deepEqual(JSON.parse(redisValues.get(AREA_KEY) ?? 'null'), {
    name: 'Central Park — New York, NY, USA',
    bounds: {west: -73.9819, south: 40.764, east: -73.9498, north: 40.8003},
  })
  // Google's own rectangle for the place, asked for at the same Pro tier the
  // name and location already cost.
  assert.match(placesReqs[0]?.fieldMask ?? '', /places\.viewport/)
})

test('default area form: several matches are offered as a pick', async () => {
  seedModerator()
  placesRspPlaces = [SPRINGFIELD_IL, SPRINGFIELD_MA]

  const req: DefaultAreaFormReq = {place: 'Springfield'}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  const ui = (await rsp.json()) as UiResponse

  assert.equal(ui.showForm?.name, DefaultAreaPickFormName)
  const field = ui.showForm?.form.fields[0]
  assert.equal(field?.type, 'select')
  assert.deepEqual(
    field?.type === 'select' ? field.options.map(option => option.label) : [],
    ['Springfield, IL, USA', 'Springfield, MA, USA'],
  )
  // Picking is the moderator's; nothing is stored on a guess.
  assert.equal(redisValues.get(AREA_KEY), undefined)
})

test('default area pick form: stores the rectangle that was picked', async () => {
  seedModerator()
  const req: DefaultAreaPickFormReq = {
    area: [
      JSON.stringify({
        name: 'Springfield, MA, USA',
        bounds: {
          west: -72.6204,
          south: 42.0501,
          east: -72.4636,
          north: 42.1585,
        },
      }),
    ],
  }
  const rsp = await postJson(Endpoint.OnFormDefaultAreaPick, req)
  assert.equal(rsp.status, 200)

  const ui = (await rsp.json()) as UiResponse
  assert.match(toastText(ui), /Springfield, MA, USA/)
  assert.deepEqual(JSON.parse(redisValues.get(AREA_KEY) ?? 'null'), {
    name: 'Springfield, MA, USA',
    bounds: {west: -72.6204, south: 42.0501, east: -72.4636, north: 42.1585},
  })
})

test('default area pick form: an answer that is not an area changes nothing', async () => {
  seedModerator()
  seedArea()

  // The pick made a round trip through a client, so it is parsed rather than
  // trusted — and a rectangle that is upside down is not a rectangle.
  const req: DefaultAreaPickFormReq = {
    area: [
      JSON.stringify({
        name: 'Nowhere',
        bounds: {west: 0, south: 40, east: 1, north: 30},
      }),
    ],
  }
  const rsp = await postJson(Endpoint.OnFormDefaultAreaPick, req)
  const ui = (await rsp.json()) as UiResponse
  assert.match(toastText(ui), /No change/)
  assert.match(redisValues.get(AREA_KEY) ?? '', /Springfield, IL, USA/)
})

test('default area form: a place Google does not know changes nothing', async () => {
  seedModerator()
  seedArea()
  placesRspPlaces = []

  const req: DefaultAreaFormReq = {place: 'Atlantis'}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  const ui = (await rsp.json()) as UiResponse
  assert.equal(ui.showForm, undefined)
  assert.match(toastText(ui), /No place found/)
  assert.match(redisValues.get(AREA_KEY) ?? '', /Springfield, IL, USA/)
})

test('default area form: a place with no viewport is not an area', async () => {
  seedModerator()
  // Google answers, but with nothing to frame. Squaring a rectangle off around
  // the point would be this app guessing a zoom level; see ADR-0012.
  placesRspPlaces = [{displayName: {text: 'Somewhere'}}]

  const req: DefaultAreaFormReq = {place: 'Somewhere'}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  const ui = (await rsp.json()) as UiResponse
  assert.match(toastText(ui), /No place found/)
  assert.equal(redisValues.get(AREA_KEY), undefined)
})

test('default area form: a blank place leaves the stored area alone', async () => {
  seedModerator()
  seedArea()

  const req: DefaultAreaFormReq = {place: '  '}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  const ui = (await rsp.json()) as UiResponse
  assert.match(toastText(ui), /No change/)
  assert.match(redisValues.get(AREA_KEY) ?? '', /Springfield, IL, USA/)
  assert.equal(placesReqs.length, 0, 'nothing to search for, so nothing asked')
})

test('default area form: removing wins over anything typed alongside it', async () => {
  seedModerator()
  seedArea()

  const req: DefaultAreaFormReq = {place: 'Tokyo', remove: true}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  const ui = (await rsp.json()) as UiResponse
  assert.match(toastText(ui), /removed/)
  assert.equal(redisValues.get(AREA_KEY), undefined)
  assert.equal(placesReqs.length, 0)
})

test('default area form: an unreachable Google changes nothing', async () => {
  seedModerator()
  seedArea()
  placesRspStatus = 0

  const req: DefaultAreaFormReq = {place: 'Tokyo'}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  assert.equal(rsp.status, 200)

  const ui = (await rsp.json()) as UiResponse
  assert.match(toastText(ui), /could not be reached/)
  assert.match(redisValues.get(AREA_KEY) ?? '', /Springfield, IL, USA/)
})

test('default area form: a reader who does not moderate is forbidden', async () => {
  const req: DefaultAreaFormReq = {place: 'Tokyo'}
  const rsp = await postJson(Endpoint.OnFormDefaultArea, req)
  assert.equal(rsp.status, 403)
  assert.equal(placesReqs.length, 0)
})

test('default area pick form: a reader who does not moderate is forbidden', async () => {
  const req: DefaultAreaPickFormReq = {
    area: [
      JSON.stringify({
        name: 'Tokyo',
        bounds: {west: 0, south: 0, east: 1, north: 1},
      }),
    ],
  }
  const rsp = await postJson(Endpoint.OnFormDefaultAreaPick, req)
  assert.equal(rsp.status, 403)
  assert.equal(redisValues.get(AREA_KEY), undefined)
})

test('get map: the default area rides along with every map', async () => {
  seedArea()
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await rsp.json()) as GetMapRsp
  assert.deepEqual(map.defaultArea?.bounds, {
    west: -89.7343,
    south: 39.6907,
    east: -89.5807,
    north: 39.8607,
  })
})

test('get map: no default area where no moderator has set one', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await rsp.json()) as GetMapRsp
  assert.equal(map.defaultArea, undefined)
})

test('get map: a stored area this version cannot read is no area at all', async () => {
  redisValues.set(AREA_KEY, 'not json')
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(rsp.status, 200)
  const map = (await rsp.json()) as GetMapRsp
  assert.equal(map.defaultArea, undefined)
})

test('search places: results are biased towards the default area', async () => {
  seedArea()

  const rsp = await fetch(
    `${serverURL}/${Endpoint.SearchPlaces}?q=Central+Park`,
  )
  assert.equal(rsp.status, 200)
  assert.deepEqual(placesReqs[0]?.body.locationBias, {
    // Google's corners: `low` is the south-west and `high` the north-east.
    rectangle: {
      low: {latitude: 39.6907, longitude: -89.7343},
      high: {latitude: 39.8607, longitude: -89.5807},
    },
  })
})

test('search places: no default area, no bias', async () => {
  await fetch(`${serverURL}/${Endpoint.SearchPlaces}?q=Central+Park`)
  assert.equal(placesReqs[0]?.body.locationBias, undefined)
})

test('search places: a bias Google refuses does not take the search with it', async () => {
  seedArea()
  placesRejectBias = true

  const rsp = await fetch(
    `${serverURL}/${Endpoint.SearchPlaces}?q=Central+Park`,
  )
  assert.equal(rsp.status, 200)
  assert.deepEqual<SearchPlacesRsp>(await rsp.json(), {
    results: [
      {name: 'Central Park', location: {lat: 40.785091, lng: -73.968285}},
    ],
  })
  // The same search again, minus the part Google would not take.
  assert.equal(placesReqs.length, 2)
  assert.equal(placesReqs[1]?.body.locationBias, undefined)
})

test('new post menu action: shows a title form and creates nothing yet', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnMenuNewPost}`, {
    method: 'POST',
  })
  assert.equal(rsp.status, 200)

  const ui = (await rsp.json()) as UiResponse
  assert.equal(ui.showForm?.name, NewPostFormName)
  assert.deepEqual(ui.showForm?.form.fields, [
    {
      type: 'string',
      name: 'title',
      label: 'Title',
      required: true,
      // The username the Owner-to-be would have gotten without being asked.
      defaultValue: "username's Map",
    },
  ])

  assert.equal(submittedPostTitle, undefined)
  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(getRsp.status, 404)
})

test('new post form: creates a post with the submitted title and an empty map', async () => {
  const req: NewPostFormReq = {title: '  Coffee shops of Berlin  '}
  const rsp = await postJson(Endpoint.OnFormNewPost, req)
  assert.equal(rsp.status, 200)
  assert.equal(submittedPostTitle, 'Coffee shops of Berlin')

  const ui = (await rsp.json()) as UiResponse
  assert.equal(ui.navigateTo, `https://reddit.com/r/test_sub/comments/${POST}`)

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(getRsp.status, 200)
  const map = (await getRsp.json()) as GetMapRsp
  assert.equal(map.ownerId, OWNER)
  assert.deepEqual(map.pins, [])
})

test('new post form: a blank title is retypable, not an error', async () => {
  const req: NewPostFormReq = {title: '   '}
  const rsp = await postJson(Endpoint.OnFormNewPost, req)
  assert.equal(rsp.status, 200)

  const ui = (await rsp.json()) as UiResponse
  assert.equal(
    typeof ui.showToast === 'object' && ui.showToast.appearance,
    undefined,
  )
  assert.equal(submittedPostTitle, undefined)
})

test('new post form: rejects a title longer than Reddit allows', async () => {
  const req: NewPostFormReq = {title: 'a'.repeat(PostTitleMaxLen + 1)}
  const rsp = await postJson(Endpoint.OnFormNewPost, req)
  assert.equal(rsp.status, 200)
  assert.equal(submittedPostTitle, undefined)
})

test('add pin: rejects an empty title', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: '   '}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 400)
})

test('add pin: rejects a pin with nowhere to be', async () => {
  seedMap({ownerId: OWNER, pins: []})

  // A stored Pin with no Location throws in the client on every later load and
  // takes the whole Map down with it — for the Owner too, who is then the one
  // person who could have deleted it and has no way left to.
  for (const location of [
    undefined,
    null,
    'somewhere',
    {},
    {lat: 10},
    {lat: 'ten', lng: 20},
    {lat: 91, lng: 20},
    {lat: 10, lng: 181},
    {lat: Number.NaN, lng: 20},
  ]) {
    const req = {location, title: 'Nowhere'} as unknown as AddPinReq
    const rsp = await postJson(Endpoint.AddPin, req)
    assert.equal(rsp.status, 400, `${JSON.stringify(location)}`)
  }

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.deepEqual(((await getRsp.json()) as GetMapRsp).pins, [])
})

test('add pin: rejects a title that is not one', async () => {
  seedMap({ownerId: OWNER, pins: []})

  // A missing title used to throw inside `normalizeTitle`, which is a 500 for
  // what is plainly a bad request.
  for (const title of [undefined, null, 42, {}]) {
    const req = {location: {lat: 10, lng: 20}, title} as unknown as AddPinReq
    const rsp = await postJson(Endpoint.AddPin, req)
    assert.equal(rsp.status, 400, `${JSON.stringify(title)}`)
  }
})

test('update pin: rejects a location that is not one', async () => {
  const pin: Pin = {id: 'p1', location: {lat: 1, lng: 2}, title: 'Original'}
  seedMap({ownerId: OWNER, pins: [pin]})

  const req = {
    id: 'p1',
    location: {lat: 'north', lng: 2},
  } as unknown as UpdatePinReq
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 400)

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await getRsp.json()) as GetMapRsp
  assert.deepEqual(map.pins[0]?.location, {lat: 1, lng: 2})
})

test('add pin: rejects a non-http(s) link', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {
    location: {lat: 10, lng: 20},
    title: 'Coffee Shop',
    link: "javascript:alert('x')",
  }
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 400)
})

test('update pin: rejects an empty title', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })

  const req: UpdatePinReq = {id: 'p1', title: '   '}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 400)
})

test('update pin: rejects a non-http(s) link', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })

  const req: UpdatePinReq = {id: 'p1', link: "javascript:alert('x')"}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 400)
})

function proxyFetch(
  externalUrl: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(
    `${serverURL}/${Endpoint.Proxy}?url=${encodeURIComponent(externalUrl)}`,
    init,
  )
}

test('proxy: forwards an allowlisted host, body bytes intact', async () => {
  const rsp = await proxyFetch(
    'https://tiles.openfreemap.org/planet/14/8000/5000.pbf',
  )
  assert.equal(rsp.status, 200)
  assert.deepEqual(
    new Uint8Array(await rsp.arrayBuffer()),
    new Uint8Array(TILE_BYTES),
  )
  assert.equal(rsp.headers.get('content-type'), 'application/x-protobuf')
  assert.equal(rsp.headers.get('content-length'), `${TILE_BYTES.length}`)
  assert.equal(
    upstreamReqs[0]?.url,
    'https://tiles.openfreemap.org/planet/14/8000/5000.pbf',
  )
})

test('proxy: forwards caching headers but not hop-by-hop or upstream cookies', async () => {
  const rsp = await proxyFetch('https://tiles.openfreemap.org/styles/bright')
  await rsp.arrayBuffer()
  assert.equal(rsp.headers.get('cache-control'), 'public, max-age=86400')
  assert.equal(rsp.headers.get('etag'), TILE_ETAG)
  assert.equal(rsp.headers.get('content-encoding'), null)
  assert.equal(rsp.headers.get('set-cookie'), null)
})

test('proxy: relays a conditional request and its 304', async () => {
  const rsp = await proxyFetch(
    'https://tiles.openfreemap.org/planet/14/8000/5000.pbf',
    {headers: {'If-None-Match': TILE_ETAG}},
  )
  assert.equal(rsp.status, 304)
  assert.equal(await rsp.text(), '')
  assert.equal(upstreamReqs[0]?.headers.get('if-none-match'), TILE_ETAG)
})

test('proxy: passes an upstream 404 through so MapLibre sees the empty tile', async () => {
  const rsp = await proxyFetch('https://tiles.openfreemap.org/missing.pbf')
  assert.equal(rsp.status, 404)
})

test('proxy: 403 for a host that is not allowlisted', async () => {
  const rsp = await proxyFetch('https://evil.example.com/secret')
  assert.equal(rsp.status, 403)
  const body = (await rsp.json()) as ErrorRsp
  assert.equal(body.error, 'host not allowed: evil.example.com')
  assert.deepEqual(upstreamReqs, [])
})

test('proxy: 403 for a host that only looks allowlisted', async () => {
  for (const url of [
    'https://tiles.openfreemap.org.evil.example.com/x',
    'https://evil.example.com/?x=tiles.openfreemap.org',
    'https://sub.tiles.openfreemap.org/x',
  ]) {
    const rsp = await proxyFetch(url)
    assert.equal(rsp.status, 403, url)
    await rsp.body?.cancel()
  }
  assert.deepEqual(upstreamReqs, [])
})

test('proxy: 400 for a non-https URL', async () => {
  for (const url of [
    'http://tiles.openfreemap.org/styles/bright',
    'file:///etc/passwd',
    'not-a-url',
    '/api/map',
  ]) {
    const rsp = await proxyFetch(url)
    assert.equal(rsp.status, 400, url)
    await rsp.body?.cancel()
  }
  assert.deepEqual(upstreamReqs, [])
})

test('proxy: 400 for a URL carrying credentials', async () => {
  const rsp = await proxyFetch('https://user:pw@tiles.openfreemap.org/x')
  assert.equal(rsp.status, 400)
  assert.deepEqual(upstreamReqs, [])
})

test('proxy: 400 when the url parameter is missing', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.Proxy}`)
  assert.equal(rsp.status, 400)
  const body = (await rsp.json()) as ErrorRsp
  assert.equal(body.error, 'url is required')
})

test('proxy: 404 for a non-GET request', async () => {
  const rsp = await proxyFetch('https://tiles.openfreemap.org/styles/bright', {
    method: 'POST',
  })
  assert.equal(rsp.status, 404)
  assert.deepEqual(upstreamReqs, [])
})

test('internal server errors do not leak the stack trace to the client', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await fetch(`${serverURL}/${Endpoint.AddPin}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: 'not json',
  })
  assert.equal(rsp.status, 500)
  const body = (await rsp.json()) as ErrorRsp
  assert.equal(body.error, 'internal server error')
})

test('index: newest first, with pin counts and live scores', async () => {
  const older = 't3_older' as T3
  const newer = 't3_newer' as T3
  seedIndexed(older, {
    title: 'Ferries',
    author: 'anna',
    createdAt: 1_000,
    pins: 12,
  })
  seedIndexed(newer, {
    title: 'Bakeries',
    author: 'bob',
    createdAt: 2_000,
    pins: 3,
  })
  seedRedditPost(older, {score: 34})
  seedRedditPost(newer, {score: 7})

  const rsp = await getIndex()
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => [entry.t3, entry.pinCount, entry.score]),
    [
      [newer, 3, 7],
      [older, 12, 34],
    ],
  )
  assert.deepEqual([body.page, body.pageCount, body.total], [1, 1, 2])
})

test('index: says whether the reader moderates, which is what shows the delete', async () => {
  const listed = 't3_listed' as T3
  seedIndexed(listed, {title: 'Berlin', author: 'anna', createdAt: 1, pins: 1})
  seedRedditPost(listed)

  const reader = (await (await getIndex()).json()) as GetIndexRsp
  assert.equal(reader.isModerator, false)

  seedModerator()
  const mod = (await (await getIndex()).json()) as GetIndexRsp
  assert.equal(mod.isModerator, true)
})

test('index: a map with no pins is not listed', async () => {
  const empty = 't3_empty' as T3
  const full = 't3_full' as T3
  seedIndexed(empty, {
    title: 'Nothing yet',
    author: 'anna',
    createdAt: 2,
    pins: 0,
  })
  seedIndexed(full, {title: 'Something', author: 'anna', createdAt: 1, pins: 1})
  seedRedditPost(empty)
  seedRedditPost(full)

  const body = (await (await getIndex()).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => entry.t3),
    [full],
  )
  assert.equal(body.total, 1)
})

test('index: search matches title and author, either case', async () => {
  const berlin = 't3_berlin' as T3
  const paris = 't3_paris' as T3
  seedIndexed(berlin, {title: 'Coffee in Berlin', author: 'anna', createdAt: 2})
  seedIndexed(paris, {title: 'Paris parks', author: 'BERLINER', createdAt: 1})
  seedRedditPost(berlin)
  seedRedditPost(paris)

  const body = (await (await getIndex({q: 'berlin'})).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => entry.t3),
    [berlin, paris],
  )

  const miss = (await (await getIndex({q: 'lisbon'})).json()) as GetIndexRsp
  assert.deepEqual(miss.entries, [])
  assert.equal(miss.total, 0)
})

test('index: search never matches the pins inside a map', async () => {
  const t3 = 't3_pinned' as T3
  seedIndexed(t3, {title: 'Coffee', author: 'anna', createdAt: 1})
  seedRedditPost(t3)
  redisHashes.set(
    `pins:${t3}`,
    new Map([
      [
        'p1',
        JSON.stringify({
          id: 'p1',
          location: {lat: 1, lng: 2},
          title: 'Berlin Wall',
        }),
      ],
    ]),
  )

  const body = (await (await getIndex({q: 'berlin'})).json()) as GetIndexRsp
  assert.deepEqual(body.entries, [])
})

test('index: top sorts by cached score, ties broken by newest', async () => {
  const top = 't3_top' as T3
  const tiedOld = 't3_tied_old' as T3
  const tiedNew = 't3_tied_new' as T3
  seedIndexed(top, {title: 'Popular', author: 'anna', createdAt: 1, score: 90})
  seedIndexed(tiedOld, {
    title: 'Tied old',
    author: 'bob',
    createdAt: 2,
    score: 5,
  })
  seedIndexed(tiedNew, {
    title: 'Tied new',
    author: 'cat',
    createdAt: 3,
    score: 5,
  })
  for (const t3 of [top, tiedOld, tiedNew]) seedRedditPost(t3)

  const body = (await (await getIndex({sort: 'top'})).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => entry.t3),
    [top, tiedNew, tiedOld],
  )
})

test('index: the live score does not reorder a top sort', async () => {
  const cachedHigh = 't3_cached_high' as T3
  const cachedLow = 't3_cached_low' as T3
  seedIndexed(cachedHigh, {
    title: 'Was popular',
    author: 'anna',
    createdAt: 1,
    score: 50,
  })
  seedIndexed(cachedLow, {
    title: 'Now popular',
    author: 'bob',
    createdAt: 2,
    score: 1,
  })
  seedRedditPost(cachedHigh, {score: 50})
  // Reddit says this one has overtaken the other since the last refresh.
  seedRedditPost(cachedLow, {score: 999})

  const body = (await (await getIndex({sort: 'top'})).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => [entry.t3, entry.score]),
    [
      [cachedHigh, 50],
      [cachedLow, 999],
    ],
  )
})

test('index: pages five at a time and clamps a page past the end', async () => {
  for (let i = 0; i < 7; i++) {
    const t3 = `t3_map${i}` as T3
    seedIndexed(t3, {title: `Map ${i}`, author: 'anna', createdAt: i})
    seedRedditPost(t3)
  }

  const first = (await (await getIndex()).json()) as GetIndexRsp
  assert.equal(first.entries.length, IndexPageSize)
  assert.deepEqual([first.page, first.pageCount, first.total], [1, 2, 7])

  const second = (await (await getIndex({page: 2})).json()) as GetIndexRsp
  assert.equal(second.entries.length, 2)

  const past = (await (await getIndex({page: 9})).json()) as GetIndexRsp
  assert.equal(past.page, 2)
  assert.equal(past.entries.length, 2)
})

test('index: a post Reddit no longer has is unlisted, keeping its map data', async () => {
  const gone = 't3_gone' as T3
  const alive = 't3_alive' as T3
  seedIndexed(gone, {title: 'Deleted', author: 'anna', createdAt: 2})
  seedIndexed(alive, {title: 'Alive', author: 'bob', createdAt: 1})
  seedRedditPost(alive)
  redisValues.set(`owner:${gone}`, OWNER)

  // Off the page from the first failed read; off the index only once the
  // failure has repeated, since one of them says nothing about which of the
  // two things happened.
  for (let load = 1; load <= 3; load++) {
    const body = (await (await getIndex()).json()) as GetIndexRsp
    assert.deepEqual(
      body.entries.map(entry => entry.t3),
      [alive],
      `load ${load}`,
    )
    assert.equal(redisSets.get('index')?.has(gone), load !== 3, `load ${load}`)
  }

  // Gone from every index key, but its Map is left where it is: a misread
  // deletion must not cost someone their Pins.
  assert.equal(redisSets.get('index')?.has(gone), false)
  assert.equal(redisSets.get('index-pins')?.has(gone), false)
  assert.equal(redisSets.get('index-miss')?.has(gone), false)
  assert.equal(redisHashes.get('index-meta')?.has(gone), false)
  assert.equal(redisValues.get(`owner:${gone}`), OWNER)

  const after = (await (await getIndex()).json()) as GetIndexRsp
  assert.equal(after.total, 1)
})

test('index: one failed read of a live post does not unlist it', async () => {
  const flaky = 't3_flaky' as T3
  seedIndexed(flaky, {title: 'Flaky', author: 'anna', createdAt: 2})
  seedIndexed('t3_alive' as T3, {title: 'Alive', author: 'bob', createdAt: 1})
  seedRedditPost('t3_alive' as T3)

  // Reddit rate-limits this one call and answers for it next time — which is
  // the case a single miss used to be indistinguishable from.
  const twice = (await (await getIndex()).json()) as GetIndexRsp
  assert.equal(twice.entries.length, 1)
  assert.equal(redisSets.get('index')?.has(flaky), true)
  assert.equal(redisSets.get('index-miss')?.get(flaky), 1)

  seedRedditPost(flaky, {score: 7})
  const body = (await (await getIndex()).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => entry.t3),
    [flaky, 't3_alive'],
  )
  // And the count is forgotten, so the next miss starts from nothing.
  assert.equal(redisSets.get('index-miss')?.has(flaky), false)
})

test('index: misses have to be consecutive to unlist', async () => {
  const flaky = 't3_flaky' as T3
  seedIndexed(flaky, {title: 'Flaky', author: 'anna', createdAt: 2})
  seedIndexed('t3_alive' as T3, {title: 'Alive', author: 'bob', createdAt: 1})
  seedRedditPost('t3_alive' as T3)

  for (let round = 0; round < 3; round++) {
    await getIndex()
    await getIndex()
    seedRedditPost(flaky)
    await getIndex()
    redditPosts.delete(flaky)
  }

  // Six misses, never three in a row, so the Map Post is still listed.
  assert.equal(redisSets.get('index')?.has(flaky), true)
})

test('index: an outage counts against nobody', async () => {
  seedIndexed('t3_a' as T3, {title: 'A', author: 'anna', createdAt: 2})
  seedIndexed('t3_b' as T3, {title: 'B', author: 'bob', createdAt: 1})

  // Every read failing is Reddit being unreachable, not every post being gone.
  for (let load = 0; load < 4; load++) await getIndex()

  assert.equal(redisSets.get('index')?.has('t3_a'), true)
  assert.equal(redisSets.get('index')?.has('t3_b'), true)
  assert.equal(redisSets.get('index-miss')?.size ?? 0, 0)
})

test('index: a removed post is hidden but stays indexed', async () => {
  const removed = 't3_removed' as T3
  const alive = 't3_alive' as T3
  seedIndexed(removed, {title: 'Removed', author: 'anna', createdAt: 2})
  seedIndexed(alive, {title: 'Alive', author: 'bob', createdAt: 1})
  seedRedditPost(removed, {removed: true})
  seedRedditPost(alive)

  const body = (await (await getIndex()).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => entry.t3),
    [alive],
  )
  // A moderator can put it back, so the index keeps it.
  assert.equal(redisSets.get('index')?.has(removed), true)
})

test('index: an unreachable Reddit omits scores and unlists nothing', async () => {
  const first = 't3_first' as T3
  const second = 't3_second' as T3
  seedIndexed(first, {title: 'One', author: 'anna', createdAt: 2, score: 12})
  seedIndexed(second, {title: 'Two', author: 'bob', createdAt: 1, score: 4})
  // Neither is seeded into the Reddit mock, so every read throws.

  const body = (await (await getIndex()).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => [entry.t3, entry.score]),
    [
      [first, undefined],
      [second, undefined],
    ],
  )
  assert.equal(redisSets.get('index')?.size, 2)
})

test('create map post: indexes the new map, which stays unlisted until it has a pin', async () => {
  const req: CreateMapPostReq = {title: '  Coffee shops of Berlin  '}
  const rsp = await postJson(Endpoint.CreateMapPost, req)
  assert.equal(rsp.status, 200)
  assert.equal(submittedPostTitle, 'Coffee shops of Berlin')
  // A Map Post takes the default entrypoint; only an Index Post names one.
  assert.equal(submittedPostEntry, undefined)
  assert.deepEqual<CreateMapPostRsp>(await rsp.json(), {
    url: `https://reddit.com/r/test_sub/comments/${POST}`,
  })

  seedRedditPost(POST)
  const empty = (await (await getIndex()).json()) as GetIndexRsp
  assert.equal(empty.total, 0)

  const pin: AddPinReq = {location: {lat: 1, lng: 2}, title: 'Cafe'}
  assert.equal((await postJson(Endpoint.AddPin, pin)).status, 200)

  const listed = (await (await getIndex()).json()) as GetIndexRsp
  assert.deepEqual(
    listed.entries.map(entry => [entry.title, entry.author, entry.pinCount]),
    [['Coffee shops of Berlin', 'username', 1]],
  )
})

test('create map post: deleting the last pin unlists the map again', async () => {
  assert.equal(
    (await postJson(Endpoint.CreateMapPost, {title: 'Berlin'})).status,
    200,
  )
  seedRedditPost(POST)
  const add = (await (
    await postJson(Endpoint.AddPin, {
      location: {lat: 1, lng: 2},
      title: 'Cafe',
    })
  ).json()) as AddPinRsp
  assert.equal(((await (await getIndex()).json()) as GetIndexRsp).total, 1)

  const del: DeletePinReq = {id: add.pin.id}
  assert.equal((await postJson(Endpoint.DeletePin, del)).status, 200)
  assert.equal(((await (await getIndex()).json()) as GetIndexRsp).total, 0)
})

test('create map post: rejects a blank title and one longer than Reddit allows', async () => {
  assert.equal(
    (await postJson(Endpoint.CreateMapPost, {title: '  '})).status,
    400,
  )
  assert.equal(
    (
      await postJson(Endpoint.CreateMapPost, {
        title: 'a'.repeat(PostTitleMaxLen + 1),
      })
    ).status,
    400,
  )
  assert.equal(submittedPostTitle, undefined)
})

test('index post form: creates a post on the index entrypoint and indexes nothing', async () => {
  seedModerator()
  const req: IndexPostFormReq = {title: '  r/test_sub Community Maps  '}
  const rsp = await postJson(Endpoint.OnFormNewIndexPost, req)
  assert.equal(rsp.status, 200)
  assert.equal(submittedPostTitle, 'r/test_sub Community Maps')
  assert.equal(submittedPostEntry, 'index')

  const ui = (await rsp.json()) as UiResponse
  assert.equal(ui.navigateTo, `https://reddit.com/r/test_sub/comments/${POST}`)
  // An Index Post holds no state of its own — that is what lets a subreddit
  // have any number of them without them disagreeing.
  assert.equal(redisSets.get('index')?.size ?? 0, 0)
  assert.equal(redisValues.get(`owner:${POST}`), undefined)
})

test('index post form: a blank title is retypable, not an error', async () => {
  seedModerator()
  const rsp = await postJson(Endpoint.OnFormNewIndexPost, {title: '   '})
  assert.equal(rsp.status, 200)
  assert.equal(submittedPostTitle, undefined)
})

test('index post form: a reader who does not moderate is forbidden', async () => {
  const req: IndexPostFormReq = {title: 'r/test_sub Community Maps'}
  const rsp = await postJson(Endpoint.OnFormNewIndexPost, req)
  assert.equal(rsp.status, 403)
  assert.equal(submittedPostTitle, undefined)
})

test('index post menu: offers the subreddit-named default', async () => {
  const rsp = await postJson(Endpoint.OnMenuNewIndexPost, {})
  const ui = (await rsp.json()) as UiResponse
  const field =
    typeof ui.showForm === 'object' ? ui.showForm.form.fields[0] : undefined
  assert.equal(
    field && 'defaultValue' in field ? field.defaultValue : undefined,
    'r/test_sub Community Maps',
  )
})

test('delete index post: a moderator deletes it and the maps are untouched', async () => {
  const mapPost = 't3_map' as T3
  seedOwnedMap(mapPost)
  seedIndexed(mapPost, {title: "anna's Map", author: 'anna', createdAt: 1})
  seedRedditPost(POST)
  seedModerator()

  const rsp = await postJson(Endpoint.DeleteIndexPost, {})
  assert.equal(rsp.status, 200)
  assert.deepEqual<DeleteIndexPostRsp>(await rsp.json(), {ok: true})
  assert.deepEqual(deletedPosts, [POST])

  // An Index Post owns nothing and is owned by nothing, so taking one away
  // leaves the Maps it listed whole and still listed.
  assert.equal(redisValues.get(`owner:${mapPost}`), OWNER)
  assert.equal(redisSets.get('index')?.has(mapPost), true)
})

test('delete index post: a reader who does not moderate is forbidden', async () => {
  seedRedditPost(POST)

  const rsp = await postJson(Endpoint.DeleteIndexPost, {})
  assert.equal(rsp.status, 403)
  assert.deepEqual(deletedPosts, [])
})

test('delete index post: a moderator of another subreddit is forbidden', async () => {
  seedRedditPost(POST)
  moderators.push({username: 'username', subredditName: 'other_sub'})

  const rsp = await postJson(Endpoint.DeleteIndexPost, {})
  assert.equal(rsp.status, 403)
  assert.deepEqual(deletedPosts, [])
})

test('delete index post: an unreachable Reddit is not a yes', async () => {
  seedRedditPost(POST)
  moderatorsUnreadable = true

  const rsp = await postJson(Endpoint.DeleteIndexPost, {})
  assert.equal(rsp.status, 403)
  assert.deepEqual(deletedPosts, [])
})

test('delete index post: a Map Post cannot be deleted through this route', async () => {
  // The owner check is the other route's; this one refuses before it gets
  // there, because a Map Post is not an Index Post whoever is asking.
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  seedRedditPost(POST)
  seedModerator()

  const rsp = await postJson(Endpoint.DeleteIndexPost, {})
  assert.equal(rsp.status, 400)
  assert.deepEqual(deletedPosts, [])
  assert.equal(redisValues.get(`owner:${POST}`), OWNER)
  assert.equal(redisHashes.get(`pins:${POST}`)?.size, 1)
})

test('refresh scores: caches what Reddit says and moves the cursor on', async () => {
  const first = 't3_first' as T3
  const second = 't3_second' as T3
  seedIndexed(first, {title: 'One', author: 'anna', createdAt: 1, score: 0})
  seedIndexed(second, {title: 'Two', author: 'bob', createdAt: 2, score: 0})
  seedRedditPost(first, {score: 11})
  seedRedditPost(second, {score: 22})

  const rsp = await postJson(Endpoint.OnTaskRefreshScores, {})
  assert.equal(rsp.status, 200)
  assert.equal(redisSets.get('index-score')?.get(first), 11)
  assert.equal(redisSets.get('index-score')?.get(second), 22)
  // Both fit in one batch, so the cursor wraps back to the start.
  assert.equal(redisValues.get('index-cursor'), '0')
})

test('refresh scores: works past one chunk, and banks the cursor as it goes', async () => {
  // More rows than one chunk of Reddit reads, so the run has to make several
  // and end up in the right place regardless of where the chunks fell.
  for (let n = 0; n < 60; n++) {
    const t3 = `t3_row${n}` as T3
    seedIndexed(t3, {title: `Row ${n}`, author: 'anna', createdAt: n, score: 0})
    seedRedditPost(t3, {score: n})
  }

  assert.equal((await postJson(Endpoint.OnTaskRefreshScores, {})).status, 200)
  assert.equal(redisSets.get('index-score')?.get('t3_row0' as T3), 0)
  assert.equal(redisSets.get('index-score')?.get('t3_row59' as T3), 59)
  // All 60 fit in one batch, so the cursor comes back round to the start.
  assert.equal(redisValues.get('index-cursor'), '0')
})

test('refresh scores: a map with no pins is not worth a read', async () => {
  const listed = 't3_listed' as T3
  const empty = 't3_empty' as T3
  seedIndexed(listed, {title: 'One', author: 'anna', createdAt: 1, score: 0})
  seedIndexed(empty, {title: 'Two', author: 'bob', createdAt: 2, pins: 0})
  seedRedditPost(listed, {score: 5})
  seedRedditPost(empty, {score: 99})

  assert.equal((await postJson(Endpoint.OnTaskRefreshScores, {})).status, 200)
  assert.equal(redisSets.get('index-score')?.get(listed), 5)
  // No Sort can reach it, so the batch is not spent on it.
  assert.equal(redisSets.get('index-score')?.has(empty), false)
})

test('refresh scores: a post Reddit will not answer for keeps its cached score', async () => {
  const readable = 't3_readable' as T3
  const unreadable = 't3_unreadable' as T3
  seedIndexed(readable, {title: 'One', author: 'anna', createdAt: 1, score: 3})
  seedIndexed(unreadable, {title: 'Two', author: 'bob', createdAt: 2, score: 9})
  seedRedditPost(readable, {score: 30})

  assert.equal((await postJson(Endpoint.OnTaskRefreshScores, {})).status, 200)
  assert.equal(redisSets.get('index-score')?.get(readable), 30)
  assert.equal(redisSets.get('index-score')?.get(unreadable), 9)
  // Unlisting is the read path's job, not the cron's.
  assert.equal(redisSets.get('index')?.has(unreadable), true)
})

test('delete post: the owner deletes the post and everything stored under it', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  seedIndexed(POST, {title: 'Berlin', author: 'username', createdAt: 1})
  seedRedditPost(POST)

  const rsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(rsp.status, 200)
  assert.deepEqual<DeletePostRsp>(await rsp.json(), {ok: true})

  assert.deepEqual(deletedPosts, [POST])
  assert.equal(redisValues.get(`owner:${POST}`), undefined)
  assert.equal(redisHashes.get(`pins:${POST}`)?.size ?? 0, 0)
  assert.equal(redisSets.get('index')?.has(POST), false)
  assert.equal(redisHashes.get('index-meta')?.has(POST), false)
})

test('delete post: a viewer cannot delete someone else s map', async () => {
  seedMap({ownerId: OWNER, pins: []})
  seedIndexed(POST, {title: 'Berlin', author: 'username', createdAt: 1})
  seedRedditPost(POST)
  requestUserId = 't2_viewer' as T2

  const rsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(rsp.status, 403)
  assert.deepEqual(deletedPosts, [])
  assert.equal(redisValues.get(`owner:${POST}`), OWNER)
  assert.equal(redisSets.get('index')?.has(POST), true)
})

test('delete post: 404 when the post has no map', async () => {
  const rsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(rsp.status, 404)
  assert.deepEqual(deletedPosts, [])
})

test('delete post: a map Reddit refuses to delete is left whole', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  seedIndexed(POST, {title: 'Berlin', author: 'username', createdAt: 1})
  // Not seeded into the Reddit mock, so reading the post throws.

  const rsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(rsp.status, 500)
  // Reddit goes first precisely so this is the failure: nothing was erased
  // under a Post that is still standing.
  assert.equal(redisValues.get(`owner:${POST}`), OWNER)
  assert.equal(redisHashes.get(`pins:${POST}`)?.size, 1)
  assert.equal(redisSets.get('index')?.has(POST), true)
})
