// FROZEN integration suite — feature 0005-cross-project-orky-registry (phase 4 / TASK-005, REQ-001 /
// REQ-005 / REQ-014 / REQ-015 / REQ-017 / REQ-018 / REQ-019).
//
// Targets `src/main/orky/orky-root-engine.ts` — the SHARED per-root watch/read engine EXTRACTED from
// 0004's `OrkyTracker` (see tests/main/orky-tracker.test.ts for the sibling/predecessor fixtures this
// suite deliberately mirrors — risk note #1 in 03-plan.md: "write/port the engine's tests against the
// EXACT same fixtures 0004 already uses for OrkyTracker, asserting identical output before/after").
// Generalizes "consumer = a single pane" to "consumer = an opaque string id" (`pane:<id>` /
// `persisted:<root>`), so a root watched by N panes AND the persisted list still gets exactly ONE
// chokidar watcher + ONE debounced re-read (REQ-014) — this is the highest-risk task in the plan.
//
// Chosen contract (the plan's TASK-005 prose is authoritative on behavior; this suite freezes the exact
// shape — the implementer MUST match it). The engine is SHARED by TWO independent consumers (the
// pane-facing `OrkyTracker` facade AND the cross-project `OrkyRegistry`), constructed ONCE by the
// composition root — so status delivery is a multi-subscriber `onStatus(cb): unsubscribe` pattern
// (mirroring the codebase's pervasive `onXxx(cb) => () => void` convention, e.g. `WindowManager.
// onWindowClose`), NOT a single constructor-bound callback (which could serve only one consumer):
//
//   new OrkyRootEngine(opts?: { now?: () => number; thresholdMs?: number; debounceMs?: number })
//   engine.onStatus(cb: (orkyDir: string, status: OrkyPaneStatus | null) => void): () => void
//   engine.addConsumer(consumerId: string, orkyDir: string): Promise<void>   // idempotent
//   engine.removeConsumer(consumerId: string): void                          // silent no-op if unknown
//   engine.getConsumers(orkyDir: string): ReadonlySet<string>
//   engine.dispose(): void                                                   // closes ALL watchers+timers
//
// A root whose `orkyDir` does not exist on disk AT ALL (never created, or deleted after a persisted root
// was added — REQ-018's "a persisted root whose .orky/ has been deleted on disk" acceptance) surfaces
// `status: null` via `onStatus`, distinguishing "unreadable root" from a present-but-empty `.orky/` tree
// (which computes a valid, if empty, roll-up — REQ-006).
//
// Runs RED today: `src/main/orky/orky-root-engine.ts` does not exist yet (module-not-found).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import chokidar from 'chokidar'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'
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

/** Build an engine + subscribe a single collector — the common case most tests need. */
function engineWithCollector(opts: { now?: () => number; thresholdMs?: number; debounceMs?: number } = {}): { engine: OrkyRootEngine; statuses: unknown[] } {
  const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20, ...opts })
  const statuses: unknown[] = []
  engine.onStatus((_orkyDir, status) => statuses.push(status))
  return { engine, statuses }
}

/** Build an engine + subscribe a collector keyed by orkyDir — for multi-root assertions. */
function engineWithKeyedCollector(opts: { now?: () => number; thresholdMs?: number; debounceMs?: number } = {}): { engine: OrkyRootEngine; statuses: Map<string, unknown[]> } {
  const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20, ...opts })
  const statuses = new Map<string, unknown[]>()
  engine.onStatus((orkyDir, status) => {
    if (!statuses.has(orkyDir)) statuses.set(orkyDir, [])
    statuses.get(orkyDir)!.push(status)
  })
  return { engine, statuses }
}

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
  const root = mkdtempSync(join(tmpdir(), 'orky-eng-'))
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
    if (f.symlinkTo) { symlinkSync(f.symlinkTo, fdir, 'dir'); continue }
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

function canSymlink(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'orky-eng-symprobe-'))
  cleanups.push(() => rmSync(probe, { recursive: true, force: true }))
  try { symlinkSync(probe, join(probe, 'lnk'), 'dir'); return true } catch { return false }
}

describe('OrkyRootEngine — basic roll-up + safe-defaulting (REQ-001/REQ-005)', () => {
  it('TEST-088 REQ-001/REQ-005 addConsumer populates a roll-up via onStatus and safe-defaults a malformed feature, no throw', async () => {
    const root = seedOrky({
      activeSlug: 'demo',
      features: {
        demo: { state: { feature: 'demo', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] }, findings: [{ status: 'open', severity: 'HIGH' }] },
        broken: { state: '{ not valid json' }
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { engine, statuses } = engineWithCollector({ thresholdMs: 120_000 })
    cleanups.push(() => engine.dispose())

    await engine.addConsumer('pane:p1', join(root, '.orky'))
    await waitFor(() => statuses.some(s => s != null))

    const st = statuses.filter(s => s != null).at(-1)! as { features: Array<{ feature: string }> }
    expect(st.features.some(f => f.feature === 'demo')).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('TEST-089 REQ-001/REQ-005 the engine\'s per-root status deep-equals what 0004\'s OrkyTracker emits for the SAME root (reuse, not a fork)', async () => {
    const root = seedOrky({
      activeSlug: 'auth',
      activePhase: 'review',
      features: { auth: { state: { feature: 'auth', phase: 'implement', gates: { brainstorm: { passed: true }, spec: { passed: true } }, escalations: [] } } }
    })

    const { engine, statuses: engineStatuses } = engineWithCollector({ thresholdMs: 120_000 })
    cleanups.push(() => engine.dispose())
    await engine.addConsumer('persisted:' + root, join(root, '.orky'))
    await waitFor(() => engineStatuses.some(s => s != null))

    const trackerStatuses: unknown[] = []
    const tracker = new OrkyTracker((_id, status) => trackerStatuses.push(status), { now: () => NOW, thresholdMs: 120_000, debounceMs: 20 })
    cleanups.push(() => tracker.dispose())
    await tracker.watch('p1', root)
    await waitFor(() => trackerStatuses.some(s => s != null))

    expect(engineStatuses.filter(s => s != null).at(-1)).toEqual(trackerStatuses.filter(s => s != null).at(-1))
  })

  it('TEST-090 REQ-005 the engine source imports (not duplicates) the shared @shared/orky-status mappers', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'main', 'orky', 'orky-root-engine.ts'), 'utf8')
    expect(src).toMatch(/from ['"]@shared\/orky-status['"]/)
    for (const fn of ['normalizeFeatureRaw', 'normalizeFindings', 'orkyFeatureStatus', 'orkyPaneStatus']) {
      expect(src).not.toMatch(new RegExp(`function ${fn}\\(|const ${fn}\\s*=`))
    }
  })

  it('TEST-091b REQ-001 onStatus supports MULTIPLE independent subscribers (the engine is shared by OrkyTracker AND OrkyRegistry) — each receives every emit', async () => {
    const root = seedOrky({ activeSlug: 'demo', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
    cleanups.push(() => engine.dispose())
    const a: unknown[] = []
    const b: unknown[] = []
    const unsubA = engine.onStatus((_d, s) => a.push(s))
    engine.onStatus((_d, s) => b.push(s))
    await engine.addConsumer('pane:p1', join(root, '.orky'))
    await waitFor(() => a.some(s => s != null) && b.some(s => s != null))
    expect(a.filter(s => s != null).at(-1)).toEqual(b.filter(s => s != null).at(-1))

    unsubA()
    const beforeA = a.length
    const beforeB = b.length
    writeFileSync(join(root, '.orky', 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    await waitFor(() => b.length > beforeB) // B is still subscribed -> the change still reaches it
    expect(a.length).toBe(beforeA)          // unsubscribed -> no further deliveries to A
  })
})

describe('OrkyRootEngine — teardown + race-safety + leak-free dispose (REQ-019)', () => {
  it('TEST-091 REQ-019 removing the LAST consumer of a root tears the watcher down; later file changes emit nothing further for it', async () => {
    const root = seedOrky({ activeSlug: 'demo', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())
    const orkyDir = join(root, '.orky')

    await engine.addConsumer('pane:p1', orkyDir)
    await waitFor(() => statuses.some(s => s != null))
    engine.removeConsumer('pane:p1')
    expect(engine.getConsumers(orkyDir).size).toBe(0)

    const before = statuses.length
    writeFileSync(join(orkyDir, 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    await new Promise(r => setTimeout(r, 200))
    expect(statuses.length).toBe(before)
  })

  it('TEST-092 REQ-019 addConsumer immediately followed by removeConsumer for the SAME consumer (before discovery completes) leaves no orphaned watcher or membership', async () => {
    const root = seedOrky({ activeSlug: 'demo', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const watchSpy = vi.spyOn(chokidar, 'watch')
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())
    const orkyDir = join(root, '.orky')

    const p = engine.addConsumer('pane:p1', orkyDir)
    engine.removeConsumer('pane:p1') // supersedes mid-discovery (session-identity race pattern)
    await p

    expect(engine.getConsumers(orkyDir).size).toBe(0)
    writeFileSync(join(orkyDir, 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    const before = statuses.length
    await new Promise(r => setTimeout(r, 200))
    expect(statuses.length).toBe(before)
    void watchSpy
  })

  it('TEST-093 REQ-019 dispose() closes ALL watchers + clears ALL timers; no onStatus fires for ANY root after dispose', async () => {
    const rootA = seedOrky({ activeSlug: 'a', features: { a: { state: { feature: 'a', phase: 'implement', gates: {}, escalations: [] } } } })
    const rootB = seedOrky({ activeSlug: 'b', features: { b: { state: { feature: 'b', phase: 'implement', gates: {}, escalations: [] } } } })
    const { engine, statuses } = engineWithCollector()
    await engine.addConsumer('pane:p1', join(rootA, '.orky'))
    await engine.addConsumer('persisted:' + rootB, join(rootB, '.orky'))
    await waitFor(() => statuses.length >= 2)

    expect(() => engine.dispose()).not.toThrow()
    const after = statuses.length
    writeFileSync(join(rootA, '.orky', 'features', 'a', 'state.json'), JSON.stringify({ feature: 'a', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    writeFileSync(join(rootB, '.orky', 'features', 'b', 'state.json'), JSON.stringify({ feature: 'b', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    await new Promise(r => setTimeout(r, 200))
    expect(statuses.length).toBe(after)
  })

  it('TEST-094 REQ-019 removeConsumer of a NEVER-added consumerId is a silent no-op (no throw, no spurious onStatus)', () => {
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())
    expect(() => engine.removeConsumer('pane:never-added')).not.toThrow()
    expect(statuses.length).toBe(0)
  })
})

describe('OrkyRootEngine — strictly read-only (REQ-017)', () => {
  it('TEST-095 REQ-017 a tracking session leaves the .orky/ tree byte-identical (content + mtime)', async () => {
    const root = seedOrky({
      activeSlug: 'demo',
      features: { demo: { state: { feature: 'demo', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] }, findings: [] } }
    })
    const orky = join(root, '.orky')
    const before = snapshot(orky)

    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())
    await engine.addConsumer('pane:p1', orky)
    await waitFor(() => statuses.some(s => s != null))
    engine.dispose()

    expect(snapshot(orky)).toEqual(before)
  })

  it('TEST-096 REQ-017 the engine source spawns no node/CLI per re-read (file reads only)', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'main', 'orky', 'orky-root-engine.ts'), 'utf8')
    expect(src).not.toMatch(/child_process/)
    expect(src).not.toMatch(/execFile/)
    expect(src).not.toMatch(/\bspawn\b/)
  })
})

describe('OrkyRootEngine — ONE shared watcher/re-read per root across ALL consumers (REQ-014, performance)', () => {
  it('TEST-097 REQ-014 a single consumer on a single root yields exactly ONE chokidar watcher (no regression vs. 0004)', async () => {
    const root = seedOrky({ activeSlug: 'demo', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const watchSpy = vi.spyOn(chokidar, 'watch')
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())
    await engine.addConsumer('pane:p1', join(root, '.orky'))
    await waitFor(() => statuses.some(s => s != null))
    expect(watchSpy).toHaveBeenCalledTimes(1)
  })

  it('TEST-098 REQ-014 N consumers (2 pane-namespaced + 1 persisted-namespaced) on the SAME root share exactly ONE watcher; getConsumers reflects all 3', async () => {
    const root = seedOrky({ activeSlug: 'demo', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const orkyDir = join(root, '.orky')
    const watchSpy = vi.spyOn(chokidar, 'watch')
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())

    await engine.addConsumer('pane:p1', orkyDir)
    await engine.addConsumer('pane:p2', orkyDir)
    await engine.addConsumer('persisted:' + root, orkyDir)
    await waitFor(() => statuses.some(s => s != null))

    expect(watchSpy).toHaveBeenCalledTimes(1) // ONE watcher shared across pane-chip AND registry consumers
    expect(engine.getConsumers(orkyDir)).toEqual(new Set(['pane:p1', 'pane:p2', 'persisted:' + root]))
  })

  it('TEST-099 REQ-014 the watcher is torn down ONLY when the root has ZERO consumers — removing 1 of 3 keeps it alive', async () => {
    const root = seedOrky({ activeSlug: 'demo', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const orkyDir = join(root, '.orky')
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())

    await engine.addConsumer('pane:p1', orkyDir)
    await engine.addConsumer('pane:p2', orkyDir)
    await engine.addConsumer('persisted:' + root, orkyDir)
    await waitFor(() => statuses.some(s => s != null))

    engine.removeConsumer('pane:p1') // 2 consumers remain (pane:p2, persisted:*)
    expect(engine.getConsumers(orkyDir).size).toBe(2)

    const before = statuses.length
    writeFileSync(join(orkyDir, 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    await waitFor(() => statuses.length > before) // watcher still alive -> the change still triggers a re-read

    engine.removeConsumer('pane:p2')
    engine.removeConsumer('persisted:' + root) // now zero consumers -> watcher torn down
    expect(engine.getConsumers(orkyDir).size).toBe(0)
    const beforeTeardown = statuses.length
    writeFileSync(join(orkyDir, 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'doc-sync', gates: {}, escalations: [] }), 'utf8')
    await new Promise(r => setTimeout(r, 200))
    expect(statuses.length).toBe(beforeTeardown)
  })

  it('TEST-100 REQ-014 a change to a non-target (.md) file does NOT trigger a re-read; a .json change does', async () => {
    const root = seedOrky({ activeSlug: 'demo', activePhase: 'implement', features: { demo: { state: { feature: 'demo', phase: 'implement', gates: {}, escalations: [] } } } })
    const orkyDir = join(root, '.orky')
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())
    await engine.addConsumer('pane:p1', orkyDir)
    await waitFor(() => statuses.some(s => s != null))
    const afterInitial = statuses.length

    writeFileSync(join(orkyDir, 'features', 'demo', '02-spec.md'), '# spec edit\n', 'utf8')
    await new Promise(r => setTimeout(r, 500))
    expect(statuses.length).toBe(afterInitial)

    writeFileSync(join(orkyDir, 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: { implement: { passed: true } }, escalations: [] }), 'utf8')
    await waitFor(() => statuses.length > afterInitial)
    expect(statuses.length).toBeGreaterThan(afterInitial)
  })
})

describe('OrkyRootEngine — read-path bounds + symlink safety apply to EVERY root, not just the first (REQ-015, security)', () => {
  it('TEST-101 REQ-015 caps feature dirs at the stated 200 + warns, on a SECOND (non-first) tracked root', async () => {
    const firstRoot = seedOrky({ activeSlug: 'solo', features: { solo: { state: { feature: 'solo', phase: 'implement', gates: {}, escalations: [] } } } })
    const features: Record<string, FeatureSeed> = {}
    for (let i = 0; i < 205; i++) {
      const slug = `f${String(i).padStart(3, '0')}`
      features[slug] = { state: { feature: slug, phase: 'doc-sync', gates: awaitingHumanGates(), escalations: [] } }
    }
    const secondRoot = seedOrky({ features })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { engine, statuses } = engineWithKeyedCollector()
    cleanups.push(() => engine.dispose())

    await engine.addConsumer('persisted:' + firstRoot, join(firstRoot, '.orky')) // tracked FIRST
    await engine.addConsumer('persisted:' + secondRoot, join(secondRoot, '.orky')) // tracked SECOND — the bound must STILL apply
    await waitFor(() => (statuses.get(join(secondRoot, '.orky')) ?? []).some(s => s != null))

    const st = statuses.get(join(secondRoot, '.orky'))!.filter(s => s != null).at(-1)! as { features: Array<{ feature: string }> }
    expect(st.features.length).toBe(200)
    expect(warn).toHaveBeenCalled()
    // the FIRST root still reports correctly too — one bad/heavy root never breaks another.
    await waitFor(() => (statuses.get(join(firstRoot, '.orky')) ?? []).some(s => s != null))
    const firstSt = statuses.get(join(firstRoot, '.orky'))!.filter(s => s != null).at(-1)! as { features: Array<{ feature: string }> }
    expect(firstSt.features.some(f => f.feature === 'solo')).toBe(true)
  })

  it('TEST-102 REQ-015 skips + warns an oversized state.json (>1 MiB) on a non-first root; the feature safe-defaults, others still report', async () => {
    const firstRoot = seedOrky({ activeSlug: 'solo', features: { solo: { state: { feature: 'solo', phase: 'implement', gates: {}, escalations: [] } } } })
    const pad = 'x'.repeat(1024 * 1024 + 4096)
    const secondRoot = seedOrky({
      features: {
        big: { state: { feature: 'big', phase: 'doc-sync', gates: awaitingHumanGates(), escalations: [], pad } },
        small: { state: { feature: 'small', phase: 'doc-sync', gates: awaitingHumanGates(), escalations: [] } }
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { engine, statuses } = engineWithKeyedCollector()
    cleanups.push(() => engine.dispose())

    await engine.addConsumer('persisted:' + firstRoot, join(firstRoot, '.orky'))
    await engine.addConsumer('persisted:' + secondRoot, join(secondRoot, '.orky'))
    await waitFor(() => (statuses.get(join(secondRoot, '.orky')) ?? []).some(s => s != null))

    const st = statuses.get(join(secondRoot, '.orky'))!.filter(s => s != null).at(-1)! as { features: Array<{ feature: string; needsHuman: boolean }> }
    expect(st.features.some(f => f.feature === 'small' && f.needsHuman)).toBe(true)
    expect(st.features.some(f => f.feature === 'big')).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('TEST-103 REQ-015 a features/<slug> symlink pointing OUTSIDE the .orky root is skipped on a non-first root (not read)', async () => {
    if (!canSymlink()) { expect(true).toBe(true); return } // host cannot create symlinks (no Developer Mode)
    const firstRoot = seedOrky({ activeSlug: 'solo', features: { solo: { state: { feature: 'solo', phase: 'implement', gates: {}, escalations: [] } } } })
    const outside = mkdtempSync(join(tmpdir(), 'orky-eng-outside-'))
    cleanups.push(() => rmSync(outside, { recursive: true, force: true }))
    writeFileSync(join(outside, 'state.json'), JSON.stringify({ feature: 'evil', phase: 'implement', gates: {}, escalations: [] }), 'utf8')
    const secondRoot = seedOrky({
      activeSlug: 'good', activePhase: 'implement',
      features: {
        good: { state: { feature: 'good', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] } },
        evil: { symlinkTo: outside }
      }
    })
    const { engine, statuses } = engineWithKeyedCollector()
    cleanups.push(() => engine.dispose())

    await engine.addConsumer('persisted:' + firstRoot, join(firstRoot, '.orky'))
    await engine.addConsumer('persisted:' + secondRoot, join(secondRoot, '.orky'))
    await waitFor(() => (statuses.get(join(secondRoot, '.orky')) ?? []).some(s => s != null))

    const st = statuses.get(join(secondRoot, '.orky'))!.filter(s => s != null).at(-1)! as { features: Array<{ feature: string }> }
    expect(st.features.some(f => f.feature === 'evil')).toBe(false)
  })
})

describe('OrkyRootEngine — robust to missing/partial/malformed per-root state (REQ-018)', () => {
  it('TEST-104 REQ-018 one root with malformed state.json never breaks another, independently-tracked root', async () => {
    const goodRoot = seedOrky({ activeSlug: 'ok', features: { ok: { state: { feature: 'ok', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] } } } })
    const badRoot = seedOrky({ features: { broken: { state: '{ not valid json at all' } } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { engine, statuses } = engineWithKeyedCollector()
    cleanups.push(() => engine.dispose())

    await engine.addConsumer('persisted:' + goodRoot, join(goodRoot, '.orky'))
    await engine.addConsumer('persisted:' + badRoot, join(badRoot, '.orky'))
    await waitFor(() => (statuses.get(join(goodRoot, '.orky')) ?? []).some(s => s != null))
    await waitFor(() => (statuses.get(join(badRoot, '.orky')) ?? []).length > 0)

    const goodSt = statuses.get(join(goodRoot, '.orky'))!.filter(s => s != null).at(-1)! as { features: Array<{ feature: string }> }
    expect(goodSt.features.some(f => f.feature === 'ok')).toBe(true) // unaffected by the OTHER root's malformed file
    expect(() => engine.dispose()).not.toThrow()
    void warn
  })

  it('TEST-105 REQ-018/REQ-006 a root whose orkyDir does NOT exist on disk at all surfaces status:null (not an empty-but-valid roll-up) — the persisted-root-deleted scenario', async () => {
    const ghostOrkyDir = join(tmpdir(), 'orky-eng-ghost-' + Date.now(), '.orky')
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())

    await engine.addConsumer('persisted:ghost', ghostOrkyDir)
    await waitFor(() => statuses.length > 0)
    expect(statuses.at(-1)).toBeNull() // unreadable root -> null, never thrown, never silently dropped
  })

  it('TEST-106 REQ-018 an empty/missing active.json and a feature missing findings.json are tolerated without throwing', async () => {
    const root = seedOrky({ features: { lonely: { state: { feature: 'lonely', phase: 'plan', gates: { brainstorm: { passed: true } }, escalations: [] } } } }) // no active.json
    const { engine, statuses } = engineWithCollector()
    cleanups.push(() => engine.dispose())
    await expect(engine.addConsumer('persisted:' + root, join(root, '.orky'))).resolves.not.toThrow()
    await waitFor(() => statuses.some(s => s != null))
    const st = statuses.filter(s => s != null).at(-1)! as { kind: string; features: Array<{ feature: string }> }
    // 'lonely' has only gates.brainstorm passed (no active.json) -- genuinely idle per the
    // verbatim-reused mapper (REQ-005), and orkyPaneStatus deliberately excludes idle features from
    // .features (tests/shared/orky-status.test.ts TEST-018). Assert the read SUCCEEDED (non-null
    // status, no throw) and produced the correct idle/empty roll-up, not popover inclusion.
    expect(st.kind).toBe('idle')
    expect(st.features.length).toBe(0)
  })
})
