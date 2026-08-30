import {isLatLng, type LatLng, type Pin} from './api.ts'

/**
 * The shape of an Export, bumped only when a reader of this version could
 * misread a later one. Import checks it loosely — an unknown version is read
 * anyway, since every field it does understand still means what it says — and
 * it is here so that a future format which *does* break can say so.
 */
export const PinsFileVersion = 1

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

/** An Export, as {@link formatPinsFile} writes it. */
export type PinsFile = {version: number; pins: PinExport[]}

/** What {@link parsePinsFile} makes of some text. */
export type PinsFileRead =
  | {pins: PinExport[]; droppedImages: number}
  | {error: string}

/**
 * Every Pin on a Map as the text an Owner copies out. Pretty-printed on
 * purpose: an Export is something a person opens in an editor and changes by
 * hand, and a single line of JSON is not.
 */
export function formatPinsFile(pins: readonly Pin[]): string {
  const file: PinsFile = {
    version: PinsFileVersion,
    pins: pins.map(toPinExport),
  }
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
export function parsePinsFile(text: string): PinsFileRead {
  if (!text.trim()) return {error: 'Paste an export first.'}

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {
      error: 'That is not JSON. Paste the whole export, including the {}.',
    }
  }
  return readPinsValue(value)
}

/**
 * The same read, of JSON that has already been parsed — which is what the
 * server has, since a request body arrives parsed rather than as text. Both
 * ends go through this, so the client's refusal and the server's are the same
 * refusal rather than two that can drift apart.
 */
export function readPinsValue(value: unknown): PinsFileRead {
  const list = readPinList(value)
  if (!list) {
    return {error: 'That JSON is not an export: it has no list of pins in it.'}
  }
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
  if (!pins.length) return {error: 'That export has no pins in it.'}
  return {pins, droppedImages}
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

/** The pins out of either envelope: `{pins: [...]}` or a bare `[...]`. */
function readPinList(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value !== 'object' || value === null) return
  const {pins} = value as {pins?: unknown}
  return Array.isArray(pins) ? pins : undefined
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
