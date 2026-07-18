/**
 * Pairing-token URL extraction (feature 0026, REQ-023/REQ-028). Pure and DOM-free: `main.ts`
 * supplies the real `window.location.href` at the call site so this module stays import-safe
 * (and unit-testable) under node.
 *
 * v2 (ESC-001 — closes the FINDING-025 auth-relaunch contradiction): the plaintext token is NO
 * LONGER persisted anywhere script-readable (no `localStorage`/`sessionStorage`, no script-written
 * cookie). The first token-authenticated HTTP response sets the REQ-028 HttpOnly session cookie
 * server-side (invisible to script); the browser then presents that cookie automatically on every
 * later same-origin request (including the WS upgrade), so the client needs no in-memory or
 * persisted credential of its own after the initial load. This module's ONLY remaining job is
 * extracting the token so `main.ts` can strip it from the visible URL immediately (it must not
 * linger in browser history) — it does not store the token anywhere.
 */

export interface ExtractedToken {
  token?: string
  cleanedHref: string
}

/** Pulls `?token=` off a URL and returns the cleaned href (every OTHER query param survives) so
 *  the caller can `history.replaceState` it — the token must not linger in browser history. */
export function extractTokenFromUrl(href: string): ExtractedToken {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { cleanedHref: href }
  }
  const token = url.searchParams.get('token')
  if (token === null) return { cleanedHref: href }
  url.searchParams.delete('token')
  const search = url.searchParams.toString()
  url.search = search
  return { token, cleanedHref: url.toString() }
}
