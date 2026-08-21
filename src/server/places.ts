import type {PlaceResult} from '../shared/api.ts'

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

type TextSearchRsp = {
  places?: {
    displayName?: {text?: string}
    location?: {latitude?: number; longitude?: number}
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

/** The cheapest single-call shape that returns both a place's name and coordinates. */
export async function searchPlaces(
  query: string,
  apiKey: string,
): Promise<PlaceResult[]> {
  const rsp = await fetch(TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.location',
    },
    body: JSON.stringify({textQuery: query}),
  })
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
