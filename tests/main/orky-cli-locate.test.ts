// FROZEN unit suite — feature 0007-orky-action-dispatch (phase 4 / TASK-003, REQ-012).
// Targets `src/main/orky/orky-cli-locate.ts` — the SINGLE shared Orky CLI resolver used by every action
// (REQ-012: "a single function reused by all four actions (no duplicated lookup)"). Injectable `env`/
// `exists` (mirrors `resolve-bin.ts`'s own signature — see tests/main/cloud-core.test.ts's `resolveBin`
// suite) so it is unit-testable without touching the real filesystem/environment. Resolution order (plan
// "CLI-location resolver" section, open question #1's pragmatic default): ORKY_PLUGIN_DIR env var ->
// join(dir, kind, 'cli.js') existence-checked -> else null. NEVER throws.
//
// Chosen contract:
//   locateOrkyCli(kind: 'gatekeeper' | 'feedback', env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean): string | null
//   describeMissingCli(kind: 'gatekeeper' | 'feedback'): string
//
// Runs RED today: `src/main/orky/orky-cli-locate.ts` does not exist yet (module-not-found).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateOrkyCli, describeMissingCli } from '../../src/main/orky/orky-cli-locate'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

describe('locateOrkyCli — ORKY_PLUGIN_DIR resolution order (REQ-012)', () => {
  it('TEST-204 REQ-012 with ORKY_PLUGIN_DIR unset, returns null (no default path assumed valid on an arbitrary machine)', () => {
    expect(locateOrkyCli('gatekeeper', {}, () => true)).toBeNull()
    expect(locateOrkyCli('feedback', {}, () => true)).toBeNull()
  })

  it('TEST-205 REQ-012 with ORKY_PLUGIN_DIR set and the resolved cli.js existing, returns the absolute join(dir,kind,"cli.js") path', () => {
    const dir = 'C:/dev/Orky/plugin'
    const expected = join(dir, 'gatekeeper', 'cli.js')
    const exists = (p: string): boolean => p === expected
    expect(locateOrkyCli('gatekeeper', { ORKY_PLUGIN_DIR: dir }, exists)).toBe(expected)
  })

  it('TEST-206 REQ-012 with ORKY_PLUGIN_DIR set but the cli.js file missing (existence-checked), returns null, never a guessed path', () => {
    const dir = 'C:/dev/Orky/plugin'
    expect(locateOrkyCli('feedback', { ORKY_PLUGIN_DIR: dir }, () => false)).toBeNull()
  })

  it('TEST-207 REQ-012 resolves the CORRECT kind subdirectory ("gatekeeper" vs "feedback" never cross)', () => {
    const dir = 'C:/dev/Orky/plugin'
    const exists = (p: string): boolean => p === join(dir, 'feedback', 'cli.js')
    expect(locateOrkyCli('feedback', { ORKY_PLUGIN_DIR: dir }, exists)).toBe(join(dir, 'feedback', 'cli.js'))
    expect(locateOrkyCli('gatekeeper', { ORKY_PLUGIN_DIR: dir }, exists)).toBeNull() // gatekeeper/cli.js does NOT exist per this fake
  })

  it('TEST-208 REQ-012 the default `exists` parameter checks the REAL filesystem when omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orky-plugin-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    mkdirSync(join(dir, 'gatekeeper'), { recursive: true })
    writeFileSync(join(dir, 'gatekeeper', 'cli.js'), '// stub', 'utf8')
    expect(locateOrkyCli('gatekeeper', { ORKY_PLUGIN_DIR: dir })).toBe(join(dir, 'gatekeeper', 'cli.js'))
    expect(locateOrkyCli('feedback', { ORKY_PLUGIN_DIR: dir })).toBeNull() // feedback/cli.js was never created
  })
})

describe('describeMissingCli — the exact REQ-012 actionable message per kind', () => {
  it('TEST-209 REQ-012 names the missing CLI kind and tells the user how to fix it (sets ORKY_PLUGIN_DIR)', () => {
    const gk = describeMissingCli('gatekeeper')
    expect(gk).toContain('gatekeeper')
    expect(gk).toContain('ORKY_PLUGIN_DIR')
    expect(gk.toLowerCase()).toContain('could not be located')
  })

  it('TEST-210 REQ-012 the feedback-kind message is DISTINCT from the gatekeeper-kind message (never one generic string)', () => {
    const gk = describeMissingCli('gatekeeper')
    const fb = describeMissingCli('feedback')
    expect(fb).toContain('feedback')
    expect(fb).not.toBe(gk)
  })
})
