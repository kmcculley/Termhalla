/**
 * The pure daemon idle-lifecycle core (REQ-006) — a REALLY-scheduled (injected scheduler)
 * arm/cancel state machine (CONV-036: a lazy check on the next inbound event would strand a
 * quiet daemon forever, exactly the orphan-accumulation locked decision 3 rejects). Arms whenever
 * the daemon becomes (or starts) empty — ZERO live panes AND ZERO ESTABLISHED CONNECTIONS —
 * cancels on a protocol establishment or a pane spawn. Fires the shared shutdown callback EXACTLY
 * once per lifecycle — the SAME path for an idle timeout and an injected SIGTERM
 * (`daemon-server.ts` wires the signal seam to real `process.on('SIGTERM', ...)`; the frozen unit
 * suite drives a fake signal seam since windows-latest cannot deliver real SIGTERM semantics).
 *
 * FINDING-008: the lifecycle tracks a COUNT of established connections, never a boolean — with
 * ≥2 established connections, one ending must NOT arm the timer (it would drop a live connection
 * on the next idle fire). FINDING-012: the signals are protocol establishment / connection end —
 * named `onConnectionEstablished`/`onConnectionEnded`, never conflated with the F20 lease bind.
 */
import { DAEMON_IDLE_TIMEOUT_DEFAULT_MS } from './daemon-constants'

export interface DaemonScheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface DaemonSignals {
  on(name: string, fn: () => void): void
}

export interface DaemonLifecycleInit {
  scheduler: DaemonScheduler
  onShutdown: (reason: 'idle' | 'signal') => void
  /** Default DAEMON_IDLE_TIMEOUT_DEFAULT_MS (5 min). */
  idleTimeoutMs?: number
  signals?: DaemonSignals
}

export interface DaemonLifecycle {
  /** Arms the idle timer if the daemon starts empty (zero connections, zero panes). Call once the
   *  caller has finished wiring cleanup (construction itself never arms). */
  start(): void
  /** A connection completed the protocol handshake: increments the established count and cancels
   *  the idle timer. */
  onConnectionEstablished(): void
  /** An established connection ended by ANY path (clean EOF, fatal framing, failed send, lease
   *  displacement): decrements the count and re-arms iff now zero connections AND zero panes. */
  onConnectionEnded(): void
  /** A pane came to life (fresh spawn only, never adopt): cancels the idle timer. */
  onPaneSpawned(): void
  /** A pane exited: re-arms iff now zero panes AND zero established connections. */
  onPaneExited(): void
  /** Cancels any pending timer and suppresses any later shutdown. Idempotent. */
  dispose(): void
}

export const createDaemonLifecycle = (init: DaemonLifecycleInit): DaemonLifecycle => {
  const idleTimeoutMs = init.idleTimeoutMs ?? DAEMON_IDLE_TIMEOUT_DEFAULT_MS
  let establishedCount = 0
  let paneCount = 0
  let timer: unknown = null
  let shutdown = false

  const cancel = (): void => {
    if (timer !== null) {
      init.scheduler.clearTimeout(timer)
      timer = null
    }
  }

  const fireShutdown = (reason: 'idle' | 'signal'): void => {
    if (shutdown) return
    shutdown = true
    cancel()
    init.onShutdown(reason)
  }

  const arm = (): void => {
    if (shutdown) return
    cancel()
    timer = init.scheduler.setTimeout(() => {
      timer = null
      fireShutdown('idle')
    }, idleTimeoutMs)
  }

  const maybeArm = (): void => {
    if (establishedCount === 0 && paneCount === 0) arm()
  }

  if (init.signals) {
    init.signals.on('SIGTERM', () => fireShutdown('signal'))
  }

  return {
    start(): void {
      maybeArm()
    },
    onConnectionEstablished(): void {
      establishedCount++
      cancel()
    },
    onConnectionEnded(): void {
      establishedCount = Math.max(0, establishedCount - 1)
      maybeArm()
    },
    onPaneSpawned(): void {
      paneCount++
      cancel()
    },
    onPaneExited(): void {
      paneCount = Math.max(0, paneCount - 1)
      maybeArm()
    },
    dispose(): void {
      shutdown = true
      cancel()
    }
  }
}
