// FROZEN loopback suite — feature 0009-native-orky-pane (phase 4, ESC-001 tests loopback).
// REQ-008(b) — an EXISTING file whose stat/open/read fails with a non-ENOENT error (EACCES/EPERM —
// a permission-broken tree) is UNREADABLE, not absent: it flows through the bounded retry and is
// then SURFACED (state.json → skippedFeatures; findings.json → findingsUnreadable), never silently
// classified as missing (FINDING-028, contract violation: readJsonOnce treats ANY stat failure as
// 'absent', silently dropping the feature from an ok:true payload).
//
// The fs seam is mocked per the orky-root-detail precedent of driving the assembler against real
// temp trees: the files physically EXIST with valid JSON; only the marked paths' fs-promises calls
// throw EACCES/EPERM. stat, open AND readFile are all denied for the marked paths so the pin holds
// regardless of which call order the (possibly fd-based, FINDING-012) read strategy uses — the
// contract is errno classification, not a specific syscall sequence.
//
// Runs RED today (2026-07-02, against the shipped F9 implementation): the EACCES state.json is
// treated as absent (feature vanishes from features AND skippedFeatures) and the EPERM
// findings.json reads as readable-empty (findingsUnreadable stays false).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const denied = (p: unknown): string | null => {
    const s = String(p).replace(/\\/g, '/')
    if (s.endsWith('/eacces-feat/state.json')) return 'EACCES'
    if (s.endsWith('/eperm-feat/findings.json')) return 'EPERM'
    return null
  }
  const err = (code: string, p: unknown): Error =>
    Object.assign(new Error(`${code}: permission denied, '${String(p)}'`), { code })
  return {
    ...real,
    stat: async (p: never, ...rest: never[]) => { const c = denied(p); if (c) throw err(c, p); return real.stat(p, ...rest) },
    open: async (p: never, ...rest: never[]) => { const c = denied(p); if (c) throw err(c, p); return real.open(p, ...rest) },
    readFile: async (p: never, ...rest: never[]) => { const c = denied(p); if (c) throw err(c, p); return real.readFile(p, ...rest) }
  }
})

import { assembleOrkyRootDetail } from '../../src/main/orky/orky-root-detail'

const NOW = 1_700_000_000_000

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-statfail-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.orky', 'features'), { recursive: true })
  return root
}
function seedFeature(root: string, slug: string, findings?: string): void {
  const dir = join(root, '.orky', 'features', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    feature: slug, phase: 'spec',
    gates: { brainstorm: { passed: true, at: '2026-01-01T00:00:00Z' } }, escalations: []
  }), 'utf8')
  if (findings !== undefined) writeFileSync(join(dir, 'findings.json'), findings, 'utf8')
}

describe('non-ENOENT stat failures are UNREADABLE, never absence (REQ-008b / FINDING-028)', () => {
  it('TEST-457 REQ-008 an EXISTING state.json whose fs access fails EACCES surfaces its slug in skippedFeatures after the bounded retry — never a silently-shorter ok:true payload; genuine absence (no state.json) still means "not a feature"', async () => {
    const root = makeRoot()
    seedFeature(root, 'a-ok-feat')
    seedFeature(root, 'eacces-feat')                       // exists, but every access is denied
    mkdirSync(join(root, '.orky', 'features', 'no-state-feat'), { recursive: true }) // genuinely absent state.json
    const res = await assembleOrkyRootDetail(root, { now: () => NOW, retryDelayMs: 25 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // the unreadable-but-existing feature is SURFACED, its sibling intact
    expect(res.skippedFeatures).toEqual(['eacces-feat'])
    expect(res.features.map(f => f.status.feature)).toEqual(['a-ok-feat'])
    // ENOENT-class absence stays a non-feature (engine parity): in NEITHER list
    expect(res.skippedFeatures).not.toContain('no-state-feat')
    // coverage invariant: every dir whose state.json EXISTS appears in features OR skippedFeatures
    expect([...res.features.map(f => f.status.feature), ...res.skippedFeatures].sort())
      .toEqual(['a-ok-feat', 'eacces-feat'])
  })

  it('TEST-458 REQ-008 an EXISTING findings.json whose fs access fails EPERM yields findings:[] + findingsUnreadable:true with gates/escalations intact; a genuinely ABSENT findings.json stays findingsUnreadable:false', async () => {
    const root = makeRoot()
    seedFeature(root, 'b-ok-feat')                          // no findings.json at all — legitimate
    seedFeature(root, 'eperm-feat', JSON.stringify([
      { id: 'F-1', lens: 'x', claim: 'c', severity: 'HIGH', status: 'open' }
    ]))                                                     // exists, but every access is denied
    const res = await assembleOrkyRootDetail(root, { now: () => NOW, retryDelayMs: 25 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const denied = res.features.find(f => f.status.feature === 'eperm-feat')
    expect(denied, 'the feature itself (state.json readable) must still be carried').toBeDefined()
    expect(denied!.findingsUnreadable, 'an existing-but-unreadable findings.json must be surfaced, not read as empty').toBe(true)
    expect(denied!.findings).toEqual([])
    expect(denied!.gates.find(g => g.phase === 'brainstorm')!.passed).toBe(true) // intact
    const absent = res.features.find(f => f.status.feature === 'b-ok-feat')
    expect(absent!.findingsUnreadable).toBe(false)          // absence is a legitimate state
    expect(res.skippedFeatures).toEqual([])                 // state.json was readable everywhere
  })
})
