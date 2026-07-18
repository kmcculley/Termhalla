/**
 * Pairing token trio (feature 0026, REQ-004/REQ-005): a CSPRNG >= 256-bit token, its sha-256
 * digest (the ONLY form ever persisted), and a total, constant-time verification primitive.
 * `verifyToken` must never throw and must never leak timing through an early-return on a
 * length mismatch — untrusted network input reaches this path on every HTTP request and WS
 * upgrade (REQ-018 posture).
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

/** 32 CSPRNG bytes, base64url-encoded (>= 256 bits of entropy, 43+ chars). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** sha-256 digest of the token, base64url-encoded — the ONLY form persisted to disk. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

/** Total: an absent/garbage/length-mismatched stored hash rejects EVERY token, never throws. The
 *  length check runs BEFORE `timingSafeEqual` (which requires equal-length buffers and throws
 *  otherwise) — this is a length check, not a value comparison, so it leaks no secret timing. */
export function verifyToken(token: string, storedHash: string | undefined): boolean {
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false
  if (typeof token !== 'string') return false
  let candidate: string
  try {
    candidate = hashToken(token)
  } catch {
    return false
  }
  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(storedHash, 'utf8')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
