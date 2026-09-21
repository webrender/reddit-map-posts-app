import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {PinExport, RegionExport} from '../shared/map-file.ts'
import {elsewhereName, planPrint, showsOverview} from './plan.ts'

function pin(
  title: string,
  lat: number,
  lng: number,
  category?: string,
): PinExport {
  return category === undefined
    ? {title, location: {lat, lng}}
    : {title, category, location: {lat, lng}}
}

const north: RegionExport = {
  name: 'North',
  polygon: [
    {lat: 10, lng: 0},
    {lat: 10, lng: 10},
    {lat: 20, lng: 10},
    {lat: 20, lng: 0},
  ],
}

test('a Map with no Regions prints as one unnamed Section', () => {
  const plan = planPrint({pins: [pin('B', 1, 1), pin('A', 2, 2)]})
  assert.equal(plan.sections.length, 1)
  assert.equal(plan.sections[0]?.region, undefined)
  assert.equal(plan.sections[0]?.name, undefined)
  assert.deepEqual(
    plan.sections[0]?.pins.map(p => [p.number, p.pin.title]),
    [
      [1, 'A'],
      [2, 'B'],
    ],
  )
})

test('numbers follow listing order: Categories alphabetical, uncategorized last', () => {
  const plan = planPrint({
    pins: [
      pin('Loose', 1, 1),
      pin('Shrine', 1, 1, 'Temples'),
      pin('Cafe', 1, 1, 'Food'),
      pin('Bakery', 1, 1, 'Food'),
    ],
  })
  assert.deepEqual(
    plan.sections[0]?.pins.map(p => [p.number, p.pin.title]),
    [
      [1, 'Bakery'],
      [2, 'Cafe'],
      [3, 'Shrine'],
      [4, 'Loose'],
    ],
  )
  assert.equal(plan.sections[0]?.headings, true)
})

test('Pins are split by Region, with the rest under Elsewhere', () => {
  const plan = planPrint({
    pins: [pin('In', 15, 5), pin('Out', 50, 50)],
    regions: [north],
  })
  assert.deepEqual(
    plan.sections.map(s => [s.name, s.pins.map(p => p.pin.title)]),
    [
      ['North', ['In']],
      [elsewhereName, ['Out']],
    ],
  )
})

test('numbers restart in every Section', () => {
  const plan = planPrint({
    pins: [pin('A', 15, 5), pin('B', 15, 6), pin('C', 50, 50)],
    regions: [north],
  })
  assert.deepEqual(
    plan.sections.map(s => s.pins.map(p => p.number)),
    [[1, 2], [1]],
  )
})

test('a Region with no Pins still has a Section, and Elsewhere is left out when empty', () => {
  const plan = planPrint({pins: [], regions: [north]})
  assert.deepEqual(
    plan.sections.map(s => [s.name, s.pins.length]),
    [['North', 0]],
  )
})

test('an older Category keeps the colour it would have on the Map', () => {
  const plan = planPrint({
    pins: [pin('A', 1, 1, 'Food'), pin('B', 1, 1, 'Temples')],
  })
  assert.notEqual(
    plan.categoryColors.get('Food'),
    plan.categoryColors.get('Temples'),
  )
})

test('the overview is only for a Map with more than one Region', () => {
  const south: RegionExport = {...north, name: 'South'}
  const pins = [pin('A', 15, 5)]
  assert.equal(showsOverview(planPrint({pins})), false)
  assert.equal(showsOverview(planPrint({pins, regions: [north]})), false)
  assert.equal(showsOverview(planPrint({pins, regions: [north, south]})), true)
})
