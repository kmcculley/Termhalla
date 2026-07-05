// FROZEN unit suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-010).
// REQ-014 (the renderer connection-state slice: push ingestion, pull seeding, CONV-011 pruning)
// and REQ-016's outcome-toast policy (the never-silently-dropped chokepoint, CONV-004/CONV-034)
// plus REQ-004's renderer door (named-agent load/save with honest failure).
//
// No jsdom: the slice is driven as plain objects (the F6/F9 slice harness pattern). Chosen
// contract (frozen here):
//
//   src/renderer/store/remote-slice.ts exports
//     createRemoteSlice(deps: {
//       set, get,                                                   // zustand pair
//       remoteCurrent: () => Promise<RemoteWorkspaceState[]>,       // preload bridge, INJECTED
//       remoteConnect: (workspaceId: string, agentId: string) => void,
//       remoteDisconnect: (workspaceId: string) => void,
//       remoteAgentsList: () => Promise<NamedAgent[]>,
//       remoteAgentsSave: (agents: NamedAgent[]) => Promise<NamedAgent[]>,
//       pushToast: (text: string, kind: 'info' | 'success' | 'error') => void
//     }): {
//       ingestRemoteState(s: RemoteWorkspaceState): void   // App routes onRemoteState here
//       seedRemoteStates(): Promise<void>                  // remote:current recovery pull on boot
//       connectRemote(workspaceId: string, agentId: string): void
//       disconnectRemote(workspaceId: string): void
//       loadNamedAgents(): Promise<void>
//       saveNamedAgents(agents: NamedAgent[]): Promise<boolean>
//       pruneRemoteStates(liveWorkspaceIds: string[]): void
//     }
//   over state fields
//     remoteStates: Record<string, RemoteWorkspaceState>   // keyed by workspaceId
//     namedAgents: NamedAgent[]
//
//   Toast policy (REQ-016): a transition INTO phase 'disconnected' with reason
//   'connect-failed' | 'connection-lost' | 'lease-stolen' | 'agent-exited' produces EXACTLY ONE
//   error toast (carrying the diagnostic when present — indeterminate wording preserved,
//   CONV-015/CONV-034); 'cancelled' (the user's own gesture) is silent; re-ingesting an identical
//   disconnected state does not toast again.
//
// Runs RED today: src/renderer/store/remote-slice.ts does not exist.
import { describe, it, expect, vi } from 'vitest'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'
import { createRemoteSlice } from '../../src/renderer/store/remote-slice'

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0))

const st = (over: Partial<RemoteWorkspaceState> = {}): RemoteWorkspaceState => ({
  workspaceId: 'ws-1', agentId: 'a-1', agentName: 'buildbox',
  phase: 'connected', capabilities: ['pty', 'status'], ...over
})

function harness(opts: {
  current?: RemoteWorkspaceState[]
  agents?: unknown[]
  saveRejects?: boolean
  listRejects?: boolean
} = {}) {
  let state: { remoteStates: Record<string, RemoteWorkspaceState>; namedAgents: unknown[] } = {
    remoteStates: {}, namedAgents: []
  }
  const set = (patch: unknown) => {
    state = { ...state, ...(typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch as object) }
  }
  const get = () => state as never
  const toasts: Array<[string, string]> = []
  const pushToast = (text: string, kind: string) => { toasts.push([text, kind]) }
  let releaseCurrent: ((v: RemoteWorkspaceState[]) => void) | null = null
  const remoteCurrent = vi.fn(() => new Promise<RemoteWorkspaceState[]>(r => { releaseCurrent = r }))
  const remoteConnect = vi.fn()
  const remoteDisconnect = vi.fn()
  const remoteAgentsList = vi.fn(async () => {
    if (opts.listRejects) throw new Error('list failed')
    return (opts.agents ?? []) as never
  })
  const remoteAgentsSave = vi.fn(async (agents: unknown) => {
    if (opts.saveRejects) throw new Error('disk write failed')
    return agents as never
  })
  const slice = createRemoteSlice({
    set, get, remoteCurrent, remoteConnect, remoteDisconnect, remoteAgentsList, remoteAgentsSave, pushToast
  } as never)
  return {
    slice, toasts, remoteConnect, remoteDisconnect, remoteAgentsSave,
    state: () => state,
    settleCurrent: (v: RemoteWorkspaceState[]) => { releaseCurrent?.(v) }
  }
}

describe('state ingestion + seeding (REQ-014)', () => {
  it('TEST-2258 REQ-014 pushes upsert by workspaceId, and the recovery pull fills ONLY workspaces no push beat it to', async () => {
    const h = harness()
    const seedP = h.slice.seedRemoteStates()
    h.slice.ingestRemoteState(st({ workspaceId: 'ws-1', phase: 'connecting', capabilities: [] }))
    h.slice.ingestRemoteState(st({ workspaceId: 'ws-1', phase: 'connected' })) // upsert same key
    h.settleCurrent([
      st({ workspaceId: 'ws-1', phase: 'disconnected', reason: 'connection-lost', capabilities: [] }), // stale — a push already landed
      st({ workspaceId: 'ws-2', phase: 'connecting', capabilities: [] })                                 // missed push — recovered
    ])
    await seedP
    await flush()
    expect(h.state().remoteStates['ws-1'].phase).toBe('connected')   // the push wins
    expect(h.state().remoteStates['ws-2'].phase).toBe('connecting')  // the pull recovered it
  })

  it('TEST-2259 REQ-016 the disconnected-transition toast policy: one error toast for failure reasons, none for cancelled, no repeat for identical re-ingest', () => {
    const h = harness()
    h.slice.ingestRemoteState(st({ phase: 'connected' }))
    h.slice.ingestRemoteState(st({ phase: 'disconnected', reason: 'connection-lost', capabilities: [], diagnostic: 'ssh exited 255' }))
    expect(h.toasts.length).toBe(1)
    expect(h.toasts[0][1]).toBe('error')
    expect(h.toasts[0][0]).toContain('ssh exited 255')
    h.slice.ingestRemoteState(st({ phase: 'disconnected', reason: 'connection-lost', capabilities: [], diagnostic: 'ssh exited 255' }))
    expect(h.toasts.length).toBe(1) // identical re-ingest: no duplicate
    h.slice.ingestRemoteState(st({ workspaceId: 'ws-9', phase: 'disconnected', reason: 'cancelled', capabilities: [] }))
    expect(h.toasts.length).toBe(1) // the user's own cancel is silent
    h.slice.ingestRemoteState(st({ workspaceId: 'ws-8', phase: 'disconnected', reason: 'lease-stolen', capabilities: [] }))
    expect(h.toasts.length).toBe(2) // displacement is a real event
  })

  it('TEST-2260 REQ-014 pruneRemoteStates drops entries for workspaces that no longer exist (CONV-011)', () => {
    const h = harness()
    h.slice.ingestRemoteState(st({ workspaceId: 'ws-1' }))
    h.slice.ingestRemoteState(st({ workspaceId: 'ws-dead' }))
    h.slice.pruneRemoteStates(['ws-1'])
    expect(Object.keys(h.state().remoteStates)).toEqual(['ws-1'])
  })
})

describe('named agents (REQ-004)', () => {
  it('TEST-2261 REQ-004 saveNamedAgents applies the RETURNED normalized list on success; a rejected save toasts once and leaves state unchanged', async () => {
    const ok = harness()
    const good = [{ id: 'a-1', name: 'n', host: 'h', user: 'u' }]
    expect(await ok.slice.saveNamedAgents(good as never)).toBe(true)
    expect(ok.state().namedAgents).toEqual(good)

    const bad = harness({ saveRejects: true })
    bad.slice.ingestRemoteState(st())
    expect(await bad.slice.saveNamedAgents(good as never)).toBe(false)
    expect(bad.state().namedAgents).toEqual([])
    expect(bad.toasts.filter(([, k]) => k === 'error').length).toBe(1)
    expect(bad.toasts[0][0].length).toBeGreaterThan(20) // actionable (CONV-001)
  })

  it('TEST-2262 REQ-004 loadNamedAgents populates from the bridge; a rejected load toasts and keeps []', async () => {
    const ok = harness({ agents: [{ id: 'a-1', name: 'n', host: 'h', user: 'u' }] })
    await ok.slice.loadNamedAgents()
    expect(ok.state().namedAgents).toEqual([{ id: 'a-1', name: 'n', host: 'h', user: 'u' }])

    const bad = harness({ listRejects: true })
    await bad.slice.loadNamedAgents()
    expect(bad.state().namedAgents).toEqual([])
    expect(bad.toasts.filter(([, k]) => k === 'error').length).toBe(1)
  })
})

describe('connect/disconnect passthrough (REQ-014)', () => {
  it('TEST-2277 REQ-014 connectRemote/disconnectRemote forward to the injected bridge (fire-and-forget)', () => {
    const h = harness()
    h.slice.connectRemote('ws-1', 'a-1')
    expect(h.remoteConnect).toHaveBeenCalledWith('ws-1', 'a-1')
    h.slice.disconnectRemote('ws-1')
    expect(h.remoteDisconnect).toHaveBeenCalledWith('ws-1')
  })
})
