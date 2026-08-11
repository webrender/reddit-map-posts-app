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
  settings,
} from '@devvit/web/server'
import type {T2, T3} from '@devvit/web/shared'
import {
  type AddPinReq,
  type AddPinRsp,
  type DeletePinReq,
  type DeletePinRsp,
  Endpoint,
  type ErrorRsp,
  type GetMapRsp,
  type SearchPlacesRsp,
  type UpdatePinReq,
  type UpdatePinRsp,
} from '../shared/api.ts'
import type {MapData} from './db.ts'
import {onReq} from './server.ts'

const OWNER = 't2_owner' as T2
const POST = 't3_123' as T3

let server: Server
let serverURL: string
const redisValues = new Map<string, string>()
const redisHashes = new Map<string, Map<string, string>>()
const redisGet = redis.get.bind(redis)
const redisSet = redis.set.bind(redis)
const redisHGet = redis.hGet.bind(redis)
const redisHSet = redis.hSet.bind(redis)
const redisHGetAll = redis.hGetAll.bind(redis)
const redisHDel = redis.hDel.bind(redis)
const mediaUpload = media.upload.bind(media)
const settingsGet = settings.get.bind(settings)
const submitCustomPost = reddit.submitCustomPost.bind(reddit)
const originalFetch = globalThis.fetch
let requestUserId: T2 = OWNER
let placesApiKey: string | undefined = 'test-api-key'
let submittedPostTitle: string | undefined
/** Every external URL the server fetched, with the headers it forwarded. */
let upstreamReqs: {url: string; headers: Headers}[] = []

const TILE_BYTES = Uint8Array.from([0x1a, 0x00, 0xff, 0x80, 0x0a])
const TILE_ETAG = '"tile-v1"'

before(async () => {
  redis.get = async key => redisValues.get(key)
  redis.set = async (key, value) => {
    redisValues.set(key, value)
    return 'OK'
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
  media.upload = async ({url}) => ({
    mediaId: 'media1',
    mediaUrl: `https://i.redd.it/uploaded?src=${encodeURIComponent(url)}`,
  })
  settings.get = (async () => placesApiKey) as typeof settings.get
  reddit.submitCustomPost = (async (
    opts: Parameters<typeof reddit.submitCustomPost>[0],
  ) => {
    submittedPostTitle = opts.title
    return {
      id: POST,
      url: `https://reddit.com/r/test_sub/comments/${POST}`,
    }
  }) as unknown as typeof reddit.submitCustomPost
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (`${url}` === 'https://places.googleapis.com/v1/places:searchText') {
      return new Response(
        JSON.stringify({
          places: [
            {
              displayName: {text: 'Central Park'},
              location: {latitude: 40.785091, longitude: -73.968285},
            },
          ],
        }),
        {status: 200, headers: {'Content-Type': 'application/json'}},
      )
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
  media.upload = mediaUpload
  settings.get = settingsGet
  reddit.submitCustomPost = submitCustomPost
  globalThis.fetch = originalFetch
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => {
  redisValues.clear()
  redisHashes.clear()
  requestUserId = OWNER
  placesApiKey = 'test-api-key'
  submittedPostTitle = undefined
  upstreamReqs = []
})

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
  placesApiKey = undefined

  const rsp = await fetch(
    `${serverURL}/${Endpoint.SearchPlaces}?q=Central+Park`,
  )
  assert.equal(rsp.status, 503)
})

test("new post menu action: creates a post titled with the creator's username and an empty map", async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnMenuNewPost}`, {
    method: 'POST',
  })
  assert.equal(rsp.status, 200)
  assert.equal(submittedPostTitle, "username's Map")

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  assert.equal(getRsp.status, 200)
  const map = (await getRsp.json()) as GetMapRsp
  assert.equal(map.ownerId, OWNER)
  assert.deepEqual(map.pins, [])
})

test('app install trigger: also creates a post and an empty map', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnAppInstall}`, {
    method: 'POST',
  })
  assert.equal(rsp.status, 200)
  assert.equal(submittedPostTitle, "username's Map")

  const getRsp = await fetch(`${serverURL}/${Endpoint.GetMap}`)
  const map = (await getRsp.json()) as GetMapRsp
  assert.equal(map.ownerId, OWNER)
  assert.deepEqual(map.pins, [])
})

test('add pin: rejects an empty title', async () => {
  seedMap({ownerId: OWNER, pins: []})

  const req: AddPinReq = {location: {lat: 10, lng: 20}, title: '   '}
  const rsp = await postJson(Endpoint.AddPin, req)
  assert.equal(rsp.status, 400)
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
