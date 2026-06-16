import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import { api } from '../api'

/** The slim chrome shown in an undocked (non-main) window in place of the full tab strip: the
 *  workspace name plus a Dock button that sends it back to the main window. A floating window
 *  hosts exactly one workspace (only the main strip is a re-dock target). */
export function FloatingHeader() {
  const { order, workspaces } = useStore(useShallow(s => ({ order: s.order, workspaces: s.workspaces })))
  const wsId = order[0]
  return (
    <div data-testid="floating-header"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 4, background: 'var(--panel, #1e1e1e)', fontSize: 'var(--font-size, 13px)' }}>
      <span style={{ flex: 1, padding: '0 4px' }}>{wsId ? workspaces[wsId]?.name : ''}</span>
      <button data-testid="dock-button" title="Dock back into the main window" disabled={!wsId}
        onClick={() => { if (wsId) api.winRedock({ workspaceId: wsId, targetWindowId: 'main' }) }}>⤓ Dock</button>
    </div>
  )
}
