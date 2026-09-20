import type {T2} from '@devvit/web/shared'
import type {Pin} from './api.ts'

/**
 * Everything `canAddPin` and `canEditPin` need to answer, gathered in one
 * place so client and server ask the identical question of the identical
 * facts. See ADR-0019.
 */
export type MapAccess = {
  /** Absent for a logged-out reader. */
  userId: T2 | undefined
  ownerId: T2
  collaborative: boolean
  isModerator: boolean
}

/**
 * Who a Pin answers to. A Pin stored before Contributors existed has no
 * `authorId` of its own, and is read as the Owner's — the same fallback
 * `createdAt` uses for a Pin older than that field. See ADR-0018 and
 * ADR-0019.
 */
export function pinAuthorId(pin: Pin, ownerId: T2): T2 {
  return pin.authorId ?? ownerId
}

/**
 * Whether `access.userId` may add a Pin to this Map. Solo: only the Owner.
 * Collaborative: any logged-in member, who becomes a Contributor by doing so.
 */
export function canAddPin(access: MapAccess): boolean {
  if (!access.userId) return false
  if (!access.collaborative) return access.userId === access.ownerId
  return true
}

/**
 * Whether `access.userId` may edit, delete, or drag this Pin. Solo: only the
 * Owner. Collaborative: the Pin's own Contributor, or a Moderator — the Owner
 * gets no special power over a Pin they did not add; see ADR-0019.
 *
 * A logged-out reader is refused before anything else is compared. Written
 * the other way round, `pin.authorId === access.userId` on a legacy Pin (no
 * `authorId`) read by a logged-out visitor (no `userId`) is
 * `undefined === undefined` — true — which would hand every pre-Contributor
 * Pin to anyone not logged in. Making "no identity, no capability" the first
 * thing this function checks is what keeps that from being a caller's job to
 * remember.
 */
export function canEditPin(access: MapAccess, pin: Pin): boolean {
  if (!access.userId) return false
  if (!access.collaborative) return access.userId === access.ownerId
  if (access.isModerator) return true
  return pinAuthorId(pin, access.ownerId) === access.userId
}

/**
 * Whether `access.userId` may write this Map's Summary. Solo: only the Owner,
 * exactly as {@link canEditPin} — moderating grants nothing on a Solo Map.
 * Collaborative: the Owner, or a Moderator.
 *
 * It gives the Owner what `canEditPin` deliberately withholds, and the two
 * sitting side by side will read as an inconsistency to fix. They are not.
 * ADR-0019 drew the line this falls on: "ownership here is of the Post, not of
 * what other people put on it." A Pin is what someone else put on the Map, so
 * the Owner gets no say over it. A Summary is the Map's own account of itself —
 * it is the Post, the way the title and the byline are — so rewriting it takes
 * nothing from anybody. A Moderator may too, for the reason they may take down
 * a Pin: a subreddit needs someone able to remove abusive text without deleting
 * the Map under it, and a Summary is the most visible text on one. See ADR-0020.
 *
 * A logged-out reader is refused first, matching `canEditPin`'s shape. There is
 * no `authorId` here for `undefined === undefined` to go wrong on, so it is not
 * literally that bug — the ordering is kept so all three predicates read alike.
 */
export function canEditSummary(access: MapAccess): boolean {
  if (!access.userId) return false
  if (!access.collaborative) return access.userId === access.ownerId
  return access.userId === access.ownerId || access.isModerator
}
