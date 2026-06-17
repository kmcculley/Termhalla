import type { RunCommand } from './types'

export interface MenuEntry { scope: 'workspace' | 'pane'; cmd: RunCommand }

/** Append a command immutably. `undefined` is treated as an empty list. */
export function addRunCommand(list: RunCommand[] | undefined, cmd: RunCommand): RunCommand[] {
  return [...(list ?? []), cmd]
}

/** Patch the command with matching id (id itself is never changed). No-op for an unknown id. */
export function updateRunCommand(
  list: RunCommand[] | undefined,
  id: string,
  patch: Partial<Omit<RunCommand, 'id'>>
): RunCommand[] {
  return (list ?? []).map(c => (c.id === id ? { ...c, ...patch, id: c.id } : c))
}

/** Remove the command with matching id. No-op for an unknown id. */
export function removeRunCommand(list: RunCommand[] | undefined, id: string): RunCommand[] {
  return (list ?? []).filter(c => c.id !== id)
}

/** Workspace commands first, then pane commands, each tagged with its scope (for the run menu). */
export function mergeForMenu(
  ws: RunCommand[] | undefined,
  pane: RunCommand[] | undefined
): MenuEntry[] {
  return [
    ...(ws ?? []).map((cmd): MenuEntry => ({ scope: 'workspace', cmd })),
    ...(pane ?? []).map((cmd): MenuEntry => ({ scope: 'pane', cmd }))
  ]
}
