// Hardening suite — overlapping re-reads of the SAME root are generation-guarded.
// `schedule` debounces 300ms then fires `void this.reread(orkyDir)`, but two overlapping re-reads of
// one root previously had no ordering guard: an older, slower re-read (the walk covers up to 200
// feature dirs) could resolve AFTER a newer one and emit stale status LAST. The engine now stamps a
// per-root monotonically increasing generation token — claimed before the first await, re-checked
// after every await (the same session-identity race pattern the consumer slots already use) — so the
// stale read abandons instead of clobbering the newer roll-up.
//
// Mirrors tests/main/orky-root-engine.test.ts's fixture techniques (temp `.orky/` trees, a collector
// subscriber, cleanups) WITHOUT editing that frozen file. The overlap itself is made deterministic by
// wrapping `node:fs/promises.readFile` with a one-shot gate on `findings.json` — the LAST read before
// the stale re-read's final emit — so the stale read provably completes AFTER the newer one.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'

// One-shot readFile gate, shared with the hoisted vi.mock factory below: while `hold` is set, the
// NEXT findings.json read parks on it (signalling `onHold`) and disarms — later reads pass through.
const fsGate = vi.hoisted(() => ({
  hold: null as Promise<void> | null,
  onHold: null as (() => void) | null
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    readFile: (async (...args: Parameters<typeof real.readFile>) => {
      if (fsGate.hold && String(args[0]).endsWith('findings.json')) {
        const gate = fsGate.hold
        fsGate.hold = null // one-shot: only the FIRST in-flight read is held
        fsGate.onHold?.()
        await gate
      }
      return real.readFile(...args)
    }) as typeof real.readFile
  }
})

const NOW = 1_700_000_000_000
const AUTONOMOUS = ['brainstorm', 'spec', 'plan', 'tests', 'implement', 'review', 'doc-sync']
const awaitingHumanGates = (): Record<string, { passed: boolean }> =>
  Object.fromEntries(AUTONOMOUS.map(p => [p, { passed: true }]))

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); fsGate.hold = null; fsGate.onHold = null; vi.restoreAllMocks() })

function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  return new Promise((res, rej) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (pred()) { clearInterval(i); res() }
      else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')) }
    }, 25)
  })
}

function seedRoot(state: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-eng-gen-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const fdir = join(root, '.orky', 'features', 'demo')
  mkdirSync(fdir, { recursive: true })
  writeFileSync(join(fdir, 'state.json'), JSON.stringify(state), 'utf8')
  writeFileSync(join(fdir, 'findings.json'), '[]', 'utf8')
  return root
}

// v1: every autonomous gate passed → awaiting-human → kind 'needs-input', popover-listed.
const STATE_V1 = { feature: 'demo', phase: 'doc-sync', gates: awaitingHumanGates(), escalations: [] }
// v2: only brainstorm passed → genuinely idle → kind 'idle', empty popover — trivially distinguishable.
const STATE_V2 = { feature: 'demo', phase: 'brainstorm', gates: { brainstorm: { passed: true } }, escalations: [] }

type EngineInternals = { reread(orkyDir: string): Promise<void> }

describe('OrkyRootEngine — per-root re-read generation guard (stale overlapped re-read never emits last)', () => {
  it('a slow re-read overlapped by a newer one abandons: the newer roll-up is the LAST emit, with no stale emit after it', async () => {
    const root = seedRoot(STATE_V1)
    const orkyDir = join(root, '.orky')
    const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
    cleanups.push(() => engine.dispose())
    const statuses: Array<{ kind: string } | null> = []
    engine.onStatus((_d, s) => statuses.push(s as { kind: string } | null))

    await engine.addConsumer('pane:p1', orkyDir)
    await waitFor(() => statuses.some(s => s?.kind === 'needs-input')) // initial v1 roll-up landed

    // Arm the one-shot gate, then start the STALE re-read: it reads state v1, then parks on the
    // findings.json read — its final await before the emit.
    let release!: () => void
    let reached!: () => void
    const reachedGate = new Promise<void>(res => { reached = res })
    fsGate.hold = new Promise<void>(res => { release = res })
    fsGate.onHold = reached
    const stale = (engine as unknown as EngineInternals).reread(orkyDir)
    await reachedGate // the stale read HAS consumed state v1 and is provably suspended pre-emit

    // Now the on-disk truth changes and a NEWER re-read runs to completion (gate is one-shot).
    writeFileSync(join(orkyDir, 'features', 'demo', 'state.json'), JSON.stringify(STATE_V2), 'utf8')
    await (engine as unknown as EngineInternals).reread(orkyDir)
    expect(statuses.at(-1)?.kind).toBe('idle') // the newer (v2) roll-up landed

    // Let the WATCHER's own debounced re-read of that same write settle too (it also reads v2 →
    // 'idle'), so the only possible emitter left is the parked stale read.
    await new Promise(r => setTimeout(r, 500))
    const emitsBefore = statuses.length

    // Release the stale read: it must ABANDON (no further emit), not clobber v2 with v1.
    release()
    await stale
    expect(statuses.length).toBe(emitsBefore)
    expect(statuses.at(-1)?.kind).toBe('idle') // v2 is still the last word
  })

  it('the guard never starves a healthy sequential flow: a later change still re-reads and emits', async () => {
    const root = seedRoot(STATE_V2)
    const orkyDir = join(root, '.orky')
    const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
    cleanups.push(() => engine.dispose())
    const statuses: Array<{ kind: string } | null> = []
    engine.onStatus((_d, s) => statuses.push(s as { kind: string } | null))

    await engine.addConsumer('pane:p1', orkyDir)
    await waitFor(() => statuses.some(s => s?.kind === 'idle'))

    writeFileSync(join(orkyDir, 'features', 'demo', 'state.json'), JSON.stringify(STATE_V1), 'utf8')
    await waitFor(() => statuses.some(s => s?.kind === 'needs-input')) // watcher → debounce → re-read still works
  })

  it('the debounce timer is unref()\'d (mirrors StatusEngine) so a pending re-read never keeps the main process alive', () => {
    // Structural pin, matching this repo's source-scan convention (e.g. orky-osc-structural.test.ts):
    // the node harness cannot observe process-keepalive directly.
    const src = readFileSync(resolve(process.cwd(), 'src/main/orky/orky-root-engine.ts'), 'utf8')
    expect(src).toMatch(/r\.timer = setTimeout[\s\S]{0,400}unref\?\.\(\)/)
  })
})
