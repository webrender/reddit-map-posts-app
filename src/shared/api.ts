import type {T2} from '@devvit/web/shared'

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
}

/** The fields an Owner supplies when adding a Pin, via either add-path. */
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

export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]
export const Endpoint = {
  GetMap: 'api/map',
  AddPin: 'api/pin/add',
  UpdatePin: 'api/pin/update',
  DeletePin: 'api/pin/delete',
  SearchPlaces: 'api/places/search',
  OnAppInstall: 'internal/on/app/install',
  OnMenuNewPost: 'internal/on/menu/new-post',
} as const

export const EndpointMethod = {
  [Endpoint.GetMap]: 'GET',
  [Endpoint.AddPin]: 'POST',
  [Endpoint.UpdatePin]: 'POST',
  [Endpoint.DeletePin]: 'POST',
  [Endpoint.SearchPlaces]: 'GET',
  [Endpoint.OnAppInstall]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}
