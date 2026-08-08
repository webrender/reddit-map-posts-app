import {redis} from '@devvit/web/server'
import type {T2, T3} from '@devvit/web/shared'
import type {Pin} from '../shared/api.ts'
import {HttpError} from './http-error.ts'

export type MapData = {ownerId: T2; pins: Pin[]}

/**
 * Owner id and pins are stored separately, with each pin as its own hash
 * field, so concurrent add/delete of different pins can't clobber each
 * other the way a single read-modify-write of one JSON blob would.
 */
export async function dbGetMap(t3: T3): Promise<MapData | undefined> {
  const ownerId = await redis.get(ownerKey(t3))
  if (!ownerId) return undefined
  const pinsHash = await redis.hGetAll(pinsKey(t3))
  const pins = Object.values(pinsHash).map(json => JSON.parse(json) as Pin)
  return {ownerId: ownerId as T2, pins}
}

export async function dbCreateMap(t3: T3, ownerId: T2): Promise<MapData> {
  await redis.set(ownerKey(t3), ownerId)
  return {ownerId, pins: []}
}

export async function dbAddPin(t3: T3, pin: Pin): Promise<void> {
  await requireOwnerExists(t3)
  await redis.hSet(pinsKey(t3), {[pin.id]: JSON.stringify(pin)})
}

export async function dbUpdatePin(
  t3: T3,
  id: string,
  patch: Partial<Pin>,
): Promise<Pin> {
  await requireOwnerExists(t3)
  const existingJson = await redis.hGet(pinsKey(t3), id)
  if (!existingJson) throw new HttpError(404, `pin not found: ${id}`)
  const pin = {...(JSON.parse(existingJson) as Pin), ...patch}
  await redis.hSet(pinsKey(t3), {[id]: JSON.stringify(pin)})
  return pin
}

export async function dbDeletePin(t3: T3, id: string): Promise<void> {
  await requireOwnerExists(t3)
  await redis.hDel(pinsKey(t3), [id])
}

function ownerKey(t3: T3): string {
  return `owner:${t3}`
}

function pinsKey(t3: T3): string {
  return `pins:${t3}`
}

async function requireOwnerExists(t3: T3): Promise<void> {
  const ownerId = await redis.get(ownerKey(t3))
  if (!ownerId) throw new HttpError(404, `map not found: ${t3}`)
}
