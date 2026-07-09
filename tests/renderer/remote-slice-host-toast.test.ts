// The multi-window disconnect-toast gate (0022 FINDING-006, fixed 2026-07-09). `remote:state` is
// an app-global broadcast, so every window's slice ingests the same disconnected transition —
// each used to toast it, one duplicate per open window for a single moment. The toast is now
// gated on the OPTIONAL injected `hostsWorkspace` (this window renders the workspace, i.e. its
// banner): exactly the banner's window raises the toast. The dep is optional so the FROZEN
// single-window contract (tests/renderer/remote-slice.test.ts, whose harness injects no such
// dep) is byte-identical — absent means toast, exactly as before.
import { describe, it, expect, vi } from 'vitest'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'
import { createRemoteSlice } from '../../src/renderer/store/remote-slice'

const st = (over: Partial<RemoteWorkspaceState> = {}): RemoteWorkspaceState => ({
  workspaceId: 'ws-1', agentId: 'a-1', agentName: 'buildbox',
  phase: 'connected', capabilities: ['pty', 'status'], ...over
})

const lost = (): RemoteWorkspaceState =>
  st({ phase: 'disconnected', reason: 'connection-lost', capabilities: [], diagnostic: 'wire died' })

function harness(hostsWorkspace?: (id: string) => boolean) {
  let state = { remoteStates: {} as Record<string, RemoteWorkspaceState>, namedAgents: [] }
  const pushToast = vi.fn()
  const slice = createRemoteSlice({
    set: (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } },
    get: () => state,
    remoteCurrent: async () => [],
    remoteConnect: vi.fn(),
    remoteDisconnect: vi.fn(),
    remoteAgentsList: async () => [],
    remoteAgentsSave: async (a) => a,
    pushToast,
    ...(hostsWorkspace ? { hostsWorkspace } : {})
  })
  return { slice, pushToast, get state() { return state } }
}

describe('remote disconnect toast: hosting-window gate', () => {
  it('the window hosting the workspace toasts the transition', () => {
    const h = harness(() => true)
    h.slice.ingestRemoteState(lost())
    expect(h.pushToast).toHaveBeenCalledTimes(1)
    expect(h.pushToast.mock.calls[0][1]).toBe('error')
  })

  it('a window NOT hosting the workspace ingests the state silently', () => {
    const h = harness(() => false)
    h.slice.ingestRemoteState(lost())
    expect(h.pushToast).not.toHaveBeenCalled()
    // The state itself still lands — only the toast is gated, never the banner's data.
    expect(h.state.remoteStates['ws-1']?.reason).toBe('connection-lost')
  })

  it('absent dep = the frozen single-window contract (toast fires)', () => {
    const h = harness(undefined)
    h.slice.ingestRemoteState(lost())
    expect(h.pushToast).toHaveBeenCalledTimes(1)
  })

  it('the gate consults the ingesting window per workspace id', () => {
    const hosts = vi.fn((id: string) => id === 'ws-hosted')
    const h = harness(hosts)
    h.slice.ingestRemoteState(lost())
    h.slice.ingestRemoteState(st({ workspaceId: 'ws-hosted', phase: 'disconnected', reason: 'agent-exited', capabilities: [] }))
    expect(hosts).toHaveBeenCalledWith('ws-1')
    expect(hosts).toHaveBeenCalledWith('ws-hosted')
    expect(h.pushToast).toHaveBeenCalledTimes(1)
  })
})
