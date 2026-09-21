import type {Form, T2, T3} from '@devvit/web/shared'
import type {PinExport, RegionExport} from './map-file.ts'

/** Generic error detail for all responses. */
export type ErrorRsp = {error: string; status: number}

export type LatLng = {lat: number; lng: number}

/**
 * Whether a value is somewhere a Pin can sit. Asked of everything that arrives
 * over the wire: a Pin whose Location is missing or malformed is one the Map
 * cannot draw and cannot frame, and every reader of that Map — the Owner
 * included — gets a blank page with no way back to the Pin that did it.
 */
export function isLatLng(value: unknown): value is LatLng {
  if (typeof value !== 'object' || value === null) return false
  const {lat, lng} = value as {lat?: unknown; lng?: unknown}
  return isLat(lat) && isLng(lng)
}

/**
 * A rectangle of the world — the Default Area's whole content, and what a
 * moderator's framing of a Map is read off as. On an area that crosses the
 * antimeridian `west` is greater than `east`, which is what every reader here
 * has to allow for.
 */
export type MapBounds = {
  west: number
  south: number
  east: number
  north: number
}

/**
 * Whether a value is a rectangle of the world. Asked of both a Redis value this
 * version of the app did not necessarily write and a body that arrived over the
 * wire, so neither may assume the shape it gets.
 */
export function isMapBounds(value: unknown): value is MapBounds {
  if (typeof value !== 'object' || value === null) return false
  const {west, south, east, north} = value as {
    west?: unknown
    south?: unknown
    east?: unknown
    north?: unknown
  }
  if (!isLng(west) || !isLng(east) || !isLat(south) || !isLat(north)) {
    return false
  }
  // A rectangle may be inverted east-to-west, and that means something; being
  // inverted north-to-south means nothing, so it is not a rectangle.
  return south <= north
}

/**
 * Reads a {@link MapBounds} back out of JSON, answering `undefined` for
 * anything that is not one — including the `{name, bounds}` shape an older
 * version of this app stored, whose rectangle came from Google and is not this
 * app's to keep. A subreddit still holding one of those has no Default Area
 * until a moderator frames a new one.
 */
export function parseMapBounds(json: string): MapBounds | undefined {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return
  }
  return isMapBounds(value) ? value : undefined
}

function isLat(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 90
  )
}

function isLng(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= 180
  )
}

/** A single marked location on a Map. */
export type Pin = {
  id: string
  /**
   * When the server first stored this Pin, in epoch ms. It is never read from a
   * client and never written by an Export: an imported Pin is stamped as it is
   * added, exactly as its id is minted then, so it stays indistinguishable from
   * a dropped one. Absent on Pins stored before this field existed, which
   * {@link categoryColors} reads as "older than everything that has one".
   *
   * It exists so a Map can say which of its Categories appeared first, which is
   * the whole of what keeps a Category's colour still when another is added.
   * See ADR-0018.
   */
  createdAt?: number
  location: LatLng
  title: string
  category?: string
  description?: string
  link?: string
  imageUrl?: string
  /**
   * The `T2` of whoever added this Pin, on a Collaborative Map. Absent on a
   * Pin stored before Contributors existed, and on every Pin on a Solo Map,
   * where it would only ever equal the Owner's — see {@link pinAuthorId} in
   * `permissions.ts`, which is the one place that fallback is spelled out.
   * Never accepted from a client: see {@link PinInput}.
   */
  authorId?: T2
  /**
   * `authorId`'s username, denormalized at write time exactly as
   * {@link IndexMeta.author} is, for the Pin Card to show without a second
   * round trip. Never refreshed if the account is renamed or deleted.
   */
  author?: string
}

/**
 * A named polygon over part of a Map. Which Pins are in it is never stored: a
 * Pin is in a Region if its Location falls inside `polygon`, worked out by the
 * client at render time. See ADR-0021.
 */
export type Region = {
  id: string
  /**
   * When the server first stored this Region, in epoch ms. Never read from a
   * client and never written by an Export, for the reason {@link Pin.createdAt}
   * is not: it exists so a Region's colour can be broken by age, and an
   * imported Region is stamped where it lands. See ADR-0018.
   */
  createdAt: number
  name: string
  /**
   * The ring's vertices in order, not repeated at the end. Between
   * `RegionVertexMinCount` and `RegionVertexMaxCount` of them, each a valid
   * {@link LatLng}. A ring that crosses the antimeridian simply has vertices on
   * both sides of it: see `regionBounds` and `containsLocation`.
   */
  polygon: LatLng[]
}

/** The fields an Owner supplies when adding a Pin. */
export type PinInput = {
  location: LatLng
  title: string
  category?: string
  description?: string
  link?: string
  /** A data: URL; the server uploads it and stores the resulting hosted URL. */
  imageDataUrl?: string
}

/** The current Map state for this post. */
export type GetMapRsp = {
  ownerId: T2
  /**
   * The Owner's username, denormalized at creation. What names a legacy Pin
   * with no {@link Pin.author} of its own on a Collaborative Map — it *is*
   * the Owner's Pin, and this is the only place the client learns their name.
   */
  ownerName: string
  pins: Pin[]
  isOwner: boolean
  /**
   * Whether this Map is a Collaborative Map. Not sent as a per-request
   * "isContributor" or similar: `context.userId` is already available to the
   * client that reads this response, so `canAddPin`/`canEditPin` compute the
   * reader's capability locally from this fact plus that id, rather than the
   * server sending a second opinion about who is asking. See ADR-0019.
   */
  collaborative: boolean
  /**
   * Whether the reader moderates this subreddit, which is the whole of what
   * decides if the Default Area control is on screen. Always false for a
   * Preview, which never asks: see {@link GetMapFullParam}.
   */
  isModerator: boolean
  /**
   * The subreddit's Default Area, absent where no moderator has set one. Only a
   * Map with nothing to frame ever opens on it, but it rides along with every
   * Map: a Map that loses its last Pin is the same empty Map as one that never
   * had any, and it should land in the same place.
   */
  defaultArea?: MapBounds
  /**
   * The Map's Summary, absent where none has been written — absent rather than
   * `''`, the shape {@link defaultArea} and {@link IndexEntry.collaborative}
   * already use. It rides along with every reading that asks for the Map, but
   * only the full screen one has a Sidebar to put it in. See ADR-0020.
   */
  summary?: string
  /**
   * The Map's Regions — always present, `[]` where there are none. Unlike
   * {@link summary} a list has an honest empty value, so the argument for
   * absent-is-a-fact does not apply. They ride along with every reading,
   * Preview included, since a Preview draws them. See ADR-0021.
   */
  regions: Region[]
  /**
   * Pin ids in the Map's hand-made order — always present, `[]` where nobody has
   * reordered anything. It may name Pins that no longer exist; `sortPins` ignores
   * them.
   */
  order: string[]
}

/**
 * Set by the reading of a Map Post that can act on the answer, and by that one
 * only. Whether someone moderates the subreddit costs a Reddit round trip, and
 * a Preview has no toolbar to put the control in — so the reading that renders
 * once per feed scroll does not pay for an answer it cannot use.
 */
export const GetMapFullParam = 'full'

export type AddPinReq = PinInput
export type AddPinRsp = {pin: Pin}

export type UpdatePinReq = {
  id: string
  removeImage?: boolean
} & Partial<PinInput>
export type UpdatePinRsp = {pin: Pin}

export type DeletePinReq = {id: string}
export type DeletePinRsp = {ok: true}

/**
 * Applies an Export to this Map: its Pins are added, and its Summary and
 * Regions — where the file carries them — replace what the Map has. It names no
 * Map: the one it applies to is the Post the request came from, and only its
 * Owner may ask.
 *
 * `regions` and `summary` are absent where the file did not mention them, and
 * that is the whole of what leaves them alone: `regions: []` clears a Map's
 * Regions and an absent `regions` does not, exactly as `summary: ''` clears a
 * Summary and an absent one does not. See ADR-0022.
 *
 * Everything is checked before anything is written, so an Export with one bad
 * entry changes nothing rather than most of itself — a half-applied Import has
 * no clean retry, since its Pins add and re-running it would duplicate whatever
 * landed. See ADR-0017.
 */
export type ImportMapReq = {
  pins: PinExport[]
  regions?: RegionExport[]
  summary?: string
  /** The file's Pins are in the Map's hand-made order: see `MapFile.ordered`. */
  ordered?: true
}

/**
 * What landed, whole, so the Map draws what it now holds rather than guessing:
 * the Pins with the ids the server minted, and the Regions and Summary as they
 * now stand. `droppedImages` counts the Pins whose picture was on a host this
 * app could not have uploaded to: the Pin is kept and the picture is not.
 * `replaced` says what the Import actually overwrote — a Summary the Map had, a
 * count of Regions it had.
 */
export type ImportMapRsp = {
  pins: Pin[]
  droppedImages: number
  regions: Region[]
  summary?: string
  replaced: {summary: boolean; regions: number}
  /** The Map's Pin order now that the imported Pins are in it. */
  order: string[]
}

/**
 * Adds a Region. It names no Map, for the reason every Pin route does not.
 * Owner, or a Moderator on a Collaborative Map: see `canEditMap`.
 */
export type AddRegionReq = {name: string; polygon: LatLng[]}
export type AddRegionRsp = {region: Region}

export type UpdateRegionReq = {
  id: string
  name?: string
  polygon?: LatLng[]
}
export type UpdateRegionRsp = {region: Region}

export type DeleteRegionReq = {id: string}
export type DeleteRegionRsp = {ok: true}

/**
 * Makes the rectangle a moderator framed the subreddit's Default Area. It
 * carries the framing and nothing else: which subreddit is the install's to
 * know, and every Map on it is affected either way.
 */
export type SetDefaultAreaReq = {bounds: MapBounds}
export type SetDefaultAreaRsp = {ok: true}

/**
 * Forgets the Default Area, so empty Maps go back to opening on the whole
 * world. Names nothing, for {@link SetDefaultAreaReq}'s reason, and asks for no
 * confirmation: unlike Delete Map this undoes nothing that cannot be redone by
 * framing the Map again.
 */
export type ClearDefaultAreaReq = Record<string, never>
export type ClearDefaultAreaRsp = {ok: true}

/**
 * Writes this Map's Summary. It names no Map, for the reason every Pin route
 * does not: the Map is the Post the request came from. An empty string clears
 * it, the same way an emptied field clears a Pin's description.
 */
export type SetSummaryReq = {summary: string}

/**
 * What is now stored — absent where the Summary was cleared. It answers with
 * the stored value rather than `{ok: true}` so the Sidebar paints what landed
 * instead of what was typed, the way an Add or Update answers with the Pin.
 */
export type SetSummaryRsp = {summary?: string}

/**
 * Writes the Map's Pin order: every Pin id, in the order the Sidebar should list
 * them within their groups. It names no Map, for the reason every Pin route does
 * not. Owner, or a Moderator on a Collaborative Map: see `canEditMap`.
 */
export type SetOrderReq = {order: string[]}

/** What is now stored — ids of Pins that no longer exist are left out. */
export type SetOrderRsp = {order: string[]}

/** One Map Post's row in an Index Post's Listing. */
export type IndexEntry = {
  t3: T3
  /** The Map Post's Reddit title, which Reddit will not let anyone edit. */
  title: string
  /** The Owner's username, without the `u/`. */
  author: string
  pinCount: number
  /** Unix milliseconds. */
  createdAt: number
  /**
   * The Map Post's live Reddit upvote count, absent when Reddit could not be
   * reached. Absent is not zero: zero is a claim about the post, and a wrong
   * one. See ADR-0011.
   */
  score?: number
  /**
   * Present and `true` only for a Collaborative Map — absent rather than
   * `false`, the same shape {@link score} uses, so an Entry seeded before this
   * field existed reads as Solo without a migration. Without it `u/alice · 40
   * pins` would misattribute forty people's work to Alice. See ADR-0019.
   */
  collaborative?: boolean
}

/**
 * The two kinds of Map Post, chosen in the New Post Form and fixed at
 * creation — there is no converting one to the other. See ADR-0019.
 */
export type MapKind = (typeof MapKind)[keyof typeof MapKind]
export const MapKind = {Solo: 'solo', Collaborative: 'collaborative'} as const

/**
 * Whether a value is one of the two recognized kinds. Asked of a client's
 * request at creation, so that only a canonical value — or nothing — is ever
 * written to Redis; a value already in Redis is trusted without this, since
 * only this app ever writes that key.
 */
export function isMapKind(value: string | null | undefined): value is MapKind {
  return value === MapKind.Solo || value === MapKind.Collaborative
}

/** Which order a Listing is in. `top` is all-time, ties broken by newest. */
export type IndexSort = (typeof IndexSort)[keyof typeof IndexSort]
export const IndexSort = {New: 'new', Top: 'top'} as const

export function isIndexSort(value: string | null): value is IndexSort {
  return value === IndexSort.New || value === IndexSort.Top
}

/**
 * How many Entries a Listing holds. Fixed on every device: an Index Post never
 * opens full screen, so it always has the same 512px to spend, and a page size
 * that changed with the viewport would make `2 / 14` a lie on rotation. See
 * ADR-0010.
 */
export const IndexPageSize = 5

/**
 * One page of the Listing. `page` is 1-based and clamped to what exists, so a
 * client that asks for page 9 of 3 is told which page it actually got.
 */
export type GetIndexRsp = {
  entries: IndexEntry[]
  page: number
  pageCount: number
  total: number
  /**
   * Whether the reader moderates this subreddit, which is the whole of what
   * decides if Delete Index Post is on screen. It rides along with the Listing
   * rather than being asked for separately, since the Listing is the one
   * request an Index Post makes before it can render anything.
   */
  isModerator: boolean
}

/**
 * Asks the server to delete this Map Post. Nothing identifies which one: it is
 * always the Post the request came from, and only its Owner may ask.
 */
export type DeletePostReq = Record<string, never>
export type DeletePostRsp = {ok: true}

/**
 * Asks the server to delete this Index Post. Like {@link DeletePostReq} it
 * names nothing: the Post is the one the request came from. Only a moderator
 * of the subreddit may ask, and only of a post that is not a Map.
 */
export type DeleteIndexPostReq = Record<string, never>
export type DeleteIndexPostRsp = {ok: true}

/**
 * The confirmation an Owner passes through before their Post is deleted. It
 * asks for nothing but the accept button: the dialog is itself the deliberate
 * step, and a field inside it would be a second one for the same decision.
 *
 * It does not name the Post. A web view is not told the title of the Post it is
 * running inside — `document.title` is this app's own `<title>`, not Reddit's —
 * so quoting one would be quoting the wrong thing, and there is only ever one
 * Post this can mean.
 *
 * `collaborative` changes only the description: on a Collaborative Map,
 * Delete Map destroys every Contributor's work along with the Owner's, and
 * the confirmation says so rather than reading as if only the Owner stood to
 * lose anything.
 */
export function deletePostForm(collaborative: boolean): Form {
  return {
    title: 'Delete this map?',
    description: collaborative
      ? 'This map and every pin on it — including pins added by other people — will be deleted. This cannot be undone.'
      : 'This map and every pin on it will be deleted. This cannot be undone.',
    acceptLabel: 'Delete',
    cancelLabel: 'Keep it',
    fields: [],
  }
}

/**
 * The confirmation an Owner passes through before an Import replaces something.
 * Reddit's own modal, whose accept button is the whole of the confirmation —
 * the same shape {@link deletePostForm} has, for the same reason. It is shown
 * only when something would actually be replaced, so it names exactly that.
 *
 * It cannot name the Post, as {@link deletePostForm} cannot: a web view is not
 * told the title of the post it is running inside. See ADR-0022.
 */
export function importOverwriteForm(replaced: {
  summary: boolean
  regions: number
}): Form {
  const parts: string[] = []
  if (replaced.summary) parts.push('its summary')
  if (replaced.regions) {
    parts.push(
      replaced.regions === 1
        ? 'its region'
        : `all ${replaced.regions} of its regions`,
    )
  }
  return {
    title: 'Replace what this map says about itself?',
    description: `This import will replace ${parts.join(' and ')}. The pins in it are added to the ones already on the map. This cannot be undone.`,
    acceptLabel: 'Replace',
    cancelLabel: 'Cancel',
    fields: [],
  }
}

/**
 * The same confirmation for the other post type, in the same shape and with
 * the same empty field list. What it says is different because what is lost is
 * different: an Index Post owns no Map, so deleting one takes a list and
 * nothing that was on it.
 */
export function deleteIndexPostForm(): Form {
  return {
    title: 'Delete this index post?',
    description:
      'This index post will be deleted. The maps it lists are not touched. This cannot be undone.',
    acceptLabel: 'Delete',
    cancelLabel: 'Keep it',
    fields: [],
  }
}

/**
 * Asks the server to create a Map Post on the caller's behalf. `kind` is
 * already unwrapped to a plain value here — unlike {@link NewPostFormReq},
 * this is a shape this app's own client code builds, not one Reddit posts
 * from a raw form submission, so the caller (`map-index.ts`) does the
 * unwrapping before sending it. Absent, like an unrecognized value, reads as
 * Solo.
 */
export type CreateMapPostReq = {title: string; kind?: string}
export type CreateMapPostRsp = {url: string}

/**
 * The New Post Form, in the one place both callers can reach it: the subreddit
 * menu item shows it through Reddit, and Create a Map on an Index Post shows
 * the same object through the client's own `showForm`. Two spellings of one
 * form would drift.
 */
export function newPostForm(defaultTitle: string): Form {
  return {
    title: 'New map post',
    description: 'Name the post. You can add pins to its map once it exists.',
    acceptLabel: 'Create post',
    fields: [
      {
        type: 'string',
        name: 'title',
        label: 'Title',
        required: true,
        defaultValue: defaultTitle,
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
    ],
  }
}

/** The default a New Post Form offers, given whoever is filling it in. */
export function defaultMapPostTitle(username: string | undefined): string {
  return `${username ?? 'Someone'}'s Map`
}

/** The form a moderator fills in to create an Index Post. */
export function indexPostForm(defaultTitle: string): Form {
  return {
    title: 'New map index post',
    description:
      'Name the post. It lists every map on this subreddit, and is meant to be pinned.',
    acceptLabel: 'Create post',
    fields: [
      {
        type: 'string',
        name: 'title',
        label: 'Title',
        required: true,
        defaultValue: defaultTitle,
      },
    ],
  }
}

/** The default an Index Post's form offers. */
export function defaultIndexPostTitle(subredditName: string): string {
  return `r/${subredditName} Community Maps`
}

/**
 * Names the form Reddit shows when an Owner-to-be picks the new post menu
 * item. `devvit.json`'s `forms` maps this same name to
 * {@link Endpoint.OnFormNewPost}, which is where Reddit posts the values; the
 * two spellings must agree or the submitted form goes nowhere.
 */
export const NewPostFormName = 'newPost'

/**
 * A submitted new post form, as Reddit posts it: the field names from the
 * form, at the top level, with no envelope. Optional because the form is
 * Reddit's to render and the values are the user's to type.
 *
 * `kind` is `string[]`, not `string` — a Devvit `select` submits its choice
 * as an array (`SelectField` is `BaseField<string[]>`) even though this one
 * never allows more than one, so `routeFormNewPost` reads `req.kind?.[0]`.
 * Getting this wrong is silent and permanent: `req.kind === 'collaborative'`
 * simply never matches `['collaborative']`, the Post is created Solo, and
 * there is no conversion afterward. See ADR-0019.
 */
export type NewPostFormReq = {title?: string; kind?: string[]}

/**
 * Names the form a moderator uses to create an Index Post. Paired with
 * {@link Endpoint.OnFormNewIndexPost} in `devvit.json`.
 */
export const IndexPostFormName = 'newIndexPost'

/** A submitted Index Post form; the same one field, and the same caveats. */
export type IndexPostFormReq = {title?: string}

/** Reddit's own cap on the length of a post title. */
export const PostTitleMaxLen = 300

/**
 * The ceiling on a Map's Summary. Generous next to a Pin's description
 * (`PinDescriptionMaxLen`, 2000) because one Summary speaks for a whole Map
 * where a description speaks for one Pin, and because Markdown spends
 * characters on markup that a reader never sees. It lives here rather than in
 * `map-file.ts` — a Summary is not a Pin, and `map-file.ts` imports it — and
 * both ends need the number.
 */
export const MapSummaryMaxLen = 4000

/**
 * Where the standalone print page lives: `src/site/`, published to GitHub Pages
 * by `.github/workflows/pages.yaml`. A Map Post cannot print itself, so the Map
 * is copied out as an Export and pasted in there. See ADR-0023.
 */
export const PrintPageUrl = 'https://webrender.github.io/reddit-map-posts-app/'

export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]
export const Endpoint = {
  /** `?full=1` from the reading that can use a moderator answer. */
  GetMap: 'api/map',
  AddPin: 'api/pin/add',
  UpdatePin: 'api/pin/update',
  DeletePin: 'api/pin/delete',
  /** Apply a whole Export: add its Pins, replace its Summary and Regions. Owner only. */
  ImportMap: 'api/map/import',
  /** Store the framed rectangle as the subreddit's Default Area. Mods only. */
  SetDefaultArea: 'api/area/set',
  /** Forget it, so empty Maps open on the whole world again. Mods only. */
  ClearDefaultArea: 'api/area/clear',
  /** Write this Map's Summary. Owner, or a Moderator on a Collaborative Map. */
  SetSummary: 'api/summary/set',
  /** Write this Map's Pin order. Owner, or a Moderator on a Collaborative Map. */
  SetOrder: 'api/order/set',
  /** Trace a Region. Owner, or a Moderator on a Collaborative Map. */
  AddRegion: 'api/region/add',
  UpdateRegion: 'api/region/update',
  DeleteRegion: 'api/region/delete',
  /** `?url=` an allowlisted external URL; the server fetches and forwards it. */
  Proxy: 'api/proxy',
  /** `?q=&sort=&page=` one page of an Index Post's Listing. */
  GetIndex: 'api/index',
  /** Create a Map Post from inside an Index Post, rather than from the menu. */
  CreateMapPost: 'api/map/create',
  /** Delete the Map Post the request came from. Owner only. */
  DeletePost: 'api/post/delete',
  /** Delete the Index Post the request came from. Moderator only. */
  DeleteIndexPost: 'api/index/delete',
  OnMenuNewPost: 'internal/on/menu/new-post',
  OnFormNewPost: 'internal/on/form/new-post',
  OnMenuNewIndexPost: 'internal/on/menu/new-index-post',
  OnFormNewIndexPost: 'internal/on/form/new-index-post',
  OnTaskRefreshScores: 'internal/on/task/refresh-scores',
} as const

export const EndpointMethod = {
  [Endpoint.GetMap]: 'GET',
  [Endpoint.AddPin]: 'POST',
  [Endpoint.UpdatePin]: 'POST',
  [Endpoint.DeletePin]: 'POST',
  [Endpoint.ImportMap]: 'POST',
  [Endpoint.SetDefaultArea]: 'POST',
  [Endpoint.ClearDefaultArea]: 'POST',
  [Endpoint.SetSummary]: 'POST',
  [Endpoint.SetOrder]: 'POST',
  [Endpoint.AddRegion]: 'POST',
  [Endpoint.UpdateRegion]: 'POST',
  [Endpoint.DeleteRegion]: 'POST',
  [Endpoint.Proxy]: 'GET',
  [Endpoint.GetIndex]: 'GET',
  [Endpoint.CreateMapPost]: 'POST',
  [Endpoint.DeletePost]: 'POST',
  [Endpoint.DeleteIndexPost]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
  [Endpoint.OnFormNewPost]: 'POST',
  [Endpoint.OnMenuNewIndexPost]: 'POST',
  [Endpoint.OnFormNewIndexPost]: 'POST',
  [Endpoint.OnTaskRefreshScores]: 'POST',
} as const satisfies {[E in Endpoint]: 'GET' | 'POST'}
