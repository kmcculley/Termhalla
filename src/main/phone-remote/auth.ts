/**
 * The HTTP+WS auth gate (feature 0026, REQ-005/REQ-006/REQ-028) — extracts a credential from the
 * `token` query parameter, the `X-Termhalla-Token` header, OR the `PHONE_COOKIE_NAME` session
 * cookie, and verifies it via `token.ts`'s / `cookie.ts`'s constant-time comparisons (never a
 * naive `===` comparison here).
 */
import type { IncomingMessage } from 'node:http'
import { verifyToken } from './token'
import { cookieValueFromHeader, verifyCookieValue } from './cookie'

export function extractTokenFromRequest(req: IncomingMessage): string | undefined {
  const header = req.headers['x-termhalla-token']
  if (typeof header === 'string' && header.length > 0) return header
  if (Array.isArray(header) && header.length > 0 && header[0].length > 0) return header[0]
  try {
    const url = new URL(req.url ?? '/', 'http://phone-remote.local')
    const fromQuery = url.searchParams.get('token')
    if (fromQuery) return fromQuery
  } catch { /* an unparsable URL simply carries no token */ }
  return undefined
}

const requestCookieHeader = (req: IncomingMessage): string | undefined => {
  const raw = req.headers.cookie
  return typeof raw === 'string' ? raw : undefined
}

/** `true` when the request presents EITHER a valid pairing token (query/header) OR a valid
 *  REQ-028 session cookie. `viaToken` distinguishes the two so the caller can decide whether to
 *  issue a fresh `Set-Cookie` (only a token-authenticated response does — REQ-028), and `token`
 *  carries the PRESENTED, just-verified plaintext on the token path (v3, FINDING-070): the
 *  cookie must be derivable from it, never from the in-memory session token — which dies with
 *  the app, while a captured pairing URL stays valid against the persisted `tokenHash` across a
 *  desktop restart. */
export function authorizeRequest(
  req: IncomingMessage,
  tokenHash: string | undefined
): { authorized: boolean; viaToken: boolean; token?: string } {
  const token = extractTokenFromRequest(req)
  if (token !== undefined && verifyToken(token, tokenHash)) return { authorized: true, viaToken: true, token }
  const cookieValue = cookieValueFromHeader(requestCookieHeader(req))
  if (cookieValue !== undefined && verifyCookieValue(cookieValue, tokenHash)) return { authorized: true, viaToken: false }
  return { authorized: false, viaToken: false }
}

/** Convenience boolean form (token OR cookie) for call sites that don't need to distinguish. */
export function isRequestAuthorized(req: IncomingMessage, tokenHash: string | undefined): boolean {
  return authorizeRequest(req, tokenHash).authorized
}
