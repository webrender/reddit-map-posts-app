import type {PlaceResult} from '../shared/api.ts'

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

type TextSearchRsp = {
  places?: {
    displayName?: {text?: string}
    location?: {latitude?: number; longitude?: number}
  }[]
}

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
