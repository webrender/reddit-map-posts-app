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
