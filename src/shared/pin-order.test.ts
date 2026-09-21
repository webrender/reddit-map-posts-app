import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Pin} from './api.ts'
import {reorderGroup, sortPins} from './pin-order.ts'

const pin = (id: string, title = id): Pin => ({
  id,
  title,
  location: {lat: 0, lng: 0},
})
const ids = (pins: Pin[]) => pins.map(p => p.id)

test('sortPins: no order sorts by title, as before ordering existed', () => {
  assert.deepEqual(ids(sortPins([pin('1', 'Park'), pin('2', 'Cafe')], [])), [
    '2',
    '1',
  ])
})

test('sortPins: ranked pins come first in order, unranked after by title', () => {
  const pins = [
    pin('a', 'Zoo'),
    pin('b', 'Bar'),
    pin('c', 'Ant'),
    pin('d', 'Dam'),
  ]
  assert.deepEqual(ids(sortPins(pins, ['b', 'a'])), ['b', 'a', 'c', 'd'])
})

test('sortPins: ids naming no pin are ignored', () => {
  assert.deepEqual(ids(sortPins([pin('a'), pin('b')], ['ghost', 'b'])), [
    'b',
    'a',
  ])
})

test('reorderGroup: only the group moves, and the others keep their places', () => {
  const pins = [pin('a'), pin('b'), pin('c'), pin('d')]
  // b and d are one group; swap them. a and c stay where they were.
  assert.deepEqual(reorderGroup(pins, [], ['d', 'b']), ['a', 'd', 'c', 'b'])
})

test('reorderGroup: respects the existing order', () => {
  const pins = [pin('a'), pin('b'), pin('c')]
  assert.deepEqual(reorderGroup(pins, ['c', 'b', 'a'], ['a', 'c']), [
    'a',
    'b',
    'c',
  ])
})
