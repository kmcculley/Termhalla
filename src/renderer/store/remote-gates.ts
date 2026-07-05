/**
 * The remote capability gates (feature 0022 / F21, REQ-017/REQ-011) — pure derivations over the
 * store-state shape, shared by every gated affordance (SplitMenu kind buttons, the empty-workspace
 * pane buttons, TerminalPane's recording default-start, the Usage/Orky watch reconcilers) so the
 * greying rule exists exactly once.
 *
 * Pure module: no `../api` import (unit-tested under the node harness).
 */
import type { Workspace } from '@shared/types'
import type { WorkspaceHome } from '@shared/remote-home'
import { remoteAllowedDomains } from '@shared/remote-home'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'

interface GateState {
  workspaces: Record<string, Workspace>
  remoteStates: Record<string, RemoteWorkspaceState>
}

export function workspaceHomeOf(s: GateState, wsId: string): WorkspaceHome | undefined {
  return s.workspaces[wsId]?.home
}

/** 'all' for a local workspace; the advertised set while connected; ['pty'] otherwise. */
export function workspaceAllowedDomains(s: GateState, wsId: string): 'all' | readonly string[] {
  return remoteAllowedDomains(workspaceHomeOf(s, wsId), s.remoteStates[wsId])
}

export function domainAllowed(s: GateState, wsId: string, domain: string): boolean {
  const allowed = workspaceAllowedDomains(s, wsId)
  return allowed === 'all' || allowed.includes(domain)
}

/** Whether a pane lives in a remote-home workspace (the watcher-skip predicate, REQ-011).
 *  Parameter narrowed to exactly what is read (FINDING-005) so callers never fabricate fields. */
export function paneIsRemote(s: Pick<GateState, 'workspaces'>, paneId: string): boolean {
  for (const ws of Object.values(s.workspaces)) {
    if (ws.panes && Object.prototype.hasOwnProperty.call(ws.panes, paneId)) return ws.home !== undefined
  }
  return false
}

/** The actionable disabled-reason text for a greyed pane-kind/domain affordance (CONV-001). */
export function domainDisabledReason(s: GateState, wsId: string, domain: string): string {
  const home = workspaceHomeOf(s, wsId)
  const who = home?.agentName || 'the remote agent'
  const st = s.remoteStates[wsId]
  return st?.phase === 'connected'
    ? `Unavailable in a remote workspace: the agent on ${who} does not provide the "${domain}" domain (it advertises: ${st.capabilities.join(', ') || 'nothing'})`
    : `Unavailable until the workspace connects to ${who} — only terminals (which trigger the connection) work while ${st?.phase === 'connecting' ? 'connecting' : 'disconnected'}`
}
