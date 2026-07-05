/**
 * The remote-workspace renderer slice (feature 0022 / F21, REQ-014/REQ-016/REQ-004): the
 * per-workspace connection states (push-fed, pull-seeded), the named-agent registry mirror, and
 * the disconnected-transition toast policy.
 *
 * The preload bridge is INJECTED (the repo's op.ts / orky-pane-slice pattern) — this module never
 * imports `../api`, so it stays unit-testable under the node harness.
 */
import type { NamedAgent } from '@shared/remote-agents'
import type { RemoteWorkspaceState, RemoteDisconnectReason } from '@shared/remote-workspace'

export interface RemoteSliceDeps {
  set: (patch: object | ((s: RemoteSliceState) => object)) => void
  get: () => RemoteSliceState
  remoteCurrent: () => Promise<RemoteWorkspaceState[]>
  remoteConnect: (workspaceId: string, agentId: string) => void
  remoteDisconnect: (workspaceId: string) => void
  remoteAgentsList: () => Promise<NamedAgent[]>
  remoteAgentsSave: (agents: NamedAgent[]) => Promise<NamedAgent[]>
  pushToast: (text: string, kind: 'info' | 'success' | 'error') => void
}

export interface RemoteSliceState {
  remoteStates: Record<string, RemoteWorkspaceState>
  namedAgents: NamedAgent[]
}

export interface RemoteSlice {
  ingestRemoteState(s: RemoteWorkspaceState): void
  seedRemoteStates(): Promise<void>
  connectRemote(workspaceId: string, agentId: string): void
  disconnectRemote(workspaceId: string): void
  loadNamedAgents(): Promise<void>
  saveNamedAgents(agents: NamedAgent[]): Promise<boolean>
  pruneRemoteStates(liveWorkspaceIds: string[]): void
}

/** The reasons that get one error toast on the transition INTO disconnected (REQ-016). The
 *  user's own cancel is silent; everything else is a real event the user must not miss even
 *  while the workspace's tab is hidden (CONV-004/CONV-034/CONV-053 — the banner is state, the
 *  toast is the never-silently-dropped outcome signal). */
const TOASTED_REASONS: ReadonlySet<RemoteDisconnectReason> =
  new Set(['connect-failed', 'connection-lost', 'lease-stolen', 'agent-exited'])

const sameDisconnect = (a: RemoteWorkspaceState | undefined, b: RemoteWorkspaceState): boolean =>
  !!a && a.phase === 'disconnected' && b.phase === 'disconnected' &&
  a.reason === b.reason && a.diagnostic === b.diagnostic

const toastText = (s: RemoteWorkspaceState): string => {
  const who = s.agentName || s.agentId || 'remote agent'
  const detail = s.diagnostic ? ` — ${s.diagnostic}` : ''
  switch (s.reason) {
    case 'lease-stolen':
      return `Remote workspace disconnected: another client attached to "${who}" and took its sessions${detail}`
    case 'agent-exited':
      return `Remote workspace disconnected: the agent on "${who}" exited${detail}`
    case 'connect-failed':
      return `Connecting to "${who}" failed${detail}`
    default:
      return `The connection to "${who}" was lost${detail}`
  }
}

export function createRemoteSlice(deps: RemoteSliceDeps): RemoteSlice {
  const { set, get } = deps

  const ingest = (next: RemoteWorkspaceState): void => {
    const prev = get().remoteStates[next.workspaceId]
    // Toast policy: exactly one error toast per transition INTO a toast-worthy disconnect —
    // never on an identical re-ingest (a recovery pull echoing the same state must not re-toast).
    if (next.phase === 'disconnected' && next.reason && TOASTED_REASONS.has(next.reason) &&
        !sameDisconnect(prev, next)) {
      deps.pushToast(toastText(next), 'error')
    }
    set(s => ({ remoteStates: { ...s.remoteStates, [next.workspaceId]: next } }))
  }

  return {
    ingestRemoteState: (s) => { ingest(s) },

    /** The remote:current recovery pull (the cloudCurrent precedent): fills ONLY workspaces no
     *  push has already populated — a push applied while the pull was in flight wins (REQ-014). */
    seedRemoteStates: async () => {
      // Push-beats-pull arbitration rides KEY PRESENCE: the seed only fills workspaces no
      // push has already populated (FINDING-004 removed the vestigial flag).
      let states: RemoteWorkspaceState[] = []
      try { states = await deps.remoteCurrent() } catch { return }
      set(s => {
        const remoteStates = { ...s.remoteStates }
        for (const st of states) {
          if (!(st.workspaceId in remoteStates)) remoteStates[st.workspaceId] = st
        }
        return { remoteStates }
      })
    },

    connectRemote: (workspaceId, agentId) => { deps.remoteConnect(workspaceId, agentId) },
    disconnectRemote: (workspaceId) => { deps.remoteDisconnect(workspaceId) },

    loadNamedAgents: async () => {
      try {
        const agents = await deps.remoteAgentsList()
        set({ namedAgents: agents })
      } catch (e) {
        deps.pushToast(`The remote-agent registry could not be read — remote workspaces are unavailable until it loads: ${msg(e)}`, 'error')
      }
    },

    /** Save through the normalizer; on success the RETURNED (normalized) list becomes the truth.
     *  A rejected save toasts once and leaves state unchanged (never a false success). */
    saveNamedAgents: async (agents) => {
      try {
        const saved = await deps.remoteAgentsSave(agents)
        set({ namedAgents: saved })
        return true
      } catch (e) {
        deps.pushToast(`Saving the remote-agent registry failed — nothing was changed on disk: ${msg(e)}`, 'error')
        return false
      }
    },

    /** CONV-011: connection states mirror the live workspace set — prune entries whose workspace
     *  no longer exists (closed / moved away). */
    pruneRemoteStates: (liveWorkspaceIds) => {
      const live = new Set(liveWorkspaceIds)
      const cur = get().remoteStates
      if (Object.keys(cur).every(id => live.has(id))) return
      const remoteStates: Record<string, RemoteWorkspaceState> = {}
      for (const [id, st] of Object.entries(cur)) if (live.has(id)) remoteStates[id] = st
      set({ remoteStates })
    }
  }
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
