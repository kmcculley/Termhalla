/**
 * HttpOnly session-cookie issuance/parsing/verification (feature 0026, REQ-028). The cookie VALUE
 * is the plaintext pairing token itself — its validity is therefore a PURE function of (value,
 * persisted `tokenHash`) via `token.ts`'s existing constant-time `verifyToken`: no server-side
 * cookie registry, no new secret persisted on the desktop (REQ-004). Regenerating the token
 * (REQ-006) invalidates every outstanding cookie for free — the pure-function binding means an old
 * cookie's value simply stops verifying against the new hash.
 */
import { PHONE_COOKIE_NAME, PHONE_COOKIE_MAX_AGE_S } from './constants'
import { verifyToken } from './token'

/** The full `Set-Cookie` header value for a token-authenticated response (REQ-028's stated
 *  attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=PHONE_COOKIE_MAX_AGE_S`). */
export function issueSetCookie(token: string): string {
  return `${PHONE_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${PHONE_COOKIE_MAX_AGE_S}`
}

/** Extracts the `PHONE_COOKIE_NAME` cookie's value from a `Cookie` request header (which may carry
 *  other cookies). Total over garbage — never throws, returns `undefined` on anything unparsable. */
export function cookieValueFromHeader(cookieHeader: string | undefined): string | undefined {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return undefined
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name !== PHONE_COOKIE_NAME) continue
    const raw = part.slice(eq + 1).trim()
    try { return decodeURIComponent(raw) } catch { return raw }
  }
  return undefined
}

/** Constant-time (via `verifyToken`'s `timingSafeEqual` site), total, `false` when either side is
 *  absent/garbage. The cookie value IS the plaintext token, so this reuses the token verification
 *  primitive verbatim — the cookie carries no separate secret. */
export function verifyCookieValue(value: string | undefined, tokenHash: string | undefined): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  return verifyToken(value, tokenHash)
}
