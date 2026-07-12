// Config-sourced stall threshold (0004 FINDING-PROV-002 close, 2026-07-12) — the 120s
// STALL_THRESHOLD_MS UI heuristic is dropped in favor of Orky's canonical liveness resolution
// (Orky v0.44.0, `gatekeeper contract` `watchdog` block): per-root `.orky/config.json`
// `watchdog.idle_threshold_seconds` when a finite positive number, else the canonical default
// 3600 s. A caller-injected `thresholdMs` (the engine/tracker opt) still wins — mirroring
// `liveness`'s caller → config → default `thresholdSource` order — so every existing suite that
// injects a threshold is untouched. This suite pins:
//   1. the pure resolver `resolveStallThresholdMs` (total, exact Number-coercion parity with
//      gatekeeper's `Number(cfg.watchdog.idle_threshold_seconds)` + finite-positive guard),
//   2. the canonical default constant (3_600_000 ms = the contract's `watchdog.default_seconds`),
//   3. the engine's per-root resolution (no config → default; config → config; opts → opts),
//      including a live `config.json` edit re-firing the watcher (it is now a target file),
//   4. the one-shot detail path (`assembleOrkyRootDetail`) applying the SAME resolution.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STALL_THRESHOLD_MS, resolveStallThresholdMs } from '@shared/orky-status'
import type { OrkyPaneStatus } from '@shared/types'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'
import { assembleOrkyRootDetail } from '../../src/main/orky/orky-root-detail'

const NOW = 1_700_000_000_000

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (pred()) { clearInterval(i); resolve() }
      else if (Date.now() - t0 > ms) { clearInterval(i); reject(new Error('timeout')) }
    }, 25)
  })
}

/** Seed a project with one ACTIVE, EXECUTING feature whose heartbeat is `idleMs` old — the exact
 *  shape whose stall verdict the threshold governs (implement phase live, implement gate unrecorded).
 *  Returns the project root; `.orky/config.json` is written only when `config` is given. */
function seedExecuting(idleMs: number, config?: unknown): { root: string; orkyDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'orky-stall-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const orkyDir = join(root, '.orky')
  const fdir = join(orkyDir, 'features', 'auth')
  mkdirSync(fdir, { recursive: true })
  writeFileSync(join(orkyDir, 'active.json'), JSON.stringify({
    feature: '.orky/features/auth', projectRoot: root, phase: 'implement',
    lastTickAt: new Date(NOW - idleMs).toISOString(), lastAction: 'x'
  }), 'utf8')
  writeFileSync(join(fdir, 'state.json'), JSON.stringify({
    feature: 'auth', phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: []
  }), 'utf8')
  if (config !== undefined) {
    writeFileSync(join(orkyDir, 'config.json'), JSON.stringify(config), 'utf8')
  }
  return { root, orkyDir }
}

function lastStatus(statuses: unknown[]): OrkyPaneStatus {
  const s = statuses[statuses.length - 1] as OrkyPaneStatus | null
  expect(s).not.toBeNull()
  return s as OrkyPaneStatus
}

describe('resolveStallThresholdMs — the liveness config → default resolution (FINDING-PROV-002)', () => {
  it('a finite positive watchdog.idle_threshold_seconds resolves to seconds * 1000', () => {
    expect(resolveStallThresholdMs({ watchdog: { idle_threshold_seconds: 300 } })).toBe(300_000)
    expect(resolveStallThresholdMs({ watchdog: { idle_threshold_seconds: 1 } })).toBe(1_000)
    // Number-coercion parity with gatekeeper's `Number(cfg.watchdog.idle_threshold_seconds)`.
    expect(resolveStallThresholdMs({ watchdog: { idle_threshold_seconds: '300' } })).toBe(300_000)
  })

  it('absent / malformed / non-positive values fall back to the canonical default — total, never throws', () => {
    for (const v of [
      undefined, null, 'garbage', 42, [], {},
      { watchdog: null }, { watchdog: 'x' }, { watchdog: {} },
      { watchdog: { idle_threshold_seconds: 'abc' } },
      { watchdog: { idle_threshold_seconds: NaN } },
      { watchdog: { idle_threshold_seconds: 0 } },
      { watchdog: { idle_threshold_seconds: -5 } },
      { watchdog: { idle_threshold_seconds: Infinity } }
    ]) {
      expect(resolveStallThresholdMs(v)).toBe(STALL_THRESHOLD_MS)
    }
  })

  it('the default constant IS the canonical contract value (watchdog.default_seconds = 3600), not the retired 120s heuristic', () => {
    expect(STALL_THRESHOLD_MS).toBe(3_600_000)
  })
})

describe('OrkyRootEngine — per-root config-sourced threshold', () => {
  it('no config.json: a 10-minute-idle executing feature is BUSY, not stalled (the 120s heuristic is gone)', async () => {
    const { orkyDir } = seedExecuting(600_000) // 10 min idle — old 120s default would have stalled
    const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
    cleanups.push(() => engine.dispose())
    const statuses: unknown[] = []
    engine.onStatus((_d, s) => statuses.push(s))
    await engine.addConsumer('pane:a', orkyDir)
    const s = lastStatus(statuses)
    expect(s.kind).toBe('busy')
    expect(s.features[0]?.reason).toBeNull()
  })

  it('config.json watchdog.idle_threshold_seconds governs the stall verdict for its root', async () => {
    const { orkyDir } = seedExecuting(600_000, { watchdog: { idle_threshold_seconds: 60 } })
    const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
    cleanups.push(() => engine.dispose())
    const statuses: unknown[] = []
    engine.onStatus((_d, s) => statuses.push(s))
    await engine.addConsumer('pane:a', orkyDir)
    const s = lastStatus(statuses)
    expect(s.kind).toBe('needs-input')
    expect(s.features[0]?.reason).toBe('stalled')
  })

  it('a caller-injected opts.thresholdMs wins over config (the liveness `caller` source)', async () => {
    const { orkyDir } = seedExecuting(600_000, { watchdog: { idle_threshold_seconds: 999_999 } })
    const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20, thresholdMs: 1_000 })
    cleanups.push(() => engine.dispose())
    const statuses: unknown[] = []
    engine.onStatus((_d, s) => statuses.push(s))
    await engine.addConsumer('pane:a', orkyDir)
    expect(lastStatus(statuses).features[0]?.reason).toBe('stalled')
  })

  it('editing config.json re-fires the watcher and the verdict follows (config.json is a target file)', async () => {
    const { orkyDir } = seedExecuting(600_000, { watchdog: { idle_threshold_seconds: 999_999 } })
    const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
    cleanups.push(() => engine.dispose())
    const statuses: unknown[] = []
    engine.onStatus((_d, s) => statuses.push(s))
    await engine.addConsumer('pane:a', orkyDir)
    expect(lastStatus(statuses).kind).toBe('busy')
    // Let chokidar's initial scan settle (suite idiom, cf. TEST-091's fixed settle): a write landing
    // inside the scan window is absorbed into the suppressed initial `add` and emits no change.
    await new Promise(r => setTimeout(r, 300))
    const before = statuses.length
    writeFileSync(join(orkyDir, 'config.json'),
      JSON.stringify({ watchdog: { idle_threshold_seconds: 60 } }), 'utf8')
    await waitFor(() => statuses.length > before)
    expect(lastStatus(statuses).features[0]?.reason).toBe('stalled')
  })
})

describe('assembleOrkyRootDetail — the one-shot detail path applies the SAME resolution', () => {
  it('config-sourced threshold governs the detail payload stall verdict; no config → canonical default', async () => {
    const withCfg = seedExecuting(600_000, { watchdog: { idle_threshold_seconds: 60 } })
    const d1 = await assembleOrkyRootDetail(withCfg.root, { now: () => NOW })
    expect(d1.ok).toBe(true)
    if (d1.ok) expect(d1.features[0]?.status.reason).toBe('stalled')

    const noCfg = seedExecuting(600_000)
    const d2 = await assembleOrkyRootDetail(noCfg.root, { now: () => NOW })
    expect(d2.ok).toBe(true)
    if (d2.ok) expect(d2.features[0]?.status.reason).toBeNull()
  })
})
