// FROZEN integration suite — feature 0009-native-orky-pane (phase 4 / TASK-006).
// REQ-008 — engine-parity bounds with the THREE pinned deliberate divergences:
//   (a) deterministic survivor set: slugs sorted by codepoint BEFORE the 200-dir cap (FINDING-006);
//   (b) torn-read stability: an EXISTING-but-unparseable file retries once after a short fixed delay,
//       then is SURFACED (skippedFeatures / findingsUnreadable), never silently dropped (FINDING-004);
//   (c) unreadable is surfaced, not swallowed (the engine's silent skip is replaced on THIS path only).
// Plus the one-shot discipline (REQ-013): no watcher, no timer left behind, no write of any kind.
//
// Chosen contract: see tests/main/orky-root-detail.test.ts (assembleOrkyRootDetail + capFeatureSlugs).
// Runs RED today: src/main/orky/orky-root-detail.ts does not exist yet (module-not-found).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assembleOrkyRootDetail, capFeatureSlugs } from '../../src/main/orky/orky-root-detail'

const NOW = 1_700_000_000_000

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-bounds-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.orky', 'features'), { recursive: true })
  return root
}
function seedFeature(root: string, slug: string, state?: string, findings?: string): void {
  const dir = join(root, '.orky', 'features', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), state ?? JSON.stringify({ feature: slug, phase: 'spec', gates: {}, escalations: [] }), 'utf8')
  if (findings !== undefined) writeFileSync(join(dir, 'findings.json'), findings, 'utf8')
}
function canSymlink(): boolean {
  const d = mkdtempSync(join(tmpdir(), 'orky-sym-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  try { mkdirSync(join(d, 'real')); symlinkSync(join(d, 'real'), join(d, 'link'), 'dir'); return true } catch { return false }
}
/** Recursive content snapshot — the byte-identical invariant (REQ-013). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) Object.assign(out, snapshot(p))
    else out[p] = readFileSync(p, 'utf8')
  }
  return out
}
/** Deterministic shuffle (seeded LCG) — no Math.random in a determinism suite. */
function shuffled<T>(arr: T[], seed: number): T[] {
  const a = arr.slice()
  let s = seed >>> 0
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

describe('deterministic survivor set — sort BEFORE cap (REQ-008a / REQ-014 / FINDING-006)', () => {
  it('TEST-400 REQ-008 REQ-014 capFeatureSlugs: 100 shuffled enumerations of 250 mixed-case slugs yield ONE codepoint-sorted 200-slug survivor set; ≤200 slugs pass through sorted and uncapped', () => {
    const slugs: string[] = []
    for (let i = 0; i < 125; i++) slugs.push(`F-${String(i).padStart(3, '0')}`) // uppercase sorts BEFORE lowercase by codepoint
    for (let i = 0; i < 125; i++) slugs.push(`f-${String(i).padStart(3, '0')}`)
    const expected = slugs.slice().sort().slice(0, 200) // all 125 'F-*' + the first 75 'f-*'
    for (let seed = 1; seed <= 100; seed++) {
      const { slugs: got, capped } = capFeatureSlugs(shuffled(slugs, seed))
      expect(capped).toBe(true)
      expect(got).toEqual(expected)
    }
    const small = capFeatureSlugs(shuffled(['b', 'A', 'a', 'B'], 7))
    expect(small).toEqual({ slugs: ['A', 'B', 'a', 'b'], capped: false })
  })

  it('TEST-401 REQ-008 a real 201-dir tree returns the FIRST 200 slugs in codepoint order (featuresCapped:true, warned) — the raw-enumeration-order engine cap is NOT copied', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeRoot()
    // FINDING-010: on-disk seeds must be genuinely distinct — F-NNN/f-NNN pairs collapse on
    // case-insensitive filesystems (201 seeds → 101 physical dirs, featuresCapped unreachable).
    // The mixed-case sort-before-cap property stays pinned in memory by the pure-seam twin TEST-400.
    const slugs: string[] = []
    for (let i = 0; i <= 200; i++) slugs.push(`f-${String(i).padStart(3, '0')}`)
    for (const s of slugs) seedFeature(root, s)
    const expected = new Set(slugs.slice().sort().slice(0, 200)) // 'f-200' is the codepoint-last slug → dropped
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.featuresCapped).toBe(true)
    expect(warn).toHaveBeenCalled() // CONV-003: capped, warned, never silent
    const carried = new Set([...res.features.map(f => f.status.feature), ...res.skippedFeatures])
    expect(carried).toEqual(expected)
    expect(carried.has('f-200')).toBe(false)
  })
})

describe('torn-write stability — bounded retry, surfaced failures (REQ-008b / FINDING-004)', () => {
  it('TEST-402 REQ-008 a torn state.json repaired BEFORE the retry delay elapses yields the FULL feature (the retry succeeded)', async () => {
    const root = makeRoot()
    const dir = join(root, '.orky', 'features', 'torn-feat')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), '{"feature": "torn-feat", "gates', 'utf8') // truncated JSON prefix
    setTimeout(() => {
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ feature: 'torn-feat', phase: 'spec', gates: { brainstorm: { passed: true, at: '2026-01-01T00:00:00Z' } }, escalations: [] }), 'utf8')
    }, 40)
    const res = await assembleOrkyRootDetail(root, { now: () => NOW, retryDelayMs: 200 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.skippedFeatures).toEqual([])
    expect(res.features).toHaveLength(1)
    expect(res.features[0].status.feature).toBe('torn-feat')
    expect(res.features[0].gates.find(g => g.phase === 'brainstorm')!.passed).toBe(true)
  })

  it('TEST-403 REQ-008 a state.json that STAYS torn surfaces its slug in skippedFeatures with siblings intact — an ok:true payload is never silently shorter than the tree', async () => {
    const root = makeRoot()
    seedFeature(root, 'ok-feat')
    const dir = join(root, '.orky', 'features', 'still-torn')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), '{"feature": "still-torn"', 'utf8')
    const res = await assembleOrkyRootDetail(root, { now: () => NOW, retryDelayMs: 30 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.skippedFeatures).toEqual(['still-torn'])
    expect(res.features.map(f => f.status.feature)).toEqual(['ok-feat'])
    // coverage invariant: every feature dir whose state.json exists appears in features OR skippedFeatures
    const dirs = readdirSync(join(root, '.orky', 'features')).sort()
    expect([...res.features.map(f => f.status.feature), ...res.skippedFeatures].sort()).toEqual(dirs)
  })

  it('TEST-404 REQ-008 a torn findings.json yields findings:[] + findingsUnreadable:true with gates/escalations INTACT; an unparseable active.json yields activeFeature:null (absent-equivalent)', async () => {
    const root = makeRoot()
    seedFeature(root, 'feat',
      JSON.stringify({ feature: 'feat', phase: 'spec', gates: { brainstorm: { passed: true, at: '2026-01-01T00:00:00Z' } }, escalations: [{ id: 'E1', status: 'open', reason: 'r' }] }),
      '[{"lens": "torn"') // truncated
    writeFileSync(join(root, '.orky', 'active.json'), 'not json at all', 'utf8')
    const res = await assembleOrkyRootDetail(root, { now: () => NOW, retryDelayMs: 30 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.activeFeature).toBeNull()
    const f = res.features[0]
    expect(f.findingsUnreadable).toBe(true)
    expect(f.findings).toEqual([])
    expect(f.gates.find(g => g.phase === 'brainstorm')!.passed).toBe(true) // intact
    expect(f.escalations).toHaveLength(1)                                   // intact
    expect(res.skippedFeatures).toEqual([]) // state.json itself was fine — the feature is NOT skipped
  })

  it('TEST-405 REQ-008 an OVERSIZED state.json is skipped deterministically with NO retry wait (warned) — absence/oversize retries nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeRoot()
    seedFeature(root, 'ok-feat')
    const dir = join(root, '.orky', 'features', 'oversized')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), 'x'.repeat(1024 * 1024 + 1), 'utf8') // > MAX_FILE_BYTES (1 MiB)
    const t0 = Date.now()
    const res = await assembleOrkyRootDetail(root, { now: () => NOW, retryDelayMs: 2000 })
    expect(Date.now() - t0).toBeLessThan(1500) // the 2000ms retry delay was NEVER awaited
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.skippedFeatures).toEqual(['oversized'])
    expect(res.features.map(f => f.status.feature)).toEqual(['ok-feat'])
    expect(warn).toHaveBeenCalled()
  })

  it('TEST-406 REQ-008 a symlinked feature dir is skipped (engine parity) with siblings intact', async () => {
    if (!canSymlink()) return // no symlink privilege on this host — the engine suite gates the same way
    const root = makeRoot()
    seedFeature(root, 'real-feat')
    const target = mkdtempSync(join(tmpdir(), 'orky-sym-target-'))
    cleanups.push(() => rmSync(target, { recursive: true, force: true }))
    writeFileSync(join(target, 'state.json'), JSON.stringify({ feature: 'linked', phase: 'spec', gates: {}, escalations: [] }), 'utf8')
    symlinkSync(target, join(root, '.orky', 'features', 'linked'), 'dir')
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.features.map(f => f.status.feature)).toEqual(['real-feat'])
    expect(res.skippedFeatures).not.toContain('linked') // engine-parity silent skip, not an unreadable marker
  })

  it('TEST-407 REQ-008 a missing orkyDir returns ok:false orky-missing NAMING the path; a present-but-EMPTY tree returns ok:true with features:[] (the unreadable-vs-empty distinction)', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'orky-bare-'))
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }))
    const missing = await assembleOrkyRootDetail(bare, { now: () => NOW })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.errorKind).toBe('orky-missing')
    expect(missing.error).toContain(join(bare, '.orky')) // specific + actionable (CONV-001)

    const empty = makeRoot() // .orky/features exists, zero feature dirs
    const res = await assembleOrkyRootDetail(empty, { now: () => NOW })
    expect(res).toMatchObject({ ok: true, features: [], skippedFeatures: [], featuresCapped: false })
  })
})

describe('one-shot read — no watcher, no recurring timer, no write (REQ-008 / REQ-013)', () => {
  it('TEST-408 REQ-008 REQ-013 the fixture tree is byte-identical after a read, and the assembler source declares no chokidar/watch/setInterval and no write API', async () => {
    const root = makeRoot()
    seedFeature(root, 'feat', undefined, JSON.stringify([{ lens: 'x', claim: 'c', severity: 'LOW', status: 'resolved', id: 'F-1' }]))
    const before = snapshot(join(root, '.orky'))
    const res = await assembleOrkyRootDetail(root, { now: () => NOW })
    expect(res.ok).toBe(true)
    expect(snapshot(join(root, '.orky'))).toEqual(before) // read-only, byte-identical

    const src = readFileSync(resolve(process.cwd(), 'src/main/orky/orky-root-detail.ts'), 'utf8')
    expect(src).not.toMatch(/chokidar|\.watch\(|watchFile|setInterval/)
    expect(src).not.toMatch(/\bwriteFile(Sync)?\b|\bappendFile(Sync)?\b|\bcreateWriteStream\b|\bunlink(Sync)?\b|\brm(Sync)?\s*\(/)
    // the read path registers no engine consumer either (REQ-008's no-new-consumer half)
    expect(src).not.toMatch(/addConsumer|OrkyRootEngine/)
  })
})
