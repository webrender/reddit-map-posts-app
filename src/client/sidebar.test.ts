import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {LatLng, Pin} from '../shared/api.ts'
import {
  filterPins,
  groupPinsByCategory,
  resolveSelection,
  showsHeadings,
} from './sidebar.ts'

const somewhere: LatLng = {lat: 1, lng: 2}

function pin(id: string, title: string, category?: string): Pin {
  return category === undefined
    ? {id, title, location: somewhere}
    : {id, title, category, location: somewhere}
}

test('groups Pins by Category, alphabetically', () => {
  const groups = groupPinsByCategory([
    pin('1', 'Shrine', 'Temples'),
    pin('2', 'Bakery', 'Food'),
    pin('3', 'Cafe', 'Food'),
  ])
  assert.deepEqual(
    groups.map(group => [group.category, group.pins.map(p => p.title)]),
    [
      ['Food', ['Bakery', 'Cafe']],
      ['Temples', ['Shrine']],
    ],
  )
})

test('sorts Pins by title within a group, not by insertion order', () => {
  const groups = groupPinsByCategory([
    pin('1', 'Zoo', 'Places'),
    pin('2', 'Aquarium', 'Places'),
  ])
  assert.deepEqual(
    groups[0]?.pins.map(p => p.title),
    ['Aquarium', 'Zoo'],
  )
})

test('puts uncategorized Pins in a group of their own, last', () => {
  const groups = groupPinsByCategory([
    pin('1', 'Nowhere'),
    pin('2', 'Bakery', 'Food'),
    pin('3', 'Anywhere'),
  ])
  assert.deepEqual(
    groups.map(group => [group.category, group.pins.map(p => p.title)]),
    [
      ['Food', ['Bakery']],
      [undefined, ['Anywhere', 'Nowhere']],
    ],
  )
})

test('an empty Map has no groups', () => {
  assert.deepEqual(groupPinsByCategory([]), [])
})

test('headings appear only when there is more than one group to tell apart', () => {
  const oneCategory = groupPinsByCategory([
    pin('1', 'Bakery', 'Food'),
    pin('2', 'Cafe', 'Food'),
  ])
  assert.equal(showsHeadings(oneCategory), false)

  const allUncategorized = groupPinsByCategory([pin('1', 'Bakery')])
  assert.equal(showsHeadings(allUncategorized), false)

  const mixed = groupPinsByCategory([
    pin('1', 'Bakery', 'Food'),
    pin('2', 'Nowhere'),
  ])
  assert.equal(showsHeadings(mixed), true)
})

test('filtering to one Category leaves a single group, so headings go away', () => {
  const pins = [
    pin('1', 'Bakery', 'Food'),
    pin('2', 'Shrine', 'Temples'),
    pin('3', 'Nowhere'),
  ]
  assert.equal(showsHeadings(groupPinsByCategory(pins)), true)
  const filtered = filterPins(pins, 'Food')
  assert.deepEqual(
    filtered.map(p => p.title),
    ['Bakery'],
  )
  assert.equal(showsHeadings(groupPinsByCategory(filtered)), false)
})

test('an empty filter matches every Pin', () => {
  const pins = [pin('1', 'Bakery', 'Food'), pin('2', 'Nowhere')]
  assert.deepEqual(filterPins(pins, ''), pins)
})

test('a Category filter never matches uncategorized Pins', () => {
  assert.deepEqual(filterPins([pin('1', 'Nowhere')], 'Food'), [])
})

test('a selection the visible Pins still contain survives', () => {
  const pins = [pin('1', 'Bakery', 'Food'), pin('2', 'Shrine', 'Temples')]
  assert.equal(resolveSelection('1', pins), '1')
})

test('a selection the filter excludes is cleared', () => {
  const pins = [pin('1', 'Bakery', 'Food'), pin('2', 'Shrine', 'Temples')]
  assert.equal(resolveSelection('1', filterPins(pins, 'Temples')), undefined)
})

test('a selection whose Pin was deleted is cleared', () => {
  assert.equal(resolveSelection('1', []), undefined)
})

test('no selection stays no selection', () => {
  assert.equal(resolveSelection(undefined, [pin('1', 'Bakery')]), undefined)
})
