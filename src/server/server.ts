import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, media, type Post, reddit} from '@devvit/web/server'
import type {
  PartialJsonValue,
  T3,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
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
  defaultAreaForm,
  defaultAreaPickForm,
  defaultIndexPostTitle,
  defaultMapPostTitle,
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type GetIndexRsp,
  type GetMapRsp,
  type IndexEntry,
  IndexPageSize,
  IndexPostFormName,
  type IndexPostFormReq,
  IndexSort,
  indexPostForm,
  isIndexSort,
  isLatLng,
  type LatLng,
  type MapArea,
  NewPostFormName,
  type NewPostFormReq,
  newPostForm,
  type Pin,
  PlacesKeyFormName,
  type PlacesKeyFormReq,
  PostTitleMaxLen,
  parseMapArea,
  type SearchPlacesRsp,
  type UpdatePinReq,
  type UpdatePinRsp,
} from '../shared/api.ts'
import {
  dbAddPin,
  dbClearIndexMiss,
  dbCreateMap,
  dbDeleteDefaultArea,
  dbDeleteMap,
  dbDeletePin,
  dbDeletePlacesApiKey,
  dbGetDefaultArea,
  dbGetIndex,
  dbGetIndexMisses,
  dbGetMap,
  dbGetPlacesApiKey,
  dbGetScoreCursor,
  dbIsMap,
  dbRecordIndexMiss,
  dbSetCachedScores,
  dbSetDefaultArea,
  dbSetPlacesApiKey,
  dbSetScoreCursor,
  dbUnlistMap,
  dbUpdatePin,
  type IndexRow,
  type MapData,
} from './db.ts'
import {HttpError} from './http-error.ts'
import {checkPlacesApiKey, searchAreas, searchPlaces} from './places.ts'
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
 * because until it is reached a deleted post keeps a row nobody can use.
 */
const IndexMissLimit = 3

type AnyRsp =
  | GetMapRsp
  | GetIndexRsp
  | CreateMapPostRsp
  | AddPinRsp
  | UpdatePinRsp
  | DeletePinRsp
  | DeletePostRsp
  | DeleteIndexPostRsp
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
      case Endpoint.OnMenuPlacesKey:
        rsp = await routeMenuPlacesKey()
        break
      case Endpoint.OnFormPlacesKey:
        rsp = await routeFormPlacesKey(reqMsg)
        break
      case Endpoint.OnMenuDefaultArea:
        rsp = await routeMenuDefaultArea()
        break
      case Endpoint.OnFormDefaultArea:
        rsp = await routeFormDefaultArea(reqMsg)
        break
      case Endpoint.OnFormDefaultAreaPick:
        rsp = await routeFormDefaultAreaPick(reqMsg)
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

async function routeGetMap(): Promise<GetMapRsp> {
  const t3 = requirePostId()
  // Read for every Map, not only the empty ones: a Map that loses its last Pin
  // while the page is open needs somewhere to go, and the Default Area is one
  // Redis read against the one this route already makes — independent of it,
  // so the two run together rather than one after the other.
  const [map, defaultArea] = await Promise.all([
    dbGetMap(t3),
    dbGetDefaultArea(),
  ])
  if (!map) throw new HttpError(404, 'map not found')
  const rsp: GetMapRsp = {
    ownerId: map.ownerId,
    pins: map.pins,
    isOwner: map.ownerId === context.userId,
  }
  if (defaultArea) rsp.defaultArea = defaultArea
  return rsp
}

async function routeAddPin(reqMsg: IncomingMessage): Promise<AddPinRsp> {
  const t3 = requirePostId()
  await requireOwnedMap(t3)
  const req = await readJson<AddPinReq>(reqMsg)

  const pin: Pin = {
    id: crypto.randomUUID(),
    location: normalizeLocation(req.location),
    title: normalizeTitle(req.title),
  }
  if (req.fromPlaceSearch) pin.fromPlaceSearch = true
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
  const map = await requireOwnedMap(t3)
  const req = await readJson<UpdatePinReq>(reqMsg)

  const patch: Partial<Pin> = {}
  if (req.location !== undefined) {
    // A Place Search Pin sits where the place is; only Manual Pin Drop Pins
    // have a Location the Owner chose and may choose again.
    const existing = map.pins.find(pin => pin.id === req.id)
    if (existing?.fromPlaceSearch) {
      throw new HttpError(400, 'a place search pin cannot be moved')
    }
    patch.location = normalizeLocation(req.location)
  }
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

  const apiKey = await dbGetPlacesApiKey()
  if (!apiKey) {
    throw new HttpError(
      503,
      'places search is not configured for this subreddit',
    )
  }

  const area = await dbGetDefaultArea()
  return {results: await searchPlaces(query, apiKey, area?.bounds)}
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

  const post = await createMapPost(title)
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
  const post = await createMapPost(title)
  return {url: post.url}
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
 * A post that could not be read is left off the page either way, since there is
 * nothing to send a reader to. What it takes to *unlist* one is more than that:
 * a read fails for two very different reasons, and Reddit rate-limiting one
 * call out of five looks exactly like the post having been deleted. Unlisting
 * is forever — nothing re-indexes a Map — so it waits for
 * {@link IndexMissLimit} failures in a row, and a single answer from Reddit
 * puts the count back to nothing.
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
    if (post.removed) continue
    entries.push(toEntry(row, post.score))
  }
  return entries
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
 * Reports whether a key is stored without reporting the key. That is the whole
 * discipline here: a moderator needs to know if place search is configured,
 * and needs no more than that to decide whether to type a new one.
 */
async function routeMenuPlacesKey(): Promise<UiResponse> {
  const stored = await dbGetPlacesApiKey()
  return {
    showForm: {
      name: PlacesKeyFormName,
      form: {
        title: 'Google Places API key',
        description: stored
          ? 'A key is stored for this subreddit. Typing a new one replaces it.'
          : 'No key is stored, so pins can only be added by clicking the map.',
        acceptLabel: 'Save',
        fields: [
          {
            type: 'string',
            name: 'key',
            label: 'API key',
            // Never pre-filled, even though the value is known here: the
            // stored key must not travel back to a client, and a masked
            // field would render it as dots the moderator cannot verify.
            isSecret: true,
            // Devvit refuses `isSecret` without this, using one validator for
            // form fields and settings alike. It does not make the key an app
            // setting and cannot widen its scope: `transformForm` drops
            // `scope` on the way to the wire, and the form field proto has no
            // such field to carry it. The key stays in this subreddit's Redis.
            scope: 'app',
            helpText: 'Leave blank to keep the stored key unchanged.',
            placeholder: 'AIza...',
          },
          {
            type: 'boolean',
            name: 'remove',
            label: 'Remove the stored key instead',
            defaultValue: false,
          },
        ],
      },
    },
  }
}

async function routeFormPlacesKey(
  reqMsg: IncomingMessage,
): Promise<UiResponse> {
  // The menu item that raises this form is hidden from non-moderators by
  // `devvit.json`, but that hides a button — it authorizes nothing. Without
  // this check, anyone could POST straight to this route and replace or
  // delete the subreddit's Google Places API key.
  if (!(await isModerator())) throw new HttpError(403, 'not authorized')

  const req = await readJson<PlacesKeyFormReq>(reqMsg)
  const key = req.key?.trim()

  // Checked before the key, so that ticking the box does what it says even if
  // the moderator also typed something.
  if (req.remove) {
    await dbDeletePlacesApiKey()
    return {
      showToast: {text: 'Places API key removed.', appearance: 'success'},
    }
  }
  if (!key) return {showToast: {text: 'No change: no key was entered.'}}

  const check = await checkPlacesApiKey(key)
  // A key Google refuses is never stored, so a typo cannot displace the
  // working key that is already there.
  if (check === 'rejected') {
    return {
      showToast: {text: 'Google rejected that key, so it was not saved.'},
    }
  }

  await dbSetPlacesApiKey(key)
  // An unreachable Google is not a reason to refuse a key the moderator may
  // well have typed correctly — but it is a reason not to claim it works.
  return {
    showToast:
      check === 'ok'
        ? {text: 'Places API key saved.', appearance: 'success'}
        : {text: 'Key saved, but Google could not be reached to check it.'},
  }
}

/**
 * Setting a Default Area begins with a place search, so it needs the same key
 * Place Search does. Without one there is nothing the form could look up, so
 * the moderator is told which setting comes first rather than being asked for a
 * place and refused afterwards.
 */
async function routeMenuDefaultArea(): Promise<UiResponse> {
  if (!(await dbGetPlacesApiKey())) {
    return {
      showToast: {
        text: 'Set the Google Places API key first — the default area is looked up with it.',
      },
    }
  }
  const area = await dbGetDefaultArea()
  return {
    showForm: {name: DefaultAreaFormName, form: defaultAreaForm(area?.name)},
  }
}

/**
 * The first half of setting a Default Area: turn what the moderator typed into
 * the places Google thinks they meant. Nothing is stored here unless there was
 * only one of those, because storing the first of several would be this app
 * guessing which Springfield a subreddit is about.
 */
async function routeFormDefaultArea(
  reqMsg: IncomingMessage,
): Promise<UiResponse> {
  // As with the Places API key form: `devvit.json` only hides the menu item
  // that raises this form, so this route re-checks before changing where
  // every new Map on the subreddit opens.
  if (!(await isModerator())) throw new HttpError(403, 'not authorized')

  const req = await readJson<DefaultAreaFormReq>(reqMsg)
  const place = req.place?.trim()

  // Checked before the place, for the reason the Places API key form checks it
  // first: ticking the box should do what it says even alongside typing.
  if (req.remove) {
    await dbDeleteDefaultArea()
    return {
      showToast: {
        text: 'Default map area removed. New maps open on the whole world.',
        appearance: 'success',
      },
    }
  }
  if (!place) return {showToast: {text: 'No change: no place was entered.'}}

  const apiKey = await dbGetPlacesApiKey()
  if (!apiKey) {
    return {
      showToast: {text: 'No change: this subreddit has no Places API key.'},
    }
  }

  let areas: MapArea[]
  try {
    areas = await searchAreas(place, apiKey)
  } catch (err) {
    console.error(`default area search failed; ${err}`)
    return {
      showToast: {text: 'Google could not be reached, so nothing was changed.'},
    }
  }

  const [first] = areas
  if (!first) return {showToast: {text: `No place found for “${place}”.`}}
  // One match is not a choice, so it is not offered as one.
  if (areas.length === 1) return await storeDefaultArea(first)

  return {
    showForm: {name: DefaultAreaPickFormName, form: defaultAreaPickForm(areas)},
  }
}

/**
 * The second half: the moderator's pick, which arrives as the same JSON the
 * pick form put in the option. It is parsed rather than trusted — it made a
 * round trip through a client — and an unreadable answer changes nothing.
 */
async function routeFormDefaultAreaPick(
  reqMsg: IncomingMessage,
): Promise<UiResponse> {
  // The other half of the same form; see routeFormDefaultArea.
  if (!(await isModerator())) throw new HttpError(403, 'not authorized')

  const req = await readJson<DefaultAreaPickFormReq>(reqMsg)
  const [chosen] = req.area ?? []
  const area = chosen ? parseMapArea(chosen) : undefined
  if (!area) return {showToast: {text: 'No change: no place was picked.'}}
  return await storeDefaultArea(area)
}

/**
 * Where both halves end up. The toast names the place, because the moderator
 * typed a word and what got stored is a rectangle — the name is the only part
 * of it they can check.
 */
async function storeDefaultArea(area: MapArea): Promise<UiResponse> {
  await dbSetDefaultArea(area)
  return {
    showToast: {
      text: `New maps will open on ${area.name}.`,
      appearance: 'success',
    },
  }
}

async function createMapPost(title: string) {
  const ownerId = context.userId
  if (!ownerId) throw new HttpError(401, 'you must be logged in to make a map')
  const post = await reddit.submitCustomPost({title})
  await dbCreateMap(post.id as T3, ownerId, {
    title,
    author: context.username ?? '',
    createdAt: Date.now(),
  })
  return post
}

function normalizeTitle(title: string): string {
  // Typed as a string and checked as though it were not, because the type is a
  // claim about a JSON body this route did not write.
  const trimmed = typeof title === 'string' ? title.trim() : ''
  if (!trimmed) throw new HttpError(400, 'title is required')
  return trimmed
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
