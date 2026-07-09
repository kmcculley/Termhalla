import { useStore } from '../store'
import { api } from '../api'
import type { GitStatus, OrkyPaneStatus } from '@shared/types'
import { resolveBindings, formatChord } from '@shared/keybindings'
import { splitChipLabel } from './pane-status'
import type { PaneMenu } from './PaneTile'

/** The MosaicWindow toolbar for one pane: the process/usage chip, per-terminal action buttons, the
 *  folder menu, split controls, a maximize toggle, and close. Env/terminal/appearance settings moved
 *  to the title-bar right-click menu (see PaneContextMenu). */
export function PaneToolbar(
  { wsId, paneId, isTerminal, chipText, gitStatus, orky, toggle, splitOpen }: {
    wsId: string
    paneId: string
    isTerminal: boolean
    chipText: string
    gitStatus: GitStatus | undefined
    orky: OrkyPaneStatus | undefined
    toggle: (menu: PaneMenu) => void
    splitOpen: boolean
  }
) {
  const closePane = useStore(s => s.closePane)
  const toggleMaximize = useStore(s => s.toggleMaximize)
  const toggleMinimize = useStore(s => s.toggleMinimize)
  // CONV-005 / REQ-013: the tooltip accelerator derives from the keybinding registry, never a literal.
  // Select the STABLE `quick.keybindings` ref and resolve in render — `resolveBindings(...)[id]` would
  // return a fresh Chord object every call once an override exists, so using it directly as the zustand
  // selector result re-fires on every render and blows the update depth (React #185).
  const keybindings = useStore(s => s.quick.keybindings)
  const minChord = resolveBindings(keybindings)['toggle-minimize-pane']
  const minTitle = minChord ? `Minimize pane (${formatChord(minChord)})` : 'Minimize pane'
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
          {orky && orky.chipFeature && (() => {
            // Shrink-clip the SLUG span, never the actionable tail (` · phase · N/M · ●k open`) —
            // a whole-button end-ellipsis hid the at-a-glance signal first (FINDING-UX-004).
            // Paint/flow only inside the button: its box (and the toolbar's) is unchanged.
            const { slug, tail } = splitChipLabel(orky.label, orky.chipFeature)
            return (
              <button type="button" data-testid={`orky-chip-${paneId}`} title={`Orky pipeline status — ${orky.label}`}
                data-needs-human={orky.needsHuman ? '' : undefined} data-failed={orky.failed ? '' : undefined}
                style={{ maxWidth: 240, display: 'inline-flex', alignItems: 'baseline', whiteSpace: 'nowrap', overflow: 'hidden' }}
                onClick={() => toggle('orky')}>
                {orky.needsHuman && <span style={{ flexShrink: 0 }}>🔔&nbsp;</span>}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{slug}</span>
                {tail && <span style={{ flexShrink: 0 }}>{tail}</span>}
              </button>
            )
          })()}
          <button type="button" data-testid={`run-chip-${paneId}`} title="Run commands"
            onClick={() => toggle('run')}>▷</button>
          <button type="button" data-testid={`schedule-chip-${paneId}`} title="Schedule a command"
            onClick={() => toggle('schedule')}>⏱</button>
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
      <button data-testid={`split-${paneId}`} title="Split (compass: up / left / right / down)"
        aria-haspopup="dialog" aria-expanded={splitOpen} onClick={() => toggle('split')}>⬌</button>
      <button data-testid={`min-${paneId}`} title={minTitle}
        onClick={() => toggleMinimize(wsId, paneId)}>🗕</button>
      <button data-testid={`max-${paneId}`} title={isMax ? 'Restore pane' : 'Maximize pane'}
        onClick={() => toggleMaximize(wsId, paneId)}>{isMax ? '🗗' : '🗖'}</button>
      <button data-testid={`close-${paneId}`} onClick={() => closePane(wsId, paneId)}>✕</button>
    </>
  )
}
