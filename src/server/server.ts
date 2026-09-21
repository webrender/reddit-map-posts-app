import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, media, type Post, reddit} from '@devvit/web/server'
import type {
  PartialJsonValue,
  T2,
  T3,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
import {
  type AddPinReq,
  type AddPinRsp,
  type AddRegionReq,
  type AddRegionRsp,
  type ClearDefaultAreaRsp,
  type CreateMapPostReq,
  type CreateMapPostRsp,
  type DeleteIndexPostRsp,
  type DeletePinReq,
  type DeletePinRsp,
  type DeletePostRsp,
  type DeleteRegionReq,
  type DeleteRegionRsp,
  defaultIndexPostTitle,
  defaultMapPostTitle,
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type GetIndexRsp,
  GetMapFullParam,
  type GetMapRsp,
  type ImportMapReq,
  type ImportMapRsp,
  type IndexEntry,
  IndexPageSize,
  IndexPostFormName,
  type IndexPostFormReq,
  IndexSort,
  indexPostForm,
  isIndexSort,
  isLatLng,
  isMapBounds,
  isMapKind,
  type LatLng,
  type MapBounds,
  MapKind,
  MapSummaryMaxLen,
  NewPostFormName,
  type NewPostFormReq,
  newPostForm,
  type Pin,
  PostTitleMaxLen,
  type Region,
  type SetDefaultAreaReq,
  type SetDefaultAreaRsp,
  type SetOrderReq,
  type SetOrderRsp,
  type SetSummaryReq,
  type SetSummaryRsp,
  type UpdatePinReq,
  type UpdatePinRsp,
  type UpdateRegionReq,
  type UpdateRegionRsp,
} from '../shared/api.ts'
import {
  isRedditMediaUrl,
  PinCategoryMaxLen,
  PinDescriptionMaxLen,
  type PinExport,
  PinLinkMaxLen,
  PinTitleMaxLen,
  type RegionExport,
  RegionNameMaxLen,
  RegionVertexMaxCount,
  RegionVertexMinCount,
  readMapValue,
} from '../shared/map-file.ts'
import {
  canAddPin,
  canEditMap,
  canEditPin,
  type MapAccess,
} from '../shared/permissions.ts'
import {PinOrderMaxCount, sortPins} from '../shared/pin-order.ts'
import {
  dbAddPin,
  dbAddPins,
  dbAddRegion,
  dbClearIndexMiss,
  dbClearSummary,
  dbCreateMap,
  dbDeleteDefaultArea,
  dbDeleteMap,
  dbDeletePin,
  dbDeleteRegion,
  dbGetDefaultArea,
  dbGetIndex,
  dbGetIndexMisses,
  dbGetMap,
  dbGetMapMeta,
  dbGetPin,
  dbGetScoreCursor,
  dbIsMap,
  dbRecordIndexMiss,
  dbReplaceRegions,
  dbSetCachedScores,
  dbSetDefaultArea,
  dbSetOrder,
  dbSetScoreCursor,
  dbSetSummary,
  dbUnlistMap,
  dbUpdatePin,
  dbUpdateRegion,
  type IndexRow,
  type MapData,
} from './db.ts'
import {HttpError} from './http-error.ts'
import {proxyGet} from './proxy.ts'

/**
 * The `post.entrypoints` key an Index Post renders. A Map Post takes the
 * default; naming this one is the whole of what makes a second post type.
 */
const INDEX_ENTRYPOINT = 'index'

/**
 * How many cached scores one cron run refreshes. Bounded so the job's cost
 * doesn't grow with the subreddit — see ADR-0011.
 */
const ScoreRefreshBatch = 300

/**
 * How many Reddit reads one cron run makes at a time. The batch is bounded for
 * cost; this is bounded for blast radius — a run that dies partway has still
 * banked every chunk before it, cursor included.
 */
const ScoreRefreshChunk = 25

/**
 * How many failed reads in a row it takes to unlist a Map Post. More than one,
 * because one is indistinguishable from Reddit having a bad second; small,
 * because until it is reached an unreadable post keeps a row nobody can use.
 * A post Reddit does answer for does not come through here at all — see
 * {@link deletedByAuthor}.
 */
const IndexMissLimit = 3

type AnyRsp =
  | GetMapRsp
  | GetIndexRsp
  | CreateMapPostRsp
  | AddPinRsp
  | UpdatePinRsp
  | DeletePinRsp
  | ImportMapRsp
  | AddRegionRsp
  | UpdateRegionRsp
  | DeleteRegionRsp
  | DeletePostRsp
  | DeleteIndexPostRsp
  | SetDefaultAreaRsp
  | ClearDefaultAreaRsp
  | SetSummaryRsp
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

  // The only route whose response isn't JSON: it forwards bytes verbatim.
  if (endpoint === Endpoint.Proxy && method === reqMsg.method) {
    const proxied = await proxyGet(url.searchParams.get('url'), reqMsg.headers)
    writeBytes(proxied.status, proxied.headers, proxied.body, rspMsg)
    return
  }

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.GetMap:
        rsp = await routeGetMap(url.searchParams)
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
      case Endpoint.ImportMap:
        rsp = await routeImportMap(reqMsg)
        break
      case Endpoint.AddRegion:
        rsp = await routeAddRegion(reqMsg)
        break
      case Endpoint.UpdateRegion:
        rsp = await routeUpdateRegion(reqMsg)
        break
      case Endpoint.DeleteRegion:
        rsp = await routeDeleteRegion(reqMsg)
        break
      case Endpoint.SetDefaultArea:
        rsp = await routeSetDefaultArea(reqMsg)
        break
      case Endpoint.ClearDefaultArea:
        rsp = await routeClearDefaultArea()
        break
      case Endpoint.SetSummary:
        rsp = await routeSetSummary(reqMsg)
        break
      case Endpoint.SetOrder:
        rsp = await routeSetOrder(reqMsg)
        break
      case Endpoint.GetIndex:
        rsp = await routeGetIndex(url.searchParams)
        break
      case Endpoint.CreateMapPost:
        rsp = await routeCreateMapPost(reqMsg)
        break
      case Endpoint.DeletePost:
        rsp = await routeDeletePost()
        break
      case Endpoint.DeleteIndexPost:
        rsp = await routeDeleteIndexPost()
        break
      case Endpoint.OnMenuNewPost:
        rsp = routeMenuNewPost()
        break
      case Endpoint.OnFormNewPost:
        rsp = await routeFormNewPost(reqMsg)
        break
      case Endpoint.OnMenuNewIndexPost:
        rsp = routeMenuNewIndexPost()
        break
      case Endpoint.OnFormNewIndexPost:
        rsp = await routeFormNewIndexPost(reqMsg)
        break
      case Endpoint.OnTaskRefreshScores:
        rsp = await routeRefreshScores()
        break
      default:
        rsp = {error: 'not found', status: 404}
        break
    }
  }

  writeJson<PartialJsonValue>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

async function routeGetMap(searchParams: URLSearchParams): Promise<GetMapRsp> {
  const t3 = requirePostId()
  // The Default Area is read for every Map, not only the empty ones: a Map that
  // loses its last Pin while the page is open needs somewhere to go, and it is
  // one Redis read against the one this route already makes — independent of
  // it, so the two run together rather than one after the other.
  //
  // Whether the reader moderates here is a round trip to Reddit rather than to
  // Redis, and only the full screen reading has anywhere to put the control it
  // decides; a Preview renders once per scroll past the post and never asks.
  const full = searchParams.get(GetMapFullParam) === '1'
  const [map, defaultArea, moderator] = await Promise.all([
    dbGetMap(t3),
    dbGetDefaultArea(),
    full ? isModerator() : false,
  ])
  if (!map) throw new HttpError(404, 'map not found')
  const rsp: GetMapRsp = {
    ownerId: map.ownerId,
    ownerName: map.ownerName,
    pins: map.pins,
    isOwner: map.ownerId === context.userId,
    collaborative: map.collaborative,
    isModerator: moderator,
    regions: map.regions,
    order: map.order,
  }
  if (defaultArea) rsp.defaultArea = defaultArea
  if (map.summary) rsp.summary = map.summary
  return rsp
}

async function routeAddPin(reqMsg: IncomingMessage): Promise<AddPinRsp> {
  const t3 = requirePostId()
  await requireAddablePin(t3)
  const req = await readJson<AddPinReq>(reqMsg)

  const pin: Pin = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    location: normalizeLocation(req.location),
    title: normalizeTitle(req.title),
    // requireAddablePin has already refused a logged-out request, so both of
    // these are always set — stamped uniformly on both kinds of Map, so a
    // Pin's shape never depends on which one it landed on. See ADR-0019.
    authorId: context.userId,
    author: context.username,
  }
  if (req.category) pin.category = normalizeCategory(req.category)
  if (req.description) pin.description = normalizeDescription(req.description)
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
  const meta = await dbGetMapMeta(t3)
  if (!meta) throw new HttpError(404, 'map not found')
  // Solo Map: decided from `meta` alone, before the body is even read — see
  // the comment on `requireCollabPinAccess` for why the two kinds ask this in
  // a different order.
  if (!meta.collaborative) requireSoloOwner(meta)

  const req = await readJson<UpdatePinReq>(reqMsg)
  if (meta.collaborative) await requireCollabPinAccess(t3, meta, req.id)

  const patch: Partial<Pin> = {}
  if (req.location !== undefined)
    patch.location = normalizeLocation(req.location)
  if (req.title !== undefined) patch.title = normalizeTitle(req.title)
  if (req.category !== undefined)
    patch.category = req.category ? normalizeCategory(req.category) : undefined
  if (req.description !== undefined)
    patch.description = req.description
      ? normalizeDescription(req.description)
      : undefined
  if (req.link !== undefined) {
    patch.link = req.link ? normalizeLink(req.link) : undefined
  }
  // Authorized above, before any of this: an unauthorized request must never
  // cost a real Reddit media upload.
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
  const meta = await dbGetMapMeta(t3)
  if (!meta) throw new HttpError(404, 'map not found')
  if (!meta.collaborative) requireSoloOwner(meta)

  const req = await readJson<DeletePinReq>(reqMsg)
  if (meta.collaborative) await requireCollabPinAccess(t3, meta, req.id)

  await dbDeletePin(t3, req.id)
  return {ok: true}
}

/**
 * Applies an Export: its Pins are added, and its Summary and Regions replace
 * what the Map has, each only where the file carries it. Owner-only on both
 * kinds of Map — a Contributor's whole gesture is Pin Drop plus editing what
 * they dropped, and Import is a 500-Pin bulk add and a whole-Map overwrite, a
 * flooding vector this app does not open to anyone but the Owner even on a
 * Collaborative Map. A Moderator may write a Region by hand but may not
 * replace all of them from a paste.
 *
 * Every entry is checked before any of them is written. An Import that applied
 * most of itself would leave the Owner with no clean retry: its Pins add, so
 * running it again after a fix would duplicate whatever had already landed. All
 * of it or none of it is the only shape that can be tried twice.
 *
 * Absent and empty mean different things, and getting it wrong erases a Map's
 * Regions on every v1 import: a body with no `regions` leaves them alone, and
 * `"regions": []` clears them. `summary: ''` draws the same line against an
 * absent `summary`. See ADR-0022.
 *
 * Nothing here reads a URL for a Location. A Pin's Location arrives as two
 * numbers or the entry is refused, which is what keeps ADR-0015's rule — the
 * app never takes a list of links — true of a route that takes a list. See
 * ADR-0017.
 */
async function routeImportMap(reqMsg: IncomingMessage): Promise<ImportMapRsp> {
  const t3 = requirePostId()
  const map = await requireOwnedMap(t3)
  const req = await readJson<ImportMapReq>(reqMsg)

  // The client has already read the Owner's text with this same reader, and is
  // asked again here for the reason every route asks: what arrives is a body,
  // not a promise.
  const read = readMapValue(req)
  if ('error' in read) throw new HttpError(400, read.error)

  // Everything that can refuse does so before the first write.
  // Stamped to the importing Owner, on both kinds of Map — Import is
  // Owner-only, so there is only ever one Contributor it could mean.
  const pins = read.pins.map(entry => toPin(entry, map.ownerId, map.ownerName))
  const regions = read.regions?.map(toRegion)
  const summary =
    read.summary === undefined ? undefined : normalizeSummary(read.summary)

  // A file in the Map's hand-made order asks for it to be kept: the Pins already
  // here keep their places, and the new ones follow in the file's order. A file
  // that is not ordered leaves the order alone, so the new Pins simply sort by
  // title after everything already ranked.
  const order = read.ordered
    ? [
        ...sortPins(map.pins, map.order).map(pin => pin.id),
        ...pins.map(pin => pin.id),
      ]
    : map.order

  await dbAddPins(t3, pins)
  if (read.ordered) await dbSetOrder(t3, order)
  if (regions) await dbReplaceRegions(t3, regions)
  if (summary === '') await dbClearSummary(t3)
  else if (summary !== undefined) await dbSetSummary(t3, summary)

  const rsp: ImportMapRsp = {
    pins,
    droppedImages: read.droppedImages,
    regions: regions ?? map.regions,
    replaced: {
      summary: summary !== undefined && !!map.summary,
      regions: regions ? map.regions.length : 0,
    },
    order,
  }
  const landed = summary === undefined ? map.summary : summary
  if (landed) rsp.summary = landed
  return rsp
}

/**
 * One imported Region as a stored one. The id and `createdAt` are the
 * server's, for a Pin's reason: an Export describes Regions rather than naming
 * them, and an imported one is stamped where it lands so its colour is
 * re-derived there. See ADR-0018.
 */
function toRegion(entry: RegionExport): Region {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    name: normalizeRegionName(entry.name),
    polygon: normalizePolygon(entry.polygon),
  }
}

/**
 * One imported entry as a Pin. The id is the server's, always: an Export
 * describes Pins rather than naming them, and letting a pasted id through
 * would let one Import overwrite the Pins of an earlier one. `createdAt` is
 * the server's for the same reason, and says when this Map got the Pin rather
 * than when the Map it came from did.
 *
 * `imageUrl` is the one field here that was never storable without an upload.
 * {@link readMapValue} has already dropped any that is not on a host this app
 * could have uploaded to; this is where that becomes a stored value, and the
 * check is on the server because the text it vets came from a person.
 */
function toPin(entry: PinExport, ownerId: T2, ownerName: string): Pin {
  const pin: Pin = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    location: normalizeLocation(entry.location),
    title: normalizeTitle(entry.title),
    authorId: ownerId,
    author: ownerName,
  }
  if (entry.category) pin.category = normalizeCategory(entry.category)
  if (entry.description)
    pin.description = normalizeDescription(entry.description)
  if (entry.link) pin.link = normalizeLink(entry.link)
  if (entry.imageUrl && isRedditMediaUrl(entry.imageUrl))
    pin.imageUrl = entry.imageUrl
  return pin
}

/**
 * Stores the rectangle a moderator framed on a real Map as the subreddit's
 * Default Area. See ADR-0014: what arrives is what MapLibre reported the view
 * to be, so this route is the whole of the lookup that used to happen here.
 *
 * Unlike the form this replaced, it is reachable by any web view — `/api/`
 * paths are what a page may fetch — so the moderator check is the only thing
 * standing between a Viewer and where every Map on the subreddit opens.
 */
async function routeSetDefaultArea(
  reqMsg: IncomingMessage,
): Promise<SetDefaultAreaRsp> {
  if (!(await isModerator())) throw new HttpError(403, 'not authorized')

  const req = await readJson<SetDefaultAreaReq>(reqMsg)
  await dbSetDefaultArea(normalizeBounds(req.bounds))
  return {ok: true}
}

/**
 * Forgets it, putting empty Maps back on the whole world. It also takes with it
 * a rectangle stored by the version of this app that looked places up with
 * Google — which no longer parses, so clearing is the only thing that can.
 */
async function routeClearDefaultArea(): Promise<ClearDefaultAreaRsp> {
  if (!(await isModerator())) throw new HttpError(403, 'not authorized')
  await dbDeleteDefaultArea()
  return {ok: true}
}

/**
 * Writes this Map's Summary, for whoever `canEditMap` allows: the Owner on
 * either kind of Map, and a Moderator on a Collaborative one. An empty string
 * clears it.
 *
 * Authorized before the body is read, which every Pin route would do too if it
 * could — `routeUpdatePin` reads first only because it needs `req.id` to find
 * the Pin it is about to authorize against. This route is about the Map, so it
 * can refuse without ever buffering a body. See {@link requireSoloOwner}.
 *
 * `isModerator()` is a Reddit round trip and is reached only once the Owner
 * check has already failed, which is ADR-0019's cost rule: pay it on the branch
 * that cannot be answered without it, never on the common one.
 */
async function routeSetSummary(
  reqMsg: IncomingMessage,
): Promise<SetSummaryRsp> {
  const t3 = requirePostId()
  await requireCanEditMap(t3)

  const req = await readJson<SetSummaryReq>(reqMsg)
  const summary = normalizeSummary(req.summary)
  if (!summary) {
    await dbClearSummary(t3)
    return {}
  }
  await dbSetSummary(t3, summary)
  return {summary}
}

/**
 * Writes the Map's Pin order, for whoever `canEditMap` allows — the Owner, or a
 * Moderator on a Collaborative Map — since the order is how the Map lists what
 * is on it rather than anything a Contributor put there. Authorized before the
 * body is read, for {@link routeSetSummary}'s reason.
 *
 * The ids are checked against the Pins the Map holds: unknown ones and repeats
 * are dropped, so what is stored can never name a Pin that is not there, and a
 * Pin someone added while this was in flight is simply unranked and sorts last.
 */
async function routeSetOrder(reqMsg: IncomingMessage): Promise<SetOrderRsp> {
  const t3 = requirePostId()
  await requireCanEditMap(t3)

  const req = await readJson<SetOrderReq>(reqMsg)
  if (
    !Array.isArray(req.order) ||
    req.order.length > PinOrderMaxCount ||
    req.order.some(id => typeof id !== 'string')
  ) {
    throw new HttpError(400, 'order must be a list of pin ids')
  }
  const map = await dbGetMap(t3)
  if (!map) throw new HttpError(404, 'map not found')
  const known = new Set(map.pins.map(pin => pin.id))
  const order = [...new Set(req.order)].filter(id => known.has(id))
  await dbSetOrder(t3, order)
  return {order}
}

/**
 * Traces a Region. A Region is the Map speaking about itself, exactly as a
 * Summary is, so it answers to the same rule — see {@link requireCanEditMap}.
 * Authorized before the body is read, for {@link routeSetSummary}'s reason.
 */
async function routeAddRegion(reqMsg: IncomingMessage): Promise<AddRegionRsp> {
  const t3 = requirePostId()
  await requireCanEditMap(t3)

  const req = await readJson<AddRegionReq>(reqMsg)
  const region: Region = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    name: normalizeRegionName(req.name),
    polygon: normalizePolygon(req.polygon),
  }
  await dbAddRegion(t3, region)
  return {region}
}

async function routeUpdateRegion(
  reqMsg: IncomingMessage,
): Promise<UpdateRegionRsp> {
  const t3 = requirePostId()
  await requireCanEditMap(t3)

  const req = await readJson<UpdateRegionReq>(reqMsg)
  const patch: Partial<Pick<Region, 'name' | 'polygon'>> = {}
  if (req.name !== undefined) patch.name = normalizeRegionName(req.name)
  if (req.polygon !== undefined) patch.polygon = normalizePolygon(req.polygon)
  const region = await dbUpdateRegion(t3, req.id, patch)
  return {region}
}

async function routeDeleteRegion(
  reqMsg: IncomingMessage,
): Promise<DeleteRegionRsp> {
  const t3 = requirePostId()
  await requireCanEditMap(t3)

  const req = await readJson<DeleteRegionReq>(reqMsg)
  await dbDeleteRegion(t3, req.id)
  return {ok: true}
}

/**
 * The menu item doesn't create anything; it asks Reddit to show the form that
 * does. Nothing exists yet at this point, so there is nothing to undo if the
 * user cancels.
 */
function routeMenuNewPost(): UiResponse {
  return {
    showForm: {
      name: NewPostFormName,
      form: newPostForm(defaultMapPostTitle(context.username)),
    },
  }
}

async function routeFormNewPost(reqMsg: IncomingMessage): Promise<UiResponse> {
  const req = await readJson<NewPostFormReq>(reqMsg)
  const title = req.title?.trim() ?? ''
  // A rejected title is the user's to retype, not an error to log, so this
  // answers 200 with a toast rather than throwing an HttpError.
  const problem = titleProblem(title)
  if (problem) return {showToast: {text: `A ${problem}.`}}

  // A Devvit `select` submits its choice as `string[]`, not `string` — see the
  // doc comment on `NewPostFormReq`.
  const post = await createMapPost(title, isCollaborativeKind(req.kind?.[0]))
  return {
    showToast: {text: `Post ${post.id} created.`, appearance: 'success'},
    navigateTo: post.url,
  }
}

/**
 * The other half of the Index Post's list: making something to put on it. The
 * form is the same object the menu item shows, because the client raises it
 * through its own `showForm` and posts the answer back here.
 */
async function routeCreateMapPost(
  reqMsg: IncomingMessage,
): Promise<CreateMapPostRsp> {
  const req = await readJson<CreateMapPostReq>(reqMsg)
  const title = req.title?.trim() ?? ''
  const problem = titleProblem(title)
  if (problem) throw new HttpError(400, problem)
  const post = await createMapPost(title, isCollaborativeKind(req.kind))
  return {url: post.url}
}

/**
 * The kind requested at creation, collapsed to the one boolean `dbCreateMap`
 * wants. Anything that is not exactly {@link MapKind.Collaborative} — absent,
 * an empty selection, or a string this app has never heard of — reads as
 * Solo, and the raw value is never the thing that reaches Redis: only this
 * boolean does. See ADR-0019.
 */
function isCollaborativeKind(raw: string | undefined): boolean {
  return isMapKind(raw) && raw === MapKind.Collaborative
}

/**
 * A title's validity, checked identically everywhere one is typed: required,
 * and no longer than {@link PostTitleMaxLen}. `undefined` means it passed;
 * the caller decides how to say otherwise, since a rejected title is a toast
 * in some forms (prefixed "A ...") and a thrown `HttpError` in others (used
 * as-is, lowercase, matching this file's other error messages).
 */
function titleProblem(trimmedTitle: string): string | undefined {
  if (!trimmedTitle) return 'title is required'
  if (trimmedTitle.length > PostTitleMaxLen) {
    return `title can be at most ${PostTitleMaxLen} characters`
  }
  return undefined
}

/**
 * Deletes the Post this request came from, at its Owner's request. The Owner
 * check is {@link requireOwnedMap}'s, the same one that guards every Pin
 * mutation — a Viewer cannot delete a Map any more than they can move a Pin,
 * and a moderator who wants one gone has Reddit's own tools.
 *
 * Reddit goes first. If it refuses, the Map is still there and still listed,
 * which is the recoverable order to fail in; the reverse would leave a Post
 * whose Map had already been erased under it.
 */
async function routeDeletePost(): Promise<DeletePostRsp> {
  const t3 = requirePostId()
  await requireOwnedMap(t3)
  const post = await reddit.getPostById(t3)
  await post.delete()
  await dbDeleteMap(t3)
  return {ok: true}
}

/**
 * Deletes the Index Post this request came from, at a moderator's request. It
 * is the mirror of {@link routeDeletePost} and fails in the same order, but the
 * two guard different things: a Map Post belongs to its Owner, while an Index
 * Post belongs to no one, so the subreddit's moderators are who may take one
 * down.
 *
 * The post is checked for not being a Map before anything else. That is the
 * only thing separating the two post types (ADR-0010), and without it this
 * would be a way for a moderator to delete someone's Map — and its Pins with
 * it — through a route that never looks at the Owner.
 *
 * Nothing in Redis is touched: an Index Post writes nothing and owns nothing,
 * so the Maps it listed are whole and still listed for the next one.
 */
async function routeDeleteIndexPost(): Promise<DeleteIndexPostRsp> {
  const t3 = requirePostId()
  if (await dbIsMap(t3)) throw new HttpError(400, 'this post is not an index')
  if (!(await isModerator())) throw new HttpError(403, 'not authorized')
  const post = await reddit.getPostById(t3)
  await post.delete()
  return {ok: true}
}

/**
 * Whether whoever is asking moderates this subreddit. Reddit is asked about
 * this one user rather than for the whole mod list, so the answer costs the
 * same on a subreddit with two moderators and one with two hundred.
 *
 * A Reddit that cannot be reached answers "no": the two things this gates are
 * showing a delete button and honouring one, and neither is worth offering on
 * a guess.
 */
async function isModerator(): Promise<boolean> {
  const {subredditName, username} = context
  if (!subredditName || !username) return false
  try {
    const mods = await reddit
      .getModerators({subredditName, username, limit: 1})
      .all()
    return mods.length > 0
  } catch (err) {
    console.error(`could not read moderators of ${subredditName}; ${err}`)
    return false
  }
}

/** Moderator-only by way of `devvit.json`; nothing here re-checks it. */
function routeMenuNewIndexPost(): UiResponse {
  return {
    showForm: {
      name: IndexPostFormName,
      form: indexPostForm(defaultIndexPostTitle(context.subredditName ?? '')),
    },
  }
}

async function routeFormNewIndexPost(
  reqMsg: IncomingMessage,
): Promise<UiResponse> {
  // The menu item that raises this form is hidden from non-moderators by
  // `devvit.json`, but that hides a button — it authorizes nothing. Without
  // this check, anyone could submit straight to this route and have the app
  // account post an Index Post on the subreddit's behalf.
  if (!(await isModerator())) throw new HttpError(403, 'not authorized')

  const req = await readJson<IndexPostFormReq>(reqMsg)
  const title = req.title?.trim() ?? ''
  const problem = titleProblem(title)
  if (problem) return {showToast: {text: `A ${problem}.`}}

  // Nothing is written to Redis for an Index Post: it holds no state of its
  // own, which is why a subreddit may have any number of them and they all
  // agree. Nor is it pinned — `sticky` may not be the app account's to call,
  // and a silent failure teaches the moderator nothing.
  const post = await reddit.submitCustomPost({title, entry: INDEX_ENTRYPOINT})
  return {
    showToast: {
      text: 'Index post created. Pin it to the top of the subreddit to keep it there.',
      appearance: 'success',
    },
    navigateTo: post.url,
  }
}

/**
 * One page of the Listing. The whole index is read and scanned on every
 * request, which is the deal ADR-0010 struck: Devvit's Redis has no text index,
 * so the scan happens somewhere, and doing it here keeps the response five
 * Entries wide however large the subreddit gets.
 */
async function routeGetIndex(
  searchParams: URLSearchParams,
): Promise<GetIndexRsp> {
  const sortParam = searchParams.get('sort')
  const sort = isIndexSort(sortParam) ? sortParam : IndexSort.New
  const query = (searchParams.get('q') ?? '').trim().toLowerCase()

  const rows = (await dbGetIndex()).filter(
    // A Map with no Pins has nothing to browse to; see ADR-0010.
    row => row.pinCount > 0 && matchesQuery(row, query),
  )
  rows.sort((a, b) =>
    sort === IndexSort.Top && a.score !== b.score
      ? b.score - a.score
      : b.createdAt - a.createdAt,
  )

  const pageCount = Math.max(1, Math.ceil(rows.length / IndexPageSize))
  const requested = Math.floor(Number(searchParams.get('page')))
  const page = Math.min(
    Math.max(Number.isFinite(requested) ? requested : 1, 1),
    pageCount,
  )
  const start = (page - 1) * IndexPageSize
  const [entries, moderator] = await Promise.all([
    liveEntries(rows.slice(start, start + IndexPageSize)),
    isModerator(),
  ])

  return {entries, page, pageCount, total: rows.length, isModerator: moderator}
}

/**
 * Asks Reddit about the Entries actually on screen, and only those: five reads
 * is a bounded cost, and it answers two questions at once — what the score is
 * now, and whether the post is still there (ADR-0011).
 *
 * Deletion is not a failed read. Reddit answers for a post whose author deleted
 * it, with a tombstone that says as much, so a deleted Map Post arrives here
 * looking alive apart from that one field. That answer is Reddit naming what
 * happened rather than us inferring it from silence, so it unlists on the spot
 * — the wait below is what silence needs, not what an answer needs.
 *
 * A read that fails says nothing nearly so clearly. It is left off the page
 * either way, since there is nothing to send a reader to, but *unlisting* one
 * takes more: Reddit rate-limiting one call out of five looks exactly like the
 * post having gone. Unlisting is forever — nothing re-indexes a Map — so it
 * waits for {@link IndexMissLimit} failures in a row, and a single answer from
 * Reddit puts the count back to nothing.
 *
 * A post that is merely *removed* is hidden but kept, since a moderator can put
 * it back. And if every read failed, Reddit is treated as unreachable rather
 * than as having lost every post at once: nothing is counted against any of
 * them, and the Entries render without a score.
 */
async function liveEntries(rows: readonly IndexRow[]): Promise<IndexEntry[]> {
  if (!rows.length) return []

  const fetched = await fetchPosts(rows)
  if (fetched.every(({post}) => !post)) return rows.map(row => toEntry(row))

  const misses = await dbGetIndexMisses()
  const entries: IndexEntry[] = []
  for (const {row, post} of fetched) {
    if (!post) {
      if ((await dbRecordIndexMiss(row.t3)) >= IndexMissLimit) {
        await dbUnlistMap(row.t3)
      }
      continue
    }
    // Written only where there is something to forget, so the ordinary page
    // load stays five reads and no writes.
    if (misses.has(row.t3)) await dbClearIndexMiss(row.t3)
    if (deletedByAuthor(post)) {
      await dbUnlistMap(row.t3)
      continue
    }
    // Any other removal category is hidden rather than gone: there is nowhere
    // to send a reader now, but a moderator can put it back, so it keeps its
    // row exactly as a `removed` post always has.
    if (post.removed || post.removedByCategory) continue
    entries.push(toEntry(row, post.score))
  }
  return entries
}

/**
 * Whether Reddit's answer for a post is a tombstone for one its author deleted.
 * Deleting is not removing: `removed` is the moderator's flag and a
 * self-deletion leaves it alone, so this field is the only thing that tells the
 * two apart — and telling them apart is what decides whether a Map Post keeps
 * its row. Without it a Map its Owner deleted from Reddit's own app read as a
 * live post forever, since it is only the app's own Delete Map that ever
 * reaches {@link dbDeleteMap}.
 *
 * Both of these categories mean the author: Reddit says `deleted` where a post
 * was taken down from the author's own controls, and `author` where it records
 * the removal as theirs. Neither is something a moderator can put back, which
 * is what makes acting on them at once safe when a failed read is not.
 */
function deletedByAuthor(post: Post): boolean {
  return (
    post.removedByCategory === 'deleted' || post.removedByCategory === 'author'
  )
}

/**
 * Reads a handful of Map Posts from Reddit, pairing each answer with the row it
 * belongs to. A post that could not be read is `undefined` — which of the two
 * things that means is the caller's to decide, and they decide it differently.
 */
async function fetchPosts(
  rows: readonly IndexRow[],
): Promise<{row: IndexRow; post: Post | undefined}[]> {
  return await Promise.all(
    rows.map(async row => {
      try {
        return {row, post: await reddit.getPostById(row.t3)}
      } catch {
        return {row, post: undefined}
      }
    }),
  )
}

function toEntry(row: IndexRow, score?: number): IndexEntry {
  const entry: IndexEntry = {
    t3: row.t3,
    title: row.title,
    author: row.author,
    pinCount: row.pinCount,
    createdAt: row.createdAt,
  }
  if (score !== undefined) entry.score = score
  if (row.collaborative) entry.collaborative = true
  return entry
}

function matchesQuery(row: IndexRow, query: string): boolean {
  if (!query) return true
  return (
    row.title.toLowerCase().includes(query) ||
    row.author.toLowerCase().includes(query)
  )
}

/**
 * The cron half of ADR-0011: refresh a bounded slice of the cached scores the
 * Top Sort orders by, then leave the cursor where the next run should pick up.
 * Under {@link ScoreRefreshBatch} Maps this refreshes everything every run;
 * above it, the refresh interval stretches instead of the job growing without
 * end.
 */
async function routeRefreshScores(): Promise<TriggerResponse> {
  // A Map with no Pins is not listed, so no Sort can reach its score. Spending
  // the batch on one would be spending it on a row nobody can see.
  const rows = (await dbGetIndex()).filter(row => row.pinCount > 0)
  if (!rows.length) return {}

  const start = (await dbGetScoreCursor()) % rows.length
  const batch = rows.slice(start, start + ScoreRefreshBatch)

  // Banked chunk by chunk rather than in one go at the end. A run that times
  // out or throws partway has still refreshed everything before the break and
  // left the cursor past it, so the next run carries on instead of starting
  // the same batch over — which, with the cursor only ever written at the end,
  // meant one bad run could freeze the Top Sort on the same rows forever.
  for (let done = 0; done < batch.length; done += ScoreRefreshChunk) {
    const chunk = batch.slice(done, done + ScoreRefreshChunk)
    const fetched = await fetchPosts(chunk)
    // A post that can't be read keeps the score it had. Unlisting is the read
    // path's job, where a failure has four siblings to be judged against.
    const scores = fetched
      .filter(({post}) => post !== undefined)
      .map(({row, post}) => ({t3: row.t3, score: post?.score ?? 0}))
    await dbSetCachedScores(scores)
    await dbSetScoreCursor((start + done + chunk.length) % rows.length)
  }
  return {}
}

/**
 * Makes the Map Post, from whichever of the two places asked for one. It is
 * submitted as the Owner rather than as the app account, which is what puts
 * their name on the byline Reddit shows a scrolling reader: without `runAs`
 * every Map in every feed was posted by u/map-posts, and the one person who
 * could not be found from a Map Post was the person who made it.
 *
 * `runAs: 'USER'` costs three things. It needs `permissions.reddit.asUser` to
 * name `SUBMIT_POST` in `devvit.json`, or the call throws before it reaches
 * Reddit. It needs `userGeneratedContent`, which is what a safety report is
 * actioned against, and the title is the whole of what the Owner has written
 * at this point — the Map is empty until they drop a Pin on it. And it is only
 * true in production: an unapproved or playtest app runs the submit from the
 * app account anyway, attributed to the app owner, so this reads as working on
 * the dev subreddit whether or not it is.
 *
 * The Owner is still recorded in Redis, and every Owner check still reads it
 * from there. Reddit's authorship and this app's ownership agree now, but they
 * are not the same fact, and only one of them decides who may move a Pin.
 */
async function createMapPost(title: string, collaborative: boolean) {
  const ownerId = context.userId
  if (!ownerId) throw new HttpError(401, 'you must be logged in to make a map')
  const post = await reddit.submitCustomPost({
    title,
    runAs: 'USER',
    userGeneratedContent: {text: title},
  })
  await dbCreateMap(
    post.id as T3,
    ownerId,
    {title, author: context.username ?? '', createdAt: Date.now()},
    collaborative,
  )
  return post
}

function normalizeTitle(title: string): string {
  // Typed as a string and checked as though it were not, because the type is a
  // claim about a JSON body this route did not write.
  const trimmed = typeof title === 'string' ? title.trim() : ''
  if (!trimmed) throw new HttpError(400, 'title is required')
  return capped(trimmed, PinTitleMaxLen, 'title')
}

/**
 * A Pin's text, refused rather than stored when it runs past its ceiling.
 * Those ceilings arrived with Import — no field had one while every Pin was
 * typed into a form by the person looking at it — and they are applied here,
 * on the path a typed Pin takes too, so the two cannot come to disagree about
 * what a Pin may hold. They sit far past anything anyone writes by hand, so
 * nothing that already exists is affected: a cap applies where a value is
 * written, and a stored Pin over one is left alone.
 */
function normalizeCategory(category: string): string {
  return capped(category.trim(), PinCategoryMaxLen, 'category')
}

function normalizeDescription(description: string): string {
  return capped(description.trim(), PinDescriptionMaxLen, 'description')
}

/**
 * A Map's Summary, refused rather than stored when it runs past its ceiling.
 * Typed as a string and checked as though it were not, for {@link
 * normalizeTitle}'s reason: the type is a claim about a body this route did not
 * write. An empty result is the clear, not a failure.
 */
function normalizeSummary(summary: string): string {
  const trimmed = typeof summary === 'string' ? summary.trim() : ''
  return capped(trimmed, MapSummaryMaxLen, 'summary')
}

/**
 * A Region's name, refused rather than stored when it is missing or over its
 * ceiling. Typed as a string and checked as though it were not, for
 * {@link normalizeTitle}'s reason.
 */
function normalizeRegionName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw new HttpError(400, 'name is required')
  return capped(trimmed, RegionNameMaxLen, 'name')
}

/**
 * A Region's ring, refused rather than stored when it is not one: too few
 * vertices to enclose anything, more than a Map may spend on one Region, or a
 * vertex that is not somewhere on Earth. Copied field by field, so nothing a
 * client tacked onto a vertex is stored.
 */
function normalizePolygon(polygon: unknown): LatLng[] {
  if (
    !Array.isArray(polygon) ||
    polygon.length < RegionVertexMinCount ||
    polygon.length > RegionVertexMaxCount
  ) {
    throw new HttpError(
      400,
      `a region needs between ${RegionVertexMinCount} and ${RegionVertexMaxCount} points`,
    )
  }
  return polygon.map(vertex => {
    if (!isLatLng(vertex)) {
      throw new HttpError(400, 'every point of a region needs a valid location')
    }
    return {lat: vertex.lat, lng: vertex.lng}
  })
}

function capped(value: string, maxLen: number, field: string): string {
  if (value.length > maxLen)
    throw new HttpError(400, `${field} must be ${maxLen} characters or fewer`)
  return value
}

/**
 * A Pin's Location, refused rather than stored when it is not one. A Pin
 * without somewhere to be is not a lesser Pin: it throws in the client on
 * every later load, taking the whole Map down with it for the Owner who would
 * have to be the one to delete it.
 */
function normalizeLocation(location: unknown): LatLng {
  if (!isLatLng(location))
    throw new HttpError(400, 'a valid location is required')
  return location
}

/**
 * The Default Area, refused rather than stored when it is not a rectangle. It
 * arrives from a client that read it off a live Map, which is exactly why it is
 * checked here: a value that does not parse on the way back out is a subreddit
 * whose Maps quietly stopped opening where the moderator put them.
 */
function normalizeBounds(bounds: unknown): MapBounds {
  if (!isMapBounds(bounds)) {
    throw new HttpError(400, 'a valid map area is required')
  }
  return bounds
}

function normalizeLink(link: string): string {
  const trimmed = capped(link.trim(), PinLinkMaxLen, 'link')
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

/** The Map, refusing anyone who may not add a Pin to it — see `canAddPin`. */
async function requireAddablePin(t3: T3): Promise<void> {
  const meta = await dbGetMapMeta(t3)
  if (!meta) throw new HttpError(404, 'map not found')
  const access: MapAccess = {
    userId: context.userId,
    ownerId: meta.ownerId,
    collaborative: meta.collaborative,
    isModerator: false,
  }
  if (!canAddPin(access)) throw new HttpError(403, 'not authorized')
}

/**
 * The Map, refusing anyone `canEditMap` does not allow: the Owner on either
 * kind of Map, and a Moderator on a Collaborative one. It serves the Summary
 * and every Region route, so there is one place this is decided.
 *
 * Called before the body is read, so an unauthorized request never pays for
 * buffering one. `isModerator()` is a Reddit round trip and is reached only
 * once the Owner check has already failed, which is ADR-0019's cost rule: pay it
 * on the branch that cannot be answered without it, never on the common one.
 */
async function requireCanEditMap(t3: T3): Promise<void> {
  const meta = await dbGetMapMeta(t3)
  if (!meta) throw new HttpError(404, 'map not found')

  const access: MapAccess = {
    userId: context.userId,
    ownerId: meta.ownerId,
    collaborative: meta.collaborative,
    isModerator: false,
  }
  if (canEditMap(access)) return
  // The only thing that could still allow it, and only on a Collaborative Map
  // — moderating grants nothing on a Solo one, so asking there would buy a
  // round trip that cannot change the answer. A logged-out reader is refused
  // outright, for the same reason.
  if (!context.userId || !meta.collaborative || !(await isModerator())) {
    throw new HttpError(403, 'not authorized')
  }
}

/**
 * Solo Map: only the Owner, ever — decided from `meta` alone, with no Pin
 * lookup and no request body. Called before the body is read, so an
 * unauthorized request never pays for `readJson` buffering one.
 */
function requireSoloOwner(meta: {ownerId: T2}): void {
  if (context.userId !== meta.ownerId)
    throw new HttpError(403, 'not authorized')
}

/**
 * Collaborative Map: the Map and the Pin, refusing anyone who may not change
 * that Pin. Unlike {@link requireSoloOwner} this needs `pinId`, which only the
 * request body carries — the caller reads it first for exactly that reason.
 *
 * `canEditPin` is asked with `isModerator: false` first, which a Contributor
 * editing their own Pin — the common case — already answers without a Reddit
 * round trip. Only when that says no does this ask `isModerator()`, the one
 * thing that could still allow it. See ADR-0019.
 */
async function requireCollabPinAccess(
  t3: T3,
  meta: {ownerId: T2},
  pinId: string,
): Promise<void> {
  const pin = await dbGetPin(t3, pinId)
  if (!pin) throw new HttpError(404, `pin not found: ${pinId}`)
  const access: MapAccess = {
    userId: context.userId,
    ownerId: meta.ownerId,
    collaborative: true,
    isModerator: false,
  }
  if (canEditPin(access, pin)) return
  if (await isModerator()) return
  throw new HttpError(403, 'not authorized')
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  return JSON.parse(`${Buffer.concat(chunks)}`)
}

function writeBytes(
  status: number,
  headers: Readonly<{[name: string]: string}>,
  body: Buffer,
  rsp: ServerResponse,
): void {
  const noBody = status === 304
  rsp.writeHead(
    status,
    noBody ? headers : {...headers, 'Content-Length': body.byteLength},
  )
  rsp.end(noBody ? undefined : body)
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
