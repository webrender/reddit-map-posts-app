import {AJAXError, addProtocol} from 'maplibre-gl'
import {
  type AddPinReq,
  type AddPinRsp,
  type DeletePinReq,
  type DeletePinRsp,
  Endpoint,
  type GetMapRsp,
  type PlaceResult,
  type UpdatePinReq,
  type UpdatePinRsp,
} from '../shared/api.ts'

export async function fetchGetMap(): Promise<GetMapRsp | undefined> {
  return fetchJson(Endpoint.GetMap)
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

export type SearchPlacesResult =
  | {ok: true; results: PlaceResult[]}
  | {ok: false; unavailable: boolean}

export async function fetchSearchPlaces(
  query: string,
): Promise<SearchPlacesResult> {
  let rsp: Response
  try {
    rsp = await fetch(
      `${Endpoint.SearchPlaces}?q=${encodeURIComponent(query)}`,
      {
        headers: {Accept: 'application/json'},
      },
    )
  } catch (err) {
    console.error(`HTTP error: ${err instanceof Error ? err.message : err}`)
    return {ok: false, unavailable: false}
  }

  if (rsp.status === 503) return {ok: false, unavailable: true}
  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '')
    console.error(`HTTP status ${rsp.status}: ${rsp.statusText}; ${text}`)
    return {ok: false, unavailable: false}
  }

  const body = (await rsp.json()) as {results: PlaceResult[]}
  return {ok: true, results: body.results}
}

async function fetchJson<T>(
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  let rsp: Response
  try {
    rsp = await fetch(
      path,
      body === undefined
        ? {headers: {Accept: 'application/json'}}
        : {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          },
    )
  } catch (err) {
    console.error(`HTTP error: ${err instanceof Error ? err.message : err}`)
    return
  }

  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '')
    console.error(`HTTP status ${rsp.status}: ${rsp.statusText}; ${text}`)
    return
  }

  return (await rsp.json()) as T
}
