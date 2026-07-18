/**
 * The per-pane replay terminal — a bounded-scrollback `@xterm/headless` mirror with a
 * write-flush-barrier `snapshot()` (feature 0026's REQ-008/REQ-009 fan-out seam), functionally
 * identical to F18's `src/agent/replay.ts` (same public shape: `createPaneReplay`,
 * `HISTORY_LIMIT_DEFAULT`, `PaneReplayOpts`, `PaneReplay`, `ReplayFactory`).
 *
 * This is a DELIBERATE, DOCUMENTED duplication, not a drift: `tests/agent-structure.test.ts`'s
 * TEST-751 (frozen since feature 0017) forbids anything under `src/main` from importing the
 * `src/agent` tree at all (the agent is meant to stand alone as its own bundled artifact), while
 * `tests/agent-replay-structure.test.ts`'s TEST-1910 (frozen since feature 0019) requires
 * `src/agent/replay.ts` to remain the ONE importer of `@xterm/headless`/`@xterm/addon-serialize`
 * within `src/agent`. Neither guard may be edited (ADR-009), and satisfying REQ-008's mirror
 * requirement genuinely needs this exact write-flush-barrier engine main-side — so it lives here
 * too, independently. Keep the two files in sync by hand if the barrier's contract ever changes.
 *
 * Write-flush barrier: xterm parses `write()` input asynchronously, chunk by chunk, invoking each
 * chunk's callback synchronously inside its parse loop after that chunk is processed and BEFORE
 * later chunks. `snapshot()` therefore captures the last issued sequence number and serializes
 * INSIDE the callback of exactly that chunk — every byte fed before the call is in the result, and
 * no byte fed after the call can be (later chunks are unparsed at serialize time). The REQ-009
 * reference-terminal oracles pin this contract.
 */
import { Terminal, type ITerminalAddon } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'

/** Matches the tmux `history-limit` analog `src/agent/replay.ts` uses (REQ-008). */
export const HISTORY_LIMIT_DEFAULT = 2000

export interface PaneReplayOpts {
  cols: number
  rows: number
  scrollback: number
  /** Diagnostics sink for contained serialize failures (degraded snapshots). Default: silent. */
  diag?: (text: string) => void
}

export interface PaneReplay {
  /** Write pty output into the headless terminal (order-faithful, never throws upward). */
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
  const term = new Terminal({
    cols: opts.cols,
    rows: opts.rows,
    scrollback: opts.scrollback,
    allowProposedApi: true
  })
  const addon = new SerializeAddon()
  term.loadAddon(addon as unknown as ITerminalAddon)

  const diag = opts.diag ?? ((): void => {})
  let disposed = false
  let issuedSeq = 0
  let parsedSeq = 0
  let waiters: SnapshotWaiter[] = []

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
    const snapshot = addonSafeSerialize('inside the write barrier')
    for (const w of ready) w.resolve(snapshot)
  }

  return {
    feed(data: string): void {
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
