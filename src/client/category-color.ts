import type {Pin, Region} from '../shared/api.ts'
import {sortRegionsOldestFirst} from './region.ts'

/**
 * The colours a Category can wear, in the order they are handed out.
 *
 * Chosen by search rather than by eye, against the gates a categorical palette
 * has to clear when any two of its marks may end up side by side — which is
 * what a Map is, unlike a bar chart where only neighbours are compared. Every
 * pair, not just adjacent ones, clears a normal-vision OKLab ΔE of 15 and a
 * protanope/deuteranope ΔE of 6; every entry sits in the OKLCH lightness band
 * 0.47–0.72 with chroma ≥ 0.105, and holds 3:1 against the Bright basemap.
 * They are ordered so that *every* prefix is as separated as it can be: a Map
 * with three Categories gets the three most distinguishable colours rather
 * than the first three of a set tuned for seven.
 *
 * Both readings wear the same values. The basemap is light whatever the
 * reader's theme, so the marker palette has to be the light one — and a
 * Sidebar dot that did not match the marker it stands for would be explaining
 * the Map with a colour the Map does not use. Two entries fall below 3:1
 * against the dark surface the Sidebar draws on; both are always beside the
 * Category's own name, which is the relief that rule asks for.
 *
 * Seven is not a shortage to be padded out. Past it no eighth colour exists
 * that a reader could tell from these under the same gates, so an eighth
 * Category wraps to the first colour rather than being given a hue that only
 * looks distinct to whoever picked it.
 */
export const categoryPalette: readonly [string, ...string[]] = [
  '#dc5faf',
  '#0a7d00',
  '#0091f5',
  '#8c3c55',
  '#006491',
  '#8746be',
  '#05968c',
]

/**
 * What a Pin with no Category wears. Deliberately outside the palette rather
 * than an eighth member of it: its chroma is far below the floor every
 * Category colour clears, so "no Category" reads as the absence of one instead
 * of as another one.
 */
export const uncategorizedColor = '#657780'

/**
 * Which colour each of a Map's Categories wears, by name.
 *
 * A Category's colour is a property of its *name* — `hash` alone would give
 * "Cafés" the same colour on every Map, before and after an Import, with
 * nothing stored anywhere. What that cannot do on its own is keep two names
 * that prefer the same colour apart, and resolving that by name would let a
 * Category typed today take the colour off one that has been on the Map for a
 * year.
 *
 * So the preference is by name and the tie-break is by age: Categories are
 * walked oldest first, and each takes the colour it prefers or, if an older
 * Category already holds it, the next one free. A Category can therefore only
 * ever be pushed aside by one that predates it — and a new Category, being
 * younger than every Category on the Map, can never push anyone. That is the
 * whole of why adding one repaints nothing.
 *
 * A Category is as old as its earliest Pin. Pins stored before {@link Pin} had
 * a `createdAt` count as older than every Pin that has one, ordered among
 * themselves by id so the answer is at least stable; a Map made entirely of
 * them is coloured in id order, which is arbitrary but never changes.
 *
 * Takes every Pin on the Map rather than the visible ones on purpose: a colour
 * follows the Category, so filtering to one Category must not repaint it, and
 * a Category cannot lose a collision to one the filter is hiding.
 */
export function categoryColors(pins: readonly Pin[]): Map<string, string> {
  const oldest = new Map<string, Pin>()
  for (const pin of pins) {
    if (!pin.category) continue
    const held = oldest.get(pin.category)
    if (!held || isOlder(pin, held)) oldest.set(pin.category, pin)
  }

  const byAge = [...oldest.entries()].sort(([, a], [, b]) =>
    isOlder(a, b) ? -1 : 1,
  )
  return assignColors(byAge.map(([category]) => category))
}

/**
 * Which colour each of a Map's Regions wears, by name — the same rule, from the
 * same seven colours, as {@link categoryColors}, so adding a Region repaints
 * none already on the Map. The palette is shared across the two axes on
 * purpose: a colour identifies within an axis and never across one, and what
 * tells a Region from a Category is its shape and where it appears, not its
 * hue. See ADR-0021.
 *
 * Two Regions with one name share its colour, as two Pins in one Category do.
 */
export function regionColors(regions: readonly Region[]): Map<string, string> {
  return assignColors(sortRegionsOldestFirst(regions).map(r => r.name))
}

/**
 * Walks names oldest first, each taking the colour its name prefers or, where
 * an older name already holds it, the next one free. Only an older name can
 * ever displace a younger one, so a name added later — being younger than all
 * of them — can only take a colour nothing else holds. See ADR-0018.
 */
function assignColors(
  namesOldestFirst: readonly string[],
): Map<string, string> {
  const colors = new Map<string, string>()
  const taken = new Set<string>()
  for (const name of namesOldestFirst) {
    if (colors.has(name)) continue
    const preferred = hashCategory(name) % categoryPalette.length
    let color = slot(preferred)
    for (
      let step = 1;
      taken.has(color) && step < categoryPalette.length;
      step++
    )
      color = slot(preferred + step)
    // Nothing was free, so this Map has more names than there are colours
    // that can be told apart. It wears the one its name asked for and shares
    // it, which at least keeps the sharing predictable from the name.
    if (taken.has(color)) color = slot(preferred)
    taken.add(color)
    colors.set(name, color)
  }
  return colors
}

/** The palette entry at `index`, wrapping. The palette is never empty. */
function slot(index: number): string {
  return categoryPalette[index % categoryPalette.length] ?? categoryPalette[0]
}

/** A Pin's colour: its Category's, or the one that means it has none. */
export function pinColor(pin: Pin, colors: Map<string, string>): string {
  return (pin.category && colors.get(pin.category)) || uncategorizedColor
}

/**
 * Which of two Pins the Map got first. An unstamped Pin predates every stamped
 * one — it was stored by a version that did not stamp at all — and ties fall
 * back to the id, which is unique, so this is a total order and the sort it
 * drives never depends on the order Redis happened to return the hash in.
 */
function isOlder(pin: Pin, than: Pin): boolean {
  const a = pin.createdAt ?? -1
  const b = than.createdAt ?? -1
  return a === b ? pin.id < than.id : a < b
}

/**
 * FNV-1a over the Category's name. Any well-mixed hash would do; this one is
 * here written out because the colours have to come out the same in every
 * reading of a Map Post and in every future version of this file — a hash
 * swapped for a "better" one silently recolours every Map on the subreddit.
 */
function hashCategory(category: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < category.length; i++) {
    hash ^= category.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}
