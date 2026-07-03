// 0015-orky-contract-v2-refresh — phase 4 (tests), REQ-109 / TASK-110+TASK-111.
// `OrkyFindingDetail` gains the v2 `finding_resolution` fields, mapped in
// `orky-root-detail.ts#mapFinding` with the module's existing total-mapping discipline (CONV-002):
//   resolution: string | null   — f.resolution when a string, VERBATIM (no trimming), else null
//   resolvedBy: string | null   — f.resolvedBy when a string, VERBATIM, else null
//   resolvedAt: number | null   — epoch ms via the SAME tz-safe timestamp parse the escalation
//                                 mapper uses (epochOrNull/parseOrkyTimestamp): string → parsed,
//                                 ANYTHING else (incl. a numeric epoch) → null
// The extended shape rides the EXISTING `registry:detail` payload (no new IPC channel, no
// SCHEMA_VERSION bump — review-time checks, TASK-113).
//
// Style mirrors the FROZEN 0009 suite (tests/main/orky-root-detail.test.ts): mapFinding is exercised
// through its module seam `assembleOrkyRootDetail` over a seeded temp tree, and the not-yet-existing
// fields are read via TOLERANT accessors (the TEST-392 `slugOf` precedent) so the suite type-checks
// while the shared OrkyFindingDetail type is still pre-amendment.
//
// Runs RED today (2026-07-03): mapFinding maps none of the three fields, so every accessor yields
// `undefined` where the pinned contract requires a verbatim value or an explicit null.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleOrkyRootDetail } from '../../src/main/orky/orky-root-detail'
import { isBlockingFinding } from '@shared/orky-status'

const NOW = 1_700_000_000_000

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

// Tolerant accessors for the pre-amendment RED state (the TEST-392 slugOf precedent).
const resolutionOf = (fd: unknown): unknown => (fd as { resolution?: unknown }).resolution
const resolvedByOf = (fd: unknown): unknown => (fd as { resolvedBy?: unknown }).resolvedBy
const resolvedAtOf = (fd: unknown): unknown => (fd as { resolvedAt?: unknown }).resolvedAt

function seedRoot(findings: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-detail-res-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, '.orky', 'features', 'res-feat')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    feature: 'res-feat', phase: 'review', gates: {}, escalations: []
  }), 'utf8')
  writeFileSync(join(dir, 'findings.json'), JSON.stringify(findings), 'utf8')
  return root
}

describe('mapFinding carries the v2 finding_resolution fields (REQ-109)', () => {
  it('TEST-713 REQ-109: string resolution/resolvedBy map VERBATIM (untrimmed) and resolvedAt parses tz-safe to epoch ms — a tz-less ISO timestamp lands on the SAME epoch as its explicit-Z twin', async () => {
    const root = seedRoot([
      {
        id: 'F-RES', lens: 'quality', severity: 'HIGH', status: 'resolved', gate: 'review',
        claim: 'the guard was wrong',
        resolution: '  rewrote the guard  ', // deliberate padding — verbatim means NO trimming
        resolvedBy: 'kevin',
        resolvedAt: '2026-07-01T12:00:00Z'
      },
      { id: 'F-TZ', status: 'resolved', claim: 'tz twin', resolution: 'r', resolvedAt: '2026-07-01T12:00:00' }
    ])
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.features).toHaveLength(1)
    const [fRes, fTz] = res.features[0].findings
    expect(resolutionOf(fRes)).toBe('  rewrote the guard  ') // verbatim, padding intact
    expect(resolvedByOf(fRes)).toBe('kevin')
    expect(resolvedAtOf(fRes)).toBe(Date.UTC(2026, 6, 1, 12)) // a real epoch-ms number
    // tz-safety: the SAME parse precedent OrkyEscalationDetail.resolvedAt uses — a tz-less ISO
    // string is interpreted as UTC, identical to its explicit-Z twin on ANY host TZ
    expect(resolvedAtOf(fTz)).toBe(Date.UTC(2026, 6, 1, 12))
  })

  it('TEST-714 REQ-109: total mapping — absent / null / mistyped fields (number resolution, object resolvedBy, junk or NUMERIC resolvedAt) all map to null with no throw, and every PRE-EXISTING OrkyFindingDetail field maps exactly as before', async () => {
    const rawFindings = [
      { id: 'F-ABSENT', severity: 'LOW', status: 'resolved', claim: 'no resolution fields at all' },
      { id: 'F-NULLED', severity: 'MEDIUM', status: 'open', claim: 'explicit nulls', resolution: null, resolvedBy: null, resolvedAt: null },
      { id: 'F-MISTYPED', severity: 'HIGH', status: 'resolved', claim: 'mistyped everything', resolution: 42, resolvedBy: { name: 'kevin' }, resolvedAt: 'not-a-timestamp' },
      { id: 'F-NUMAT', severity: 'LOW', status: 'resolved', claim: 'numeric epoch is NOT a string', resolution: 'ok', resolvedAt: 1_700_000_000_000 }
    ]
    const root = seedRoot(rawFindings)
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const findings = res.features[0].findings
    expect(findings).toHaveLength(4)

    // the three new fields: mistyped/absent/null → the pinned null default, NEVER the raw value
    for (const fd of [findings[0], findings[1], findings[2]]) {
      expect(resolutionOf(fd)).toBeNull()
      expect(resolvedByOf(fd)).toBeNull()
      expect(resolvedAtOf(fd)).toBeNull()
    }
    // a string resolution maps even when resolvedAt is mistyped — fields are independent…
    expect(resolutionOf(findings[3])).toBe('ok')
    // …and a NUMERIC resolvedAt is null (epochOrNull's string-only precedent), never passed through
    expect(resolvedAtOf(findings[3])).toBeNull()
    expect(resolvedByOf(findings[3])).toBeNull()

    // every pre-existing field still maps exactly as before (FILE order, verbatim, pinned defaults,
    // the SHARED blocking predicate) — the extension is additive, not a remap
    findings.forEach((fd, i) => {
      const raw = rawFindings[i] as Record<string, unknown>
      expect(fd.id).toBe(raw.id)
      expect(fd.severity).toBe(raw.severity)
      expect(fd.status).toBe(raw.status)
      expect(fd.claim).toBe(raw.claim)
      expect(fd.blocking).toBe(isBlockingFinding(raw))
    })
    // control: the one OPEN finding above is not blocking either (MEDIUM), and nothing threw
    expect(findings[1].blocking).toBe(false)
  })
})
