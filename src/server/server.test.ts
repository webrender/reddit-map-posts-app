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
  type AddRegionReq,
  type AddRegionRsp,
  type CreateMapPostReq,
  type CreateMapPostRsp,
  type DeleteIndexPostRsp,
  type DeletePinReq,
  type DeletePinRsp,
  type DeletePostRsp,
  Endpoint,
  type ErrorRsp,
  type GetIndexRsp,
  type GetMapRsp,
  type ImportMapReq,
  type ImportMapRsp,
  IndexPageSize,
  type IndexPostFormReq,
  MapKind,
  MapSummaryMaxLen,
  NewPostFormName,
  type NewPostFormReq,
  type Pin,
  PostTitleMaxLen,
  type Region,
  type SetDefaultAreaReq,
  type SetSummaryReq,
  type SetSummaryRsp,
  type UpdatePinReq,
  type UpdatePinRsp,
  type UpdateRegionReq,
  type UpdateRegionRsp,
} from '../shared/api.ts'
import {
  PinImportMaxCount,
  RegionMaxCount,
  RegionNameMaxLen,
  RegionVertexMaxCount,
} from '../shared/map-file.ts'
import type {MapData} from './db.ts'
import {onReq} from './server.ts'

const OWNER = 't2_owner' as T2
/** A Contributor on a Collaborative Map — never the Owner, never a Moderator. */
const CONTRIBUTOR = 't2_contributor' as T2
/** A second Contributor, for "someone else's Pin" tests. */
const OTHER_CONTRIBUTOR = 't2_other_contributor' as T2
/** A Moderator who is not the Owner. */
const MODERATOR = 't2_moderator' as T2
const POST = 't3_123' as T3
/** Mirrors the install-scoped key `db.ts` writes the Default Area under. */
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
const redisHLen = redis.hLen.bind(redis)
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
/** `undefined` stands for a logged-out reader — a real, testable state now that ADR-0019's fallback closes a hole on exactly that case. */
let requestUserId: T2 | undefined = OWNER

/**
 * Derives a username from a userId. `OWNER` keeps its pre-existing username,
 * since a long list of tests already assert against it by that name; every
 * other `T2` strips its `t2_` prefix, giving every distinct test user a
 * distinct, readable username for free.
 */
function usernameForId(userId: T2): string {
  return userId === OWNER ? 'username' : userId.replace(/^t2_/, '')
}

/**
 * The same, for `context.username` in the harness — which actually tracks
 * `requestUserId` now instead of the whole app running as one constant
 * `'username'` no matter who is asking. `undefined` stays `undefined`, same
 * as a logged-out `context.username` really is.
 */
function usernameFor(userId: T2 | undefined): string | undefined {
  return userId ? usernameForId(userId) : undefined
}
let submittedPostTitle: string | undefined
/** Which `post.entrypoints` key the last submitted post asked to render. */
let submittedPostEntry: string | undefined
/** Which account the last submitted post was submitted as. */
let submittedPostRunAs: string | undefined
/** What the last submitted post offered a safety report to act against. */
let submittedPostUgc: {text: string} | undefined
/** Every external URL the server fetched, with the headers it forwarded. */
let upstreamReqs: {url: string; headers: Headers}[] = []

/** A rectangle a moderator framed, as the client reads one off the Map. */
const SPRINGFIELD_IL = {
  west: -89.7343,
  south: 39.6907,
  east: -89.5807,
  north: 39.8607,
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
  redis.hLen = async key => redisHashes.get(key)?.size ?? 0
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
      del: async (...keys: string[]) => {
        ops.push(() => redis.del(...keys))
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
    submittedPostRunAs = opts.runAs
    submittedPostUgc = opts.userGeneratedContent
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
      moderatorReadCount++
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
        username: usernameFor(requestUserId),
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
  redis.hLen = redisHLen
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
  submittedPostTitle = undefined
  submittedPostEntry = undefined
  submittedPostRunAs = undefined
  submittedPostUgc = undefined
  upstreamReqs = []
  moderators = []
  moderatorsUnreadable = false
  moderatorReadCount = 0
})

/** What Reddit will say about a post id, for the reads an Index Post makes. */
const redditPosts = new Map<
  T3,
  {score: number; removed: boolean; removedByCategory?: string}
>()
/** Every post the app asked Reddit to delete, in order. */
let deletedPosts: T3[] = []
/** Who moderates what, as Reddit would answer it. */
let moderators: {username: string; subredditName: string}[] = []
/** When set, every moderator read throws, standing for an unreachable Reddit. */
let moderatorsUnreadable = false
/**
 * How many times `reddit.getModerators(...).all()` has actually been
 * awaited — the Reddit round trip `requireCollabPinAccess` is supposed to
 * defer until the fast path (a Contributor editing their own Pin, or a Solo
 * Owner) has already said no. See ADR-0019.
 */
let moderatorReadCount = 0

/** Makes the given user (the request's, by default) a moderator of this subreddit. */
function seedModerator(userId: T2 = OWNER): void {
  moderators.push({username: usernameForId(userId), subredditName: 'test_sub'})
}

/** Gives the subreddit a Default Area, as a moderator's framing would leave one. */
function seedArea(): void {
  redisValues.set(AREA_KEY, JSON.stringify(SPRINGFIELD_IL))
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
    /** Left out entirely by default — a row from before this field existed. */
    collaborative?: boolean
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
      ...(opts.collaborative === undefined
        ? {}
        : {collaborative: opts.collaborative}),
    }),
  )
}

/**
 * Teaches the Reddit mock about a post; without this, reads of it throw.
 *
 * A throw is Reddit failing to answer, which is *not* what deletion looks like:
 * Reddit answers for a deleted post with a tombstone, which is
 * `removedByCategory` and nothing else.
 */
function seedRedditPost(
  t3: T3,
  opts?: {score?: number; removed?: boolean; removedByCategory?: string},
): void {
  redditPosts.set(t3, {
    score: opts?.score ?? 0,
    removed: opts?.removed ?? false,
    ...(opts?.removedByCategory === undefined
      ? {}
      : {removedByCategory: opts.removedByCategory}),
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

/**
 * A Map on {@link POST}, as `dbCreateMap` and the Pin routes would leave it.
 * `collaborative` and `ownerName` are optional so the many Solo-Map tests
 * that predate them need no changes; `ownerName`, when given, is written into
 * `index-meta` the way `dbGetMap` actually reads it back — denormalized
 * there at creation, not on a key of its own.
 */
function seedMap(
  map: Pick<MapData, 'ownerId' | 'pins'> &
    Partial<Pick<MapData, 'collaborative' | 'ownerName'>>,
): void {
  redisValues.set(`owner:${POST}`, map.ownerId)
  const hash = new Map<string, string>()
  for (const pin of map.pins) hash.set(pin.id, JSON.stringify(pin))
  redisHashes.set(`pins:${POST}`, hash)
  if (map.collaborative) redisValues.set(`kind:${POST}`, 'collaborative')
  if (map.ownerName !== undefined) {
    let meta = redisHashes.get('index-meta')
    if (!meta) {
      meta = new Map()
      redisHashes.set('index-meta', meta)
    }
    meta.set(
      POST,
      JSON.stringify({title: '', author: map.ownerName, createdAt: 0}),
    )
  }
}

/** A Collaborative Map on {@link POST} — see {@link seedMap}. */
function seedCollabMap(
  map: Pick<MapData, 'ownerId' | 'pins'> & Partial<Pick<MapData, 'ownerName'>>,
): void {
  seedMap({...map, collaborative: true})
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

/** Writes a Summary as whoever the request is currently from. */
function setSummary(summary: string): Promise<Response> {
  return postJson(Endpoint.SetSummary, {summary} satisfies SetSummaryReq)
}

test('set summary: the owner writes one, and the map hands it back', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await setSummary('  Cafes worth the walk.  ')
  assert.equal(rsp.status, 200)
  // Trimmed on the way in, and answered with what was actually stored.
  assert.deepEqual<SetSummaryRsp>(await rsp.json(), {
    summary: 'Cafes worth the walk.',
  })

  const map = (await (
    await fetch(`${serverURL}/${Endpoint.GetMap}`)
  ).json()) as GetMapRsp
  assert.equal(map.summary, 'Cafes worth the walk.')
})

test('set summary: a map with none has no summary field at all', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const map = (await (
    await fetch(`${serverURL}/${Endpoint.GetMap}`)
  ).json()) as GetMapRsp
  // Absent, not empty — the shape `defaultArea` already uses.
  assert.equal('summary' in map, false)
})

test('set summary: an empty string clears it', async () => {
  seedMap({ownerId: OWNER, pins: []})
  await setSummary('Something')

  const rsp = await setSummary('   ')
  assert.equal(rsp.status, 200)
  assert.deepEqual<SetSummaryRsp>(await rsp.json(), {})

  const map = (await (
    await fetch(`${serverURL}/${Endpoint.GetMap}`)
  ).json()) as GetMapRsp
  assert.equal(map.summary, undefined)
})

test('set summary: one longer than the ceiling is refused', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await setSummary('x'.repeat(MapSummaryMaxLen + 1))
  assert.equal(rsp.status, 400)
  const body = (await rsp.json()) as ErrorRsp
  assert.equal(
    body.error,
    `summary must be ${MapSummaryMaxLen} characters or fewer`,
  )
})

test('set summary: a viewer is forbidden', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = 't2_viewer' as T2

  const rsp = await setSummary('Mine now')
  assert.equal(rsp.status, 403)
})

test('set summary: logged out is forbidden', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = undefined

  const rsp = await setSummary('Mine now')
  assert.equal(rsp.status, 403)
})

test('set summary: a moderator who is not the Owner is forbidden on a Solo Map', async () => {
  // Moderating grants nothing on a Solo Map — the same rule the Pin routes
  // hold to. See ADR-0019.
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const rsp = await setSummary('Taken down')
  assert.equal(rsp.status, 403)
  // And it never asked Reddit: the Solo branch cannot be changed by the answer.
  assert.equal(moderatorReadCount, 0)
})

test('set summary: a moderator may write one on a Collaborative Map', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const rsp = await setSummary('Please keep pins inside the city.')
  assert.equal(rsp.status, 200)
})

test('set summary: a contributor is forbidden on a Collaborative Map', async () => {
  // A Contributor's rights are exactly their own Pins; the Summary is the
  // Post's, and the Post is the Owner's. See ADR-0020.
  seedCollabMap({ownerId: OWNER, pins: []})
  requestUserId = CONTRIBUTOR

  const rsp = await setSummary('Mine now')
  assert.equal(rsp.status, 403)
})

test('set summary: the owner of a Collaborative Map pays no moderator round trip', async () => {
  // ADR-0019's cost rule: `isModerator()` is only reached once the Owner check
  // has already failed.
  seedCollabMap({ownerId: OWNER, pins: []})

  const rsp = await setSummary('Ours.')
  assert.equal(rsp.status, 200)
  assert.equal(moderatorReadCount, 0)
})

test('set summary: 404 when the post has no map yet', async () => {
  const rsp = await setSummary('Nothing to describe')
  assert.equal(rsp.status, 404)
})

test('delete map: the summary goes with it', async () => {
  seedMap({ownerId: OWNER, pins: []})
  seedRedditPost(POST)
  await setSummary('Cafes worth the walk.')

  const rsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(rsp.status, 200)
  // An orphaned key here would be invisible and permanent.
  assert.equal(redisValues.has(`summary:${POST}`), false)
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
    ownerName: '',
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
    isOwner: true,
    collaborative: false,
    isModerator: false,
    regions: [],
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

test('add pin: a non-owner is forbidden', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = 't2_viewer' as T2

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Coffee Shop'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 403)
  const body = (await rsp.json()) as ErrorRsp
  assert.equal(body.error, 'not authorized')
})

test('add pin: a moderator who is not the Owner is forbidden on a Solo Map', async () => {
  // The collaborative rule — a Moderator may add/edit/delete any Pin — must
  // not leak onto a Solo Map, where moderating grants nothing. See ADR-0019.
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Coffee Shop'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 403)
})

test('add pin: logged out is forbidden', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = undefined

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Coffee Shop'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 403)
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

test('update pin: a moderator who is not the Owner is forbidden on a Solo Map', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const req: UpdatePinReq = {id: 'p1', title: 'Hijacked'}
  const rsp = await postJson(Endpoint.UpdatePin, req)
  assert.equal(rsp.status, 403)
})

test('update pin: logged out is forbidden', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  requestUserId = undefined

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

test('delete pin: a moderator who is not the Owner is forbidden on a Solo Map', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const req: DeletePinReq = {id: 'p1'}
  const rsp = await postJson(Endpoint.DeletePin, req)
  assert.equal(rsp.status, 403)
})

test('delete pin: logged out is forbidden', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  requestUserId = undefined

  const req: DeletePinReq = {id: 'p1'}
  const rsp = await postJson(Endpoint.DeletePin, req)
  assert.equal(rsp.status, 403)
})

/** The pins currently on {@link POST}, straight out of the fake Redis. */
function storedPins(): Pin[] {
  const hash = redisHashes.get(`pins:${POST}`) ?? new Map()
  return [...hash.values()].map(json => JSON.parse(json) as Pin)
}

/** The Index Post's cached count for this Map. */
function storedPinCount(): number | undefined {
  return redisSets.get('index-pins')?.get(POST)
}

test('delete pin: two deletes of the same pin leave the cached count down by exactly one', async () => {
  // The concurrency `dbDeletePin` used to get wrong: two writers — an author
  // and a Moderator, now that both can hit Delete on the same card — racing
  // to delete one Pin used to double-decrement `index-pins`. `hDel`'s own
  // return count fixes it, and needs no concurrency mock to prove: called
  // twice in sequence, exactly one of the two calls actually removes anything.
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  redisSet_('index-pins').set(POST, 1)

  const req: DeletePinReq = {id: 'p1'}
  const first = await postJson(Endpoint.DeletePin, req)
  const second = await postJson(Endpoint.DeletePin, req)
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(storedPinCount(), 0)
})

test('import pins: owner adds a whole export at once', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })

  const req: ImportMapReq = {
    pins: [
      {title: 'Park', location: {lat: 3, lng: 4}, category: 'Outdoors'},
      {
        title: 'Museum',
        location: {lat: 5, lng: 6},
        description: 'Closed Mondays',
        link: 'https://example.com/',
      },
    ],
  }
  const rsp = await postJson(Endpoint.ImportMap, req)
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as ImportMapRsp
  assert.equal(body.pins.length, 2)
  assert.equal(body.droppedImages, 0)
  assert.deepEqual(
    body.pins.map(pin => pin.title),
    ['Park', 'Museum'],
  )
  assert.equal(body.pins[0]?.category, 'Outdoors')
  assert.equal(body.pins[1]?.link, 'https://example.com/')

  // Added, never replaced: the Pin that was already there is still there.
  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await getRsp.json()) as GetMapRsp
  assert.equal(map.pins.length, 3)
  assert.ok(map.pins.some(pin => pin.id === 'p1'))
})

test('import pins: every pin gets a fresh id, whatever the export said', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })

  // An id in the text must not be able to overwrite a Pin already on the Map.
  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [{id: 'p1', title: 'Impostor', location: {lat: 3, lng: 4}}],
  })
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as ImportMapRsp
  assert.notEqual(body.pins[0]?.id, 'p1')
  assert.equal(storedPins().length, 2)
  assert.ok(storedPins().some(pin => pin.title === 'Cafe'))
})

test('import pins: the cached count rises by exactly what landed', async () => {
  seedMap({ownerId: OWNER, pins: []})
  redisSets.set('index-pins', new Map([[POST, 0]]))

  const req: ImportMapReq = {
    pins: [
      {title: 'A', location: {lat: 1, lng: 2}},
      {title: 'B', location: {lat: 3, lng: 4}},
      {title: 'C', location: {lat: 5, lng: 6}},
    ],
  }
  await postJson(Endpoint.ImportMap, req)
  assert.equal(storedPinCount(), 3)
})

test('import pins: a Reddit-hosted image survives, another host does not', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: ImportMapReq = {
    pins: [
      {
        title: 'Kept',
        location: {lat: 1, lng: 2},
        imageUrl: 'https://i.redd.it/abc.jpg',
      },
      {
        title: 'Dropped',
        location: {lat: 3, lng: 4},
        imageUrl: 'https://evil.example/abc.jpg',
      },
      {
        title: 'Also dropped',
        location: {lat: 5, lng: 6},
        imageUrl: 'https://i.redd.it.evil.example/abc.jpg',
      },
    ],
  }
  const rsp = await postJson(Endpoint.ImportMap, req)
  const body = (await rsp.json()) as ImportMapRsp
  assert.equal(body.droppedImages, 2)
  assert.equal(body.pins[0]?.imageUrl, 'https://i.redd.it/abc.jpg')
  assert.equal(body.pins[1]?.imageUrl, undefined)
  assert.equal(body.pins[2]?.imageUrl, undefined)
  // The picture is dropped; the Pin is not.
  assert.equal(body.pins.length, 3)
})

test('import pins: one bad entry writes none of them', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req = {
    pins: [
      {title: 'Fine', location: {lat: 1, lng: 2}},
      {title: 'Broken', location: {lat: 91, lng: 2}},
      {title: 'Also fine', location: {lat: 5, lng: 6}},
    ],
  }
  const rsp = await postJson(Endpoint.ImportMap, req)
  assert.equal(rsp.status, 400)
  const body = (await rsp.json()) as ErrorRsp
  assert.match(body.error, /Pin 2 \("Broken"\)/)
  assert.equal(storedPins().length, 0)
  assert.equal(storedPinCount(), undefined)
})

test('import pins: a pin with no title is refused', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [{location: {lat: 1, lng: 2}}],
  })
  assert.equal(rsp.status, 400)
  assert.equal(storedPins().length, 0)
})

test('import pins: nothing to add is refused rather than silently doing nothing', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await postJson(Endpoint.ImportMap, {pins: []})
  assert.equal(rsp.status, 400)
})

test('import pins: more than one import may carry is refused', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const many = Array.from({length: PinImportMaxCount + 1}, (_, i) => ({
    title: `Pin ${i}`,
    location: {lat: 1, lng: 2},
  }))
  const rsp = await postJson(Endpoint.ImportMap, {pins: many})
  assert.equal(rsp.status, 400)
  assert.equal(storedPins().length, 0)
})

test('import pins: a non-owner is forbidden', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = 't2_viewer' as T2

  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [{title: 'A', location: {lat: 1, lng: 2}}],
  })
  assert.equal(rsp.status, 403)
  assert.equal(storedPins().length, 0)
})

test('import pins: a moderator who is not the Owner is forbidden, even on a Collaborative Map', async () => {
  // Import is a 500-Pin bulk add — a flooding vector this app keeps
  // Owner-only regardless of who else may touch individual Pins.
  seedCollabMap({ownerId: OWNER, pins: []})
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [{title: 'A', location: {lat: 1, lng: 2}}],
  })
  assert.equal(rsp.status, 403)
  assert.equal(storedPins().length, 0)
})

test('import pins: 404 when the post has no map', async () => {
  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [{title: 'A', location: {lat: 1, lng: 2}}],
  })
  assert.equal(rsp.status, 404)
})

test('import pins: a location given as a maps link is refused, not resolved', async () => {
  seedMap({ownerId: OWNER, pins: []})

  // The format has no field a URL can be a Location in, which is the whole of
  // what keeps ADR-0015 true of a route that takes a list. See ADR-0017.
  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [
      {
        title: 'Somewhere',
        location: 'https://www.google.com/maps/@35.6586,139.7454,17z',
      },
    ],
  })
  assert.equal(rsp.status, 400)
  assert.equal(storedPins().length, 0)
  // And nothing was fetched to find out where that link goes.
  assert.deepEqual(upstreamReqs, [])
})

// --- Collaborative Maps -----------------------------------------------
//
// See ADR-0019. Where a Solo-Map test above already covers a rule that also
// holds here (a bad title, a bad location, 404s that don't depend on who is
// asking), it is not repeated — this section is about what is *different*:
// who may touch a Pin, and what a Pin remembers about who added it.

test('collaborative add pin: the Owner adds a pin', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Cafe'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as AddPinRsp
  assert.equal(body.pin.authorId, OWNER)
  assert.equal(body.pin.author, 'username')
})

test('collaborative add pin: any logged-in member adds a pin, stamped as its Contributor', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})
  requestUserId = CONTRIBUTOR

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Cafe'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as AddPinRsp
  assert.equal(body.pin.authorId, CONTRIBUTOR)
  assert.equal(body.pin.author, 'contributor')
  assert.equal(storedPins()[0]?.authorId, CONTRIBUTOR)
})

test('collaborative add pin: a Moderator adds a pin like any other member', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Cafe'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 200)
})

test('collaborative add pin: logged out is forbidden, and nothing is written', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})
  requestUserId = undefined

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: 'Cafe'}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 403)
  assert.equal(storedPins().length, 0)
})

test('collaborative update/delete pin: the author may edit and delete their own Pin', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        authorId: CONTRIBUTOR,
        author: 'contributor',
      },
    ],
  })
  requestUserId = CONTRIBUTOR

  const updateRsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    title: 'Renamed',
  } satisfies UpdatePinReq)
  assert.equal(updateRsp.status, 200)

  const deleteRsp = await postJson(Endpoint.DeletePin, {
    id: 'p1',
  } satisfies DeletePinReq)
  assert.equal(deleteRsp.status, 200)
  assert.equal(storedPins().length, 0)
})

test('collaborative update/delete pin: a non-mod member may not touch someone else s Pin', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        authorId: CONTRIBUTOR,
        author: 'contributor',
      },
    ],
  })
  requestUserId = OTHER_CONTRIBUTOR

  const updateRsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    title: 'Hijacked',
  } satisfies UpdatePinReq)
  assert.equal(updateRsp.status, 403)
  assert.equal(storedPins()[0]?.title, 'Cafe')

  const deleteRsp = await postJson(Endpoint.DeletePin, {
    id: 'p1',
  } satisfies DeletePinReq)
  assert.equal(deleteRsp.status, 403)
  assert.equal(storedPins().length, 1)
})

test('collaborative update/delete pin: a Moderator may touch someone else s Pin', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        authorId: CONTRIBUTOR,
        author: 'contributor',
      },
    ],
  })
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const updateRsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    title: 'Moderated',
  } satisfies UpdatePinReq)
  assert.equal(updateRsp.status, 200)
  assert.equal(storedPins()[0]?.title, 'Moderated')

  const deleteRsp = await postJson(Endpoint.DeletePin, {
    id: 'p1',
  } satisfies DeletePinReq)
  assert.equal(deleteRsp.status, 200)
  assert.equal(storedPins().length, 0)
})

test('collaborative update/delete pin: the Owner gets no special power over a Contributor s Pin', async () => {
  // The rule most likely to be got wrong: ownership is of the Post, not of
  // other people's work.
  seedCollabMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        authorId: CONTRIBUTOR,
        author: 'contributor',
      },
    ],
  })

  const updateRsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    title: 'Hijacked',
  } satisfies UpdatePinReq)
  assert.equal(updateRsp.status, 403)
  assert.equal(storedPins()[0]?.title, 'Cafe')

  const deleteRsp = await postJson(Endpoint.DeletePin, {
    id: 'p1',
  } satisfies DeletePinReq)
  assert.equal(deleteRsp.status, 403)
  assert.equal(storedPins().length, 1)
})

test('collaborative update pin: a legacy Pin with no authorId is the Owner s', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })

  const ownerRsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    title: 'By the Owner',
  } satisfies UpdatePinReq)
  assert.equal(ownerRsp.status, 200)

  requestUserId = OTHER_CONTRIBUTOR
  const memberRsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    title: 'By a stranger',
  } satisfies UpdatePinReq)
  assert.equal(memberRsp.status, 403)

  // The regression test for the `undefined === undefined` hole: a logged-out
  // reader must not inherit a legacy Pin just because neither side has an id.
  requestUserId = undefined
  const loggedOutRsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    title: 'By nobody',
  } satisfies UpdatePinReq)
  assert.equal(loggedOutRsp.status, 403)
})

test('collaborative update pin: authorId is not patchable', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        authorId: CONTRIBUTOR,
        author: 'contributor',
      },
    ],
  })
  requestUserId = CONTRIBUTOR

  // A forged field a real client never sends — UpdatePinReq has no authorId
  // to type this as, which is the point; this goes in as a raw body.
  const rsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    authorId: OTHER_CONTRIBUTOR,
  })
  assert.equal(rsp.status, 200)
  assert.equal(storedPins()[0]?.authorId, CONTRIBUTOR)
})

test('collaborative import pins: the Owner adds a whole export, every Pin stamped to themselves', async () => {
  seedCollabMap({ownerId: OWNER, pins: [], ownerName: 'username'})

  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [{title: 'A', location: {lat: 1, lng: 2}}],
  } satisfies ImportMapReq)
  assert.equal(rsp.status, 200)
  assert.equal(storedPins()[0]?.authorId, OWNER)
  assert.equal(storedPins()[0]?.author, 'username')
})

test('collaborative delete post: the Owner may delete it; a Contributor may not', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        authorId: CONTRIBUTOR,
        author: 'contributor',
      },
    ],
  })
  seedIndexed(POST, {title: 'Berlin', author: 'username', createdAt: 1})
  seedRedditPost(POST)
  requestUserId = CONTRIBUTOR

  const contributorRsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(contributorRsp.status, 403)
  assert.deepEqual(deletedPosts, [])

  requestUserId = OWNER
  const ownerRsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(ownerRsp.status, 200)
  assert.deepEqual(deletedPosts, [POST])
})

test('collaborative update pin: an unreachable Reddit is not a yes for a Moderator', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        authorId: CONTRIBUTOR,
        author: 'contributor',
      },
    ],
  })
  requestUserId = MODERATOR
  seedModerator(MODERATOR)
  moderatorsUnreadable = true

  const rsp = await postJson(Endpoint.UpdatePin, {
    id: 'p1',
    title: 'Hijacked',
  } satisfies UpdatePinReq)
  assert.equal(rsp.status, 403)
})

test('collaborative update pin: a Contributor editing their own Pin makes zero moderator reads', async () => {
  // The whole point of deferring `isModerator()` — nothing else will notice
  // if this regresses into a Reddit round trip on every write. See
  // ADR-0019.
  seedCollabMap({
    ownerId: OWNER,
    pins: [
      {
        id: 'p1',
        location: {lat: 1, lng: 2},
        title: 'Cafe',
        authorId: CONTRIBUTOR,
        author: 'contributor',
      },
    ],
  })
  requestUserId = CONTRIBUTOR

  assert.equal(
    (
      await postJson(Endpoint.UpdatePin, {
        id: 'p1',
        title: 'By its own author',
      } satisfies UpdatePinReq)
    ).status,
    200,
  )
  assert.equal(moderatorReadCount, 0)
})

test('update pin: a Solo-Owner edit makes zero moderator reads', async () => {
  // The other fast path `requireCollabPinAccess` never gets a chance to
  // matter on: a Solo Map is decided from `dbGetMapMeta` alone.
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })

  assert.equal(
    (
      await postJson(Endpoint.UpdatePin, {
        id: 'p1',
        title: 'By the Owner',
      } satisfies UpdatePinReq)
    ).status,
    200,
  )
  assert.equal(moderatorReadCount, 0)
})

test("every form the app shows satisfies Devvit's own field rules", async () => {
  for (const endpoint of [
    Endpoint.OnMenuNewPost,
    Endpoint.OnMenuNewIndexPost,
  ]) {
    const rsp = await fetch(`${serverURL}/${endpoint}`, {method: 'POST'})
    assertValidForm((await rsp.json()) as UiResponse, endpoint)
  }
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
    // `assertValidFormFields` — Devvit's own runtime check — has no select
    // rules at all: `options: []` and a `defaultValue` that names no real
    // option both sail through it. These are the two ways a select can be
    // wrong that nothing else in the stack catches.
    if (field.type === 'select') {
      assert.notEqual(
        field.options.length,
        0,
        `${label} field "${name}" is a select with no options`,
      )
      const values = field.options.map(option => option.value)
      assert.equal(
        new Set(values).size,
        values.length,
        `${label} field "${name}" repeats an option value`,
      )
      for (const picked of field.defaultValue ?? []) {
        assert.ok(
          values.includes(picked),
          `${label} field "${name}" defaults to "${picked}", which is not one of its options`,
        )
      }
    }
  }
}

test('get map: the default area rides along with every map', async () => {
  seedArea()
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await rsp.json()) as GetMapRsp
  assert.deepEqual(map.defaultArea, SPRINGFIELD_IL)
})

test('get map: an area stored by the version that asked Google is unreadable', async () => {
  // What the Place Search era wrote: Google's viewport, under a name it chose.
  // Those coordinates are not this app's to keep, so the shape no longer
  // parses and the subreddit has no Default Area until one is framed.
  redisValues.set(
    AREA_KEY,
    JSON.stringify({name: 'Springfield, IL, USA', bounds: SPRINGFIELD_IL}),
  )
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await rsp.json()) as GetMapRsp
  assert.equal(map.defaultArea, undefined)
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

test('get map: the full reading is told the reader moderates here', async () => {
  seedModerator()
  seedMap({ownerId: OWNER, pins: []})

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}?full=1`)
  const map = (await rsp.json()) as GetMapRsp
  assert.equal(map.isModerator, true)
})

test('get map: a preview does not ask, so it is never told', async () => {
  seedModerator()
  seedMap({ownerId: OWNER, pins: []})

  // The same moderator, on the reading with no toolbar to put the control in.
  // Reddit is not asked at all — an answer per feed scroll for a control that
  // cannot be shown.
  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await rsp.json()) as GetMapRsp
  assert.equal(map.isModerator, false)
})

test('get map: moderating is not owning', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = 't2_viewer' as T2
  seedModerator(requestUserId)

  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}?full=1`)
  const map = (await rsp.json()) as GetMapRsp
  assert.equal(map.isModerator, true)
  assert.equal(map.isOwner, false)
})

test('set default area: a moderator stores the rectangle they framed', async () => {
  seedModerator()

  const req: SetDefaultAreaReq = {bounds: SPRINGFIELD_IL}
  const rsp = await postJson(Endpoint.SetDefaultArea, req)
  assert.equal(rsp.status, 200)
  assert.deepEqual(
    JSON.parse(redisValues.get(AREA_KEY) ?? 'null'),
    SPRINGFIELD_IL,
  )
})

test('set default area: an area crossing the antimeridian keeps its corners', async () => {
  seedModerator()

  // West numerically east of east is how both this app and MapLibre spell an
  // area over the 180th meridian; it must survive the round trip unswapped.
  const fiji = {west: 176.9, south: -19.2, east: -178.5, north: -16.1}
  const req: SetDefaultAreaReq = {bounds: fiji}
  assert.equal((await postJson(Endpoint.SetDefaultArea, req)).status, 200)

  seedMap({ownerId: OWNER, pins: []})
  const rsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.deepEqual(((await rsp.json()) as GetMapRsp).defaultArea, fiji)
})

test('set default area: a rectangle that is upside down is not one', async () => {
  seedModerator()

  const req = {bounds: {west: 0, south: 40, east: 1, north: 30}}
  const rsp = await postJson(Endpoint.SetDefaultArea, req)
  assert.equal(rsp.status, 400)
  assert.equal(redisValues.get(AREA_KEY), undefined)
})

test('set default area: a reader who does not moderate is forbidden', async () => {
  // Unlike the form this replaced, an `/api/` route is reachable by any page —
  // so this check is the whole of what stops a Viewer moving every map on the
  // subreddit.
  seedArea()
  const req: SetDefaultAreaReq = {
    bounds: {west: 0, south: 0, east: 1, north: 1},
  }
  const rsp = await postJson(Endpoint.SetDefaultArea, req)
  assert.equal(rsp.status, 403)
  assert.deepEqual(
    JSON.parse(redisValues.get(AREA_KEY) ?? 'null'),
    SPRINGFIELD_IL,
  )
})

test('clear default area: a moderator puts empty maps back on the world', async () => {
  seedModerator()
  seedArea()

  const rsp = await postJson(Endpoint.ClearDefaultArea, {})
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(AREA_KEY), undefined)
})

test('clear default area: it also takes an area this version cannot read', async () => {
  seedModerator()
  redisValues.set(
    AREA_KEY,
    JSON.stringify({name: 'Springfield, IL, USA', bounds: SPRINGFIELD_IL}),
  )

  // Clearing is a delete, not a read-modify-write, so it reaches a value that
  // no longer parses — which is the only way one leaves Redis.
  const rsp = await postJson(Endpoint.ClearDefaultArea, {})
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(AREA_KEY), undefined)
})

test('clear default area: a reader who does not moderate is forbidden', async () => {
  seedArea()

  const rsp = await postJson(Endpoint.ClearDefaultArea, {})
  assert.equal(rsp.status, 403)
  assert.match(redisValues.get(AREA_KEY) ?? '', /39.6907/)
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
    {
      type: 'select',
      name: 'kind',
      label: 'Who can add pins?',
      options: [
        {label: 'Only me', value: MapKind.Solo},
        {label: 'Anyone in this community', value: MapKind.Collaborative},
      ],
      defaultValue: [MapKind.Solo],
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

test('index: a post its owner deleted on Reddit is unlisted at once', async () => {
  const gone = 't3_gone' as T3
  const alive = 't3_alive' as T3
  seedIndexed(gone, {title: 'Gone', author: 'anna', createdAt: 2})
  seedIndexed(alive, {title: 'Alive', author: 'bob', createdAt: 1})
  // Reddit answers for a deleted post rather than failing, so this is not a
  // miss and nothing waits for it to happen three times.
  seedRedditPost(gone, {removedByCategory: 'deleted'})
  seedRedditPost(alive)
  redisValues.set(`owner:${gone}`, OWNER)

  const body = (await (await getIndex()).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => entry.t3),
    [alive],
  )
  assert.equal(body.total, 2, 'the page it was counted for was already sized')

  assert.equal(redisSets.get('index')?.has(gone), false)
  assert.equal(redisSets.get('index-pins')?.has(gone), false)
  assert.equal(redisHashes.get('index-meta')?.has(gone), false)
  // Nothing was counted against it: an answer is not a missed read.
  assert.equal(redisSets.get('index-miss')?.has(gone) ?? false, false)
  // The Pins stay put, as they do for every unlisting.
  assert.equal(redisValues.get(`owner:${gone}`), OWNER)

  const after = (await (await getIndex()).json()) as GetIndexRsp
  assert.equal(after.total, 1)
})

test('index: a deletion recorded against the author unlists too', async () => {
  const gone = 't3_gone' as T3
  seedIndexed(gone, {title: 'Gone', author: 'anna', createdAt: 2})
  seedIndexed('t3_alive' as T3, {title: 'Alive', author: 'bob', createdAt: 1})
  seedRedditPost(gone, {removedByCategory: 'author'})
  seedRedditPost('t3_alive' as T3)

  const body = (await (await getIndex()).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => entry.t3),
    ['t3_alive'],
  )
  assert.equal(redisSets.get('index')?.has(gone), false)
})

test('index: a moderator s removal is hidden but stays indexed', async () => {
  const removed = 't3_removed' as T3
  seedIndexed(removed, {title: 'Removed', author: 'anna', createdAt: 2})
  seedIndexed('t3_alive' as T3, {title: 'Alive', author: 'bob', createdAt: 1})
  // The category a mod removal carries — off the page, but the Map keeps its
  // row, because only the author's own deletion is the irreversible one.
  seedRedditPost(removed, {removed: true, removedByCategory: 'moderator'})
  seedRedditPost('t3_alive' as T3)
  redisValues.set(`owner:${removed}`, OWNER)

  const body = (await (await getIndex()).json()) as GetIndexRsp
  assert.deepEqual(
    body.entries.map(entry => entry.t3),
    ['t3_alive'],
  )
  assert.equal(redisSets.get('index')?.has(removed), true)
  assert.equal(redisValues.get(`owner:${removed}`), OWNER)
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
  // Submitted by the Owner, so Reddit's byline names them rather than the app
  // account, and carrying the one thing they have written for a report to act
  // against.
  assert.equal(submittedPostRunAs, 'USER')
  assert.deepEqual(submittedPostUgc, {text: 'Coffee shops of Berlin'})
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

// --- Creation / kind -----------------------------------------------------

test('new post form: a Collaborative selection creates a Collaborative Map, shaped as Reddit actually sends a select', async () => {
  // {kind: ['collaborative']}, not {kind: 'collaborative'} — a Devvit select
  // submits its choice as an array even for a single pick. See ADR-0019.
  const rsp = await postJson(Endpoint.OnFormNewPost, {
    title: 'Community Map',
    kind: [MapKind.Collaborative],
  })
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(`kind:${POST}`), MapKind.Collaborative)

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(((await getRsp.json()) as GetMapRsp).collaborative, true)
})

test('new post form: no kind creates a Solo Map', async () => {
  const rsp = await postJson(Endpoint.OnFormNewPost, {title: 'Plain Map'})
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(`kind:${POST}`), undefined)
  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(((await getRsp.json()) as GetMapRsp).collaborative, false)
})

test('new post form: an empty selection creates a Solo Map', async () => {
  const rsp = await postJson(Endpoint.OnFormNewPost, {
    title: 'Plain Map',
    kind: [],
  })
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(`kind:${POST}`), undefined)
})

test('new post form: an unrecognized kind creates a Solo Map, never the raw client string', async () => {
  const rsp = await postJson(Endpoint.OnFormNewPost, {
    title: 'Plain Map',
    kind: ['anything-else'],
  })
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(`kind:${POST}`), undefined)
})

test('create map post: from an Index Post gives an identical result to the menu form', async () => {
  const req: CreateMapPostReq = {
    title: 'Community Map',
    kind: MapKind.Collaborative,
  }
  const rsp = await postJson(Endpoint.CreateMapPost, req)
  assert.equal(rsp.status, 200)
  assert.equal(redisValues.get(`kind:${POST}`), MapKind.Collaborative)

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(((await getRsp.json()) as GetMapRsp).collaborative, true)
})

test('index: collaborative is true for a Collaborative Map, absent for a row seeded without the field', async () => {
  const collab = 't3_collab' as T3
  const solo = 't3_solo' as T3
  seedIndexed(collab, {
    title: 'Community',
    author: 'anna',
    createdAt: 2,
    collaborative: true,
  })
  // A pre-feature index-meta row, with no `collaborative` key at all.
  seedIndexed(solo, {title: 'Solo', author: 'bob', createdAt: 1})
  seedRedditPost(collab)
  seedRedditPost(solo)

  const rsp = (await (await getIndex()).json()) as GetIndexRsp
  assert.equal(rsp.entries.find(e => e.t3 === collab)?.collaborative, true)
  assert.equal(rsp.entries.find(e => e.t3 === solo)?.collaborative, undefined)
})

test('index post form: creates a post on the index entrypoint and indexes nothing', async () => {
  seedModerator()
  const req: IndexPostFormReq = {title: '  r/test_sub Community Maps  '}
  const rsp = await postJson(Endpoint.OnFormNewIndexPost, req)
  assert.equal(rsp.status, 200)
  assert.equal(submittedPostTitle, 'r/test_sub Community Maps')
  assert.equal(submittedPostEntry, 'index')
  // An Index Post is owned by no one, so it stays the app account's post: the
  // moderator who asked for one is not its author the way an Owner is theirs.
  assert.equal(submittedPostRunAs, undefined)
  assert.equal(submittedPostUgc, undefined)

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

test('delete index post: a Collaborative Map Post cannot be deleted through this route either', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  seedRedditPost(POST)
  seedModerator()

  const rsp = await postJson(Endpoint.DeleteIndexPost, {})
  assert.equal(rsp.status, 400)
  assert.deepEqual(deletedPosts, [])
  assert.equal(redisValues.get(`owner:${POST}`), OWNER)
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

test('delete post: also forgets the kind, on a Collaborative Map', async () => {
  seedCollabMap({
    ownerId: OWNER,
    pins: [{id: 'p1', location: {lat: 1, lng: 2}, title: 'Cafe'}],
  })
  seedIndexed(POST, {title: 'Berlin', author: 'username', createdAt: 1})
  seedRedditPost(POST)

  assert.equal((await postJson(Endpoint.DeletePost, {})).status, 200)
  assert.equal(redisValues.get(`kind:${POST}`), undefined)
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

test('delete post: a moderator who is not the Owner is forbidden, even on a Collaborative Map', async () => {
  // Delete Map answers to owning the Post, never to moderating — a
  // Moderator's reach stops at individual Pins. See ADR-0019.
  seedCollabMap({ownerId: OWNER, pins: []})
  seedIndexed(POST, {title: 'Berlin', author: 'username', createdAt: 1})
  seedRedditPost(POST)
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const rsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(rsp.status, 403)
  assert.deepEqual(deletedPosts, [])
  assert.equal(redisValues.get(`owner:${POST}`), OWNER)
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

// --- Regions -----------------------------------------------------------------

const TRIANGLE = [
  {lat: 0, lng: 0},
  {lat: 0, lng: 1},
  {lat: 1, lng: 1},
]

function addRegion(body: AddRegionReq): Promise<Response> {
  return postJson(Endpoint.AddRegion, body)
}

async function getMapRsp(): Promise<GetMapRsp> {
  return (await (
    await fetch(`${serverURL}/${Endpoint.GetMap}`)
  ).json()) as GetMapRsp
}

/** Puts Regions where `dbGetMap` reads them, as the routes would have left them. */
function seedRegions(...regions: Region[]): void {
  const hash = new Map<string, string>()
  for (const region of regions) hash.set(region.id, JSON.stringify(region))
  redisHashes.set(`regions:${POST}`, hash)
}

function storedRegion(over: Partial<Region> = {}): Region {
  return {
    id: 'r1',
    createdAt: 1,
    name: 'North Side',
    polygon: TRIANGLE,
    ...over,
  }
}

test('region: a map with none says so with an empty list, not an absent field', async () => {
  seedMap({ownerId: OWNER, pins: []})
  assert.deepEqual((await getMapRsp()).regions, [])
})

test('region: the owner adds one, updates it, and deletes it', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const added = await addRegion({name: '  North Side  ', polygon: TRIANGLE})
  assert.equal(added.status, 200)
  const {region} = (await added.json()) as AddRegionRsp
  // Trimmed on the way in, and stamped by the server rather than the client.
  assert.equal(region.name, 'North Side')
  assert.deepEqual(region.polygon, TRIANGLE)
  assert.ok(region.id)
  assert.ok(region.createdAt > 0)
  assert.deepEqual((await getMapRsp()).regions, [region])

  const renamed = await postJson(Endpoint.UpdateRegion, {
    id: region.id,
    name: 'East End',
  } satisfies UpdateRegionReq)
  assert.equal(renamed.status, 200)
  const updated = ((await renamed.json()) as UpdateRegionRsp).region
  assert.equal(updated.name, 'East End')
  // A patch that names no polygon leaves the polygon, and the age, alone.
  assert.deepEqual(updated.polygon, TRIANGLE)
  assert.equal(updated.createdAt, region.createdAt)

  const reshaped = await postJson(Endpoint.UpdateRegion, {
    id: region.id,
    polygon: [...TRIANGLE, {lat: 1, lng: 0}],
  } satisfies UpdateRegionReq)
  assert.equal(
    ((await reshaped.json()) as UpdateRegionRsp).region.polygon.length,
    4,
  )

  const deleted = await postJson(Endpoint.DeleteRegion, {id: region.id})
  assert.equal(deleted.status, 200)
  assert.deepEqual((await getMapRsp()).regions, [])
})

test('region: nothing a client tacks on is stored', async () => {
  seedMap({ownerId: OWNER, pins: []})
  const rsp = await postJson(Endpoint.AddRegion, {
    name: 'A',
    polygon: TRIANGLE.map(vertex => ({...vertex, extra: 'x'})),
    id: 'chosen-by-client',
    createdAt: 1,
  })
  const {region} = (await rsp.json()) as AddRegionRsp
  assert.notEqual(region.id, 'chosen-by-client')
  assert.ok(region.createdAt > 1)
  assert.deepEqual(region.polygon, TRIANGLE)
})

test('region: a viewer, a contributor and a logged-out reader are each forbidden', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})
  seedRegions(storedRegion())

  for (const userId of ['t2_viewer' as T2, CONTRIBUTOR, undefined]) {
    requestUserId = userId
    const label = `user=${userId}`
    assert.equal(
      (await addRegion({name: 'X', polygon: TRIANGLE})).status,
      403,
      `add ${label}`,
    )
    assert.equal(
      (await postJson(Endpoint.UpdateRegion, {id: 'r1', name: 'X'})).status,
      403,
      `update ${label}`,
    )
    assert.equal(
      (await postJson(Endpoint.DeleteRegion, {id: 'r1'})).status,
      403,
      `delete ${label}`,
    )
  }
  requestUserId = OWNER
  assert.equal((await getMapRsp()).regions.length, 1)
})

test('region: a moderator who is not the Owner is forbidden on a Solo Map', async () => {
  seedMap({ownerId: OWNER, pins: []})
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  assert.equal((await addRegion({name: 'X', polygon: TRIANGLE})).status, 403)
  // Moderating grants nothing here, and the route never asked Reddit.
  assert.equal(moderatorReadCount, 0)
})

test('region: a moderator may draw one on a Collaborative Map', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  assert.equal((await addRegion({name: 'X', polygon: TRIANGLE})).status, 200)
})

test('region: the owner of a Collaborative Map pays no moderator round trip', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})

  assert.equal((await addRegion({name: 'X', polygon: TRIANGLE})).status, 200)
  assert.equal(moderatorReadCount, 0)
})

test('region: 404 when the post has no map yet', async () => {
  assert.equal((await addRegion({name: 'X', polygon: TRIANGLE})).status, 404)
})

test('region: updating or deleting one that is not there is a loud 404 or a quiet no-op as appropriate', async () => {
  seedMap({ownerId: OWNER, pins: []})
  assert.equal(
    (await postJson(Endpoint.UpdateRegion, {id: 'nope', name: 'X'})).status,
    404,
  )
  assert.equal(
    (await postJson(Endpoint.DeleteRegion, {id: 'nope'})).status,
    200,
  )
})

test('region: refuses a missing or over-long name', async () => {
  seedMap({ownerId: OWNER, pins: []})
  assert.equal((await addRegion({name: '   ', polygon: TRIANGLE})).status, 400)
  const rsp = await addRegion({
    name: 'x'.repeat(RegionNameMaxLen + 1),
    polygon: TRIANGLE,
  })
  assert.equal(rsp.status, 400)
  assert.equal(
    ((await rsp.json()) as ErrorRsp).error,
    `name must be ${RegionNameMaxLen} characters or fewer`,
  )
})

test('region: refuses too few vertices, too many, and a malformed one', async () => {
  seedMap({ownerId: OWNER, pins: []})
  assert.equal(
    (await addRegion({name: 'X', polygon: TRIANGLE.slice(0, 2)})).status,
    400,
  )
  assert.equal(
    (
      await addRegion({
        name: 'X',
        polygon: Array.from({length: RegionVertexMaxCount + 1}, () => ({
          lat: 0,
          lng: 0,
        })),
      })
    ).status,
    400,
  )
  for (const bad of [{lat: 91, lng: 0}, {lat: 0}, 'nope', null]) {
    const rsp = await postJson(Endpoint.AddRegion, {
      name: 'X',
      polygon: [...TRIANGLE.slice(0, 2), bad],
    })
    assert.equal(rsp.status, 400, JSON.stringify(bad))
  }
  assert.equal(
    (await postJson(Endpoint.AddRegion, {name: 'X', polygon: 'triangle'}))
      .status,
    400,
  )
  // Refused outright, so nothing was stored.
  assert.deepEqual((await getMapRsp()).regions, [])
})

test('region: refuses a reshape to something that is not a polygon', async () => {
  seedMap({ownerId: OWNER, pins: []})
  seedRegions(storedRegion())
  const rsp = await postJson(Endpoint.UpdateRegion, {
    id: 'r1',
    polygon: TRIANGLE.slice(0, 2),
  })
  assert.equal(rsp.status, 400)
  assert.deepEqual((await getMapRsp()).regions[0]?.polygon, TRIANGLE)
})

test('region: a map holds no more than its ceiling', async () => {
  seedMap({ownerId: OWNER, pins: []})
  seedRegions(
    ...Array.from({length: RegionMaxCount}, (_, i) =>
      storedRegion({id: `r${i}`, name: `R${i}`}),
    ),
  )
  const rsp = await addRegion({name: 'One too many', polygon: TRIANGLE})
  assert.equal(rsp.status, 400)
  assert.equal((await getMapRsp()).regions.length, RegionMaxCount)
})

test('delete map: its regions go with it', async () => {
  seedMap({ownerId: OWNER, pins: []})
  seedRedditPost(POST)
  await addRegion({name: 'X', polygon: TRIANGLE})
  assert.equal(redisHashes.has(`regions:${POST}`), true)

  const rsp = await postJson(Endpoint.DeletePost, {})
  assert.equal(rsp.status, 200)
  // An orphaned key here would be invisible and permanent.
  assert.equal(redisHashes.has(`regions:${POST}`), false)
})

// --- Import carries the whole Map --------------------------------------------

const somePin = {title: 'Cafe', location: {lat: 1, lng: 2}}

test('import map: a file with Regions and a Summary replaces both while adding Pins', async () => {
  seedMap({
    ownerId: OWNER,
    pins: [{id: 'old', location: {lat: 5, lng: 5}, title: 'Already here'}],
  })
  seedRegions(storedRegion({id: 'a'}), storedRegion({id: 'b', name: 'Other'}))
  await setSummary('The old summary.')

  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [somePin],
    regions: [{name: 'Harbour', polygon: TRIANGLE}],
    summary: 'The new summary.',
  } satisfies ImportMapReq)
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as ImportMapRsp
  assert.deepEqual(body.replaced, {summary: true, regions: 2})
  assert.equal(body.summary, 'The new summary.')
  assert.deepEqual(
    body.regions.map(r => r.name),
    ['Harbour'],
  )

  const map = await getMapRsp()
  // Pins add; they never replace.
  assert.equal(map.pins.length, 2)
  assert.equal(map.summary, 'The new summary.')
  assert.deepEqual(
    map.regions.map(r => r.name),
    ['Harbour'],
  )
  // Stamped where it landed, not carried from the file.
  assert.notEqual(map.regions[0]?.id, 'a')
  assert.ok((map.regions[0]?.createdAt ?? 0) > 1)
})

test('import map: a v1 file leaves the Map’s Summary and Regions untouched', async () => {
  seedMap({ownerId: OWNER, pins: []})
  seedRegions(storedRegion())
  await setSummary('Keep me.')

  const rsp = await postJson(Endpoint.ImportMap, {pins: [somePin]})
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as ImportMapRsp
  assert.deepEqual(body.replaced, {summary: false, regions: 0})
  assert.equal(body.summary, 'Keep me.')
  assert.equal(body.regions.length, 1)

  const map = await getMapRsp()
  assert.equal(map.summary, 'Keep me.')
  assert.deepEqual(
    map.regions.map(r => r.id),
    ['r1'],
  )
  assert.equal(map.pins.length, 1)
})

test('import map: an empty regions list clears them, and an empty summary clears the Summary', async () => {
  seedMap({ownerId: OWNER, pins: []})
  seedRegions(storedRegion())
  await setSummary('Going.')

  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [somePin],
    regions: [],
    summary: '',
  })
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as ImportMapRsp
  assert.deepEqual(body.replaced, {summary: true, regions: 1})
  assert.equal('summary' in body, false)

  const map = await getMapRsp()
  assert.deepEqual(map.regions, [])
  assert.equal(map.summary, undefined)
})

test('import map: a bad Region refuses the whole Import, changing nothing', async () => {
  seedMap({ownerId: OWNER, pins: []})
  seedRegions(storedRegion())
  await setSummary('Untouched.')

  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [somePin],
    regions: [{name: 'Line', polygon: TRIANGLE.slice(0, 2)}],
    summary: 'Never lands.',
  })
  assert.equal(rsp.status, 400)

  const map = await getMapRsp()
  assert.equal(map.pins.length, 0)
  assert.equal(map.summary, 'Untouched.')
  assert.deepEqual(
    map.regions.map(r => r.id),
    ['r1'],
  )
})

test('import map: a moderator may not replace a Collaborative Map’s Regions from a paste', async () => {
  seedCollabMap({ownerId: OWNER, pins: []})
  seedRegions(storedRegion())
  requestUserId = MODERATOR
  seedModerator(MODERATOR)

  const rsp = await postJson(Endpoint.ImportMap, {
    pins: [somePin],
    regions: [],
  })
  assert.equal(rsp.status, 403)
  requestUserId = OWNER
  assert.equal((await getMapRsp()).regions.length, 1)
})
