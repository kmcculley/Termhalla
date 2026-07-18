// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-025: exactly ONE module under src/main reads TERMHALLA_E2E_PHONE_REMOTE (the
// e2e-presentation.ts / e2e-remote.ts seam discipline); unset means byte-identical production
// behavior. Contract set here for the implementer — src/main/e2e-phone-remote.ts exports:
//   e2ePhoneRemoteOverride(raw?: string): { port?: number; token?: string } | undefined
// with `raw` defaulting to process.env.TERMHALLA_E2E_PHONE_REMOTE at call time. Any malformed
// value degrades to undefined (production behavior) — never a throw, never a partial.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { e2ePhoneRemoteOverride } from '../../src/main/e2e-phone-remote'

const walk = (dir: string, ext: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (p.endsWith(ext)) out.push(p)
  }
  return out
}

describe('TEST-2660 REQ-025 the seam is inert unless the harness sets it', () => {
  it('parses the harness JSON into the test override', () => {
    const parsed = e2ePhoneRemoteOverride(JSON.stringify({ port: 18199, token: 'fixed-e2e-token' }))
    expect(parsed).toEqual({ port: 18199, token: 'fixed-e2e-token' })
  })

  it('is absent (production behavior) when unset, empty, or malformed', () => {
    expect(e2ePhoneRemoteOverride(undefined)).toBeUndefined()
    expect(e2ePhoneRemoteOverride('')).toBeUndefined()
    expect(e2ePhoneRemoteOverride('not json')).toBeUndefined()
    expect(e2ePhoneRemoteOverride('42')).toBeUndefined()
    expect(e2ePhoneRemoteOverride('null')).toBeUndefined()
    expect(e2ePhoneRemoteOverride('[]')).toBeUndefined()
  })

  it('degrades field-wise: a malformed port or token is dropped, never a throw', () => {
    expect(() => e2ePhoneRemoteOverride(JSON.stringify({ port: 'high', token: 42 }))).not.toThrow()
    const parsed = e2ePhoneRemoteOverride(JSON.stringify({ port: 'high', token: 't' }))
    expect(parsed?.port).toBeUndefined()
    expect(parsed?.token).toBe('t')
  })

  it('reads the harness env by default', () => {
    const saved = process.env.TERMHALLA_E2E_PHONE_REMOTE
    try {
      process.env.TERMHALLA_E2E_PHONE_REMOTE = JSON.stringify({ port: 18200 })
      expect(e2ePhoneRemoteOverride()).toEqual({ port: 18200 })
      delete process.env.TERMHALLA_E2E_PHONE_REMOTE
      expect(e2ePhoneRemoteOverride()).toBeUndefined()
    } finally {
      if (saved === undefined) delete process.env.TERMHALLA_E2E_PHONE_REMOTE
      else process.env.TERMHALLA_E2E_PHONE_REMOTE = saved
    }
  })
})

describe('TEST-2661 REQ-025 structural: exactly one reader under src/main (CONV-032/CONV-037)', () => {
  it('no src/main source outside e2e-phone-remote.ts mentions the env var in code', () => {
    const offenders: string[] = []
    for (const f of walk(resolve(process.cwd(), 'src/main'), '.ts')) {
      const norm = f.replace(/\\/g, '/')
      if (norm.endsWith('src/main/e2e-phone-remote.ts')) continue
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      if (/TERMHALLA_E2E_PHONE_REMOTE/.test(code)) offenders.push(norm)
    }
    expect(offenders, 'read the override via e2ePhoneRemoteOverride() from src/main/e2e-phone-remote.ts').toEqual([])
  })
})
