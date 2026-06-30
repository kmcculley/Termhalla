// FROZEN integration suite — feature 0004-orky-status-awareness (phase 4).
// REVISED at the review LOOP-BACK: the tracker now (a) passes the active feature's `active.json.phase`
// through as the LIVE phase (REQ-023), (b) bounds the read path (readdir count cap + readFile size cap +
// symlink realpath guard — REQ-025), and (c) filters chokidar events to the `.json` targets and shares
// ONE watcher/read per resolved `.orky/` root (REQ-027). The constructor contract is unchanged.
//
//   new OrkyTracker(
//     emit: (paneId: string, status: OrkyPaneStatus | null) => void,
//     opts?: { now?: () => number; thresholdMs?: number; debounceMs?: number }
//   )
//   tracker.watch(paneId, cwd): Promise<void>   // findOrkyRoot(cwd); null → emits cleared null
//   tracker.unwatch(paneId): void               // emits cleared null, stops the watch
//   tracker.dispose(): void                     // closes ALL watchers + timers
//
// Runs RED against the prior pass for the gate-based / bounds / filter / dedup tests (the shipped tracker
// discards active.json.phase, caps nothing, filters nothing, and spins one watcher per pane).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import chokidar from 'chokidar'
import { OrkyTracker } from '../../src/main/orky/orky-tracker'

const NOW = 1_700_000_000_000

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (pred()) { clearInterval(i); resolve() }
      else if (Date.now() - t0 > ms) { clearInterval(i); reject(new Error('timeout')) }
    }, 25)
  })
}

// Gates passed for every AUTONOMOUS phase through doc-sync (the REAL "awaiting human-review" shape:
// state.json.phase stays 'doc-sync', the human-review gate is absent).
const AUTONOMOUS = ['brainstorm', 'spec', 'plan', 'tests', 'implement', 'review', 'doc-sync']
const awaitingHumanGates = (): Record<string, { passed: boolean }> =>
  Object.fromEntries(AUTONOMOUS.map(p => [p, { passed: true }]))

type FeatureSeed = { state?: unknown | string; findings?: unknown; symlinkTo?: string }
function seedOrky(opts: {
  activeSlug?: string | null
  activePhase?: string
  lastTickAt?: string
  features?: Record<string, FeatureSeed>
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-trk-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const orky = join(root, '.orky')
  mkdirSync(join(orky, 'features'), { recursive: true })
  if (opts.activeSlug) {
    writeFileSync(join(orky, 'active.json'), JSON.stringify({
      feature: `.orky/features/${opts.activeSlug}`, projectRoot: root, phase: opts.activePhase ?? 'implement',
      lastTickAt: opts.lastTickAt ?? new Date(NOW - 1_000).toISOString(), lastAction: 'x'
    }), 'utf8')
  }
  for (const [slug, f] of Object.entries(opts.features ?? {})) {
    const fdir = join(orky, 'features', slug)
    if (f.symlinkTo) { symlinkSync(f.symlinkTo, fdir, 'dir'); continue } // a symlink entry (REQ-025 guard)
    mkdirSync(fdir, { recursive: true })
    const state = typeof f.state === 'string' ? f.state
      : JSON.stringify(f.state ?? { feature: slug, phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] })
    writeFileSync(join(fdir, 'state.json'), state, 'utf8')
    if (f.findings !== undefined) {
      writeFileSync(join(fdir, 'findings.json'), typeof f.findings === 'string' ? f.findings : JSON.stringify(f.findings), 'utf8')
    }
  }
  return root
}

function snapshot(dir: string): Record<string, { content: string; mtimeMs: number }> {
  const out: Record<string, { content: string; mtimeMs: number }> = {}
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) Object.assign(out, snapshot(p))
    else out[p] = { content: readFileSync(p, 'utf8'), mtimeMs: st.mtimeMs }
  }
  return out
}

// Detect whether this host can create directory symlinks (Windows needs Developer Mode / admin).
function canSymlink(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'orky-symprobe-'))
  cleanups.push(() => rmSync(probe, { recursive: true, force: true }))
  try { symlinkSync(probe, join(probe, 'lnk'), 'dir'); return true } catch { return false }
}

describe('OrkyTracker (REQ-011 / REQ-012 / REQ-015 / REQ-017 / REQ-019 / REQ-023 / REQ-025 / REQ-027)', () => {
  it('TEST-026 REQ-011/REQ-019 emits a populated roll-up and safe-defaults a malformed feature, no throw', async () => {
    const root = seedOrky({
      activeSlug: 'demo',
      features: {
        demo: { state: { feature: 'demo', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] }, findings: [{ status: 'open', severity: 'HIGH' }] },
        broken: { state: '{ not valid json' }
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emits: Array<{ id: string; status: unknown }> = []
    const tracker = new OrkyTracker((id, status) => emits.push({ id, status }), { now: () => NOW, thresholdMs: 120_000, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    await tracker.watch('p1', root)
    await waitFor(() => emits.some(e => e.status != null))

    const st = emits.filter(e => e.status != null).at(-1)!.status as { features: Array<{ feature: string }>; chipFeature: string | null }
    expect(st.features.some(f => f.feature === 'demo')).toBe(true) // the good feature still reports
    expect(warn).toHaveBeenCalled()                                 // the malformed read is diagnosable, not silent
  })

  it('TEST-027 REQ-011 unwatch emits a cleared null and a superseded read does not re-populate (race-safe)', async () => {
    const root = seedOrky({ activeSlug: 'demo', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const emits: Array<{ id: string; status: unknown }> = []
    const tracker = new OrkyTracker((id, status) => emits.push({ id, status }), { now: () => NOW, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    const p = tracker.watch('p1', root)
    tracker.unwatch('p1')
    await p
    await waitFor(() => emits.some(e => e.id === 'p1' && e.status === null))

    const before = emits.filter(e => e.status != null).length
    writeFileSync(join(root, '.orky', 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    await new Promise(r => setTimeout(r, 200))
    expect(emits.filter(e => e.status != null).length).toBe(before)
    expect(emits.filter(e => e.id === 'p1').at(-1)!.status).toBeNull()
  })

  it('TEST-028 REQ-011 dispose() closes all watchers so later file changes emit nothing (no orphaned watcher)', async () => {
    const root = seedOrky({ activeSlug: 'demo', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const emits: Array<{ id: string; status: unknown }> = []
    const tracker = new OrkyTracker((id, status) => emits.push({ id, status }), { now: () => NOW, debounceMs: 20 })
    await tracker.watch('p1', root)
    await waitFor(() => emits.some(e => e.status != null))

    expect(() => tracker.dispose()).not.toThrow()
    const after = emits.length
    writeFileSync(join(root, '.orky', 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    await new Promise(r => setTimeout(r, 200))
    expect(emits.length).toBe(after)
  })

  it('TEST-029 REQ-017 a watch session leaves the .orky/ tree byte-identical (strictly read-only)', async () => {
    const root = seedOrky({
      activeSlug: 'demo',
      features: { demo: { state: { feature: 'demo', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] }, findings: [] } }
    })
    const orky = join(root, '.orky')
    const before = snapshot(orky)

    const emits: unknown[] = []
    const tracker = new OrkyTracker((_id, status) => emits.push(status), { now: () => NOW, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())
    await tracker.watch('p1', root)
    await waitFor(() => emits.some(s => s != null))
    tracker.dispose()

    expect(snapshot(orky)).toEqual(before)
  })

  it('TEST-030 REQ-015 the tracker source spawns no node/CLI per poll (file reads only)', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'main', 'orky', 'orky-tracker.ts'), 'utf8')
    expect(src).not.toMatch(/child_process/)
    expect(src).not.toMatch(/execFile/)
    expect(src).not.toMatch(/\bspawn\b/)
  })

  it('TEST-031 REQ-012 watching a cwd with no .orky ancestor emits a cleared null', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'orky-bare-'))
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }))
    const emits: Array<{ id: string; status: unknown }> = []
    const tracker = new OrkyTracker((id, status) => emits.push({ id, status }), { now: () => NOW, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    await tracker.watch('p2', bare)
    await waitFor(() => emits.some(e => e.id === 'p2'))
    expect(emits.filter(e => e.id === 'p2').every(e => e.status === null)).toBe(true)
  })

  // ── REQ-023: the tracker passes active.json.phase through as the LIVE phase ──────────────────────
  it('TEST-053 REQ-023 the active feature reports active.json.phase as its live phase even when state.json.phase lags', async () => {
    // state.json.phase lags at 'implement' (implement gate passed); active.json.phase is 'review'. The
    // tracker MUST pass active.phase through so the active feature reports busy in 'review' — the prior
    // tracker discarded active.phase and reported the lagging 'implement' as idle (FINDING-DA-002).
    const root = seedOrky({
      activeSlug: 'demo', activePhase: 'review', lastTickAt: new Date(NOW - 1_000).toISOString(),
      features: { demo: { state: { feature: 'demo', phase: 'implement', gates: { brainstorm: { passed: true }, spec: { passed: true }, plan: { passed: true }, tests: { passed: true }, implement: { passed: true } }, escalations: [] } } }
    })
    const emits: Array<{ id: string; status: unknown }> = []
    const tracker = new OrkyTracker((id, status) => emits.push({ id, status }), { now: () => NOW, thresholdMs: 120_000, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    await tracker.watch('p1', root)
    await waitFor(() => emits.some(e => e.status != null))
    const st = emits.filter(e => e.status != null).at(-1)!.status as { features: Array<{ feature: string; phase: string; kind: string }> }
    const demo = st.features.find(f => f.feature === 'demo')
    expect(demo).toBeTruthy()
    expect(demo!.phase).toBe('review') // the LIVE phase from active.json, not the lagging 'implement'
    expect(demo!.kind).toBe('busy')    // actively running in review
  })

  // ── REQ-025: read-path resource bounds ──────────────────────────────────────────────────────────
  it('TEST-045 REQ-025 caps the number of feature directories processed per re-read (stated 200) + warns', async () => {
    const features: Record<string, FeatureSeed> = {}
    for (let i = 0; i < 205; i++) {
      const slug = `f${String(i).padStart(3, '0')}`
      features[slug] = { state: { feature: slug, phase: 'doc-sync', gates: awaitingHumanGates(), escalations: [] } }
    }
    const root = seedOrky({ features }) // no active feature; all are non-active awaiting-human (needs-input)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emits: unknown[] = []
    const tracker = new OrkyTracker((_id, status) => emits.push(status), { now: () => NOW, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    await tracker.watch('p1', root)
    await waitFor(() => emits.some(s => s != null))
    const st = emits.filter(s => s != null).at(-1)! as { features: Array<{ feature: string }> }
    expect(st.features.length).toBe(200)   // capped at the stated limit, NOT all 205
    expect(warn).toHaveBeenCalled()         // the cap is a STATED limit with a warning (CONV-003), no silent capping
  })

  it('TEST-046 REQ-025 skips + warns an oversized state.json (> the size cap), the feature safe-defaults, others still report', async () => {
    const pad = 'x'.repeat(1024 * 1024 + 4096) // > 1 MiB, but VALID JSON so it is the SIZE cap (not a parse error) that skips it
    const root = seedOrky({
      features: {
        big: { state: { feature: 'big', phase: 'doc-sync', gates: awaitingHumanGates(), escalations: [], pad } },
        small: { state: { feature: 'small', phase: 'doc-sync', gates: awaitingHumanGates(), escalations: [] } }
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emits: unknown[] = []
    const tracker = new OrkyTracker((_id, status) => emits.push(status), { now: () => NOW, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    await tracker.watch('p1', root)
    await waitFor(() => emits.some(s => s != null))
    const st = emits.filter(s => s != null).at(-1)! as { features: Array<{ feature: string; needsHuman: boolean }> }
    expect(st.features.some(f => f.feature === 'small' && f.needsHuman)).toBe(true) // the small feature still reports
    expect(st.features.some(f => f.feature === 'big')).toBe(false)                  // the oversized feature is skipped
    expect(warn).toHaveBeenCalled()
  })

  it('TEST-047 REQ-025 a features/<slug> symlink pointing OUTSIDE the .orky root is skipped (not read)', async () => {
    if (!canSymlink()) { expect(true).toBe(true); return } // host cannot create symlinks (no Developer Mode) → environment-gated
    const outside = mkdtempSync(join(tmpdir(), 'orky-outside-'))
    cleanups.push(() => rmSync(outside, { recursive: true, force: true }))
    // The outside target carries an in-flight phase (under the OLD tracker a non-active in-flight feature
    // read 'busy' and would surface; the corrected tracker realpath-guards it OUT of the root entirely).
    writeFileSync(join(outside, 'state.json'), JSON.stringify({ feature: 'evil', phase: 'implement', gates: {}, escalations: [] }), 'utf8')
    const root = seedOrky({
      activeSlug: 'good', activePhase: 'implement',
      features: {
        good: { state: { feature: 'good', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] } },
        evil: { symlinkTo: outside }
      }
    })
    const emits: unknown[] = []
    const tracker = new OrkyTracker((_id, status) => emits.push(status), { now: () => NOW, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    await tracker.watch('p1', root)
    await waitFor(() => emits.some(s => s != null))
    const st = emits.filter(s => s != null).at(-1)! as { features: Array<{ feature: string }> }
    expect(st.features.some(f => f.feature === 'evil')).toBe(false) // the symlinked-out feature never surfaces
  })

  // ── REQ-027: event filter + per-root de-duplication ─────────────────────────────────────────────
  it('TEST-048 REQ-027 a change to a non-target (.md) file does NOT trigger a re-read; a .json change does', async () => {
    const root = seedOrky({ activeSlug: 'demo', activePhase: 'implement', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const emits: unknown[] = []
    const tracker = new OrkyTracker((_id, status) => emits.push(status), { now: () => NOW, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    await tracker.watch('p1', root)
    await waitFor(() => emits.some(s => s != null))
    const afterInitial = emits.length

    // a routine markdown edit under features/<slug>/ must NOT fire a roll-up re-read (mirrors UsageTracker's .jsonl guard)
    writeFileSync(join(root, '.orky', 'features', 'demo', '02-spec.md'), '# spec edit\n', 'utf8')
    await new Promise(r => setTimeout(r, 500))
    expect(emits.length).toBe(afterInitial) // no emit from the .md change

    // a change to a TARGET .json file DOES fire a re-read/emit
    writeFileSync(join(root, '.orky', 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: { implement: { passed: true } }, escalations: [] }), 'utf8')
    await waitFor(() => emits.length > afterInitial)
    expect(emits.length).toBeGreaterThan(afterInitial)
  })

  it('TEST-049 REQ-027 two panes resolving to the same .orky root share ONE chokidar watcher, yet both still receive their emit', async () => {
    const root = seedOrky({ activeSlug: 'demo', activePhase: 'implement', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const watchSpy = vi.spyOn(chokidar, 'watch')
    const emits: Array<{ id: string; status: unknown }> = []
    const tracker = new OrkyTracker((id, status) => emits.push({ id, status }), { now: () => NOW, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())

    await tracker.watch('p1', root)
    await tracker.watch('p2', root) // a different cwd in the SAME project resolves to the same root
    await waitFor(() => emits.some(e => e.id === 'p1' && e.status != null) && emits.some(e => e.id === 'p2' && e.status != null))

    expect(watchSpy).toHaveBeenCalledTimes(1) // ONE watcher per resolved root, not one per pane (FINDING-PERF-002)
    expect(emits.some(e => e.id === 'p1' && e.status != null)).toBe(true)
    expect(emits.some(e => e.id === 'p2' && e.status != null)).toBe(true) // per-pane emit granularity preserved
  })
})
