// 0024 ledger FINDING-029 (deferred at human-review, fixed 2026-07-07): the REQ-019 close-tab
// detach (`disconnectWorkspace(id, { forget: true })`) deleted the manager entry but never pruned
// `paneIndex` (paneId -> workspaceId) — the only cleanups live in kill() (deliberately skipped on
// detach) and prunePane() (unreachable once the entry is gone). Every close-tab detach leaked one
// entry per tracked pane in a process-lifetime main singleton, and owns()/isAdoptable() kept
// answering true for the dead ids (register-pty routes pty ops on owns()).
//
// Harness: the frozen remote-manager stub-wire pattern (remote-manager-harness.ts).
import { describe, it, expect } from 'vitest'
import { CH } from '@shared/ipc-contract'
import { mkHarness, settle } from './remote-manager-harness'

const WS = 'ws-1'
const spawnArgs = (id: string) => ({
  id, shellId: 'sh-1', cwd: '', cols: 80, rows: 24,
  remote: { workspaceId: WS, agentId: 'a-1' }
})

describe('forget-disconnect prunes paneIndex without killing (0024 FINDING-029)', () => {
  it('after a close-tab detach with tracked panes, owns()/isAdoptable() answer false and NO pty:kill reached the wire', async () => {
    const h = mkHarness({ wireOpts: { respond: { 'pty:sessions': () => [], 'pty:spawn': () => null } } })
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await h.mgr.spawn(spawnArgs('p-2') as never)
    await settle()
    expect(h.mgr.owns('p-1')).toBe(true)
    expect(h.mgr.owns('p-2')).toBe(true)

    h.mgr.disconnectWorkspace(WS, { forget: true })

    // the detach point: local bookkeeping fully forgotten...
    expect(h.mgr.owns('p-1'), 'paneIndex must be pruned on the forget branch').toBe(false)
    expect(h.mgr.owns('p-2')).toBe(false)
    expect(h.mgr.isAdoptable('p-1')).toBe(false)
    expect(h.mgr.currentStates().find(s => s.workspaceId === WS)).toBeUndefined()
    // ...while the remote PTYs were never killed (REQ-019: detach, not kill)
    const kills = h.wires[0].reqs().filter(r => r.method === CH.ptyKill)
    expect(kills, 'a forget disconnect must not send pty:kill').toEqual([])
  })

  it('the pre-0024 shapes are untouched: a pane-less disconnect still forgets, a paned NON-forget disconnect keeps its entry AND its paneIndex', async () => {
    const h = mkHarness({ wireOpts: { respond: { 'pty:sessions': () => [], 'pty:spawn': () => null } } })
    await h.mgr.spawn(spawnArgs('p-1') as never)
    await settle()

    // banner-style disconnect (no opts): the frozen-panes state — entry AND index survive
    h.mgr.disconnectWorkspace(WS)
    expect(h.mgr.owns('p-1'), 'a non-forget disconnect keeps the pane tracked for reconnect').toBe(true)
    expect(h.mgr.currentStates().find(s => s.workspaceId === WS)).toBeDefined()
  })
})
