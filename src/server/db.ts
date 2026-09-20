import {redis, type TxClientLike} from '@devvit/web/server'
import type {T2, T3} from '@devvit/web/shared'
import {
  type MapBounds,
  MapKind,
  type Pin,
  parseMapBounds,
} from '../shared/api.ts'
import {HttpError} from './http-error.ts'

export type MapData = {
  ownerId: T2
  /**
   * Denormalized from {@link IndexMeta.author} at creation, the same way that
   * field itself is: never refreshed if the account is renamed, and empty for
   * a Map whose index-meta row is gone (unlisted, or from before this field
   * existed).
   */
  ownerName: string
  collaborative: boolean
  /** The Map's Summary, absent where none has been written. See ADR-0020. */
  summary?: string
  pins: Pin[]
}

/**
 * Owner id, kind and pins are stored separately, with each pin as its own
 * hash field, so concurrent add/delete of different pins can't clobber each
 * other the way a single read-modify-write of one JSON blob would.
 */
export async function dbGetMap(t3: T3): Promise<MapData | undefined> {
  const [ownerId, kind, summary, metaJson, pinsHash] = await Promise.all([
    redis.get(ownerKey(t3)),
    redis.get(kindKey(t3)),
    redis.get(summaryKey(t3)),
    redis.hGet(INDEX_META_KEY, t3),
    redis.hGetAll(pinsKey(t3)),
  ])
  if (!ownerId) return undefined
  const pins = Object.values(pinsHash).map(json => JSON.parse(json) as Pin)
  const ownerName = metaJson ? (JSON.parse(metaJson) as IndexMeta).author : ''
  const map: MapData = {
    ownerId: ownerId as T2,
    ownerName,
    collaborative: kind === MapKind.Collaborative,
    pins,
  }
  // Absent rather than empty: a Map with no Summary and a Map whose Summary is
  // a blank string are the same Map, and only one of them is a fact.
  if (summary) map.summary = summary
  return map
}

/**
 * Just enough to authorize a Pin mutation: the Owner and whether the Map is
 * Collaborative, in one round trip that never touches the Pins hash. Every
 * Pin mutation used to authorize through {@link dbGetMap}, which `hGetAll`s
 * every Pin on the Map for a guard that never looks at one — cheap with one
 * writer, paid on every write once a Map can have many.
 */
export async function dbGetMapMeta(
  t3: T3,
): Promise<{ownerId: T2; collaborative: boolean} | undefined> {
  const [ownerId, kind] = await Promise.all([
    redis.get(ownerKey(t3)),
    redis.get(kindKey(t3)),
  ])
  if (!ownerId) return undefined
  return {ownerId: ownerId as T2, collaborative: kind === MapKind.Collaborative}
}

/**
 * Writes the Map's Summary. Unlike a Pin this is a single value with a single
 * writer at a time and no id to collide on, so it is a plain `set` — last write
 * wins between an Owner and a Moderator, the same posture {@link dbUpdatePin}
 * takes and for the same reason. See ADR-0020.
 */
export async function dbSetSummary(t3: T3, summary: string): Promise<void> {
  await requireOwnerExists(t3)
  await redis.set(summaryKey(t3), summary)
}

/** Forgets it, putting the Map back to having nothing to say about itself. */
export async function dbClearSummary(t3: T3): Promise<void> {
  await requireOwnerExists(t3)
  await redis.del(summaryKey(t3))
}

export async function dbCreateMap(
  t3: T3,
  ownerId: T2,
  meta: IndexMeta,
  collaborative: boolean,
): Promise<MapData> {
  await atomically(async tx => {
    await tx.set(ownerKey(t3), ownerId)
    // Absent means Solo — see the warning on `dbIsMap` — so the key is only
    // ever written for the other kind, and only ever this one canonical
    // value. Written inside the same transaction as the owner key: split
    // across two writes, a crash between them could leave a Map permanently
    // the wrong kind, with no conversion to fix it.
    if (collaborative) await tx.set(kindKey(t3), MapKind.Collaborative)
    await tx.zAdd(INDEX_KEY, {member: t3, score: meta.createdAt})
    await tx.hSet(INDEX_META_KEY, {
      [t3]: JSON.stringify({...meta, collaborative}),
    })
  })
  return {ownerId, ownerName: meta.author, collaborative, pins: []}
}

/**
 * Runs `queue` against a MULTI/EXEC transaction, so its writes land together
 * or not at all — a crash or timeout partway through used to be able to leave
 * some of them applied and others not. Nothing is WATCHed: these callers
 * don't make a decision that a concurrent write could go stale, they just
 * need their own writes batched, so there is nothing to invalidate the
 * transaction and nothing to retry.
 */
async function atomically(
  queue: (tx: TxClientLike) => Promise<unknown>,
): Promise<void> {
  const tx = await redis.watch()
  await tx.multi()
  await queue(tx)
  await tx.exec()
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
  await dbAddPins(t3, [pin])
}

/**
 * One Pin, without reading any of the others — what authorizing an edit on a
 * Collaborative Map needs, and all it needs: `canEditPin` asks about this one
 * Pin's `authorId`, not the rest of the hash.
 */
export async function dbGetPin(t3: T3, id: string): Promise<Pin | undefined> {
  const json = await redis.hGet(pinsKey(t3), id)
  return json ? (JSON.parse(json) as Pin) : undefined
}

/**
 * Adds any number of Pins in one transaction — one Pin from a Pin Drop, or a
 * whole Export from an Import. Every `pin.id` is a fresh `crypto.randomUUID()`
 * from the caller, so every field below is new and the count always wants the
 * increment; it is the size of the batch rather than a decision.
 *
 * The hSet and the increment go together for the reason a single add always
 * did: a crash between the two leaves the pin hash and the cached count
 * disagreeing about whether a Map with Pins is listed, and an Import makes
 * that gap the size of the Export rather than one Pin.
 */
export async function dbAddPins(t3: T3, pins: readonly Pin[]): Promise<void> {
  await requireOwnerExists(t3)
  if (!pins.length) return
  const fields: {[id: string]: string} = {}
  for (const pin of pins) fields[pin.id] = JSON.stringify(pin)
  await atomically(async tx => {
    await tx.hSet(pinsKey(t3), fields)
    await tx.zIncrBy(INDEX_PINS_KEY, t3, pins.length)
  })
}

/**
 * A whole-object read-modify-write, and deliberately last-write-wins: two
 * editors racing on the same Pin — an author and a Moderator, now that a
 * Collaborative Map can have both — is a real possibility this does not
 * guard against, and one of their edits can silently vanish under the
 * other's. Locking it (as {@link dbDeletePin} briefly did, for a narrower
 * problem) would trade that for the granularity failure below: WATCHing the
 * whole Pins hash means any other Contributor's unrelated add or edit on the
 * *same Map* invalidates it too. This Map is stale-until-reload everywhere
 * else (see ADR-0019), so a lost concurrent edit is accepted the same way;
 * the case that actually matters — the Pin having been deleted out from
 * under an editor — is already loud, via the 404 below, rather than silent.
 */
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

/**
 * Unlike {@link dbAddPin}'s field, `id` is client-chosen and may already be
 * gone — from a second click, a retry, or someone else's request — so whether
 * to decrement is a real decision, not a given. `hDel`'s own return count
 * makes that decision atomically: exactly one caller, of however many ask to
 * delete the same `id` at once, gets `1` back, and the rest get `0` and skip
 * the decrement. That needs no WATCH, and used to have one anyway — on the
 * *whole* Pins hash, to protect a single integer, so any other Contributor's
 * unrelated add or edit on the same Map invalidated it and forced a retry.
 * With two writers now routine on a Collaborative Map rather than
 * unreachable, that granularity mismatch stopped being theoretical.
 */
export async function dbDeletePin(t3: T3, id: string): Promise<void> {
  await requireOwnerExists(t3)
  const removed = await redis.hDel(pinsKey(t3), [id])
  if (removed) await redis.zIncrBy(INDEX_PINS_KEY, t3, -removed)
}

/**
 * What an Entry renders that Reddit isn't asked for. The title is safe to copy
 * because Reddit won't let anyone edit a post title; the score is deliberately
 * not here, since it changes constantly and lives in its own cache.
 *
 * `collaborative` is written once, at creation, and is optional only so that
 * an `index-meta` row from before this field existed still parses — read as
 * `undefined`, which {@link dbGetIndex} treats the same as `false`. It exists
 * so the Listing's scan never has to read a per-post `kind:` key to know
 * whether an Entry needs its `community` marker.
 */
export type IndexMeta = {
  title: string
  author: string
  createdAt: number
  collaborative?: boolean
}

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
    const {title, author, collaborative} = JSON.parse(json) as IndexMeta
    rows.push({
      t3: member as T3,
      title,
      author,
      createdAt,
      collaborative,
      pinCount: pinCountByT3.get(member) ?? 0,
      score: scoreByT3.get(member) ?? 0,
    })
  }
  return rows
}

/**
 * Drops a Map Post from the index because its Reddit post is gone. The Map
 * itself is left alone — the owner key, the kind, and the Pins stay where
 * they are. A deletion we misread costs a listing; a deletion we act on by
 * erasing someone's Pins costs their Map, and only one of those is
 * recoverable.
 */
export async function dbUnlistMap(t3: T3): Promise<void> {
  await Promise.all([
    redis.zRem(INDEX_KEY, [t3]),
    redis.zRem(INDEX_PINS_KEY, [t3]),
    redis.zRem(INDEX_SCORE_KEY, [t3]),
    redis.zRem(INDEX_MISS_KEY, [t3]),
    redis.hDel(INDEX_META_KEY, [t3]),
  ])
}

/**
 * How many times in a row Reddit has failed to answer for each indexed Map
 * Post. Normally empty: a row only appears here between a failed read and the
 * next successful one, which is what makes reading the whole thing cheap.
 */
export async function dbGetIndexMisses(): Promise<Map<string, number>> {
  const misses = await redis.zRange(INDEX_MISS_KEY, 0, -1)
  return new Map(misses.map(z => [z.member, z.score]))
}

/** Counts one failed read, answering how many have now happened in a row. */
export async function dbRecordIndexMiss(t3: T3): Promise<number> {
  return await redis.zIncrBy(INDEX_MISS_KEY, t3, 1)
}

/** Forgets the failures, because Reddit has just answered for this one. */
export async function dbClearIndexMiss(t3: T3): Promise<void> {
  await redis.zRem(INDEX_MISS_KEY, [t3])
}

/**
 * Forgets a Map entirely, at its Owner's request: the index entries, the owner
 * key, the kind, and every Pin. Unlike {@link dbUnlistMap} this is not a guess
 * about what Reddit did — the Owner asked for it and the Post is going with
 * it, so there is nothing left for the Pins, or the kind, to belong to.
 */
export async function dbDeleteMap(t3: T3): Promise<void> {
  await dbUnlistMap(t3)
  await Promise.all([
    redis.del(ownerKey(t3)),
    redis.del(pinsKey(t3)),
    redis.del(kindKey(t3)),
    redis.del(summaryKey(t3)),
  ])
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
 * The Default Area, or nothing where no moderator has set one — which is also
 * the answer for a value this version of the app cannot read, since an
 * unframeable area and a missing one leave a Map in the same place. A
 * subreddit whose area was looked up by the version that asked Google is in
 * exactly that position, and clearing it is what takes the stale value out of
 * Redis; see {@link parseMapBounds}.
 */
export async function dbGetDefaultArea(): Promise<MapBounds | undefined> {
  const json = await redis.get(DEFAULT_AREA_KEY)
  return json ? parseMapBounds(json) : undefined
}

export async function dbSetDefaultArea(bounds: MapBounds): Promise<void> {
  await redis.set(DEFAULT_AREA_KEY, JSON.stringify(bounds))
}

export async function dbDeleteDefaultArea(): Promise<void> {
  await redis.del(DEFAULT_AREA_KEY)
}

/**
 * The subreddit's Default Area, as {@link MapBounds} JSON. Unqualified by any
 * post id because it belongs to the install rather than to a Map, and Redis is
 * installation-scoped — so one unqualified key is already one per subreddit.
 */
const DEFAULT_AREA_KEY = 'default-area'
/** Map Post id -> created-at ms. The set of Maps this subreddit knows about. */
const INDEX_KEY = 'index'
/** Map Post id -> {@link IndexMeta} JSON. */
const INDEX_META_KEY = 'index-meta'
/** Map Post id -> how many Pins its Map holds. */
const INDEX_PINS_KEY = 'index-pins'
/** Map Post id -> upvotes, as of the last refresh. */
const INDEX_SCORE_KEY = 'index-score'
/** Map Post id -> consecutive failed reads of it. See {@link dbGetIndexMisses}. */
const INDEX_MISS_KEY = 'index-miss'
/** How far through {@link INDEX_KEY} the last score refresh got. */
const INDEX_CURSOR_KEY = 'index-cursor'

function ownerKey(t3: T3): string {
  return `owner:${t3}`
}

function pinsKey(t3: T3): string {
  return `pins:${t3}`
}

/**
 * Holds {@link MapKind.Collaborative} for a Collaborative Map, and is absent
 * for a Solo one — never `'solo'` itself. It cannot live on `owner:{t3}`,
 * whose mere existence is the only thing telling a Map Post apart from an
 * Index Post at the Reddit API level; overloading it a second way would let
 * an empty value there be misread as "no owner" by {@link dbIsMap}.
 */
function kindKey(t3: T3): string {
  return `kind:${t3}`
}

/**
 * Holds the Map's Summary, and is absent where none has been written. Its own
 * key for {@link kindKey}'s reason: `owner:{t3}`'s mere existence is what
 * {@link dbIsMap} reads to tell a Map Post from an Index Post, and nothing else
 * may ever be overloaded onto it.
 */
function summaryKey(t3: T3): string {
  return `summary:${t3}`
}

async function requireOwnerExists(t3: T3): Promise<void> {
  const ownerId = await redis.get(ownerKey(t3))
  if (!ownerId) throw new HttpError(404, `map not found: ${t3}`)
}
