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
 * ONE deliberate divergence (FINDING-084): here `resize()` rides the same write-ordering barrier
 * as `snapshot()` (see below) — the agent copy keeps its original synchronous resize, pinned by
 * its own frozen suites.
 *
 * Write-flush barrier: xterm parses `write()` input asynchronously, chunk by chunk, invoking each
 * chunk's callback synchronously inside its parse loop after that chunk is processed and BEFORE
 * later chunks. `snapshot()` therefore captures the last issued sequence number and serializes
 * INSIDE the callback of exactly that chunk — every byte fed before the call is in the result, and
 * no byte fed after the call can be (later chunks are unparsed at serialize time). The REQ-009
 * reference-terminal oracles pin this contract.
 *
 * Import shape: `@xterm/headless`/`@xterm/addon-serialize` ship CJS with no `exports` map (no
 * `import` condition), so Node's ESM loader must fall back to `cjs-module-lexer` to synthesize
 * named exports — which fails for `Terminal` (main's real Electron launch throws `SyntaxError:
 * Named export 'Terminal' not found` loading the electron-vite-built, dependency-externalized
 * `out/main/index.js`; unlike `src/agent/`'s bundled single-file `.cjs` artifact, where Rollup
 * inlines the dependency at build time and this interop step never runs). A default import +
 * destructure is the universally-safe CJS interop pattern regardless of what the lexer can infer.
 */
import xtermHeadless from '@xterm/headless'
import type { ITerminalAddon } from '@xterm/headless'
import addonSerialize from '@xterm/addon-serialize'

const { Terminal } = xtermHeadless
const { SerializeAddon } = addonSerialize

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

/** One ordering domain for BOTH barrier-riding operations (FINDING-084): a snapshot waiter and a
 *  deferred resize share a single FIFO whose entries carry the write sequence they must trail.
 *  Targets are non-decreasing (issuedSeq only grows), so draining strictly from the front inside
 *  each write's callback applies every mirror operation in OBSERVATION order. */
type PendingOp =
  | { kind: 'snapshot'; target: number; resolve: (snapshot: string) => void }
  | { kind: 'resize'; target: number; cols: number; rows: number }

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
  let ops: PendingOp[] = []

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
    if (ops.length === 0 || ops[0].target > parsedSeq) return
    // One serialize is shared by CONSECUTIVE ready snapshot waiters, but an interleaved resize
    // invalidates the cache: the grid changed, so a waiter queued after it must re-serialize.
    let cached: string | undefined
    while (ops.length > 0 && ops[0].target <= parsedSeq) {
      const op = ops.shift() as PendingOp
      if (op.kind === 'resize') {
        term.resize(op.cols, op.rows)
        cached = undefined
      } else {
        if (cached === undefined) cached = addonSafeSerialize('inside the write barrier')
        op.resolve(cached)
      }
    }
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
      // Ordered WITH the feeds (FINDING-084, REQ-009/REQ-013): xterm parses write() input
      // asynchronously, so a synchronous term.resize() here could apply BEFORE bytes that were
      // observed (fed) earlier — a later attach/resync snapshot would then parse pre-resize
      // bytes at the new grid (verified against @xterm/headless: feed('ABCDE12345') at 5x2 then
      // resize(10,2) before the write callback serializes one unwrapped line; after it, the
      // proper reflow). With writes pending, the resize therefore rides the SAME barrier queue
      // as snapshot(): it runs inside the callback of the last write issued before it — after
      // every previously observed byte, before any byte fed after it (xterm fires each chunk's
      // callback before parsing later chunks). With nothing pending it stays synchronous.
      if (parsedSeq >= issuedSeq) {
        term.resize(cols, rows)
        return
      }
      ops.push({ kind: 'resize', target: issuedSeq, cols, rows })
    },

    snapshot(): Promise<string> {
      if (disposed) return Promise.resolve(addonSafeSerialize())
      const target = issuedSeq
      // Fast path: nothing pending ⇒ the op queue is empty too (every queued op targets a seq
      // ≤ issuedSeq and drains inside that write's callback), so serializing now is in order.
      if (parsedSeq >= target) return Promise.resolve(addon.serialize())
      return new Promise<string>((resolve) => {
        ops.push({ kind: 'snapshot', target, resolve })
      })
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      const pendingSnapshots = ops.filter((op): op is PendingOp & { kind: 'snapshot' } => op.kind === 'snapshot')
      ops = []
      if (pendingSnapshots.length > 0) {
        // Pending resizes are dropped (the terminal is going away); waiters settle with the
        // degraded at-dispose snapshot exactly as before.
        const snapshot = addonSafeSerialize('at dispose')
        for (const w of pendingSnapshots) w.resolve(snapshot)
      }
      term.dispose()
    }
  }
}
