import type { State, SliceDeps } from './types'

type RunCommandsSlice = Pick<State, 'setWorkspaceRunCommands'>

/** Workspace-scoped saved run commands (the pane-scoped list reuses updatePaneConfig). The send
 *  action `runCommand` lives on the root store (store.ts) so this slice stays free of `../api` and
 *  remains unit-testable. */
export function createRunCommandsSlice({ set, scheduleAutosave }: SliceDeps): RunCommandsSlice {
  return {
    setWorkspaceRunCommands: (wsId, runCommands) => {
      set(s => {
        const ws = s.workspaces[wsId]
        if (!ws) return {}
        return { workspaces: { ...s.workspaces, [wsId]: { ...ws, runCommands } } }
      })
      scheduleAutosave()
    }
  }
}
