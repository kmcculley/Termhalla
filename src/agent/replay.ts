/**
 * The per-pane replay terminal (REQ-003) — ONE `@xterm/headless` Terminal + serialize addon per
 * live pane, agent-side, with bounded scrollback (the tmux `history-limit` analog, locked
 * decision 3). The headless terminal IS the replay history: there is deliberately NO event
 * queue anywhere in the survival design (REQ-002 — the window-manager transit buffer is the
 * wrong tool and is not imported).
 *
 * This file is the ONLY sanctioned importer of `@xterm/headless` and `@xterm/addon-serialize`
 * inside `src/agent/` (TEST-1910 confinement — the injectable-seam discipline of the node-pty
 * backend). Its own source is deterministic-scannable: no clock, no RNG, no timer calls — the
 * ONE async seam is xterm's own write scheduling, handled below.
 *
 * Write-flush barrier: xterm parses `write()` input asynchronously, chunk by chunk, invoking
 * each chunk's callback synchronously inside its parse loop after that chunk is processed and
 * BEFORE later chunks. `snapshot()` therefore captures the last issued sequence number and
 * serializes INSIDE the callback of exactly that chunk — every byte fed before the call is in
 * the result, and no byte fed after the call can be (later chunks are unparsed at serialize
 * time). The REQ-003/REQ-010 reference-terminal oracles pin this contract.
 */
import { Terminal, type ITerminalAddon } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'

/** tmux's own default `history-limit` — the bounded-scrollback default (spec REQ-003; sizing
 *  policy is the roadmap's recorded open question 2, overridable per store, never a CLI flag). */
export const HISTORY_LIMIT_DEFAULT = 2000

export interface PaneReplayOpts {
  cols: number
  rows: number
  scrollback: number
  /** Diagnostics sink for contained serialize failures (degraded snapshots). Default: silent. */
  diag?: (text: string) => void
}

export interface PaneReplay {
  /** Write pty output into the headless terminal (order-faithful, never throws upward here —
   *  the STORE contains replay failures per REQ-004). */
  feed(data: string): void
  resize(cols: number, rows: number): void
  /** Resolves to the serialize-addon snapshot reflecting every byte fed BEFORE this call. */
  snapshot(): Promise<string>
  dispose(): void
}

export type ReplayFactory = (opts: PaneReplayOpts) => PaneReplay

interface SnapshotWaiter {
  target: number
  resolve: (snapshot: string) => void
}

export const createPaneReplay = (opts: PaneReplayOpts): PaneReplay => {
  // Option parity with the test oracles is load-bearing (REQ-010): cols/rows/scrollback +
  // allowProposedApi only. allowProposedApi is required by the serialize addon's buffer access.
  const term = new Terminal({
    cols: opts.cols,
    rows: opts.rows,
    scrollback: opts.scrollback,
    allowProposedApi: true
  })
  const addon = new SerializeAddon()
  // The addon's d.ts targets `@xterm/xterm`; the runtime object is interface-compatible with
  // the headless Terminal (the ^5.5 pair is version-locked in package.json — TEST-1910).
  term.loadAddon(addon as unknown as ITerminalAddon)

  const diag = opts.diag ?? ((): void => {})
  let disposed = false
  let issuedSeq = 0
  let parsedSeq = 0
  let waiters: SnapshotWaiter[] = []

  /** Serialize on a disposed terminal (or a broken addon) would throw inside xterm; answer the
   *  degraded empty snapshot instead. The waiter-settling paths pass `where` for a diagnostic:
   *  drain() runs inside xterm's async write callback where NO caller try/catch reaches
   *  (session-store's FINDING-009 guard covers only the synchronous snapshot() fast path), so a
   *  propagated throw is an uncaughtException — in the daemon, killing every surviving pane —
   *  and the ready waiters would hang forever. Mirror feedReplay's containment posture:
   *  degrade + diagnose, never throw upward. */
  const addonSafeSerialize = (where?: string): string => {
    try {
      return addon.serialize()
    } catch (e) {
      if (where) {
        const msg = String(e instanceof Error ? e.message : e).slice(0, 300)
        diag(`replay serialize failed ${where}; settling snapshot waiter(s) with a degraded empty snapshot: ${msg}`)
      }
      return ''
    }
  }

  const drain = (): void => {
    if (waiters.length === 0) return
    const ready = waiters.filter((w) => w.target <= parsedSeq)
    if (ready.length === 0) return
    waiters = waiters.filter((w) => w.target > parsedSeq)
    // One serialize serves every waiter satisfied at this exact parse point (they requested a
    // snapshot at-or-before this sequence; later chunks are still unparsed here).
    const snapshot = addonSafeSerialize('inside the write barrier')
    for (const w of ready) w.resolve(snapshot)
  }

  return {
    feed(data: string): void {
      // FINDING-002: never issue a zero-length write — the barrier's liveness must not depend
      // on xterm invoking callbacks for empty chunks (an undocumented edge).
      if (disposed || data.length === 0) return
      const seq = ++issuedSeq
      term.write(data, () => {
        parsedSeq = seq
        drain()
      })
    },

    resize(cols: number, rows: number): void {
      if (disposed) return
      term.resize(cols, rows)
    },

    snapshot(): Promise<string> {
      if (disposed) return Promise.resolve(addonSafeSerialize())
      const target = issuedSeq
      if (parsedSeq >= target) return Promise.resolve(addon.serialize())
      return new Promise<string>((resolve) => {
        waiters.push({ target, resolve })
      })
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      // Never orphan an in-flight snapshot: resolve pending waiters with the current state
      // BEFORE the terminal is torn down. The store re-checks pane liveness after every await
      // (the session-identity race pattern), so a raced attach still reports unknown-pane —
      // this resolution only guarantees no promise hangs and no unhandled rejection (REQ-006b).
      if (waiters.length > 0) {
        const snapshot = addonSafeSerialize('at dispose')
        const pending = waiters
        waiters = []
        for (const w of pending) w.resolve(snapshot)
      }
      term.dispose()
    }
  }
}
