/**
 * The remote:* IPC registrar (feature 0022 / F21, REQ-004/REQ-005): the named-agent registry
 * (config only — never a secret) + the per-workspace connection lifecycle. Remote pty/status
 * traffic itself rides the existing pty:* surface (register-pty delegates to the manager).
 */
import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { NamedAgent } from '@shared/remote-agents'
import { loadNamedAgents, saveNamedAgents } from '../../remote-client/agents-store'
import type { RemoteWorkspaceManager } from '../remote/remote-workspace-manager'
import type { Disposer } from './types'

export interface RemoteAgentsIo {
  list(): Promise<NamedAgent[]>
  /** Normalize → atomic write → the normalized list. REJECTS when the disk write fails so the
   *  UI never toasts a false success (the envSetGlobal precedent). */
  save(agents: unknown): Promise<NamedAgent[]>
}

/** The registry IO seam over F19's path-injected store (both doors normalize — no secret field
 *  survives a round-trip in either direction). */
export function createRemoteAgentsIo(filePath: string): RemoteAgentsIo {
  return {
    list: () => loadNamedAgents(filePath),
    save: async (agents: unknown) => {
      await saveNamedAgents(filePath, agents) // normalizes internally; atomic temp+rename
      return loadNamedAgents(filePath)        // the read door normalizes again
    }
  }
}

export function registerRemote(deps: {
  manager: RemoteWorkspaceManager
  agentsIo: RemoteAgentsIo
  /** Sender gate (FINDING-001, the FINDING-SEC-002 write-capable-surface precedent): when
   *  provided, every remote:* surface serves only currently-tracked app windows — agentsSave
   *  writes disk and connect spawns an outbound ssh child, so a foreign/destroyed sender is
   *  refused (reads answer an empty shape, the write rejects, fire-and-forget verbs drop). */
  isKnownWindowSender?: (sender: Electron.WebContents) => boolean
}): Disposer {
  const { manager, agentsIo } = deps
  const known = (e: { sender: Electron.WebContents }): boolean =>
    deps.isKnownWindowSender ? deps.isKnownWindowSender(e.sender) : true

  ipcMain.handle(CH.remoteAgentsList, (e) => known(e) ? agentsIo.list() : [])
  ipcMain.handle(CH.remoteAgentsSave, async (e, agents: unknown) => {
    if (!known(e)) throw new Error('remote:agentsSave refused: unknown sender (not a tracked app window)')
    return agentsIo.save(agents)
  })
  ipcMain.handle(CH.remoteCurrent, (e) => known(e) ? manager.currentStates() : [])
  // Fire-and-forget lifecycle verbs: outcomes ride the remote:state pushes.
  ipcMain.on(CH.remoteConnect, (e, a: { workspaceId?: unknown; agentId?: unknown }) => {
    if (!known(e)) return
    if (typeof a?.workspaceId !== 'string' || typeof a?.agentId !== 'string') return
    void manager.connectWorkspace(a.workspaceId, a.agentId)
  })
  ipcMain.on(CH.remoteDisconnect, (e, workspaceId: unknown) => {
    if (!known(e)) return
    if (typeof workspaceId !== 'string') return
    manager.disconnectWorkspace(workspaceId)
  })

  return () => {
    ipcMain.removeHandler(CH.remoteAgentsList)
    ipcMain.removeHandler(CH.remoteAgentsSave)
    ipcMain.removeHandler(CH.remoteCurrent)
    ipcMain.removeAllListeners(CH.remoteConnect)
    ipcMain.removeAllListeners(CH.remoteDisconnect)
  }
}
