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
