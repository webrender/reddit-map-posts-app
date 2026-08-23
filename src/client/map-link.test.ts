import assert from 'node:assert/strict'
import {test} from 'node:test'
import {type MapLink, parseMapLink} from './map-link.ts'

/** The link a Google Maps place page hands out, verbatim. */
const googlePlace =
  'https://www.google.com/maps/place/%E2%80%98Alohilani+Resort+Waikiki+Beach/@21.2747121,-157.8259471,1213m/data=!3m1!1e3!4m9!3m8!1s0x79540ef8fb534149:0xc06f292ad796880!5m2!4m1!1i2!8m2!3d21.2747071!4d-157.8233668!16s%2Fg%2F11ffv6l4gk?entry=ttu&g_ep=EgoyMDI2MDgxOS4wIKXMDSoASAFQAw%3D%3D'

/** The link an Apple Maps place sheet hands out, verbatim. */
const applePlace =
  'https://maps.apple.com/place?place-id=I8722DEA18BE76C12&address=70+Kukui+St%2C+Wahiawa%2C+HI+96786%2C+United+States&coordinate=21.497063%2C-158.030670&name=Shige%27s+Saimin+Stand&_provider=9902'

function place(link: MapLink): {lat: number; lng: number; title?: string} {
  assert.equal(link.kind, 'place')
  return {...link.location, ...(link.title ? {title: link.title} : {})}
}

test('reads a Google place link', () => {
  assert.deepEqual(place(parseMapLink(googlePlace)), {
    lat: 21.2747071,
    lng: -157.8233668,
    title: '‘Alohilani Resort Waikiki Beach',
  })
})

test('prefers what a Google link is about over the camera it opens with', () => {
  // The `@` pair and the `!3d!4d` pair differ by a street's width here.
  const link = parseMapLink(googlePlace)
  assert.equal(link.kind === 'place' && link.location.lng, -157.8233668)
})

test('falls back to the Google camera when there is no place in the link', () => {
  assert.deepEqual(
    place(parseMapLink('https://www.google.com/maps/@35.6586,139.7454,17z')),
    {
      lat: 35.6586,
      lng: 139.7454,
    },
  )
})

test('reads a Google q= pair', () => {
  assert.deepEqual(
    place(parseMapLink('https://maps.google.com/?q=48.8584,2.2945')),
    {
      lat: 48.8584,
      lng: 2.2945,
    },
  )
})

test('keeps a Google place name that is only coordinates out of the Title', () => {
  const link = parseMapLink(
    'https://www.google.com/maps/place/21.27,-157.82/@21.27,-157.82,17z',
  )
  assert.deepEqual(place(link), {lat: 21.27, lng: -157.82})
})

test('reads an Apple place link', () => {
  assert.deepEqual(place(parseMapLink(applePlace)), {
    lat: 21.497063,
    lng: -158.03067,
    title: "Shige's Saimin Stand",
  })
})

test('reads an older Apple ll= link, naming it from q=', () => {
  assert.deepEqual(
    place(
      parseMapLink(
        'https://maps.apple.com/?ll=37.7749,-122.4194&q=Ferry+Building',
      ),
    ),
    {lat: 37.7749, lng: -122.4194, title: 'Ferry Building'},
  )
})

test('falls back to an Apple address when nothing names the place', () => {
  assert.deepEqual(
    place(
      parseMapLink(
        'https://maps.apple.com/?ll=21.3,-157.8&address=70+Kukui+St',
      ),
    ),
    {lat: 21.3, lng: -157.8, title: '70 Kukui St'},
  )
})

test('finds the link inside the text a share sheet pastes', () => {
  const shared = `Shige's Saimin Stand\n${applePlace}`
  assert.equal(parseMapLink(shared).kind, 'place')
})

test('meets a link pasted without its scheme halfway', () => {
  assert.equal(parseMapLink('maps.google.com/?q=1.3,103.8').kind, 'place')
})

test('names the shortened links rather than following them', () => {
  for (const short of [
    'https://maps.app.goo.gl/abc123',
    'https://goo.gl/maps/abc123',
    'https://maps.apple.com/p/AbCdEf',
    'https://maps.apple/p/AbCdEf',
  ]) {
    assert.equal(parseMapLink(short).kind, 'shortened', short)
  }
})

test('refuses a link with no location in it', () => {
  for (const useless of [
    'https://www.google.com/maps/search/coffee',
    'https://www.google.com/maps/place/Somewhere/data=!4m2!3m1!1s0x795',
    'https://maps.apple.com/place?place-id=I8722DEA18BE76C12',
    'https://example.com/?q=21.3,-157.8',
    'https://openstreetmap.org/#map=15/21.3/-157.8',
    'not a link at all',
    '',
  ]) {
    assert.notEqual(parseMapLink(useless).kind, 'place', useless)
  }
})

test('refuses coordinates that are not on the globe', () => {
  assert.equal(
    parseMapLink('https://maps.google.com/?q=121.3,-257.8').kind,
    'unreadable',
  )
})

test('reads a place name with an unescaped apostrophe in the path', () => {
  // Google leaves `'` literal in the segment while escaping `‘` — both have to
  // survive the same decode.
  assert.deepEqual(
    place(
      parseMapLink(
        "https://www.google.com/maps/place/Shiro's+Saimin+Haven/@21.3857325,-157.9525863,1072m/data=!3m2!1e3!4b1!4m6!3m5!1s0x7c006f55226637c1:0x19d57deba75a1b28!8m2!3d21.3857275!4d-157.9500114!16s%2Fg%2F1vc_qkxp?entry=ttu",
      ),
    ),
    {lat: 21.3857275, lng: -157.9500114, title: "Shiro's Saimin Haven"},
  )
})
