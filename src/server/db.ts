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

export async function dbCreateMap(
  t3: T3,
  ownerId: T2,
  meta: IndexMeta,
): Promise<MapData> {
  await redis.set(ownerKey(t3), ownerId)
  await redis.zAdd(INDEX_KEY, {member: t3, score: meta.createdAt})
  await redis.hSet(INDEX_META_KEY, {[t3]: JSON.stringify(meta)})
  return {ownerId, pins: []}
}

/**
 * Whether this post id names a Map, without reading the Map. It is the one
 * thing that tells a Map Post apart from an Index Post at the Reddit API
 * level: both are submitted by the app account and neither says which
 * entrypoint it renders, but only a Map Post has an owner.
 */
export async function dbIsMap(t3: T3): Promise<boolean> {
  return !!(await redis.get(ownerKey(t3)))
}

export async function dbAddPin(t3: T3, pin: Pin): Promise<void> {
  await requireOwnerExists(t3)
  const added = await redis.hSet(pinsKey(t3), {[pin.id]: JSON.stringify(pin)})
  // Incremented rather than recounted so two adds in flight at once can't
  // settle on the same total, and only when the field was new so a replayed
  // add doesn't inflate it. A Map with no Pins is not listed, so this count is
  // what decides whether the Map Post appears in a Listing at all.
  if (added > 0) await redis.zIncrBy(INDEX_PINS_KEY, t3, added)
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
  const deleted = await redis.hDel(pinsKey(t3), [id])
  if (deleted > 0) await redis.zIncrBy(INDEX_PINS_KEY, t3, -deleted)
}

/**
 * What an Entry renders that Reddit isn't asked for. The title is safe to copy
 * because Reddit won't let anyone edit a post title; the score is deliberately
 * not here, since it changes constantly and lives in its own cache.
 */
export type IndexMeta = {title: string; author: string; createdAt: number}

/** An indexed Map Post, before Reddit has been asked anything about it. */
export type IndexRow = IndexMeta & {t3: T3; pinCount: number; score: number}

/**
 * Every indexed Map Post, in no particular order. Three full reads, because
 * Devvit's Redis has no text index and no join: a Search Query is a scan
 * wherever it runs (ADR-0010), and both Sorts need every row to order any of
 * them (ADR-0011). Rows whose metadata has gone missing are skipped rather
 * than rendered half-blank.
 */
export async function dbGetIndex(): Promise<IndexRow[]> {
  const [created, pinCounts, scores, meta] = await Promise.all([
    redis.zRange(INDEX_KEY, 0, -1),
    redis.zRange(INDEX_PINS_KEY, 0, -1),
    redis.zRange(INDEX_SCORE_KEY, 0, -1),
    redis.hGetAll(INDEX_META_KEY),
  ])
  const pinCountByT3 = new Map(pinCounts.map(z => [z.member, z.score]))
  const scoreByT3 = new Map(scores.map(z => [z.member, z.score]))

  const rows: IndexRow[] = []
  for (const {member, score: createdAt} of created) {
    const json = meta[member]
    if (!json) continue
    const {title, author} = JSON.parse(json) as IndexMeta
    rows.push({
      t3: member as T3,
      title,
      author,
      createdAt,
      pinCount: pinCountByT3.get(member) ?? 0,
      score: scoreByT3.get(member) ?? 0,
    })
  }
  return rows
}

/**
 * Drops a Map Post from the index because its Reddit post is gone. The Map
 * itself is left alone — the owner key and the Pins stay where they are. A
 * deletion we misread costs a listing; a deletion we act on by erasing someone's
 * Pins costs their Map, and only one of those is recoverable.
 */
export async function dbUnlistMap(t3: T3): Promise<void> {
  await Promise.all([
    redis.zRem(INDEX_KEY, [t3]),
    redis.zRem(INDEX_PINS_KEY, [t3]),
    redis.zRem(INDEX_SCORE_KEY, [t3]),
    redis.hDel(INDEX_META_KEY, [t3]),
  ])
}

/**
 * Forgets a Map entirely, at its Owner's request: the index entries, the owner
 * key, and every Pin. Unlike {@link dbUnlistMap} this is not a guess about what
 * Reddit did — the Owner asked for it and the Post is going with it, so there
 * is nothing left for the Pins to belong to.
 */
export async function dbDeleteMap(t3: T3): Promise<void> {
  await dbUnlistMap(t3)
  await Promise.all([redis.del(ownerKey(t3)), redis.del(pinsKey(t3))])
}

/** Writes the cached upvote counts the Top Sort orders by. */
export async function dbSetCachedScores(
  scores: readonly {t3: T3; score: number}[],
): Promise<void> {
  if (!scores.length) return
  await redis.zAdd(
    INDEX_SCORE_KEY,
    ...scores.map(({t3, score}) => ({member: t3, score})),
  )
}

/**
 * Where the score refresh got to last time. It is a rank into the index, not a
 * post id, so a Map Post added or forgotten between runs shifts the window
 * rather than stalling it — the cursor is an approximation on purpose.
 */
export async function dbGetScoreCursor(): Promise<number> {
  const raw = await redis.get(INDEX_CURSOR_KEY)
  const cursor = Number(raw)
  return Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : 0
}

export async function dbSetScoreCursor(cursor: number): Promise<void> {
  await redis.set(INDEX_CURSOR_KEY, `${cursor}`)
}

/**
 * The Places API key is written by a moderator and read only by
 * `search places`; nothing ever hands it back out. Redis is
 * installation-scoped, so this is one key per subreddit — the cost isolation
 * ADR-0002 wanted, without the plaintext settings field it had to accept to
 * get it.
 */
export async function dbGetPlacesApiKey(): Promise<string | undefined> {
  return await redis.get(PLACES_API_KEY)
}

export async function dbSetPlacesApiKey(key: string): Promise<void> {
  await redis.set(PLACES_API_KEY, key)
}

export async function dbDeletePlacesApiKey(): Promise<void> {
  await redis.del(PLACES_API_KEY)
}

/**
 * Unqualified by any post id: these belong to the install, not to a Map. Redis
 * is installation-scoped, so one unqualified key is already one per subreddit.
 */
const PLACES_API_KEY = 'places-api-key'
/** Map Post id -> created-at ms. The set of Maps this subreddit knows about. */
const INDEX_KEY = 'index'
/** Map Post id -> {@link IndexMeta} JSON. */
const INDEX_META_KEY = 'index-meta'
/** Map Post id -> how many Pins its Map holds. */
const INDEX_PINS_KEY = 'index-pins'
/** Map Post id -> upvotes, as of the last refresh. */
const INDEX_SCORE_KEY = 'index-score'
/** How far through {@link INDEX_KEY} the last score refresh got. */
const INDEX_CURSOR_KEY = 'index-cursor'

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
