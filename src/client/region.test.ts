import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {LatLng, Pin, Region} from '../shared/api.ts'
import {
  containsLocation,
  groupPinsByRegion,
  regionAtLocation,
  regionBounds,
  regionCentroid,
  regionForPin,
  regionRing,
} from './region.ts'

function region(
  id: string,
  polygon: LatLng[],
  createdAt = 0,
  name = id,
): Region {
  return {id, name, createdAt, polygon}
}

function at(lat: number, lng: number): LatLng {
  return {lat, lng}
}

function pin(id: string, lat: number, lng: number): Pin {
  return {id, title: id, location: at(lat, lng)}
}

/** A square from (0,0) to (10,10). */
const square = region('square', [at(0, 0), at(0, 10), at(10, 10), at(10, 0)])

test('a Location inside a polygon is contained, one outside is not', () => {
  assert.equal(containsLocation(square, at(5, 5)), true)
  assert.equal(containsLocation(square, at(15, 5)), false)
  assert.equal(containsLocation(square, at(5, -1)), false)
})

test('a Location on a vertex or an edge is contained', () => {
  assert.equal(containsLocation(square, at(0, 0)), true)
  assert.equal(containsLocation(square, at(10, 10)), true)
  assert.equal(containsLocation(square, at(0, 5)), true)
})

test('a concave polygon excludes the notch', () => {
  // A "U" opening upwards: the notch is lng 4..6, lat 4..10.
  const u = region('u', [
    at(0, 0),
    at(0, 10),
    at(10, 10),
    at(10, 6),
    at(4, 6),
    at(4, 4),
    at(10, 4),
    at(10, 0),
  ])
  assert.equal(containsLocation(u, at(1, 5)), true)
  assert.equal(containsLocation(u, at(7, 5)), false)
  assert.equal(containsLocation(u, at(7, 8)), true)
})

test('a polygon crossing the antimeridian answers correctly', () => {
  const fiji = region('fiji', [
    at(-17, 179.4),
    at(-17, -179.8),
    at(-18, -179.8),
    at(-18, 179.4),
  ])
  assert.equal(containsLocation(fiji, at(-17.5, 179.9)), true)
  assert.equal(containsLocation(fiji, at(-17.5, -179.9)), true)
  assert.equal(containsLocation(fiji, at(-17.5, 0)), false)
  assert.equal(containsLocation(fiji, at(-17.5, 178)), false)
  assert.equal(containsLocation(fiji, at(-17.5, -178)), false)
})

test('regionBounds spells a crossing Region with west east of east', () => {
  const fiji = region('fiji', [
    at(-17, 179.4),
    at(-17, -179.8),
    at(-18, -179.8),
    at(-18, 179.4),
  ])
  const {west, east, south, north} = regionBounds(fiji)
  assert.ok(Math.abs(west - 179.4) < 1e-9)
  assert.ok(Math.abs(east - -179.8) < 1e-9)
  assert.equal(south, -18)
  assert.equal(north, -17)
})

test('regionBounds of an ordinary Region is its rectangle', () => {
  assert.deepEqual(regionBounds(square), {
    west: 0,
    south: 0,
    east: 10,
    north: 10,
  })
})

test('nested polygons: the smallest containing Region wins', () => {
  const big = region('big', [at(0, 0), at(0, 100), at(100, 100), at(100, 0)])
  const small = region('small', [at(4, 4), at(4, 6), at(6, 6), at(6, 4)])
  assert.equal(regionForPin(pin('p', 5, 5), [big, small])?.id, 'small')
  assert.equal(regionForPin(pin('p', 5, 5), [small, big])?.id, 'small')
  assert.equal(regionForPin(pin('p', 50, 50), [big, small])?.id, 'big')
})

test('equal-sized overlapping polygons are broken by id, in any input order', () => {
  const a = region('a', [at(0, 0), at(0, 10), at(10, 10), at(10, 0)])
  const b = region('b', [at(0, 0), at(0, 10), at(10, 10), at(10, 0)])
  assert.equal(regionForPin(pin('p', 5, 5), [a, b])?.id, 'a')
  assert.equal(regionForPin(pin('p', 5, 5), [b, a])?.id, 'a')
})

test('a Pin in no Region is in none', () => {
  assert.equal(regionForPin(pin('p', 50, 50), [square]), undefined)
})

test('groups Pins by Region oldest first, with the Pins in none last', () => {
  const older = region(
    'z-older',
    [at(0, 0), at(0, 10), at(10, 10), at(10, 0)],
    1,
  )
  const newer = region(
    'a-newer',
    [at(20, 0), at(20, 10), at(30, 10), at(30, 0)],
    2,
  )
  const groups = groupPinsByRegion(
    [pin('n', 25, 5), pin('o', 5, 5), pin('x', 50, 50)],
    [newer, older],
  )
  assert.deepEqual(
    groups.map(group => [group.region?.id, group.pins.map(p => p.id)]),
    [
      ['z-older', ['o']],
      ['a-newer', ['n']],
      [undefined, ['x']],
    ],
  )
})

test('a Region holding none of the given Pins still has a group', () => {
  const groups = groupPinsByRegion([pin('x', 50, 50)], [square])
  assert.deepEqual(
    groups.map(group => [group.region?.id, group.pins.length]),
    [
      ['square', 0],
      [undefined, 1],
    ],
  )
  assert.deepEqual(
    groupPinsByRegion([], [square]).map(group => group.region?.id),
    ['square'],
  )
})

test('an empty Region list leaves every Pin ungrouped', () => {
  const groups = groupPinsByRegion([pin('a', 1, 1), pin('b', 2, 2)], [])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.region, undefined)
  assert.deepEqual(
    groups[0]?.pins.map(p => p.id),
    ['a', 'b'],
  )
})

test('no Pins and no Regions is no groups', () => {
  assert.deepEqual(groupPinsByRegion([], []), [])
})

test('regionAtLocation answers for a click the way regionForPin does for a Pin', () => {
  const big = region('big', [at(0, 0), at(0, 100), at(100, 100), at(100, 0)])
  const small = region('small', [at(4, 4), at(4, 6), at(6, 6), at(6, 4)])
  assert.equal(regionAtLocation(at(5, 5), [big, small])?.id, 'small')
  assert.equal(regionAtLocation(at(50, 50), [big, small])?.id, 'big')
  assert.equal(regionAtLocation(at(-5, -5), [big, small]), undefined)
})

test('regionRing is closed and unwrapped, so Fiji is one shape', () => {
  const ring = regionRing([
    at(-17, 179.4),
    at(-17, -179.8),
    at(-18, -179.8),
    at(-18, 179.4),
  ])
  assert.equal(ring.length, 5)
  assert.deepEqual(ring[0], ring[4])
  const lngs = ring.map(([lng]) => lng)
  assert.ok(Math.max(...lngs) - Math.min(...lngs) < 2)
  assert.ok(Math.abs((lngs[1] ?? 0) - 180.2) < 1e-9)
})

test('regionCentroid is the middle of a square, and wraps across the antimeridian', () => {
  const c = regionCentroid(square)
  assert.ok(Math.abs(c.lat - 5) < 1e-9 && Math.abs(c.lng - 5) < 1e-9)
  const fiji = regionCentroid(
    region('fiji', [at(-17, 179), at(-17, -179), at(-19, -179), at(-19, 179)]),
  )
  assert.ok(Math.abs(Math.abs(fiji.lng) - 180) < 1e-9, `${fiji.lng}`)
  assert.ok(Math.abs(fiji.lat - -18) < 1e-9)
})

test('regionCentroid of a degenerate ring falls back to its bounds', () => {
  const line = regionCentroid(region('line', [at(0, 0), at(0, 2), at(0, 4)]))
  assert.deepEqual(line, {lat: 0, lng: 2})
})
