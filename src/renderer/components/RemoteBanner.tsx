/**
 * The remote-workspace connection banner (feature 0022 / F21, REQ-016): a workspace-body OVERLAY
 * — a sibling of `.mosaic` inside the workspace host (the MinimizedTray precedent), so it needs
 * NO portal (it is not a tile child) and, critically, it never unmounts or `display:none`s the
 * panes beneath it: a disconnected pane FREEZES under the banner (the keep-mounted discipline —
 * xterm scrollback and live TUIs survive to the reconnect).
 */
import { useStore } from '../store'
import { SURFACE } from './Modal'
import { remoteBannerModel } from './remote-banner-model'

export function RemoteBanner({ wsId }: { wsId: string }) {
  const home = useStore(s => s.workspaces[wsId]?.home)
  const state = useStore(s => s.remoteStates[wsId])
  const connectRemote = useStore(s => s.connectRemote)
  const disconnectRemote = useStore(s => s.disconnectRemote)

  const model = remoteBannerModel(home, state)
  if (!model || !home) return null

  return (
    <div data-testid="remote-banner" role="status"
      style={{
        // SURFACE = the established elevated-chrome tokens (CONV-029: never a novel var name —
        // the theme-var-validity sweep caught the first draft's undefined --panel-bg).
        ...SURFACE,
        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
        zIndex: 30, maxWidth: 'min(680px, calc(100% - 24px))',
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6
      }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{model.headline}</div>
        {model.detail && (
          <div style={{ opacity: 0.75, fontSize: '0.85em', overflowWrap: 'anywhere' }} title={model.detail}>
            {model.detail}
          </div>
        )}
      </div>
      {/* Target-guarded actions (CONV-030/CONV-041): plain buttons, no container-level handler. */}
      {model.action === 'cancel' ? (
        <button type="button" data-testid="remote-cancel" style={{ flexShrink: 0 }}
          onClick={() => disconnectRemote(wsId)}>Cancel</button>
      ) : (
        <button type="button" data-testid="remote-reconnect" style={{ flexShrink: 0 }}
          onClick={() => connectRemote(wsId, home.agentId)}>Reconnect</button>
      )}
    </div>
  )
}
