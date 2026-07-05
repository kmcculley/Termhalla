/**
 * Remote-workspace connection state (feature 0022 / F21, REQ-005/REQ-014) — the shape the main
 * process pushes on `remote:state` (app-global broadcast) and returns from `remote:current`.
 *
 * Pure module: zero Node/Electron imports.
 */

export type RemotePhase = 'connecting' | 'connected' | 'disconnected'

export type RemoteDisconnectReason =
  | 'lease-stolen'      // F20's displacement signal (lease:revoked) — another client attached
  | 'connection-lost'   // the transport/agent died unexpectedly (non-zero / null exit)
  | 'connect-failed'    // the connect attempt failed (classify diagnostics ride `diagnostic`)
  | 'cancelled'         // the user's own cancel/disconnect gesture
  | 'agent-exited'      // the agent ended cleanly (exit 0) while connected

export interface RemoteWorkspaceState {
  workspaceId: string
  agentId: string
  agentName: string
  phase: RemotePhase
  /** The handshake-advertised capability set while connected; [] otherwise (REQ-017). */
  capabilities: string[]
  /** Present iff phase === 'disconnected'. */
  reason?: RemoteDisconnectReason
  /** Bounded, control-char-sanitized cause detail (the F19 classify contract, unweakened —
   *  REQ-007); indeterminate outcomes keep their indeterminate wording (CONV-015). */
  diagnostic?: string
}
