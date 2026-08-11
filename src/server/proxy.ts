import type {IncomingHttpHeaders} from 'node:http'
import {HttpError} from './http-error.ts'

/**
 * Hosts the webview may reach through the proxy. This is deliberately narrower
 * than devvit.json's `permissions.http.domains`: `places.googleapis.com` is
 * reachable from the server but not through here, because place search needs
 * the subreddit's API key attached server-side and has its own endpoint.
 */
const ProxyHost: ReadonlySet<string> = new Set(['tiles.openfreemap.org'])

/** Tiles, sprites, and glyphs are all far below this; anything bigger is a mistake. */
const maxBytes = 8 * 1024 * 1024
const timeoutMs = 10_000

/** Passed upstream so the webview's HTTP cache can still revalidate through the proxy. */
const forwardedReqHeader = ['accept', 'if-none-match', 'if-modified-since']

/**
 * Passed back to the webview. `content-encoding` is deliberately absent: fetch()
 * has already decoded the body, so echoing it would make the webview decode
 * twice. `content-length` is recomputed from the bytes actually sent.
 */
const forwardedRspHeader = [
  'content-type',
  'cache-control',
  'etag',
  'expires',
  'last-modified',
]

export type ProxyRsp = {
  status: number
  headers: {[name: string]: string}
  body: Buffer
}

/**
 * Fetches an allowlisted external URL and returns it verbatim for forwarding.
 * Reddit apps may only make external requests from the server, so this is the
 * only way the webview can reach the map tile host.
 */
export async function proxyGet(
  rawUrl: string | null,
  reqHeaders: IncomingHttpHeaders,
): Promise<ProxyRsp> {
  const url = parseProxyUrl(rawUrl)

  const headers: {[name: string]: string} = {}
  for (const name of forwardedReqHeader) {
    const value = reqHeaders[name]
    if (typeof value === 'string') headers[name] = value
  }

  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    console.error(
      `proxy request failed: ${url}; ${err instanceof Error ? err.message : err}`,
    )
    throw new HttpError(502, `proxy request failed: ${url.host}`)
  }

  const rspHeaders: {[name: string]: string} = {}
  for (const name of forwardedRspHeader) {
    const value = upstream.headers.get(name)
    if (value) rspHeaders[name] = value
  }

  // Not-modified responses carry no body, and reading one would hang on some hosts.
  if (upstream.status === 304) {
    return {status: 304, headers: rspHeaders, body: Buffer.alloc(0)}
  }

  if (Number(upstream.headers.get('content-length')) > maxBytes) {
    throw new HttpError(502, 'proxied response is too large')
  }
  const body = Buffer.from(await upstream.arrayBuffer())
  if (body.byteLength > maxBytes) {
    throw new HttpError(502, 'proxied response is too large')
  }

  // Upstream failures pass through as-is; MapLibre relies on a 404 to know a tile is empty.
  return {status: upstream.status, headers: rspHeaders, body}
}

function parseProxyUrl(rawUrl: string | null): URL {
  if (!rawUrl?.trim()) throw new HttpError(400, 'url is required')

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new HttpError(400, 'url must be an absolute URL')
  }
  if (url.protocol !== 'https:') {
    throw new HttpError(400, 'url must be an https URL')
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'url must not contain credentials')
  }
  if (!ProxyHost.has(url.hostname.toLowerCase())) {
    throw new HttpError(403, `host not allowed: ${url.hostname}`)
  }
  return url
}
