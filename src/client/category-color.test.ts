import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {LatLng, Pin, Region} from '../shared/api.ts'
import {
  categoryColors,
  categoryPalette,
  pinColor,
  regionColors,
  uncategorizedColor,
} from './category-color.ts'

const somewhere: LatLng = {lat: 1, lng: 2}

function pin(id: string, category?: string, createdAt?: number): Pin {
  const made: Pin = {id, title: `Pin ${id}`, location: somewhere}
  if (category !== undefined) made.category = category
  if (createdAt !== undefined) made.createdAt = createdAt
  return made
}

/** The Categories a Map would show, oldest first, as names. */
function colorOf(pins: Pin[], category: string): string | undefined {
  return categoryColors(pins).get(category)
}

test('gives every Category on a Map a colour of its own', () => {
  const pins = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, i) =>
    pin(name, name.toUpperCase(), i),
  )
  const colors = [...categoryColors(pins).values()]
  assert.equal(colors.length, categoryPalette.length)
  assert.equal(new Set(colors).size, categoryPalette.length)
})

test('adding a Category never repaints the ones already there', () => {
  const existing = ['Food', 'Temples', 'Views', 'Bars'].map((c, i) =>
    pin(`p${i}`, c, i),
  )
  const before = categoryColors(existing)

  // Every possible newcomer, added after all of them.
  for (const name of ['Parks', 'Cafés', 'Shops', 'z', '', 'Food Trucks']) {
    if (!name) continue
    const after = categoryColors([...existing, pin('new', name, 100)])
    for (const [category, color] of before) {
      assert.equal(
        after.get(category),
        color,
        `${category} changed when ${name} was added`,
      )
    }
  }
})

test('a Category keeps its colour as Pins come and go inside it', () => {
  const base = [pin('1', 'Food', 1), pin('2', 'Views', 2)]
  const before = categoryColors(base)
  const after = categoryColors([
    ...base,
    pin('3', 'Food', 50),
    pin('4', 'Views', 60),
  ])
  assert.deepEqual([...after], [...before])
})

test('the colour follows the name, not the Map', () => {
  const here = colorOf([pin('1', 'Cafés', 1)], 'Cafés')
  const there = colorOf([pin('9', 'Cafés', 999)], 'Cafés')
  assert.equal(here, there)
})

test('a collision is lost by the younger Category, never the older', () => {
  // Find two names that prefer the same colour, so the tie-break is exercised
  // rather than assumed.
  const names: string[] = []
  for (let i = 0; names.length < 2; i++) names.push(`c${i}`)
  let older = ''
  let younger = ''
  outer: for (let i = 0; i < 200; i++) {
    for (let j = i + 1; j < 200; j++) {
      const a = `c${i}`
      const b = `c${j}`
      if (colorOf([pin('1', a, 1)], a) === colorOf([pin('1', b, 1)], b)) {
        older = a
        younger = b
        break outer
      }
    }
  }
  assert.ok(older && younger, 'expected two names to prefer the same colour')

  const alone = colorOf([pin('1', older, 1)], older)
  const together = [pin('1', older, 1), pin('2', younger, 2)]
  assert.equal(colorOf(together, older), alone, 'the older one kept its colour')
  assert.notEqual(colorOf(together, younger), alone, 'the younger one moved')

  // …and the same pair the other way round: age decides, not the name.
  const reversed = [pin('1', older, 9), pin('2', younger, 1)]
  assert.equal(colorOf(reversed, younger), alone)
  assert.notEqual(colorOf(reversed, older), alone)
})

test('Pins stored before createdAt existed are the oldest, in id order', () => {
  const legacy = [pin('b', 'Second'), pin('a', 'First')]
  const withStamped = categoryColors([...legacy, pin('c', 'Third', 5)])
  const bare = categoryColors(legacy)
  assert.equal(withStamped.get('First'), bare.get('First'))
  assert.equal(withStamped.get('Second'), bare.get('Second'))
})

test('an eighth Category wraps rather than going uncoloured', () => {
  const pins = Array.from({length: 9}, (_, i) => pin(`p${i}`, `C${i}`, i))
  const colors = categoryColors(pins)
  assert.equal(colors.size, 9)
  for (const color of colors.values()) {
    assert.ok(categoryPalette.includes(color), `${color} is not in the palette`)
  }
})

test('a Pin with no Category is not given one of the colours', () => {
  const colors = categoryColors([pin('1', 'Food', 1), pin('2')])
  assert.equal(pinColor(pin('2'), colors), uncategorizedColor)
  assert.ok(!categoryPalette.includes(uncategorizedColor))
})

test('a Pin whose Category is not on the Map falls back rather than throwing', () => {
  const colors = categoryColors([pin('1', 'Food', 1)])
  assert.equal(pinColor(pin('2', 'Gone', 2), colors), uncategorizedColor)
})

test('no addition to any Map ever repaints what was already on it', () => {
  // The claim the whole scheme exists to make, checked against Maps this file's
  // author did not choose: random Category names, random ages, random sizes.
  let seed = 0x2f6f_d012
  const rand = (n: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed % n
  }
  const name = (): string =>
    String.fromCharCode(97 + rand(26), 97 + rand(26), 97 + rand(26))

  for (let trial = 0; trial < 300; trial++) {
    const existing: Pin[] = []
    for (let i = 0, count = 1 + rand(9); i < count; i++) {
      existing.push(pin(`p${i}`, name(), rand(1000)))
    }
    const before = categoryColors(existing)

    // Anything an Owner could do next that adds a Category: a dropped Pin, or a
    // whole Import. Both are stamped now, so both are younger than everything.
    const now = 1000 + rand(1000)
    const added: Pin[] = []
    for (let i = 0, count = 1 + rand(4); i < count; i++) {
      added.push(pin(`new${i}`, name(), now))
    }
    const after = categoryColors([...existing, ...added])

    for (const [category, color] of before) {
      assert.equal(
        after.get(category),
        color,
        `trial ${trial}: ${category} was repainted by ${added
          .map(p => p.category)
          .join(', ')}`,
      )
    }
  }
})

function region(id: string, name: string, createdAt: number): Region {
  return {id, name, createdAt, polygon: []}
}

test('gives every Region on a Map a colour of its own, from the Category palette', () => {
  const colors = regionColors([
    region('1', 'North Side', 1),
    region('2', 'East End', 2),
    region('3', 'Harbour', 3),
  ])
  assert.equal(new Set(colors.values()).size, 3)
  for (const color of colors.values())
    assert.ok(categoryPalette.includes(color))
})

test('a Region and a Category of one name wear one colour: it identifies within an axis, not across', () => {
  const colors = regionColors([region('1', 'Cafes', 1)])
  assert.equal(colors.get('Cafes'), colorOf([pin('a', 'Cafes', 1)], 'Cafes'))
})

test('a Region older than its rival keeps the colour they both want', () => {
  // Find two names that prefer the same slot, so the age tie-break is exercised.
  const names: string[] = []
  const probe = (name: string): string | undefined =>
    regionColors([region('x', name, 0)]).get(name)
  const first = 'aaa'
  names.push(first)
  for (let i = 0; names.length < 2; i++) {
    const candidate = `n${i}`
    if (probe(candidate) === probe(first)) names.push(candidate)
  }
  const [older, younger] = names as [string, string]
  const colors = regionColors([region('1', older, 1), region('2', younger, 2)])
  assert.equal(colors.get(older), probe(older))
  assert.notEqual(colors.get(younger), colors.get(older))
})

test('adding a Region never repaints the Regions already on the Map', () => {
  let seed = 0x1d2c_3b4a
  const rand = (n: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed % n
  }
  const name = (): string =>
    String.fromCharCode(97 + rand(26), 97 + rand(26), 97 + rand(26))

  for (let trial = 0; trial < 300; trial++) {
    const existing: Region[] = []
    for (let i = 0, count = 1 + rand(7); i < count; i++) {
      existing.push(region(`r${i}`, name(), rand(1000)))
    }
    const before = regionColors(existing)

    const added: Region[] = []
    for (let i = 0, count = 1 + rand(3); i < count; i++) {
      added.push(region(`new${i}`, name(), 1000 + rand(1000)))
    }
    const after = regionColors([...existing, ...added])

    for (const [regionName, color] of before) {
      assert.equal(
        after.get(regionName),
        color,
        `trial ${trial}: ${regionName} was repainted by ${added
          .map(r => r.name)
          .join(', ')}`,
      )
    }
  }
})
