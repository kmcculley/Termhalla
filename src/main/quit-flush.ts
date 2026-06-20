/** Outcome of a flush-before-quit round-trip. */
export type FlushOutcome = 'all' | 'timeout'

export interface FlushCoordination {
  /** Record that `windowId` has finished flushing. Duplicate / unknown ids are ignored. */
  confirm(windowId: string): void
  /** Resolves 'all' once every window has confirmed, or 'timeout' after `timeoutMs`. Never rejects. */
  promise: Promise<FlushOutcome>
}

/**
 * Coordinate a flush-before-quit round-trip: the caller asks each window to flush and calls
 * `confirm(id)` as replies arrive. The returned promise resolves 'all' when every window has
 * confirmed, or 'timeout' after `timeoutMs` — so a hung or crashed renderer can never block the
 * quit indefinitely. Resolving 'all' early cancels the timer so no late outcome fires.
 */
export function coordinateFlush(windowIds: string[], timeoutMs: number): FlushCoordination {
  const pending = new Set(windowIds)
  let settle!: (outcome: FlushOutcome) => void
  let settled = false
  const promise = new Promise<FlushOutcome>(resolve => { settle = resolve })

  const finish = (outcome: FlushOutcome, timer?: ReturnType<typeof setTimeout>): void => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    settle(outcome)
  }

  if (pending.size === 0) { finish('all'); return { confirm: () => {}, promise } }

  const timer = setTimeout(() => finish('timeout'), timeoutMs)
  const confirm = (windowId: string): void => {
    if (!pending.delete(windowId)) return     // unknown or already-confirmed id
    if (pending.size === 0) finish('all', timer)
  }
  return { confirm, promise }
}
