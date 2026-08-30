/**
 * The app's one JSON fetch, kept apart from `fetch.ts` because that module is
 * welded to MapLibre — importing it would pull the whole map library into the
 * Index Post's bundle, which is the last thing a post rendering inline in a
 * feed needs.
 *
 * A failure is `undefined` rather than a throw: every caller's answer to a dead
 * request is to show what it already has, and none of them can do anything with
 * the reason.
 */
export async function fetchJson<T>(
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  const result = await fetchJsonResult<T>(path, body)
  return result.ok ? result.value : undefined
}

/** What {@link fetchJsonResult} answers. */
export type FetchResult<T> = {ok: true; value: T} | {ok: false; status: number}

/**
 * A sibling to {@link fetchJson} for the rare caller that *can* do something
 * with the reason. On a Collaborative Map, a Contributor racing another
 * editor of the same Pin gets a 403 or 404 that means something specific — the
 * Pin was deleted, or is no longer theirs to touch — and collapsing that into
 * `undefined` alongside a dead network the way `fetchJson` does would lose the
 * one signal that tells a deliberately-stale client it is stale. Everywhere
 * else keeps using `fetchJson`, so this is a sibling rather than a change to
 * it. `status` is `0` for a network failure, which no real response ever is.
 */
export async function fetchJsonResult<T>(
  path: string,
  body?: unknown,
): Promise<FetchResult<T>> {
  let rsp: Response
  try {
    rsp = await fetch(
      path,
      body === undefined
        ? {headers: {Accept: 'application/json'}}
        : {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          },
    )
  } catch (err) {
    console.error(`HTTP error: ${err instanceof Error ? err.message : err}`)
    return {ok: false, status: 0}
  }

  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '')
    console.error(`HTTP status ${rsp.status}: ${rsp.statusText}; ${text}`)
    return {ok: false, status: rsp.status}
  }

  return {ok: true, value: (await rsp.json()) as T}
}
