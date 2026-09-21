import assert from 'node:assert/strict'
import {test} from 'node:test'
import {type Point, type SpreadOptions, spreadPoints} from './spread.ts'

const options: SpreadOptions = {
  minDistance: 27,
  width: 720,
  height: 960,
  margin: 16,
}

function nearestPair(points: readonly Point[]): number {
  let nearest = Infinity
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i] as Point
      const b = points[j] as Point
      nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  return nearest
}

test('points already apart are left where they are', () => {
  const points = [
    {x: 100, y: 100},
    {x: 300, y: 400},
  ]
  assert.deepEqual(spreadPoints(points, options), points)
})

test('does not change its input', () => {
  const points = [
    {x: 100, y: 100},
    {x: 101, y: 100},
  ]
  spreadPoints(points, options)
  assert.deepEqual(points, [
    {x: 100, y: 100},
    {x: 101, y: 100},
  ])
})

test('two points on the same spot are pushed apart', () => {
  const out = spreadPoints(
    [
      {x: 360, y: 480},
      {x: 360, y: 480},
    ],
    options,
  )
  assert.ok(nearestPair(out) >= options.minDistance - 0.01)
})

test('a tight cluster ends with no two markers overlapping', () => {
  const points = Array.from({length: 60}, (_, i) => ({
    x: 360 + (i % 5),
    y: 480 + Math.floor(i / 5) * 0.5,
  }))
  const out = spreadPoints(points, options)
  assert.equal(out.length, 60)
  assert.ok(nearestPair(out) >= options.minDistance - 0.01)
})

test('a cluster against a corner still fits, and stays inside the frame', () => {
  const points = Array.from({length: 40}, () => ({x: 2, y: 2}))
  const out = spreadPoints(points, options)
  assert.ok(nearestPair(out) >= options.minDistance - 0.01)
  for (const {x, y} of out) {
    assert.ok(x >= options.margin && x <= options.width - options.margin)
    assert.ok(y >= options.margin && y <= options.height - options.margin)
  }
})

test('markers stay near where they began', () => {
  const out = spreadPoints(
    [
      {x: 360, y: 480},
      {x: 362, y: 480},
      {x: 360, y: 482},
    ],
    options,
  )
  for (const point of out) {
    assert.ok(Math.hypot(point.x - 360, point.y - 480) < 60)
  }
})

test('the same input always gives the same output', () => {
  const points = Array.from({length: 20}, () => ({x: 100, y: 100}))
  assert.deepEqual(spreadPoints(points, options), spreadPoints(points, options))
})

test('a frame with no room leaves the extra markers in place rather than dropping them', () => {
  const tiny: SpreadOptions = {
    minDistance: 27,
    width: 60,
    height: 60,
    margin: 10,
  }
  const out = spreadPoints(
    Array.from({length: 30}, () => ({x: 30, y: 30})),
    tiny,
  )
  assert.equal(out.length, 30)
})

test('markers keep clear of a fixed obstacle', () => {
  const label = Array.from({length: 9}, (_, i) => ({x: 300 + i * 10, y: 480}))
  const out = spreadPoints(
    [
      {x: 340, y: 480},
      {x: 342, y: 481},
      {x: 344, y: 479},
    ],
    {...options, obstacles: label, obstacleDistance: 24},
  )
  for (const point of out) {
    for (const obstacle of label) {
      assert.ok(Math.hypot(point.x - obstacle.x, point.y - obstacle.y) >= 23.99)
    }
  }
  assert.ok(nearestPair(out) >= options.minDistance - 0.01)
})
