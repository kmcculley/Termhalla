import { useStore } from '../store'
import { api } from '../api'
import type { GitStatus } from '@shared/types'
import type { PaneMenu } from './PaneTile'

/** The MosaicWindow toolbar for one pane: the process/usage chip, per-terminal action buttons, the
 *  folder menu, split controls, a maximize toggle, and close. Env/terminal/appearance settings moved
 *  to the title-bar right-click menu (see PaneContextMenu). */
export function PaneToolbar(
  { wsId, paneId, isTerminal, chipText, gitStatus, recording, toggle }: {
    wsId: string
    paneId: string
    isTerminal: boolean
    chipText: string
    gitStatus: GitStatus | undefined
    recording: boolean
    toggle: (menu: PaneMenu) => void
  }
) {
  const addTerminal = useStore(s => s.addTerminal)
  const closePane = useStore(s => s.closePane)
  const toggleMaximize = useStore(s => s.toggleMaximize)
  const isMax = useStore(s => s.maximized[wsId] === paneId)
  return (
    <>
      {isTerminal && (
        <>
          <button type="button" data-testid={`proc-chip-${paneId}`} title="Running process"
            style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={() => toggle('proc')}>{chipText}</button>
          <button type="button" data-testid={`run-chip-${paneId}`} title="Run commands"
            onClick={() => toggle('run')}>▷</button>
          <button type="button" data-testid={`schedule-chip-${paneId}`} title="Schedule a command"
            onClick={() => toggle('schedule')}>⏱</button>
          <button type="button" data-testid={`rec-${paneId}`}
            title={recording ? 'Stop recording' : 'Record session'}
            style={{ color: recording ? '#ff6b6b' : undefined }}
            onClick={() => recording ? api.recStop(paneId) : api.recStart(paneId)}>⏺</button>
          {gitStatus && (
            <button type="button" data-testid={`git-chip-${paneId}`} title="Git status"
              style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={() => toggle('git')}>
              {gitStatus.detached ? '⎇ ' : ''}{gitStatus.branch}{gitStatus.dirty ? ' ●' : ''}
            </button>
          )}
        </>
      )}
      <button data-testid={`cwd-${paneId}`} title="Folder actions" onClick={() => toggle('cwd')}>📁</button>
      <button data-testid={`split-${paneId}`} title="Split right" onClick={() => addTerminal(wsId, paneId, 'row')}>⬌</button>
      <button data-testid={`split-col-${paneId}`} title="Split down" onClick={() => addTerminal(wsId, paneId, 'column')}>⬍</button>
      <button data-testid={`max-${paneId}`} title={isMax ? 'Restore pane' : 'Maximize pane'}
        onClick={() => toggleMaximize(wsId, paneId)}>{isMax ? '🗗' : '🗖'}</button>
      <button data-testid={`close-${paneId}`} onClick={() => closePane(wsId, paneId)}>✕</button>
    </>
  )
}
