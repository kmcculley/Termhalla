import { encodeBroadcast } from '@shared/broadcast'
import { api } from '../api'
import type { State, SliceDeps } from './types'

type RunCommandsSlice = Pick<State, 'setWorkspaceRunCommands' | 'runCommand'>

/** Saved run commands: workspace-scoped list persisted on the Workspace (pane-scoped list reuses
 *  updatePaneConfig), plus the send action that runs a command in a terminal — raw keystrokes + CR
 *  via the shared encodeBroadcast path (same plumbing as broadcast / scheduled commands). */
export function createRunCommandsSlice({ set, get, scheduleAutosave }: SliceDeps): RunCommandsSlice {
  return {
    setWorkspaceRunCommands: (wsId, runCommands) => {
      const ws = get().workspaces[wsId]
      if (!ws) return
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: { ...ws, runCommands } } }))
      scheduleAutosave()
    },

    runCommand: (paneId, command) => {
      api.ptyWrite({ id: paneId, data: encodeBroadcast(command, 'keys', true) })
    }
  }
}
