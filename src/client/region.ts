import type {LatLng, MapBounds, Pin, Region} from '../shared/api.ts'

/**
 * The Pins in one Region, or — with `region` undefined — the Pins in none.
 * See {@link groupPinsByRegion}.
 */
export type RegionGroup = {region: Region | undefined; pins: Pin[]}

/**
 * Whether a Location falls inside a Region's polygon. Even-odd ray casting,
 * with a Location exactly on an edge or a vertex counted as inside: a Pin
 * dropped on a boundary a reader can see is a Pin they expect to find in it.
 *
 * Longitudes are unwrapped first. A polygon over Fiji has vertices at `179.4`
 * and `-179.8`, and cast on the raw numbers the ray crosses the whole world the
 * wrong way round, so every answer is wrong. See {@link unwrapRing}.
 */
export function containsLocation(region: Region, at: LatLng): boolean {
  const ring = unwrapRing(region.polygon)
  if (ring.length < 3) return false
  const x = unwrapNear(at.lng, ringCentre(ring))
  const y = at.lat

  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (!a || !b) continue
    if (onSegment(x, y, a, b)) return true
    if (a.lat > y !== b.lat > y) {
      const crossing = ((b.lng - a.lng) * (y - a.lat)) / (b.lat - a.lat) + a.lng
      if (x < crossing) inside = !inside
    }
  }
  return inside
}

/**
 * The Region a Pin is in. Where polygons overlap the smallest containing one
 * wins, ties broken by id, so the answer is total and stable rather than
 * depending on the order Redis returned the hash in. A Pin inside nothing is in
 * no Region.
 */
export function regionForPin(
  pin: Pin,
  regions: readonly Region[],
): Region | undefined {
  return regionAtLocation(pin.location, regions)
}

/**
 * The same answer for any Location — which is what a click on the Map is. It is
 * what stands in for asking MapLibre which polygon was hit: it needs no layer to
 * exist yet, and it agrees with Pin membership by construction, since both are
 * this.
 */
export function regionAtLocation(
  at: LatLng,
  regions: readonly Region[],
): Region | undefined {
  let best: Region | undefined
  let bestArea = Infinity
  for (const region of regions) {
    if (!containsLocation(region, at)) continue
    const area = ringArea(unwrapRing(region.polygon))
    if (area < bestArea || (area === bestArea && best && region.id < best.id)) {
      best = region
      bestArea = area
    }
  }
  return best
}

/**
 * Groups Pins for display: Regions oldest first, then the Pins in none — last,
 * as `groupPinsByCategory` puts the uncategorized last. Every Region has a
 * group, empty or not: a Region the Owner has just drawn is still on the Map and
 * still worth a heading, and the tour needs somewhere to go. Only the group of
 * Pins in no Region is left out when it would be empty. With no Regions at all
 * every Pin lands in the one group with no Region.
 */
export function groupPinsByRegion(
  pins: Pin[],
  regions: readonly Region[],
): RegionGroup[] {
  const byRegion = new Map<string, Pin[]>()
  const elsewhere: Pin[] = []
  for (const pin of pins) {
    const region = regionForPin(pin, regions)
    if (!region) {
      elsewhere.push(pin)
      continue
    }
    const group = byRegion.get(region.id)
    if (group) group.push(pin)
    else byRegion.set(region.id, [pin])
  }

  const groups: RegionGroup[] = []
  for (const region of sortRegionsOldestFirst(regions)) {
    groups.push({region, pins: byRegion.get(region.id) ?? []})
  }
  if (elsewhere.length) groups.push({region: undefined, pins: elsewhere})
  return groups
}

/**
 * The smallest rectangle holding a Region, as `MapBounds` spells one: a Region
 * that crosses the antimeridian comes back with `west` numerically east of
 * `east`, exactly as the Default Area does, and the caller's `areaBounds` turns
 * that into something MapLibre reads correctly. This imports nothing from
 * `maplibre-gl` on purpose.
 */
export function regionBounds(region: Region): MapBounds {
  const ring = unwrapRing(region.polygon)
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const {lat, lng} of ring) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  if (east - west >= 360) return {west: -180, south, east: 180, north}
  return {west: wrapLng(west), south, east: wrapLng(east), north}
}

/**
 * The ring as GeoJSON wants it — `[lng, lat]`, closed by repeating the first
 * vertex — with longitudes unwrapped into one continuous frame, so a polygon
 * over Fiji is drawn as one shape (`179.4` to `180.2`) rather than one that
 * spans the whole world. MapLibre draws a longitude past 180 correctly.
 */
export function regionRing(polygon: readonly LatLng[]): [number, number][] {
  const ring = unwrapRing(polygon).map(({lat, lng}): [number, number] => [
    lng,
    lat,
  ])
  const first = ring[0]
  if (first) ring.push(first)
  return ring
}

/**
 * Where a Region's label sits: the polygon's centre of mass, or its bounding
 * box's centre where the ring has no area to speak of. It is not guaranteed to
 * be inside a concave polygon, which is accepted — a label is a name for the
 * shape, not a claim about a point in it.
 */
export function regionCentroid(region: Region): LatLng {
  const ring = unwrapRing(region.polygon)
  let area2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (!a || !b) continue
    const cross = b.lng * a.lat - a.lng * b.lat
    area2 += cross
    cx += (b.lng + a.lng) * cross
    cy += (b.lat + a.lat) * cross
  }
  if (Math.abs(area2) < 1e-12) {
    const {west, south, east, north} = regionBounds(region)
    const width = east < west ? east + 360 - west : east - west
    return {lat: (south + north) / 2, lng: wrapLng(west + width / 2)}
  }
  return {lat: cy / (3 * area2), lng: wrapLng(cx / (3 * area2))}
}

/**
 * Regions in the order the Map got them: `createdAt`, then `id`. The same total
 * order `isOlder` gives Pins, so it never depends on the order Redis returned
 * the hash in.
 */
export function sortRegionsOldestFirst(regions: readonly Region[]): Region[] {
  return [...regions].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id < b.id
        ? -1
        : 1
      : a.createdAt - b.createdAt,
  )
}

/**
 * The ring with every longitude carried into one continuous frame: each vertex
 * is shifted by a multiple of 360 until it is within 180 of the one before. A
 * ring over Fiji, `179.4` then `-179.8`, comes out as `179.4` then `180.2`.
 * `viewBounds` and `areaBounds` in `map.ts` carry the same concern; this is the
 * third place that has to.
 */
function unwrapRing(polygon: readonly LatLng[]): LatLng[] {
  const out: LatLng[] = []
  let previous: number | undefined
  for (const {lat, lng} of polygon) {
    let unwrapped = lng
    if (previous !== undefined) {
      while (unwrapped - previous > 180) unwrapped -= 360
      while (unwrapped - previous < -180) unwrapped += 360
    }
    out.push({lat, lng: unwrapped})
    previous = unwrapped
  }
  return out
}

/** The point's longitude, shifted by whole turns to the copy nearest `near`. */
function unwrapNear(lng: number, near: number): number {
  let out = lng
  while (out - near > 180) out -= 360
  while (out - near < -180) out += 360
  return out
}

function ringCentre(ring: readonly LatLng[]): number {
  let west = Infinity
  let east = -Infinity
  for (const {lng} of ring) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  return (west + east) / 2
}

/** Longitude back into [-180, 180]. */
function wrapLng(lng: number): number {
  let out = lng
  while (out > 180) out -= 360
  while (out < -180) out += 360
  return out
}

/** Planar shoelace area in degrees squared: only ever compared, never shown. */
function ringArea(ring: readonly LatLng[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a && b) sum += b.lng * a.lat - a.lng * b.lat
  }
  return Math.abs(sum) / 2
}

/** Whether (x, y) lies on the segment a–b. */
function onSegment(x: number, y: number, a: LatLng, b: LatLng): boolean {
  const cross = (y - a.lat) * (b.lng - a.lng) - (x - a.lng) * (b.lat - a.lat)
  if (Math.abs(cross) > 1e-12) return false
  return (
    x >= Math.min(a.lng, b.lng) &&
    x <= Math.max(a.lng, b.lng) &&
    y >= Math.min(a.lat, b.lat) &&
    y <= Math.max(a.lat, b.lat)
  )
}
