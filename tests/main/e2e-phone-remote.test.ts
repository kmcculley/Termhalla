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

// ---------------------------------------------------------------------------------------------
// v2 loopback amendment (ESC-001; FINDING-012) — REQ-025: the seam must be WIRED into the
// production service-construction path and CONSUMED by this feature's Playwright e2e specs.
// A decorative unconsumed seam is non-conforming. The override also gains the deterministic
// knobs the mandated e2e/integration coverage needs:
//   e2ePhoneRemoteOverride(raw?) additionally parses
//     enabled?: boolean   // force the service on at startup (test-only pairing bootstrap)
//     timing?: { pingIntervalMs?: number; pongTimeoutMs?: number; stallTimeoutMs?: number }
// with the same field-wise degradation discipline.

describe('TEST-2715 REQ-025 the seam is consumed: production wiring + e2e specs', () => {
  it('parses the v2 enabled/timing knobs field-wise', () => {
    const parsed = e2ePhoneRemoteOverride(JSON.stringify({
      port: 18199, token: 't', enabled: true, timing: { pingIntervalMs: 50, pongTimeoutMs: 50, stallTimeoutMs: 200 }
    })) as (ReturnType<typeof e2ePhoneRemoteOverride> & { enabled?: boolean; timing?: Record<string, number> }) | undefined
    expect(parsed?.enabled).toBe(true)
    expect(parsed?.timing?.pingIntervalMs).toBe(50)
    expect(parsed?.timing?.stallTimeoutMs).toBe(200)
    // malformed knobs degrade without dropping the healthy fields
    const partial = e2ePhoneRemoteOverride(JSON.stringify({ port: 1, enabled: 'yes', timing: 'junk' })) as
      (ReturnType<typeof e2ePhoneRemoteOverride> & { enabled?: boolean; timing?: unknown }) | undefined
    expect(partial?.port).toBe(1)
    expect(partial?.enabled).toBeUndefined()
    expect(partial?.timing).toBeUndefined()
  })

  it('the production service construction path consumes the seam (FINDING-012)', () => {
    const wiringSources = ['src/main/ipc/register.ts', 'src/main/services.ts'].map((rel) => {
      try {
        return readFileSync(resolve(process.cwd(), rel), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
      } catch { return '' }
    })
    expect(
      wiringSources.some((s) => /e2e-phone-remote|e2ePhoneRemoteOverride/.test(s)),
      'setting the env var must actually affect the real server construction'
    ).toBe(true)
  })

  it('the mandated Playwright specs exist and launch through the seam', () => {
    const e2eDir = resolve(process.cwd(), 'tests/e2e')
    const specs = readdirSync(e2eDir).filter((f) => /phone/.test(f) && f.endsWith('.spec.ts'))
    expect(specs.length, 'the REQ-015/019/023/029 e2e coverage must exist under tests/e2e').toBeGreaterThanOrEqual(2)
    const consuming = specs.filter((f) => readFileSync(join(e2eDir, f), 'utf8').includes('TERMHALLA_E2E_PHONE_REMOTE'))
    expect(consuming.length, 'the specs must launch the app with the seam env var set').toBeGreaterThanOrEqual(2)
  })
})
