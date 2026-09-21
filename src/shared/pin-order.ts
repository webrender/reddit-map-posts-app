import type {Pin} from './api.ts'

/**
 * The most ids a Map's stored order may hold. Bigger than any Map is expected
 * to be, so it only ever bounds a value's size, the way the Region ceilings do.
 */
export const PinOrderMaxCount = 5000

/**
 * Sorts Pins by the Map's hand-made order, then by title. A Pin the order does
 * not name — added since it was last written, or on a Map nobody has ever
 * reordered — comes after every Pin it does name, alphabetically, so a Map with
 * no order at all reads exactly as it did before ordering existed. Ids in the
 * order that name no Pin are ignored, which is what lets a deleted Pin leave the
 * stored list without anyone having to prune it.
 */
export function sortPins(
  pins: readonly Pin[],
  order: readonly string[],
): Pin[] {
  const rank = new Map<string, number>()
  for (const [index, id] of order.entries()) {
    if (!rank.has(id)) rank.set(id, index)
  }
  return [...pins].sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.title.localeCompare(b.title)
  })
}

/**
 * The whole Map's order after one group of Pins is rearranged. `groupIds` is
 * the group in its new order; the Pins outside it keep their places, and the
 * group's members take back the slots they held, in the new sequence. Working
 * on the whole Map's list, rather than only the group, is what lets a group be
 * reordered without disturbing any other.
 */
export function reorderGroup(
  pins: readonly Pin[],
  order: readonly string[],
  groupIds: readonly string[],
): string[] {
  const inGroup = new Set(groupIds)
  const next = [...groupIds]
  return sortPins(pins, order).map(pin =>
    inGroup.has(pin.id) ? next.shift() : pin.id,
  ) as string[]
}
