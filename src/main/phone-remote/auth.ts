/**
 * The HTTP+WS auth gate (feature 0026, REQ-005/REQ-006) — extracts the pairing token from the
 * `token` query parameter or the `X-Termhalla-Token` header and verifies it via `token.ts`'s
 * constant-time `verifyToken` (never a naive `===` comparison here).
 */
import type { IncomingMessage } from 'node:http'
import { verifyToken } from './token'

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

export function isRequestAuthorized(req: IncomingMessage, tokenHash: string | undefined): boolean {
  return verifyToken(extractTokenFromRequest(req) ?? '', tokenHash)
}
