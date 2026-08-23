import {isLatLng, type LatLng} from '../shared/api.ts'

/**
 * What a pasted Map Link turned out to be. Read entirely on the device: the
 * link is picked apart with the browser's own URL parser and nothing is
 * fetched, so Google and Apple are never told that a Pin was made — which is
 * the whole of what keeps ADR-0013 true. See ADR-0015.
 */
export type MapLink =
  | {kind: 'place'; location: LatLng; title?: string}
  | {kind: 'shortened'}
  | {kind: 'unreadable'}

/**
 * Coordinates as both providers spell a pair of them in one string: `lat,lng`,
 * with the space a URL-decoded `+` leaves behind allowed either side.
 */
const coordPair = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/

/**
 * The place a Google Maps link is *about*, which is not the same as the `@`
 * camera it opens with — a link to a hotel centres the map on the block and
 * marks the door, and those differ by a street's width. It rides in the opaque
 * `data=` segment as an adjacent `!3d<lat>!4d<lng>` pair.
 */
const googlePlaceCoords = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g

/** The camera a Google Maps link opens with: `/@lat,lng,<zoom>`. */
const googleCameraCoords = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/

/**
 * Query parameters either provider may hand a `lat,lng` in, most specific
 * first: a link that says both where it is centred and what it is about should
 * yield the latter.
 */
const coordParams = [
  'coordinate',
  'destination',
  'daddr',
  'q',
  'query',
  'll',
  'sll',
  'center',
]

/** Where a name may be, most specific first. `address` is a last resort. */
const titleParams = ['name', 'q', 'query', 'address']

/**
 * Reads a Google Maps or Apple Maps link into somewhere a Pin can go. Given
 * anything else — including a shortened link, whose location lives behind a
 * redirect this app will not follow — it says so rather than guessing.
 */
export function parseMapLink(text: string): MapLink {
  const url = readUrl(text)
  if (!url) return {kind: 'unreadable'}

  const host = url.hostname.toLowerCase()
  if (isShortened(host, url.pathname)) return {kind: 'shortened'}
  if (isAppleHost(host)) return readAppleLink(url)
  if (isGoogleHost(host)) return readGoogleLink(url)
  return {kind: 'unreadable'}
}

/**
 * The URL inside whatever was pasted. A share sheet often hands over the name
 * and the link on two lines, so the link is picked out of the text rather than
 * required to be all of it; a bare `maps.apple.com/…` with the scheme rubbed
 * off is met halfway.
 */
function readUrl(text: string): URL | undefined {
  const embedded = text.match(/https?:\/\/\S+/i)
  const candidate = embedded ? embedded[0] : `https://${text.trim()}`
  try {
    return new URL(candidate)
  } catch {
    return
  }
}

function isGoogleHost(host: string): boolean {
  return /(^|\.)google(\.[a-z]{2,})+$/.test(host)
}

function isAppleHost(host: string): boolean {
  return /(^|\.)maps\.apple(\.com)?$/.test(host)
}

/**
 * Whether the link is one of the short forms both providers hand out from a
 * share sheet. They carry an opaque key and nothing else: the coordinates are
 * on the other end of a redirect, and following one would be the request
 * ADR-0013 says this app does not make.
 */
function isShortened(host: string, path: string): boolean {
  if (/(^|\.)goo\.gl$/.test(host)) return true
  return isAppleHost(host) && path.startsWith('/p/')
}

function readGoogleLink(url: URL): MapLink {
  const location =
    coordsFromPlace(url.href) ??
    coordsFromCamera(url.pathname) ??
    coordsFromParams(url)
  if (!location) return {kind: 'unreadable'}
  return placeLink(location, googleTitle(url))
}

function readAppleLink(url: URL): MapLink {
  const location = coordsFromParams(url)
  if (!location) return {kind: 'unreadable'}
  return placeLink(location, textFromParams(url))
}

function coordsFromPlace(href: string): LatLng | undefined {
  // A directions link carries one pair per leg; the last is the destination,
  // which is the one a Pin would be about.
  let last: RegExpExecArray | undefined
  for (const match of href.matchAll(googlePlaceCoords)) last = match
  return last ? toLatLng(last[1], last[2]) : undefined
}

function coordsFromCamera(pathname: string): LatLng | undefined {
  const match = pathname.match(googleCameraCoords)
  return match ? toLatLng(match[1], match[2]) : undefined
}

function coordsFromParams(url: URL): LatLng | undefined {
  for (const name of coordParams) {
    const found = parseCoordPair(url.searchParams.get(name))
    if (found) return found
  }
  return
}

/**
 * A Google link's title: the segment after `/place/`, which is the name with
 * its spaces written as `+`. A dropped pin has coordinates there instead of a
 * name, and those are already the Location — a Pin called "21.27,-157.82"
 * would only be the Map saying twice where it is.
 */
function googleTitle(url: URL): string | undefined {
  const segments = url.pathname.split('/')
  const index = segments.indexOf('place')
  const named = index === -1 ? undefined : decodeSegment(segments[index + 1])
  if (named) return named
  return textFromParams(url)
}

function textFromParams(url: URL): string | undefined {
  for (const name of titleParams) {
    // `URLSearchParams` has already turned `+` into a space and decoded the
    // rest, unlike a path segment.
    const value = url.searchParams.get(name)?.trim()
    if (value && !parseCoordPair(value)) return value
  }
  return
}

function decodeSegment(segment: string | undefined): string | undefined {
  if (!segment) return
  try {
    // `+` first: a real plus reaches here as `%2B`, so decoding first would
    // turn it into a space along with the separators.
    const decoded = decodeURIComponent(segment.replaceAll('+', ' ')).trim()
    return decoded && !parseCoordPair(decoded) ? decoded : undefined
  } catch {
    // A half-escaped segment is not a name worth salvaging.
    return
  }
}

function parseCoordPair(value: string | null | undefined): LatLng | undefined {
  const match = value?.match(coordPair)
  return match ? toLatLng(match[1], match[2]) : undefined
}

/**
 * Both numbers as a Location, or nothing where either is outside the world.
 * The same check the server makes of a Pin, asked here so that a link with a
 * plausible shape but impossible numbers reads as unreadable rather than
 * dropping a Pin the server will refuse.
 */
function toLatLng(
  lat: string | undefined,
  lng: string | undefined,
): LatLng | undefined {
  const location = {lat: Number(lat), lng: Number(lng)}
  return isLatLng(location) ? location : undefined
}

function placeLink(location: LatLng, title: string | undefined): MapLink {
  return title ? {kind: 'place', location, title} : {kind: 'place', location}
}
