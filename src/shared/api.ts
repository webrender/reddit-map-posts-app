import type {Form, T2, T3} from '@devvit/web/shared'

/** Generic error detail for all responses. */
export type ErrorRsp = {error: string; status: number}

export type LatLng = {lat: number; lng: number}

/** A single marked location on a Map. */
export type Pin = {
  id: string
  location: LatLng
  title: string
  category?: string
  description?: string
  link?: string
  imageUrl?: string
  /**
   * Set on Pins added by Place Search, whose Location belongs to the place
   * rather than to the Owner, and so cannot be moved. Absent on Pins added by
   * Manual Pin Drop, and on Pins stored before this was recorded.
   */
  fromPlaceSearch?: boolean
}

/** The fields an Owner supplies when adding a Pin, via either add-path. */
export type PinInput = {
  location: LatLng
  title: string
  category?: string
  description?: string
  link?: string
  /** Only the Place Search add-path sets this; see {@link Pin.fromPlaceSearch}. */
  fromPlaceSearch?: boolean
  /** A data: URL; the server uploads it and stores the resulting hosted URL. */
  imageDataUrl?: string
}

/** The current Map state for this post. */
export type GetMapRsp = {ownerId: T2; pins: Pin[]; isOwner: boolean}

export type AddPinReq = PinInput
export type AddPinRsp = {pin: Pin}

export type UpdatePinReq = {
  id: string
  removeImage?: boolean
} & Partial<PinInput>
export type UpdatePinRsp = {pin: Pin}

export type DeletePinReq = {id: string}
export type DeletePinRsp = {ok: true}

export type PlaceResult = {name: string; location: LatLng}
export type SearchPlacesRsp = {results: PlaceResult[]}

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
 */
export function deletePostForm(): Form {
  return {
    title: 'Delete this map?',
    description:
      'This map and every pin on it will be deleted. This cannot be undone.',
    acceptLabel: 'Delete',
    cancelLabel: 'Keep it',
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

/** Asks the server to create a Map Post on the caller's behalf. */
export type CreateMapPostReq = {title: string}
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
 */
export type NewPostFormReq = {title?: string}

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
 * Names the form a moderator uses to store this subreddit's Places API key.
 * Paired with {@link Endpoint.OnFormPlacesKey} in `devvit.json`, the same way
 * {@link NewPostFormName} is.
 */
export const PlacesKeyFormName = 'placesKey'

/**
 * A submitted Places API key form. The key travels in one direction only — it
 * is written here and never sent back — so an empty `key` means "leave
 * whatever is stored alone", and `remove` is the only way to clear it.
 */
export type PlacesKeyFormReq = {key?: string; remove?: boolean}

export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]
export const Endpoint = {
  GetMap: 'api/map',
  AddPin: 'api/pin/add',
  UpdatePin: 'api/pin/update',
  DeletePin: 'api/pin/delete',
  SearchPlaces: 'api/places/search',
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
  OnMenuPlacesKey: 'internal/on/menu/places-key',
  OnFormPlacesKey: 'internal/on/form/places-key',
  OnTaskRefreshScores: 'internal/on/task/refresh-scores',
} as const

export const EndpointMethod = {
  [Endpoint.GetMap]: 'GET',
  [Endpoint.AddPin]: 'POST',
  [Endpoint.UpdatePin]: 'POST',
  [Endpoint.DeletePin]: 'POST',
  [Endpoint.SearchPlaces]: 'GET',
  [Endpoint.Proxy]: 'GET',
  [Endpoint.GetIndex]: 'GET',
  [Endpoint.CreateMapPost]: 'POST',
  [Endpoint.DeletePost]: 'POST',
  [Endpoint.DeleteIndexPost]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
  [Endpoint.OnFormNewPost]: 'POST',
  [Endpoint.OnMenuNewIndexPost]: 'POST',
  [Endpoint.OnFormNewIndexPost]: 'POST',
  [Endpoint.OnMenuPlacesKey]: 'POST',
  [Endpoint.OnFormPlacesKey]: 'POST',
  [Endpoint.OnTaskRefreshScores]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}
