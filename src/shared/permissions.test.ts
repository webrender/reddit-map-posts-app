import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {T2} from '@devvit/web/shared'
import type {Pin} from './api.ts'
import {
  canAddPin,
  canEditPin,
  canEditSummary,
  type MapAccess,
  pinAuthorId,
} from './permissions.ts'

const OWNER = 't2_owner' as T2
const AUTHOR = 't2_author' as T2
const OTHER = 't2_other' as T2

const somewhere = {lat: 1, lng: 2}

function pinWithAuthor(authorId?: T2): Pin {
  const pin: Pin = {id: 'p1', title: 'Pin', location: somewhere}
  if (authorId) pin.authorId = authorId
  return pin
}

function access(opts: Partial<MapAccess>): MapAccess {
  return {
    userId: undefined,
    ownerId: OWNER,
    collaborative: false,
    isModerator: false,
    ...opts,
  }
}

test('pinAuthorId: a legacy pin with no authorId is the Owner’s', () => {
  assert.equal(pinAuthorId(pinWithAuthor(undefined), OWNER), OWNER)
})

test('pinAuthorId: a stamped pin answers to its own author, not the Owner', () => {
  assert.equal(pinAuthorId(pinWithAuthor(AUTHOR), OWNER), AUTHOR)
})

test('canAddPin: exhaustive over collaborative × who is asking', () => {
  const cases: [
    collaborative: boolean,
    userId: T2 | undefined,
    expected: boolean,
  ][] = [
    // Solo: only the Owner.
    [false, undefined, false],
    [false, OWNER, true],
    [false, OTHER, false],
    // Collaborative: any logged-in member.
    [true, undefined, false],
    [true, OWNER, true],
    [true, OTHER, true],
  ]
  for (const [collaborative, userId, expected] of cases) {
    assert.equal(
      canAddPin(access({collaborative, userId})),
      expected,
      `collaborative=${collaborative} userId=${userId}`,
    )
  }
})

/**
 * Exhaustive over every combination the doc comment on `canEditPin` promises
 * to get right: whether the Map is Collaborative, whether the reader
 * moderates, who is asking (nobody, the Owner, the Pin's author, or an
 * unrelated third member), and whether the Pin carries an `authorId` at all
 * (absent stands for a Pin stored before Contributors existed).
 */
test('canEditPin: exhaustive over collaborative × moderator × who is asking × authorship', () => {
  const cases: [
    collaborative: boolean,
    isModerator: boolean,
    userId: T2 | undefined,
    authorId: T2 | undefined,
    expected: boolean,
  ][] = [
    // --- Solo Map: only the Owner, ever — moderating and authorId are both irrelevant. ---
    [false, false, undefined, undefined, false],
    [false, false, undefined, AUTHOR, false],
    [false, false, OWNER, undefined, true],
    [false, false, OWNER, AUTHOR, true],
    [false, false, AUTHOR, AUTHOR, false],
    [false, false, OTHER, undefined, false],
    [false, true, undefined, undefined, false],
    [false, true, OWNER, undefined, true],
    [false, true, OWNER, AUTHOR, true],
    [false, true, AUTHOR, AUTHOR, false],
    [false, true, OTHER, undefined, false],

    // --- Collaborative Map, not a moderator. ---
    // Logged out: refused before anything else is compared — the regression
    // this predicate exists to close, on both a legacy pin and an authored one.
    [true, false, undefined, undefined, false],
    [true, false, undefined, AUTHOR, false],
    // A legacy pin (no authorId) defaults to the Owner.
    [true, false, OWNER, undefined, true],
    [true, false, OTHER, undefined, false],
    // The Owner gets no special power over a Contributor's Pin.
    [true, false, OWNER, AUTHOR, false],
    // The Owner's own Pin is still theirs to edit.
    [true, false, OWNER, OWNER, true],
    // A Contributor may edit their own Pin, and no one else's.
    [true, false, AUTHOR, AUTHOR, true],
    [true, false, AUTHOR, OTHER, false],
    [true, false, OTHER, AUTHOR, false],

    // --- Collaborative Map, a moderator: edits anyone's, including a legacy pin. ---
    [true, true, undefined, undefined, false],
    [true, true, undefined, AUTHOR, false],
    [true, true, OWNER, AUTHOR, true],
    [true, true, AUTHOR, AUTHOR, true],
    [true, true, OTHER, AUTHOR, true],
    [true, true, OTHER, undefined, true],
  ]

  for (const [
    collaborative,
    isModerator,
    userId,
    authorId,
    expected,
  ] of cases) {
    const result = canEditPin(
      access({collaborative, isModerator, userId}),
      pinWithAuthor(authorId),
    )
    assert.equal(
      result,
      expected,
      `collaborative=${collaborative} isModerator=${isModerator} userId=${userId} authorId=${authorId}`,
    )
  }
})

/**
 * Exhaustive over what `canEditSummary` promises, and deliberately asserting
 * the two rows where it parts company with `canEditPin`: a Moderator gets
 * nothing on a Solo Map, and the Owner keeps the Summary on a Collaborative one
 * even though they have no power over its Pins. See ADR-0020.
 */
test('canEditSummary: exhaustive over collaborative × moderator × who is asking', () => {
  const cases: [
    collaborative: boolean,
    isModerator: boolean,
    userId: T2 | undefined,
    expected: boolean,
  ][] = [
    // --- Solo Map: only the Owner, ever. Moderating grants nothing here. ---
    [false, false, undefined, false],
    [false, false, OWNER, true],
    [false, false, OTHER, false],
    [false, true, undefined, false],
    [false, true, OWNER, true],
    // The row that keeps the Solo rule honest: a Moderator is still refused.
    [false, true, OTHER, false],

    // --- Collaborative Map: the Owner, or a Moderator. ---
    [true, false, undefined, false],
    // The Owner keeps the Summary, unlike a Contributor's Pin.
    [true, false, OWNER, true],
    // A Contributor may write their own Pins and not the Map's Summary.
    [true, false, AUTHOR, false],
    [true, false, OTHER, false],
    [true, true, undefined, false],
    [true, true, OWNER, true],
    [true, true, OTHER, true],
  ]

  for (const [collaborative, isModerator, userId, expected] of cases) {
    assert.equal(
      canEditSummary(access({collaborative, isModerator, userId})),
      expected,
      `collaborative=${collaborative} isModerator=${isModerator} userId=${userId}`,
    )
  }
})

test('canEditPin: a logged-out reader is refused even where undefined === undefined would otherwise say yes', () => {
  // The specific hole ADR-0019 calls out: naively comparing
  // `pin.authorId === access.userId` on a legacy Pin (authorId absent) read by
  // a logged-out visitor (userId absent) is `undefined === undefined`, which
  // is true. This is the regression test for that.
  const legacyPin = pinWithAuthor(undefined)
  assert.equal(
    canEditPin(access({collaborative: true, userId: undefined}), legacyPin),
    false,
  )
})
