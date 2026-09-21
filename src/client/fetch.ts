import {AJAXError, addProtocol} from 'maplibre-gl'
import {
  type AddPinReq,
  type AddPinRsp,
  type AddRegionReq,
  type AddRegionRsp,
  type ClearDefaultAreaRsp,
  type DeletePinReq,
  type DeletePinRsp,
  type DeletePostRsp,
  type DeleteRegionReq,
  type DeleteRegionRsp,
  Endpoint,
  GetMapFullParam,
  type GetMapRsp,
  type ImportMapReq,
  type ImportMapRsp,
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
import {type FetchResult, fetchJson, fetchJsonResult} from './json.ts'

/**
 * `full` is the reading asking, and it decides whether the server spends a
 * Reddit round trip working out if this reader moderates here. A Preview has
 * nowhere to put the control that answer gates, so it does not ask.
 */
export async function fetchGetMap(
  full: boolean,
): Promise<GetMapRsp | undefined> {
  return fetchJson(
    full ? `${Endpoint.GetMap}?${GetMapFullParam}=1` : Endpoint.GetMap,
  )
}

export async function fetchAddPin(
  req: AddPinReq,
): Promise<AddPinRsp | undefined> {
  return fetchJson(Endpoint.AddPin, req)
}

export async function fetchUpdatePin(
  req: UpdatePinReq,
): Promise<UpdatePinRsp | undefined> {
  return fetchJson(Endpoint.UpdatePin, req)
}

export async function fetchDeletePin(
  req: DeletePinReq,
): Promise<DeletePinRsp | undefined> {
  return fetchJson(Endpoint.DeletePin, req)
}

/**
 * The result-carrying sibling of {@link fetchUpdatePin}, for the one caller —
 * `savePin` — that has to tell a 404 (the Pin was deleted out from under this
 * editor) and a 403 (a Moderator or the author revoked this reader's standing
 * mid-edit) apart from an ordinary failure.
 */
export async function fetchUpdatePinResult(
  req: UpdatePinReq,
): Promise<FetchResult<UpdatePinRsp>> {
  return fetchJsonResult(Endpoint.UpdatePin, req)
}

/** The result-carrying sibling of {@link fetchDeletePin} — see the above. */
export async function fetchDeletePinResult(
  req: DeletePinReq,
): Promise<FetchResult<DeletePinRsp>> {
  return fetchJsonResult(Endpoint.DeletePin, req)
}

/**
 * Applies a whole Export at once: its Pins are added and its Summary and
 * Regions replace what the Map has. Names no Map for the reason every Pin route
 * does not: the Map is the Post this page is running in.
 */
export async function fetchImportMap(
  req: ImportMapReq,
): Promise<ImportMapRsp | undefined> {
  return fetchJson(Endpoint.ImportMap, req)
}

/** Writes the Map's Pin order; see `SetOrderReq`. */
export async function fetchSetOrder(
  req: SetOrderReq,
): Promise<SetOrderRsp | undefined> {
  return fetchJson(Endpoint.SetOrder, req)
}

/** Takes no arguments: the Post to delete is the one this page is running in. */
export async function fetchDeletePost(): Promise<DeletePostRsp | undefined> {
  return fetchJson(Endpoint.DeletePost, {})
}

/**
 * The scheme external URLs are rewritten to. Any scheme but http(s) makes
 * MapLibre defer the request to the handler registered by
 * {@link installProxyProtocol} rather than fetching it itself, and a worker that
 * doesn't recognize the scheme forwards the request to the main thread. That
 * detour is the point: MapLibre loads tiles and glyphs from a Web Worker, and
 * only the main thread's `fetch` carries the app's auth token, so a request made
 * from the worker comes back 401.
 */
const proxyScheme = 'mapproxy'

/**
 * Rewrites an external URL to the proxy scheme, since Reddit apps may only make
 * external requests from the server. Local URLs (`data:`, `blob:`, same-origin)
 * are left alone, signalled as `undefined`.
 */
export function proxyExternalUrl(url: string): {url: string} | undefined {
  if (!/^https?:\/\//i.test(url)) return
  if (new URL(url).origin === location.origin) return
  return {url: url.replace(/^https?:/i, `${proxyScheme}:`)}
}

/**
 * Teaches MapLibre to load {@link proxyScheme} URLs through the server's proxy.
 * MapLibre only ever calls this on the main thread, which is what makes it work.
 */
export function installProxyProtocol(): void {
  addProtocol(proxyScheme, async (req, abort) => {
    const url = req.url.replace(new RegExp(`^${proxyScheme}:`, 'i'), 'https:')
    const rsp = await fetch(
      `${Endpoint.Proxy}?url=${encodeURIComponent(url)}`,
      {signal: abort.signal, headers: req.headers},
    )
    // MapLibre reads the status off this error; a 404 tile means empty, not broken.
    if (!rsp.ok) {
      throw new AJAXError(rsp.status, rsp.statusText, req.url, await rsp.blob())
    }

    let data: unknown
    if (req.type === 'json') data = await rsp.json()
    else if (req.type === 'string') data = await rsp.text()
    else data = await rsp.arrayBuffer()

    return {
      data,
      cacheControl: rsp.headers.get('Cache-Control'),
      expires: rsp.headers.get('Expires'),
      etag: rsp.headers.get('ETag') ?? undefined,
    }
  })
}

/** Makes the rectangle the moderator framed the subreddit's Default Area. */
export async function fetchSetDefaultArea(
  req: SetDefaultAreaReq,
): Promise<SetDefaultAreaRsp | undefined> {
  return fetchJson(Endpoint.SetDefaultArea, req)
}

/** Takes no arguments: there is one Default Area, and it belongs to the install. */
export async function fetchClearDefaultArea(): Promise<
  ClearDefaultAreaRsp | undefined
> {
  return fetchJson(Endpoint.ClearDefaultArea, {})
}

/**
 * Writes this Map's Summary. Names no Map for the reason the Pin routes do not:
 * it is the Post this page is running in. An empty string clears it.
 */
export async function fetchSetSummary(
  req: SetSummaryReq,
): Promise<SetSummaryRsp | undefined> {
  return fetchJson(Endpoint.SetSummary, req)
}

/**
 * The three Region writes, in the shape of {@link fetchSetSummary} and for the
 * same reason: they name no Map, and the caller has nothing more specific to say
 * about a failure than that it happened.
 */
export async function fetchAddRegion(
  req: AddRegionReq,
): Promise<AddRegionRsp | undefined> {
  return fetchJson(Endpoint.AddRegion, req)
}

export async function fetchUpdateRegion(
  req: UpdateRegionReq,
): Promise<UpdateRegionRsp | undefined> {
  return fetchJson(Endpoint.UpdateRegion, req)
}

export async function fetchDeleteRegion(
  req: DeleteRegionReq,
): Promise<DeleteRegionRsp | undefined> {
  return fetchJson(Endpoint.DeleteRegion, req)
}
