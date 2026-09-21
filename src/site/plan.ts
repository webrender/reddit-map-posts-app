import {categoryColors, regionColors} from '../client/category-color.ts'
import {groupPinsByRegion} from '../client/region.ts'
import {groupPinsByCategory, showsHeadings} from '../client/sidebar.ts'
import type {Pin, Region} from '../shared/api.ts'
import type {PinExport, RegionExport} from '../shared/map-file.ts'

/** A Pin and the number that ties its marker on the printed map to its card. */
export type NumberedPin = {number: number; pin: Pin}

export type NumberedGroup = {
  /** `undefined` for the Pins with no Category. */
  category: string | undefined
  pins: NumberedPin[]
}

/**
 * One map page and the listing that follows it: a Region, or the Pins in no
 * Region, or — for a Map with no Regions at all — every Pin.
 */
export type Section = {
  region: Region | undefined
  /** What heads the listing; `undefined` where there is nothing to name. */
  name: string | undefined
  groups: NumberedGroup[]
  /** Every Pin in the Section in listing order, so `pins[n - 1]` is number `n`. */
  pins: NumberedPin[]
  /** Whether Category headings earn their space — see `showsHeadings`. */
  headings: boolean
}

export type Plan = {
  pins: Pin[]
  regions: Region[]
  sections: Section[]
  categoryColors: Map<string, string>
  regionColors: Map<string, string>
}

/** The heading over the Pins that are in no Region, as the Sidebar has it. */
export const elsewhereName = 'Elsewhere'

/**
 * What to print, worked out from an Export by the same rules the Sidebar reads
 * a Map by: Regions oldest first, Categories alphabetical, Pins by title. An
 * Export carries no ids and no ages, so both are made up here from the order it
 * lists things in — which is the order an Import would have stamped them in, so
 * the colours come out the same as the Map's own.
 *
 * Numbers restart in every Section, because a Section's map shows only its own
 * Pins and a reader matches a marker to a card within one page.
 */
export function planPrint(file: {
  pins: readonly PinExport[]
  regions?: readonly RegionExport[]
}): Plan {
  const pins: Pin[] = file.pins.map((pin, index) => ({
    ...pin,
    id: `pin-${index}`,
    createdAt: index + 1,
  }))
  const regions: Region[] = (file.regions ?? []).map((region, index) => ({
    ...region,
    id: `region-${index}`,
    createdAt: index + 1,
  }))

  const sections = groupPinsByRegion(pins, regions).map(group => {
    const groups: NumberedGroup[] = []
    const numbered: NumberedPin[] = []
    const categoryGroups = groupPinsByCategory(group.pins)
    for (const categoryGroup of categoryGroups) {
      const groupPins = categoryGroup.pins.map(pin => {
        const entry = {number: numbered.length + 1, pin}
        numbered.push(entry)
        return entry
      })
      groups.push({category: categoryGroup.category, pins: groupPins})
    }
    const name = group.region
      ? group.region.name
      : regions.length
        ? elsewhereName
        : undefined
    return {
      region: group.region,
      name,
      groups,
      pins: numbered,
      headings: showsHeadings(categoryGroups),
    }
  })

  return {
    pins,
    regions,
    sections,
    categoryColors: categoryColors(pins),
    regionColors: regionColors(regions),
  }
}
