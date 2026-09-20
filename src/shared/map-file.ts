import {
  isLatLng,
  type LatLng,
  MapSummaryMaxLen,
  type Pin,
  type Region,
} from './api.ts'

/**
 * The shape of an Export, bumped only when a reader of this version could
 * misread a later one. Import checks it loosely — an unknown version is read
 * anyway, since every field it does understand still means what it says — and
 * it is here so that a future format which *does* break can say so.
 *
 * 2 is the version that added the Summary and Regions. A version 1 file and a
 * bare array of Pins both still read, as Pins with no Summary and no Regions —
 * which is most of what is in the wild, and what makes an Import that asks for
 * no confirmation the common one. See ADR-0022.
 */
export const MapFileVersion = 2

/**
 * How many Pins one Import may carry. A Map has never had a ceiling because a
 * Pin has never been cheap to add; an Export pasted into a field is the first
 * way to ask for thousands at once, so this is where the ceiling belongs.
 */
export const PinImportMaxCount = 500

/**
 * Ceilings on a Pin's text. Far past anything anyone types into the form —
 * they exist because an Import is the first Pin text this app did not watch
 * someone write, and an unbounded string is an unbounded Redis value.
 */
export const PinTitleMaxLen = 200
export const PinCategoryMaxLen = 60
export const PinDescriptionMaxLen = 2000
export const PinLinkMaxLen = 2000

/**
 * Ceilings on a Region, for the reason the Pin ones exist: an Import is the
 * first Region text this app did not watch someone draw. Enforced in the shared
 * reader and in the server's normalizers alike, so the typed path and the
 * pasted one cannot disagree about what a Region may hold.
 */
export const RegionNameMaxLen = 60
export const RegionMaxCount = 24
export const RegionVertexMaxCount = 200
export const RegionVertexMinCount = 3

/**
 * One Pin as an Export writes it: everything a Pin has except its id, which
 * belongs to the Map that holds it rather than to the Pin's description of
 * itself. Import mints a fresh one for every Pin it adds.
 *
 * A Location is a pair of numbers and can be nothing else. There is
 * deliberately no field here that a Google or Apple Maps URL could sit in and
 * be resolved from: taking a list of links at once is the line ADR-0015 drew,
 * and this format cannot express the request. See ADR-0017.
 */
export type PinExport = {
  title: string
  location: LatLng
  category?: string
  description?: string
  link?: string
  imageUrl?: string
}

/**
 * One Region as an Export writes it: its name and its ring, and nothing else.
 * No id, which belongs to the Map holding the Region rather than to the
 * Region's account of itself, and no `createdAt`, so an imported Region is
 * stamped fresh where it lands and its colour is re-derived there. See
 * ADR-0018 and ADR-0022.
 */
export type RegionExport = {name: string; polygon: LatLng[]}

/**
 * An Export, as {@link formatMapFile} writes it. `summary` and `regions` are
 * absent where the Map has none, and *absent means something*: a file with no
 * `regions` leaves the Map's Regions alone on Import, and a file with
 * `"regions": []` clears them. The writer only ever omits, so an Export of a
 * Map with nothing to say never destroys anything on its way back in.
 */
export type MapFile = {
  version: number
  summary?: string
  regions?: RegionExport[]
  pins: PinExport[]
}

/**
 * What {@link parseMapFile} makes of some text. `summary` and `regions` are
 * present only where the file carried them — see {@link MapFile} for why
 * absent and empty are different answers.
 */
export type MapFileRead =
  | {
      pins: PinExport[]
      droppedImages: number
      summary?: string
      regions?: RegionExport[]
    }
  | {error: string}

/**
 * A whole Map as the text an Owner copies out: its Pins, its Regions and its
 * Summary. Pretty-printed on purpose: an Export is something a person opens in
 * an editor and changes by hand, and a single line of JSON is not.
 */
export function formatMapFile(
  pins: readonly Pin[],
  regions: readonly Region[] = [],
  summary?: string,
): string {
  const file: MapFile = {
    version: MapFileVersion,
    pins: pins.map(toPinExport),
  }
  if (summary) file.summary = summary
  if (regions.length) file.regions = regions.map(toRegionExport)
  return `${JSON.stringify(file, undefined, 2)}\n`
}

/**
 * Reads an Export back, or says why it could not. Every entry is checked
 * before any of them is accepted, and an error names the entry by its position
 * so the Owner can find it in the text they still have in front of them —
 * Import adds all of it or none of it, because a half-applied Import has no
 * clean retry.
 *
 * It is deliberately forgiving about the envelope and strict about the Pins: a
 * bare array is read as the pins, and unknown fields are ignored, so text
 * written by hand or by a later version of this app still works.
 */
export function parseMapFile(text: string): MapFileRead {
  if (!text.trim()) return {error: 'Paste an export first.'}

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {
      error: 'That is not JSON. Paste the whole export, including the {}.',
    }
  }
  return readMapValue(value)
}

/**
 * The same read, of JSON that has already been parsed — which is what the
 * server has, since a request body arrives parsed rather than as text. Both
 * ends go through this, so the client's refusal and the server's are the same
 * refusal rather than two that can drift apart.
 */
export function readMapValue(value: unknown): MapFileRead {
  const envelope = readEnvelope(value)
  if (!envelope) {
    return {error: 'That JSON is not an export: it has no list of pins in it.'}
  }
  const list = envelope.pins
  if (list.length > PinImportMaxCount) {
    return {
      error: `That is ${list.length} pins; ${PinImportMaxCount} is the most one import can add.`,
    }
  }

  const pins: PinExport[] = []
  let droppedImages = 0
  for (const [index, entry] of list.entries()) {
    const read = readPin(entry, index)
    if ('error' in read) return read
    if (read.droppedImage) droppedImages++
    pins.push(read.pin)
  }

  const out: MapFileRead = {pins, droppedImages}

  if (envelope.regions !== undefined) {
    const regions = readRegions(envelope.regions)
    if ('error' in regions) return regions
    out.regions = regions.regions
  }

  if (envelope.summary !== undefined) {
    const summary = readSummary(envelope.summary)
    if (typeof summary === 'object') return summary
    out.summary = summary
  }

  // A file that carries a Summary or Regions but no Pins is a real Export of a
  // Map that has none yet; a file that carries nothing at all is not one.
  if (!pins.length && out.regions === undefined && out.summary === undefined) {
    return {error: 'That export has no pins in it.'}
  }
  return out
}

/**
 * Whether an `imageUrl` is one this app could itself have uploaded. Until
 * Import there was no way for a stored `imageUrl` to be anything else — every
 * one of them came back from `media.upload` — and this check is the whole of
 * what keeps that true now that text an Owner pasted can carry one. See
 * ADR-0017.
 *
 * Hosts are matched whole. A substring test would let `i.redd.it.example.com`
 * through, which is the entire trick this is here to refuse.
 */
export function isRedditMediaUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return (
    host === 'redd.it' ||
    host.endsWith('.redd.it') ||
    host === 'redditmedia.com' ||
    host.endsWith('.redditmedia.com')
  )
}

/**
 * A Pin as an Export describes it, dropping the id the Map gave it. Built
 * from an allowlist rather than a spread, so `authorId` and `author` — a
 * Contributor's identity on a Collaborative Map — cannot leak into an Export
 * merely because `Pin` grew the fields; leaving them off is a decision, not
 * an oversight left for the next field `Pin` gains. The consequence is
 * accepted rather than guarded against: an Owner who exports a Collaborative
 * Map and imports it into a Solo one launders every Pin's attribution to
 * themselves, since `toPin` in `server.ts` always stamps an imported Pin to
 * whoever is running the Import.
 */
function toPinExport(pin: Pin): PinExport {
  const out: PinExport = {title: pin.title, location: pin.location}
  if (pin.category) out.category = pin.category
  if (pin.description) out.description = pin.description
  if (pin.link) out.link = pin.link
  if (pin.imageUrl) out.imageUrl = pin.imageUrl
  return out
}

/**
 * The parts out of either envelope: `{pins, regions?, summary?}` or a bare
 * `[...]` of Pins. An object may leave `pins` out only if it carries a Summary
 * or Regions, which is what a Map with no Pins yet exports as.
 */
function readEnvelope(
  value: unknown,
): {pins: unknown[]; regions?: unknown; summary?: unknown} | undefined {
  if (Array.isArray(value)) return {pins: value}
  if (typeof value !== 'object' || value === null) return
  const {pins, regions, summary} = value as {
    pins?: unknown
    regions?: unknown
    summary?: unknown
  }
  if (pins === undefined) {
    if (regions === undefined && summary === undefined) return
    return {pins: [], regions, summary}
  }
  if (!Array.isArray(pins)) return
  return {pins, regions, summary}
}

/**
 * A Region as an Export describes it, from an allowlist for `toPinExport`'s
 * reason: `name` and `polygon`, so that nothing `Region` grows later leaks into
 * a file merely by being there.
 */
function toRegionExport(region: Region): RegionExport {
  return {name: region.name, polygon: region.polygon}
}

type RegionsRead = {regions: RegionExport[]} | {error: string}

/** Every Region in the file, checked before any is accepted. */
function readRegions(value: unknown): RegionsRead {
  if (!Array.isArray(value)) {
    return {error: 'The regions in that export are not a list.'}
  }
  if (value.length > RegionMaxCount) {
    return {
      error: `That is ${value.length} regions; ${RegionMaxCount} is the most a map can hold.`,
    }
  }
  const regions: RegionExport[] = []
  for (const [index, entry] of value.entries()) {
    const read = readRegion(entry, index)
    if ('error' in read) return read
    regions.push(read.region)
  }
  return {regions}
}

function readRegion(
  value: unknown,
  index: number,
): {region: RegionExport} | {error: string} {
  const at = `Region ${index + 1}`
  if (typeof value !== 'object' || value === null) {
    return {error: `${at} is not a region.`}
  }
  const entry = value as Record<string, unknown>

  const name = readText(entry.name, RegionNameMaxLen)
  if (name === undefined) {
    return {
      error: `${at} has no name, or one longer than ${RegionNameMaxLen} characters.`,
    }
  }
  const polygon = entry.polygon
  if (
    !Array.isArray(polygon) ||
    polygon.length < RegionVertexMinCount ||
    polygon.length > RegionVertexMaxCount
  ) {
    return {
      error: `${at} ("${name}") needs between ${RegionVertexMinCount} and ${RegionVertexMaxCount} points.`,
    }
  }
  const vertices: LatLng[] = []
  for (const [vertex, point] of polygon.entries()) {
    if (!isLatLng(point)) {
      return {
        error: `${at} ("${name}") has an invalid location at point ${vertex + 1}.`,
      }
    }
    vertices.push({lat: point.lat, lng: point.lng})
  }
  return {region: {name, polygon: vertices}}
}

/**
 * The Summary in a file: trimmed, and possibly empty, which says the Map has
 * none. Anything that is not a string, or is over its ceiling, is refused
 * rather than silently truncated.
 */
function readSummary(value: unknown): string | {error: string} {
  if (typeof value !== 'string') return {error: 'The summary is not text.'}
  const trimmed = value.trim()
  if (trimmed.length > MapSummaryMaxLen) {
    return {
      error: `The summary is longer than ${MapSummaryMaxLen} characters.`,
    }
  }
  return trimmed
}

type PinRead = {pin: PinExport; droppedImage: boolean} | {error: string}

/**
 * One entry, held to the rules a typed Pin is held to. An image on a host this
 * app could not have uploaded to is dropped and counted rather than refused:
 * it is decoration, and losing a whole import of real Pins over one is a worse
 * answer than losing the picture.
 */
function readPin(value: unknown, index: number): PinRead {
  const at = `Pin ${index + 1}`
  if (typeof value !== 'object' || value === null) {
    return {error: `${at} is not a pin.`}
  }
  const entry = value as Record<string, unknown>

  const title = readText(entry.title, PinTitleMaxLen)
  if (title === undefined) {
    return {
      error: `${at} has no title, or one longer than ${PinTitleMaxLen} characters.`,
    }
  }
  if (!isLatLng(entry.location)) {
    return {error: `${at} ("${title}") has no valid location.`}
  }

  const pin: PinExport = {title, location: entry.location}

  if (entry.category !== undefined && entry.category !== '') {
    const category = readText(entry.category, PinCategoryMaxLen)
    if (category === undefined) {
      return {
        error: `${at} ("${title}") has a category longer than ${PinCategoryMaxLen} characters.`,
      }
    }
    pin.category = category
  }

  if (entry.description !== undefined && entry.description !== '') {
    const description = readText(entry.description, PinDescriptionMaxLen)
    if (description === undefined) {
      return {
        error: `${at} ("${title}") has a description longer than ${PinDescriptionMaxLen} characters.`,
      }
    }
    pin.description = description
  }

  if (entry.link !== undefined && entry.link !== '') {
    const link = readText(entry.link, PinLinkMaxLen)
    if (link === undefined || !isHttpUrl(link)) {
      return {
        error: `${at} ("${title}") has a link that is not an http or https URL.`,
      }
    }
    pin.link = link
  }

  let droppedImage = false
  if (entry.imageUrl !== undefined && entry.imageUrl !== '') {
    const imageUrl = readText(entry.imageUrl, PinLinkMaxLen)
    if (imageUrl !== undefined && isRedditMediaUrl(imageUrl)) {
      pin.imageUrl = imageUrl
    } else droppedImage = true
  }

  return {pin, droppedImage}
}

/** A trimmed non-empty string within its ceiling, or nothing. */
function readText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLen) return
  return trimmed
}

/** The same rule `normalizeLink` applies to a link an Owner typed. */
export function isHttpUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}
