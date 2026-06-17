import { useStore } from '../store'
import { api } from '../api'
import type { PaneMenu } from './PaneTile'

/** The MosaicWindow toolbar for one pane: the process/usage chip, per-terminal action buttons,
 *  and the universal folder/settings/theme/split/close controls. Rendered into
 *  `MosaicWindow.toolbarControls`. Pulls only the two layout actions it needs from the store. */
export function PaneToolbar(
  { wsId, paneId, isTerminal, chipText, recording, envActive, toggle }: {
    wsId: string
    paneId: string
    isTerminal: boolean
    chipText: string
    recording: boolean
    envActive: boolean
    toggle: (menu: PaneMenu) => void
  }
) {
  const addTerminal = useStore(s => s.addTerminal)
  const closePane = useStore(s => s.closePane)
  const openSettings = useStore(s => s.openSettings)
  return (
    <>
      {isTerminal && (
        <>
          <button type="button" data-testid={`proc-chip-${paneId}`} title="Running process"
            style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={() => toggle('proc')}>{chipText}</button>
          <button type="button" data-testid={`schedule-chip-${paneId}`} title="Schedule a command"
            onClick={() => toggle('schedule')}>⏱</button>
          <button type="button" data-testid={`rec-${paneId}`}
            title={recording ? 'Stop recording' : 'Record session'}
            style={{ color: recording ? '#ff6b6b' : undefined }}
            onClick={() => recording ? api.recStop(paneId) : api.recStart(paneId)}>⏺</button>
          <button type="button" data-testid={`env-chip-${paneId}`} title="Environment variables"
            style={{ color: envActive ? 'var(--accent, #4ea1ff)' : undefined }}
            onClick={() => openSettings({ section: 'environment', paneId })}>🔑</button>
        </>
      )}
      <button data-testid={`cwd-${paneId}`} title="Folder actions" onClick={() => toggle('cwd')}>📁</button>
      <button data-testid={`gear-${paneId}`} title="Terminal settings" onClick={() => openSettings({ section: 'terminal', paneId })}>⚙</button>
      <button data-testid={`theme-chip-${paneId}`} title="Theme this pane" onClick={() => openSettings({ section: 'appearance', paneId })}>🎨</button>
      <button data-testid={`split-${paneId}`} title="Split right" onClick={() => addTerminal(wsId, paneId, 'row')}>⬌</button>
      <button data-testid={`split-col-${paneId}`} title="Split down" onClick={() => addTerminal(wsId, paneId, 'column')}>⬍</button>
      <button data-testid={`close-${paneId}`} onClick={() => closePane(wsId, paneId)}>✕</button>
    </>
  )
}
