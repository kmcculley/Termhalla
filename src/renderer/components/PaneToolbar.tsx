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
  const closePane = useStore(s => s.closePane)
  const toggleMaximize = useStore(s => s.toggleMaximize)
  const isMax = useStore(s => s.maximized[wsId] === paneId)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const historyMuted = useStore(s => {
    const cfg = s.workspaces[wsId]?.panes[paneId]?.config
    return cfg?.kind === 'terminal' ? !!cfg.historyMuted : false
  })
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
          <button type="button" data-testid={`history-mute-${paneId}`}
            title={historyMuted ? 'Output history muted — click to index' : 'Indexing output history — click to mute'}
            onClick={() => {
              const next = !historyMuted
              updatePaneConfig(wsId, paneId, { historyMuted: next || undefined })
              api.searchSetMuted(paneId, next)
            }}>{historyMuted ? '🔇' : '📖'}</button>
        </>
      )}
      <button data-testid={`cwd-${paneId}`} title="Folder actions" onClick={() => toggle('cwd')}>📁</button>
      <button data-testid={`split-${paneId}`} title="Split right (terminal / editor / explorer)" onClick={() => toggle('split-row')}>⬌</button>
      <button data-testid={`split-col-${paneId}`} title="Split down (terminal / editor / explorer)" onClick={() => toggle('split-col')}>⬍</button>
      <button data-testid={`max-${paneId}`} title={isMax ? 'Restore pane' : 'Maximize pane'}
        onClick={() => toggleMaximize(wsId, paneId)}>{isMax ? '🗗' : '🗖'}</button>
      <button data-testid={`close-${paneId}`} onClick={() => closePane(wsId, paneId)}>✕</button>
    </>
  )
}
