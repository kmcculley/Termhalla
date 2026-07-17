/** Pending editor reveal positions (QoL batch 2026-07-17): a terminal file:line link stashes the
 *  position here, then routes through store.openFileInEditor; whichever editor pane opens (or
 *  already holds) the file consumes the stash and jumps to the line. Path-keyed, consumed once —
 *  the same fire-and-forget discipline as the scrollback snapshot stash in terminal-registry. */
const pending = new Map<string, { line: number; col?: number }>()

export function stashReveal(path: string, pos: { line: number; col?: number }): void {
  pending.set(path, pos)
}

export function consumeReveal(path: string): { line: number; col?: number } | null {
  const p = pending.get(path)
  pending.delete(path)
  return p ?? null
}
