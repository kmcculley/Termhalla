/**
 * The remote banner's pure view-model (feature 0022 / F21, REQ-016) — separated from the
 * rendering exactly the way pane-status.ts / tab-badge.ts split theirs, so the copy + action
 * derivation is unit-testable under the node harness.
 */
import type { WorkspaceHome } from '@shared/remote-home'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'

export interface RemoteBannerModel {
  phase: 'connecting' | 'disconnected'
  headline: string
  detail?: string
  action: 'cancel' | 'reconnect'
}

/** null ⇒ no banner (a local workspace, or a connected remote one). A remote-home workspace with
 *  NO state yet still explains itself (not-yet-connected — the first terminal triggers it). */
export function remoteBannerModel(
  home: WorkspaceHome | undefined,
  state: RemoteWorkspaceState | undefined
): RemoteBannerModel | null {
  if (!home) return null
  const who = state?.agentName || home.agentName || home.agentId || 'remote agent'
  if (!state) {
    return {
      phase: 'disconnected',
      headline: `Not connected to ${who} yet`,
      detail: 'Open a terminal in this workspace (or press Reconnect) to connect.',
      action: 'reconnect'
    }
  }
  if (state.phase === 'connected') return null
  if (state.phase === 'connecting') {
    return {
      phase: 'connecting',
      headline: `Connecting to ${who}…`,
      detail: 'SSH may prompt for 2FA or a hardware key; there is no built-in timeout — Cancel is yours.',
      action: 'cancel'
    }
  }
  const detail = state.diagnostic
  switch (state.reason) {
    case 'lease-stolen':
      return {
        phase: 'disconnected',
        headline: `Disconnected: another client attached to ${who} and took this workspace's sessions`,
        detail: detail ?? 'Reconnect steals the sessions back (exclusive attach).',
        action: 'reconnect'
      }
    case 'cancelled':
      return { phase: 'disconnected', headline: `Connection to ${who} cancelled`, detail, action: 'reconnect' }
    case 'agent-exited':
      return { phase: 'disconnected', headline: `The agent on ${who} exited`, detail, action: 'reconnect' }
    case 'connect-failed':
      return { phase: 'disconnected', headline: `Connecting to ${who} failed`, detail, action: 'reconnect' }
    default:
      return { phase: 'disconnected', headline: `The connection to ${who} was lost`, detail, action: 'reconnect' }
  }
}
