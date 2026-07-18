// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-004: pairing token is CSPRNG >= 256 bits, base64url; only its sha-256 hash is ever at
// rest. REQ-005 (primitive): verification compares hash-to-hash with a constant-time compare.
// Contract set here for the implementer — src/main/phone-remote/token.ts exports:
//   generateToken(): string                       // base64url of crypto.randomBytes(32)
//   hashToken(token: string): string              // sha-256, base64url digest
//   verifyToken(token: string, storedHash: string | undefined): boolean
// verifyToken must be total: absent/empty/garbage/length-mismatched stored hashes return
// false and NEVER throw (untrusted input reaches this path — REQ-018 posture).
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateToken, hashToken, verifyToken } from '../../src/main/phone-remote/token'

const B64URL = /^[A-Za-z0-9_-]+$/

describe('TEST-2604 REQ-004 token generation: 256-bit CSPRNG, base64url', () => {
  it('produces 43+ chars of base64url (32 random bytes)', () => {
    const t = generateToken()
    expect(t.length).toBeGreaterThanOrEqual(43)
    expect(t).toMatch(B64URL)
  })

  it('is distinct across calls', () => {
    const seen = new Set(Array.from({ length: 8 }, () => generateToken()))
    expect(seen.size).toBe(8)
  })
})

describe('TEST-2605 REQ-004/REQ-005 hash + verify semantics', () => {
  it('hashToken is the sha-256 base64url digest of the token (the persisted shape)', () => {
    const t = generateToken()
    expect(hashToken(t)).toBe(createHash('sha256').update(t).digest('base64url'))
    expect(hashToken(t)).not.toBe(t)
  })

  it('the hash verifies against the plaintext; a wrong token does not', () => {
    const t = generateToken()
    const h = hashToken(t)
    expect(verifyToken(t, h)).toBe(true)
    expect(verifyToken(generateToken(), h)).toBe(false)
    expect(verifyToken(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), h)).toBe(false)
  })

  it('an absent stored hash rejects EVERY token (never-paired state)', () => {
    expect(verifyToken(generateToken(), undefined)).toBe(false)
    expect(verifyToken('', undefined)).toBe(false)
  })

  it('is total: garbage / length-mismatched stored hashes return false, never throw', () => {
    const t = generateToken()
    for (const h of ['', 'short', 'not base64url !!', 'A'.repeat(1000)]) {
      expect(() => verifyToken(t, h)).not.toThrow()
      expect(verifyToken(t, h)).toBe(false)
    }
    expect(() => verifyToken('', hashToken(t))).not.toThrow()
    expect(verifyToken('', hashToken(t))).toBe(false)
  })
})

describe('TEST-2606 REQ-005 structural: constant-time comparison at the verification site', () => {
  it('token.ts (or auth.ts) compares digests via crypto.timingSafeEqual', () => {
    const root = process.cwd()
    const candidates = ['src/main/phone-remote/token.ts', 'src/main/phone-remote/auth.ts']
    const sources = candidates
      .filter((rel) => existsSync(resolve(root, rel)))
      .map((rel) => readFileSync(resolve(root, rel), 'utf8'))
    expect(sources.length, 'token.ts must exist').toBeGreaterThan(0)
    expect(sources.some((s) => /timingSafeEqual/.test(s)),
      'the token verification call site must use crypto.timingSafeEqual over equal-length digests').toBe(true)
    // and no naive string equality on a token/hash anywhere in the auth surface
    for (const s of sources) {
      expect(s).not.toMatch(/token\s*===\s*|===\s*token\b/)
    }
  })
})
