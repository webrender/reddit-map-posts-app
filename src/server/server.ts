import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, media, reddit, settings} from '@devvit/web/server'
import type {
  PartialJsonValue,
  T3,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
import {
  type AddPinReq,
  type AddPinRsp,
  type DeletePinReq,
  type DeletePinRsp,
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type GetMapRsp,
  type Pin,
  type SearchPlacesRsp,
  type UpdatePinReq,
  type UpdatePinRsp,
} from '../shared/api.ts'
import {
  dbAddPin,
  dbCreateMap,
  dbDeletePin,
  dbGetMap,
  dbUpdatePin,
  type MapData,
} from './db.ts'
import {HttpError} from './http-error.ts'
import {searchPlaces} from './places.ts'

type AnyRsp =
  | GetMapRsp
  | AddPinRsp
  | UpdatePinRsp
  | DeletePinRsp
  | SearchPlacesRsp
  | UiResponse
  | TriggerResponse
  | ErrorRsp

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    if (err instanceof HttpError) {
      writeJson<ErrorRsp>(
        err.status,
        {error: err.message, status: err.status},
        rspMsg,
      )
      return
    }
    console.error(`server error; ${err instanceof Error ? err.stack : err}`)
    writeJson<ErrorRsp>(
      500,
      {error: 'internal server error', status: 500},
      rspMsg,
    )
  }
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  const url = new URL(reqMsg.url ?? '/', 'http://localhost')
  const endpoint = url.pathname.slice(1) as Endpoint
  const method = EndpointMethod[endpoint]

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.GetMap:
        rsp = await routeGetMap()
        break
      case Endpoint.AddPin:
        rsp = await routeAddPin(reqMsg)
        break
      case Endpoint.UpdatePin:
        rsp = await routeUpdatePin(reqMsg)
        break
      case Endpoint.DeletePin:
        rsp = await routeDeletePin(reqMsg)
        break
      case Endpoint.SearchPlaces:
        rsp = await routeSearchPlaces(url.searchParams)
        break
      case Endpoint.OnMenuNewPost:
        rsp = await routeMenuNewPost()
        break
      case Endpoint.OnAppInstall:
        rsp = await routeAppInstall()
        break
      default:
        rsp = {error: 'not found', status: 404}
        break
    }
  }

  writeJson<PartialJsonValue>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

async function routeGetMap(): Promise<GetMapRsp> {
  const t3 = requirePostId()
  const map = await dbGetMap(t3)
  if (!map) throw new HttpError(404, 'map not found')
  return {
    ownerId: map.ownerId,
    pins: map.pins,
    isOwner: map.ownerId === context.userId,
  }
}

async function routeAddPin(reqMsg: IncomingMessage): Promise<AddPinRsp> {
  const t3 = requirePostId()
  await requireOwnedMap(t3)
  const req = await readJson<AddPinReq>(reqMsg)

  const pin: Pin = {
    id: crypto.randomUUID(),
    location: req.location,
    title: normalizeTitle(req.title),
  }
  if (req.category) pin.category = req.category
  if (req.description) pin.description = req.description
  if (req.link) pin.link = normalizeLink(req.link)
  if (req.imageDataUrl) {
    const asset = await media.upload({url: req.imageDataUrl, type: 'image'})
    pin.imageUrl = asset.mediaUrl
  }

  await dbAddPin(t3, pin)
  return {pin}
}

async function routeUpdatePin(reqMsg: IncomingMessage): Promise<UpdatePinRsp> {
  const t3 = requirePostId()
  await requireOwnedMap(t3)
  const req = await readJson<UpdatePinReq>(reqMsg)

  const patch: Partial<Pin> = {}
  if (req.location !== undefined) patch.location = req.location
  if (req.title !== undefined) patch.title = normalizeTitle(req.title)
  if (req.category !== undefined) patch.category = req.category || undefined
  if (req.description !== undefined)
    patch.description = req.description || undefined
  if (req.link !== undefined) {
    patch.link = req.link ? normalizeLink(req.link) : undefined
  }
  if (req.imageDataUrl) {
    const asset = await media.upload({url: req.imageDataUrl, type: 'image'})
    patch.imageUrl = asset.mediaUrl
  } else if (req.removeImage) {
    patch.imageUrl = undefined
  }

  const pin = await dbUpdatePin(t3, req.id, patch)
  return {pin}
}

async function routeDeletePin(reqMsg: IncomingMessage): Promise<DeletePinRsp> {
  const t3 = requirePostId()
  await requireOwnedMap(t3)
  const req = await readJson<DeletePinReq>(reqMsg)
  await dbDeletePin(t3, req.id)
  return {ok: true}
}

async function routeSearchPlaces(
  searchParams: URLSearchParams,
): Promise<SearchPlacesRsp> {
  const query = searchParams.get('q')?.trim()
  if (!query) return {results: []}

  const apiKey = await settings.get<string>('placesApiKey')
  if (!apiKey) {
    throw new HttpError(
      503,
      'places search is not configured for this subreddit',
    )
  }

  return {results: await searchPlaces(query, apiKey)}
}

async function routeMenuNewPost(): Promise<UiResponse> {
  const post = await createMapPost()
  return {
    showToast: {text: `Post ${post.id} created.`, appearance: 'success'},
    navigateTo: post.url,
  }
}

async function routeAppInstall(): Promise<TriggerResponse> {
  await createMapPost()
  return {}
}

async function createMapPost() {
  const ownerId = context.userId
  if (!ownerId) throw Error('no user id')
  const post = await reddit.submitCustomPost({
    title: `${context.username ?? 'Someone'}'s Map`,
  })
  await dbCreateMap(post.id as T3, ownerId)
  return post
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new HttpError(400, 'title is required')
  return trimmed
}

function normalizeLink(link: string): string {
  const trimmed = link.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new HttpError(400, 'link must be a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'link must be an http or https URL')
  }
  return trimmed
}

function requirePostId(): T3 {
  const t3 = context.postId
  if (!t3) throw Error('no t3')
  return t3
}

async function requireOwnedMap(t3: T3): Promise<MapData> {
  const map = await dbGetMap(t3)
  if (!map) throw new HttpError(404, 'map not found')
  if (map.ownerId !== context.userId) throw new HttpError(403, 'not authorized')
  return map
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  return JSON.parse(`${Buffer.concat(chunks)}`)
}

function writeJson<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  const len = Buffer.byteLength(body)
  rsp.writeHead(status, {
    'Content-Length': len,
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
