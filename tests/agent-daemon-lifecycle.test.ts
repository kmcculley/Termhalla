// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — re-derived after the
// ESC-001 loop-back; REQ-006 as amended per FINDING-008/FINDING-012).
// The daemon self-exits when it has ZERO live panes AND ZERO ESTABLISHED CONNECTIONS
// continuously for the idle timeout — a REALLY-SCHEDULED timer (CONV-036; a lazy check on the
// next inbound event would strand a quiet daemon forever), with the pure lifecycle core taking
// an injected scheduler. The lifecycle tracks a COUNT of established connections, never a
// boolean (FINDING-008: with ≥2 established connections, one ending must NOT arm the timer),
// and its signal vocabulary is protocol establishment / connection end — never the F20 lease
// bind (FINDING-012). SIGTERM shares the SAME once-only shutdown path, driven through an
// injected signal seam (windows-latest cannot deliver real SIGTERM semantics — REQ-016).
//
// Chosen contract (frozen here): src/agent/daemon-lifecycle.ts exports
//   createDaemonLifecycle({ scheduler, onShutdown, idleTimeoutMs?, signals? }) with
//   start() / onConnectionEstablished() / onConnectionEnded() / onPaneSpawned() /
//   onPaneExited() / dispose(); onShutdown(reason: 'idle' | 'signal') fires EXACTLY once.
import { describe, it, expect } from 'vitest'
import { createDaemonLifecycle } from '../src/agent/daemon-lifecycle'
import { DAEMON_IDLE_TIMEOUT_DEFAULT_MS } from '../src/agent/daemon-constants'

interface FakeTimer { id: number; fn: () => void; ms: number }

const mkScheduler = () => {
  let seq = 0
  const timers = new Map<number, FakeTimer>()
  return {
    setTimeout: (fn: () => void, ms: number): unknown => {
      const t = { id: ++seq, fn, ms }
      timers.set(t.id, t)
      return t.id
    },
    clearTimeout: (handle: unknown): void => { timers.delete(handle as number) },
    pending: (): FakeTimer[] => [...timers.values()],
    fire: (): void => {
      const due = [...timers.values()]
      timers.clear()
      for (const t of due) t.fn()
    }
  }
}

type Sig = { name: string; fn: () => void }
const mkSignals = () => {
  const handlers: Sig[] = []
  return {
    handlers,
    on: (name: string, fn: () => void): void => { handlers.push({ name, fn }) }
  }
}

const mk = (over: { idleTimeoutMs?: number } = {}) => {
  const scheduler = mkScheduler()
  const signals = mkSignals()
  const shutdowns: string[] = []
  const lc = createDaemonLifecycle({
    scheduler,
    signals,
    onShutdown: (reason: 'idle' | 'signal') => { shutdowns.push(reason) },
    ...(over.idleTimeoutMs !== undefined ? { idleTimeoutMs: over.idleTimeoutMs } : {})
  })
  return { lc, scheduler, signals, shutdowns }
}

describe('TEST-2406 REQ-006 the idle timer is REALLY scheduled at empty start (CONV-036)', () => {
  it('nothing is armed at construction; start() on an empty daemon arms one real timer', () => {
    const { lc, scheduler } = mk()
    expect(scheduler.pending(), 'construction must not arm — the caller wires cleanup first').toHaveLength(0)
    lc.start()
    expect(scheduler.pending(), 'a quiet daemon carries a genuinely scheduled timer, not a lazy check').toHaveLength(1)
    expect(scheduler.pending()[0].ms, 'the default is the named exported constant').toBe(DAEMON_IDLE_TIMEOUT_DEFAULT_MS)
  })

  it('--idle-timeout-ms overrides the default (CONV-003: the limit is stated and asserted)', () => {
    const { lc, scheduler } = mk({ idleTimeoutMs: 1234 })
    lc.start()
    expect(scheduler.pending()[0].ms).toBe(1234)
  })
})

describe('TEST-2407 REQ-006 arm/cancel transitions track empty-and-disconnected exactly', () => {
  it('establishment cancels; the last end with zero panes re-arms; spawn cancels; last exit with zero connections re-arms', () => {
    const { lc, scheduler } = mk()
    lc.start()
    expect(scheduler.pending()).toHaveLength(1)

    lc.onConnectionEstablished()
    expect(scheduler.pending(), 'an established connection cancels the idle timer').toHaveLength(0)

    lc.onConnectionEnded()
    expect(scheduler.pending(), 'zero connections with zero panes re-arms').toHaveLength(1)

    lc.onPaneSpawned()
    expect(scheduler.pending(), 'a live pane cancels the idle timer').toHaveLength(0)

    lc.onPaneExited()
    expect(scheduler.pending(), 'the last pane exit with zero connections re-arms').toHaveLength(1)
  })

  it('neither a pane exit while connected nor a connection end with live panes arms the timer', () => {
    const { lc, scheduler } = mk()
    lc.start()
    lc.onConnectionEstablished()
    lc.onPaneSpawned()
    lc.onPaneSpawned()
    lc.onPaneExited()
    expect(scheduler.pending(), 'one pane still lives — no arm while connected anyway').toHaveLength(0)
    lc.onConnectionEnded()
    expect(scheduler.pending(), 'disconnected but a pane still lives — the daemon is NOT idle').toHaveLength(0)
    lc.onPaneExited()
    expect(scheduler.pending(), 'now genuinely empty and disconnected').toHaveLength(1)
    lc.onConnectionEstablished()
    expect(scheduler.pending()).toHaveLength(0)
  })
})

describe('TEST-2446 REQ-006 an established-connection COUNT, never a boolean (FINDING-008)', () => {
  it('two concurrent established connections, zero panes: one ends and the timer MUST NOT arm; the second ends and it arms', () => {
    const { lc, scheduler } = mk()
    lc.start()
    lc.onConnectionEstablished() // A
    lc.onConnectionEstablished() // B — concurrently established
    expect(scheduler.pending()).toHaveLength(0)

    lc.onConnectionEnded() // A ends — B is STILL established: a boolean would wrongly arm here
    expect(scheduler.pending(), 'one of two connections ending must NOT arm (the daemon stays alive)').toHaveLength(0)

    lc.onConnectionEnded() // B ends — now genuinely zero established connections
    expect(scheduler.pending(), 'the second (last) end arms').toHaveLength(1)
  })

  it('a lease-steal displacement (the loser ends while the winner stays established) never reaches count 0', () => {
    const { lc, scheduler } = mk()
    lc.start()
    lc.onConnectionEstablished() // A (the eventual loser)
    lc.onConnectionEstablished() // B binds — the F20 steal displaces A …
    lc.onConnectionEnded()       // … so A's CONNECTION ends (lease displacement is an end path)
    expect(scheduler.pending(), 'the winner is still established — the steal never idles the daemon').toHaveLength(0)
  })
})

describe('TEST-2408 REQ-006 shutdown fires exactly once; SIGTERM shares the same path; dispose cancels', () => {
  it('the timer firing runs onShutdown("idle") exactly once, and later events never re-fire it', () => {
    const { lc, scheduler, shutdowns } = mk({ idleTimeoutMs: 50 })
    lc.start()
    scheduler.fire()
    expect(shutdowns).toEqual(['idle'])
    // Post-shutdown events must be inert: no re-arm, no second shutdown.
    lc.onConnectionEnded()
    lc.onPaneExited()
    scheduler.fire()
    expect(shutdowns, 'cleanup runs EXACTLY once per daemon lifetime').toEqual(['idle'])
    expect(scheduler.pending()).toHaveLength(0)
  })

  it('the injected SIGTERM seam runs the SAME shared shutdown exactly once (the windows-latest signal vector)', () => {
    const { lc, scheduler, signals, shutdowns } = mk({ idleTimeoutMs: 50 })
    lc.start()
    const sigterm = signals.handlers.find((h) => h.name === 'SIGTERM')
    expect(sigterm, 'the lifecycle registers a SIGTERM handler through the injected seam').toBeDefined()
    sigterm!.fn()
    expect(shutdowns).toEqual(['signal'])
    // The shared once-only guard covers BOTH triggers: a pending idle fire after the signal
    // must not run cleanup a second time.
    scheduler.fire()
    sigterm!.fn()
    expect(shutdowns).toEqual(['signal'])
  })

  it('dispose() cancels the pending idle timer and suppresses any later shutdown', () => {
    const { lc, scheduler, shutdowns } = mk({ idleTimeoutMs: 50 })
    lc.start()
    expect(scheduler.pending()).toHaveLength(1)
    lc.dispose()
    expect(scheduler.pending(), 'dispose cancels the really-scheduled timer').toHaveLength(0)
    scheduler.fire()
    expect(shutdowns).toEqual([])
  })
})
