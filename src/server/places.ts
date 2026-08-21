import {
  DefaultAreaMaxResults,
  type MapArea,
  type MapBounds,
  type PlaceResult,
} from '../shared/api.ts'

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

type LatLngLiteral = {latitude?: number; longitude?: number}

type TextSearchRsp = {
  places?: {
    displayName?: {text?: string}
    formattedAddress?: string
    location?: LatLngLiteral
    viewport?: {low?: LatLngLiteral; high?: LatLngLiteral}
  }[]
}

/** What a key turned out to be worth when Google was asked about it. */
export type PlacesKeyCheck = 'ok' | 'rejected' | 'unreachable'

/**
 * Asks Google whether a key works, before it is stored, so a typo surfaces
 * while the moderator is still looking at the form rather than as a 503 the
 * next time someone searches.
 *
 * An id-only text search is billed at Google's free Essentials tier, so this
 * check costs nothing — which is what makes it affordable on every submit.
 */
export async function checkPlacesApiKey(
  apiKey: string,
): Promise<PlacesKeyCheck> {
  let rsp: Response
  try {
    rsp = await fetch(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({textQuery: KEY_CHECK_QUERY, maxResultCount: 1}),
    })
  } catch {
    return 'unreachable'
  }

  if (rsp.ok) return 'ok'
  // A quota that is spent says nothing about whether the key is the right
  // one, so it is grouped with Google being down rather than with rejection.
  if (rsp.status === 429) return 'unreachable'
  // Everything else in the 4xx range is Google refusing this key: malformed,
  // restricted away from this API, or belonging to a project without Places
  // enabled. A 5xx is Google having a bad day.
  return rsp.status < 500 ? 'rejected' : 'unreachable'
}

/** Any query at all; only the response status is read. */
const KEY_CHECK_QUERY = 'coffee'

/**
 * The cheapest single-call shape that returns both a place's name and
 * coordinates. `bias` is the subreddit's Default Area where it has one, which
 * ranks nearby places first without hiding distant ones — the answer to
 * "Springfield" on a Map of Illinois should not be the one in Massachusetts.
 */
export async function searchPlaces(
  query: string,
  apiKey: string,
  bias?: MapBounds,
): Promise<PlaceResult[]> {
  const mask = 'places.displayName,places.location'
  let rsp = await textSearch(query, apiKey, mask, bias)
  // A bias Google will not take is not worth a failed search: it only orders
  // results, so the same search without it is the same search, less helpfully
  // ranked. Without this, one rectangle Google stopped accepting would take
  // Place Search down on every subreddit that had set a Default Area.
  if (!rsp.ok && bias && rsp.status < 500) {
    console.error(`places search rejected the location bias: ${rsp.status}`)
    rsp = await textSearch(query, apiKey, mask)
  }
  if (!rsp.ok) throw Error(`places search failed: ${rsp.status}`)

  const data = (await rsp.json()) as TextSearchRsp
  const results: PlaceResult[] = []
  for (const place of data.places ?? []) {
    const name = place.displayName?.text
    const lat = place.location?.latitude
    const lng = place.location?.longitude
    if (name && lat !== undefined && lng !== undefined) {
      results.push({name, location: {lat, lng}})
    }
  }
  return results
}

/**
 * The same search read for its rectangles instead of its points: what a
 * moderator gets to choose a Default Area from. `viewport` and
 * `formattedAddress` are billed at the same Pro tier as the name and location
 * {@link searchPlaces} already asks for, so reading an area costs no more than
 * reading a place.
 *
 * A place Google returns without a viewport is dropped rather than squared off
 * around its point: a rectangle guessed here would be a zoom level guessed
 * here, which is the thing ADR-0012 refuses to store.
 */
export async function searchAreas(
  query: string,
  apiKey: string,
): Promise<MapArea[]> {
  const rsp = await textSearch(
    query,
    apiKey,
    'places.displayName,places.formattedAddress,places.viewport',
    undefined,
    DefaultAreaMaxResults,
  )
  if (!rsp.ok) throw Error(`places search failed: ${rsp.status}`)

  const data = (await rsp.json()) as TextSearchRsp
  const areas: MapArea[] = []
  for (const place of data.places ?? []) {
    const west = place.viewport?.low?.longitude
    const south = place.viewport?.low?.latitude
    const east = place.viewport?.high?.longitude
    const north = place.viewport?.high?.latitude
    if (
      west === undefined ||
      south === undefined ||
      east === undefined ||
      north === undefined
    ) {
      continue
    }
    const name = areaName(place.displayName?.text, place.formattedAddress)
    if (name) areas.push({name, bounds: {west, south, east, north}})
  }
  return areas
}

/**
 * What one match is called in the pick form, and afterwards wherever the stored
 * area is reported. The address is what tells two Springfields apart, but for a
 * region it usually contains the name already, so pasting both together would
 * read as "Tokyo — Tokyo, Japan".
 */
function areaName(
  displayName: string | undefined,
  address: string | undefined,
): string | undefined {
  if (!displayName) return address
  if (!address) return displayName
  return address.includes(displayName) ? address : `${displayName} — ${address}`
}

function textSearch(
  query: string,
  apiKey: string,
  fieldMask: string,
  bias?: MapBounds,
  maxResultCount?: number,
): Promise<Response> {
  const body: {
    textQuery: string
    maxResultCount?: number
    locationBias?: {rectangle: {low: LatLngLiteral; high: LatLngLiteral}}
  } = {textQuery: query}
  if (maxResultCount !== undefined) body.maxResultCount = maxResultCount
  if (bias) {
    // Google's corners, not ours: `low` is the south-west and `high` the
    // north-east, and an inverted longitude range is how both sides spell an
    // area that crosses the antimeridian.
    body.locationBias = {
      rectangle: {
        low: {latitude: bias.south, longitude: bias.west},
        high: {latitude: bias.north, longitude: bias.east},
      },
    }
  }
  return fetch(TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  })
}
