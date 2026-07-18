/**
 * Runs enqueued async tasks strictly one at a time, in FIFO order. `run` returns the task's own
 * promise — a rejection propagates to that caller only — while the internal chain settles
 * regardless, so one failed task can never wedge every later one.
 *
 * Used by WindowManager to serialize workspace moves: a move claims shared per-move state
 * (`inflight`, the per-pane transit handoff), and its three entry points (tab drag-end, the
 * `win:redock` IPC, redockAll on a floating window's close) were previously un-serialized against
 * each other — an overlapping move's timeout could null another move's `inflight` slot and drop
 * its terminal snapshots (silent scrollback loss).
 *
 * Pure (no Electron imports) so it is unit-testable; see tests/main/serial-queue.test.ts.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  /** Run `task` after every previously-enqueued task has settled. The task must never re-enqueue
   *  onto the same queue and then await that (classic self-deadlock); awaiting `run`'s result from
   *  a sequential caller-side loop (redockAll's for-await) is fine. */
  run<T>(task: () => Promise<T> | T): Promise<T> {
    // `.then(task, task)` — the previous task's outcome is irrelevant to whether the next runs.
    const next = this.tail.then(task, task)
    // Keep the stored chain unrejectable so a task failure can never wedge the queue (and never
    // surfaces as an unhandled rejection through the chain — only through `next`'s caller).
    this.tail = next.then(() => undefined, () => undefined)
    return next
  }
}
