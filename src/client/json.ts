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
    return
  }

  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '')
    console.error(`HTTP status ${rsp.status}: ${rsp.statusText}; ${text}`)
    return
  }

  return (await rsp.json()) as T
}
