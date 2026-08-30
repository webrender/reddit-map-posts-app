import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {T2} from '@devvit/web/shared'
import type {Pin} from './api.ts'
import {
  formatPinsFile,
  isRedditMediaUrl,
  PinCategoryMaxLen,
  PinImportMaxCount,
  PinTitleMaxLen,
  parsePinsFile,
} from './pins-file.ts'

function pin(over: Partial<Pin> = {}): Pin {
  return {
    id: 'a1',
    title: 'Kaimuki Superette',
    location: {lat: 21.2747, lng: -157.8234},
    ...over,
  }
}

/** The pins out of a read that was expected to succeed. */
function read(text: string) {
  const out = parsePinsFile(text)
  assert.ok(!('error' in out), 'error' in out ? out.error : '')
  return out
}

/** The message from a read that was expected to fail. */
function error(text: string): string {
  const out = parsePinsFile(text)
  assert.ok('error' in out, 'expected a refusal')
  return out.error
}

test('round trips every field a Pin has, minus its id', () => {
  const original = pin({
    category: 'Food',
    description: 'Breakfast.',
    link: 'https://example.com/',
    imageUrl: 'https://i.redd.it/abc123.jpg',
  })
  const out = read(formatPinsFile([original]))
  assert.equal(out.droppedImages, 0)
  assert.deepEqual(out.pins, [
    {
      title: 'Kaimuki Superette',
      location: {lat: 21.2747, lng: -157.8234},
      category: 'Food',
      description: 'Breakfast.',
      link: 'https://example.com/',
      imageUrl: 'https://i.redd.it/abc123.jpg',
    },
  ])
})

test('writes the version, and omits fields a Pin does not have', () => {
  const file = JSON.parse(formatPinsFile([pin()]))
  assert.equal(file.version, 1)
  assert.deepEqual(Object.keys(file.pins[0]), ['title', 'location'])
})

test('never writes a Contributor’s identity into an Export', () => {
  const authored = pin({authorId: 't2_alice' as T2, author: 'alice'})
  const file = JSON.parse(formatPinsFile([authored]))
  assert.deepEqual(Object.keys(file.pins[0]), ['title', 'location'])
  assert.equal('authorId' in file.pins[0], false)
  assert.equal('author' in file.pins[0], false)
})

test('leaves createdAt out, so an imported Pin is as new as a dropped one', () => {
  // ADR-0018 rests on this: a Pin's stamp says when *this* Map got it, so an
  // Export that carried one would let an Import land Pins older than the Map.
  const file = JSON.parse(
    formatPinsFile([{...pin(), id: 'p1', createdAt: 1_700_000_000_000}]),
  )
  assert.ok(!('createdAt' in file.pins[0]), 'an Export named createdAt')
  assert.deepEqual(Object.keys(file.pins[0]), ['title', 'location'])
})

test('reads a bare array, so text written by hand works', () => {
  const out = read('[{"title":"A","location":{"lat":1,"lng":2}}]')
  assert.deepEqual(out.pins, [{title: 'A', location: {lat: 1, lng: 2}}])
})

test('ignores an id and any other field it does not know', () => {
  const out = read(
    '[{"id":"keep-me-out","title":"A","location":{"lat":1,"lng":2},"colour":"red"}]',
  )
  assert.deepEqual(out.pins, [{title: 'A', location: {lat: 1, lng: 2}}])
})

test('reads a version it has never heard of', () => {
  const out = read(
    '{"version":99,"pins":[{"title":"A","location":{"lat":1,"lng":2}}]}',
  )
  assert.equal(out.pins.length, 1)
})

test('trims the text it keeps', () => {
  const out = read('[{"title":"  A  ","location":{"lat":1,"lng":2}}]')
  assert.equal(out.pins[0]?.title, 'A')
})

test('refuses text that is not JSON', () => {
  assert.match(error('not json at all'), /not JSON/)
})

test('refuses an empty paste', () => {
  assert.match(error('   '), /Paste an export/)
})

test('refuses JSON with no pins in it', () => {
  assert.match(error('{"version":1}'), /no list of pins/)
  assert.match(error('{"version":1,"pins":[]}'), /no pins in it/)
})

test('refuses a location outside the world, naming the pin', () => {
  const text = JSON.stringify([
    {title: 'Fine', location: {lat: 1, lng: 2}},
    {title: 'Broken', location: {lat: 91, lng: 2}},
  ])
  assert.match(error(text), /Pin 2 \("Broken"\) has no valid location/)
})

test('refuses a location that is missing or the wrong shape', () => {
  assert.match(error('[{"title":"A"}]'), /no valid location/)
  assert.match(error('[{"title":"A","location":"1,2"}]'), /no valid location/)
  assert.match(
    error('[{"title":"A","location":{"lat":"1","lng":"2"}}]'),
    /no valid location/,
  )
})

test('refuses a pin with no title', () => {
  assert.match(error('[{"location":{"lat":1,"lng":2}}]'), /Pin 1 has no title/)
  assert.match(
    error('[{"title":"  ","location":{"lat":1,"lng":2}}]'),
    /no title/,
  )
})

test('refuses an entry that is not an object at all', () => {
  assert.match(error('["nope"]'), /Pin 1 is not a pin/)
})

test('refuses text longer than its ceiling', () => {
  const long = (n: number) => 'x'.repeat(n + 1)
  assert.match(
    error(
      JSON.stringify([
        {title: long(PinTitleMaxLen), location: {lat: 1, lng: 2}},
      ]),
    ),
    /no title, or one longer/,
  )
  assert.match(
    error(
      JSON.stringify([
        {
          title: 'A',
          location: {lat: 1, lng: 2},
          category: long(PinCategoryMaxLen),
        },
      ]),
    ),
    /category longer than/,
  )
})

test('refuses a link that is not http or https', () => {
  assert.match(
    error(
      '[{"title":"A","location":{"lat":1,"lng":2},"link":"javascript:alert(1)"}]',
    ),
    /not an http or https URL/,
  )
})

test('refuses more pins than one import may carry', () => {
  const many = Array.from({length: PinImportMaxCount + 1}, () => ({
    title: 'A',
    location: {lat: 1, lng: 2},
  }))
  assert.match(error(JSON.stringify(many)), /is the most one import can add/)
})

test('keeps a Reddit-hosted image and drops any other, counting the drops', () => {
  const out = read(
    JSON.stringify([
      {
        title: 'A',
        location: {lat: 1, lng: 2},
        imageUrl: 'https://i.redd.it/a.jpg',
      },
      {
        title: 'B',
        location: {lat: 1, lng: 2},
        imageUrl: 'https://evil.example/a.jpg',
      },
      {
        title: 'C',
        location: {lat: 1, lng: 2},
        imageUrl: 'https://i.redd.it.evil.example/a.jpg',
      },
    ]),
  )
  assert.equal(out.droppedImages, 2)
  assert.equal(out.pins[0]?.imageUrl, 'https://i.redd.it/a.jpg')
  assert.equal(out.pins[1]?.imageUrl, undefined)
  assert.equal(out.pins[2]?.imageUrl, undefined)
})

test('a foreign image drops the picture, not the pin', () => {
  const out = read(
    '[{"title":"A","location":{"lat":1,"lng":2},"imageUrl":"https://evil.example/a.jpg"}]',
  )
  assert.equal(out.pins.length, 1)
})

test('matches Reddit media hosts whole, never as a substring', () => {
  assert.ok(isRedditMediaUrl('https://i.redd.it/abc.jpg'))
  assert.ok(isRedditMediaUrl('https://preview.redd.it/abc.jpg'))
  assert.ok(isRedditMediaUrl('https://redd.it/abc.jpg'))
  assert.ok(isRedditMediaUrl('https://i.redditmedia.com/abc.jpg'))

  assert.ok(!isRedditMediaUrl('https://i.redd.it.example.com/abc.jpg'))
  assert.ok(!isRedditMediaUrl('https://notredd.it/abc.jpg'))
  assert.ok(!isRedditMediaUrl('https://example.com/i.redd.it/abc.jpg'))
  assert.ok(!isRedditMediaUrl('http://i.redd.it/abc.jpg'))
  assert.ok(!isRedditMediaUrl('data:image/png;base64,AAAA'))
  assert.ok(!isRedditMediaUrl('not a url'))
})
