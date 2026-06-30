// FROZEN integration suite — feature 0004-orky-status-awareness (phase 4 / REQ-011/012/015/017/019).
// The main-process OrkyTracker is a structural clone of UsageTracker: a single bounded debounced
// chokidar watch on `<root>/.orky/`, race-safe (slot-claim-before-await + re-check-after-await),
// disposable (closes all watchers + timers — must not keep the process alive), READ-ONLY (zero writes
// under .orky/), file-reads only (no `child_process`/`node` per poll), and total over malformed JSON.
//
// Chosen constructor contract (see 04-tests.md):
//   new OrkyTracker(
//     emit: (paneId: string, status: OrkyPaneStatus | null) => void,
//     opts?: { now?: () => number; thresholdMs?: number; debounceMs?: number }
//   )
//   tracker.watch(paneId, cwd): Promise<void>   // findOrkyRoot(cwd); null → emits cleared null
//   tracker.unwatch(paneId): void               // emits cleared null, stops the watch
//   tracker.dispose(): void                     // closes ALL watchers + timers
//
// Runs RED today: `src/main/orky/orky-tracker` does not exist — the file errors on import.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

type FeatureSeed = { state?: unknown | string; findings?: unknown }
function seedOrky(opts: { activeSlug?: string | null; lastTickAt?: string; features?: Record<string, FeatureSeed> } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-trk-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const orky = join(root, '.orky')
  mkdirSync(orky, { recursive: true })
  if (opts.activeSlug) {
    writeFileSync(join(orky, 'active.json'), JSON.stringify({
      feature: `.orky/features/${opts.activeSlug}`, projectRoot: root, phase: 'implement',
      lastTickAt: opts.lastTickAt ?? new Date(NOW - 1_000).toISOString(), lastAction: 'x'
    }), 'utf8')
  }
  for (const [slug, f] of Object.entries(opts.features ?? {})) {
    const fdir = join(orky, 'features', slug)
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

// Recursively snapshot path -> { content, mtimeMs } for the whole .orky tree (read-only invariant).
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

describe('OrkyTracker (REQ-011 / REQ-012 / REQ-015 / REQ-017 / REQ-019)', () => {
  it('TEST-026 REQ-011/REQ-019 emits a populated roll-up and safe-defaults a malformed feature, no throw', async () => {
    const root = seedOrky({
      activeSlug: 'demo',
      features: {
        demo: { state: { feature: 'demo', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] }, findings: [{ status: 'open', severity: 'HIGH' }] },
        broken: { state: '{ not valid json' } // a malformed feature must be skipped/safe, not crash the watch
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

    // watch then immediately unwatch the SAME paneId — the unwatch must supersede any pending read.
    const p = tracker.watch('p1', root)
    tracker.unwatch('p1')
    await p
    await waitFor(() => emits.some(e => e.id === 'p1' && e.status === null))

    // a later file change must NOT resurrect a populated status for the unwatched pane
    const before = emits.filter(e => e.status != null).length
    writeFileSync(join(root, '.orky', 'features', 'demo', 'state.json'), JSON.stringify({ feature: 'demo', phase: 'review', gates: {}, escalations: [] }), 'utf8')
    await new Promise(r => setTimeout(r, 200))
    expect(emits.filter(e => e.status != null).length).toBe(before)
    expect(emits.filter(e => e.id === 'p1').at(-1)!.status).toBeNull() // last state for the pane is cleared
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
    expect(emits.length).toBe(after) // disposed tracker is inert; no lingering watcher fires
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

    expect(snapshot(orky)).toEqual(before) // no content or mtime changes attributable to the tracker
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
    expect(emits.filter(e => e.id === 'p2').every(e => e.status === null)).toBe(true) // never a populated status
  })
})
