// Test suite — feature 0024-agent-daemonization (phase 4, revision 3 — REQ-019, locked D10 /
// FINDING-023; REQ-014's amended confinement).
// Closing a remote workspace TAB must DETACH — never pty:kill — so all three going-away gestures
// (quit-app, banner disconnect, close-tab) share ONE survival story. A LOCAL workspace close and
// an individual pane close stay byte-identical kills.
//
// Chosen contract (frozen here — the implementer builds to this):
//   src/renderer/store/pane-ops.ts (the established api-free module — the pure core must not
//   import renderer/api, per the repo's renderer-injection convention) exports
//     routeWorkspaceTeardown(
//       input: { isRemote: boolean; paneIds: string[] },
//       fns: { kill: (paneId: string) => void; detach: () => void }
//     ): void
//   — remote ⇒ ZERO kill calls + exactly ONE detach (even pane-less); local ⇒ one kill per pane,
//   in order, and never a detach (pane-less local ⇒ nothing at all).
//   store.ts's closeWorkspace consumes it: kill = the per-pane teardownPanes path, detach =
//   disconnectRemote(id, { forget: true }) → pruneRemoteStates — written so TEST-2283's literal
//   source order (teardownPanes( → disconnectRemote( → pruneRemoteStates( after the closeWorkspace
//   anchor) stays satisfiable and that frozen pin needs NO amendment.
//   remote-slice's disconnectRemote(workspaceId, opts?) threads opts UNCHANGED to
//   deps.remoteDisconnect (no opts anywhere else — banner disconnect stays byte-identical).
//   The ipc contract's remoteDisconnect gains ONE additive optional { forget?: boolean } param on
//   the EXISTING remote:disconnect channel — no new channel, no other renderer/preload change
//   (REQ-014).
//
// RUNS RED until routeWorkspaceTeardown exists and the wiring lands.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { routeWorkspaceTeardown } from '../../src/renderer/store/pane-ops'
import { createRemoteSlice, type RemoteSliceDeps } from '../../src/renderer/store/remote-slice'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('TEST-2460 REQ-019 the pure teardown-routing core: a remote close detaches, a local close kills — nothing else', () => {
  it('a REMOTE workspace close issues ZERO kill calls and exactly one detach', () => {
    const kill = vi.fn()
    const detach = vi.fn()
    routeWorkspaceTeardown({ isRemote: true, paneIds: ['p1', 'p2', 'p3'] }, { kill, detach })
    expect(kill, 'NO pty:kill for any of the workspace\'s remote panes (FINDING-023)').not.toHaveBeenCalled()
    expect(detach, 'exactly one detach/disconnect for the workspace').toHaveBeenCalledTimes(1)
  })

  it('a LOCAL workspace close issues one kill per pane, in order, and no detach (corollary a — byte-identical to today)', () => {
    const kill = vi.fn()
    const detach = vi.fn()
    routeWorkspaceTeardown({ isRemote: false, paneIds: ['p1', 'p2', 'p3'] }, { kill, detach })
    expect(kill.mock.calls.map((c) => c[0]), 'one kill per pane, the panes in order').toEqual(['p1', 'p2', 'p3'])
    expect(detach, 'a local close has no detach path').not.toHaveBeenCalled()
  })

  it('edge shapes: a pane-less REMOTE workspace still detaches once; a pane-less LOCAL one does nothing', () => {
    const k1 = vi.fn()
    const d1 = vi.fn()
    routeWorkspaceTeardown({ isRemote: true, paneIds: [] }, { kill: k1, detach: d1 })
    expect(k1).not.toHaveBeenCalled()
    expect(d1, 'the connection still ends / the entry is still forgotten for a pane-less remote workspace').toHaveBeenCalledTimes(1)

    const k2 = vi.fn()
    const d2 = vi.fn()
    routeWorkspaceTeardown({ isRemote: false, paneIds: [] }, { kill: k2, detach: d2 })
    expect(k2).not.toHaveBeenCalled()
    expect(d2).not.toHaveBeenCalled()
  })
})

describe('TEST-2461 REQ-019/REQ-014 the wiring: closeWorkspace consumes the core with { forget: true }; every surface change is additive-only', () => {
  it('store.ts closeWorkspace routes through the pure core, forgets the remote entry, and still clears the pane runtime (corollary c)', () => {
    const src = read('src/renderer/store.ts')
    const iClose = src.indexOf('closeWorkspace: (')
    expect(iClose, 'closeWorkspace exists').toBeGreaterThanOrEqual(0)
    const iRoute = src.indexOf('routeWorkspaceTeardown(', iClose)
    expect(iRoute, 'closeWorkspace consumes the extracted pure routing core').toBeGreaterThan(iClose)
    const iForget = src.indexOf('forget: true', iClose)
    expect(iForget, 'the remote detach passes { forget: true } through the existing disconnectRemote surface').toBeGreaterThan(iClose)
    const iClear = src.indexOf('clearPaneRuntime(', iClose)
    expect(iClear, 'the closed panes\' runtime bookkeeping still clears (no leaked pane runtime)').toBeGreaterThan(iClose)
  })

  it('closePane (an individual pane close) remains a deliberate kill — corollary b, byte-identical', () => {
    const src = read('src/renderer/store.ts')
    const iPane = src.indexOf('closePane: (')
    expect(iPane).toBeGreaterThanOrEqual(0)
    const seg = src.slice(iPane, src.indexOf('scheduleAutosave()', iPane))
    expect(seg, 'one pane close = one kill (the teardownPanes path is untouched)').toContain('teardownPanes([paneId])')
  })

  it('remote-slice threads the additive opts through unchanged; the no-opts call shape stays byte-identical', () => {
    const remoteDisconnect = vi.fn()
    const deps = {
      set: () => {},
      get: () => ({ remoteStates: {}, namedAgents: [] }),
      remoteCurrent: async () => [],
      remoteConnect: () => {},
      remoteDisconnect,
      remoteAgentsList: async () => [],
      remoteAgentsSave: async () => [],
      pushToast: () => {}
    } as unknown as RemoteSliceDeps
    const slice = createRemoteSlice(deps)

    // Every EXISTING call site (banner disconnect, quit path) passes no opts — nothing extra
    // may reach the bridge for them.
    slice.disconnectRemote('w-legacy')
    expect(remoteDisconnect.mock.calls[0][0]).toBe('w-legacy')
    expect(remoteDisconnect.mock.calls[0][1], 'no opts in ⇒ no opts out (byte-identical legacy shape)').toBeUndefined()

    // The close-tab path passes { forget: true } and it arrives UNCHANGED.
    ;(slice.disconnectRemote as unknown as (id: string, opts?: { forget?: boolean }) => void)('w-close', { forget: true })
    expect(remoteDisconnect.mock.calls[1][0]).toBe('w-close')
    expect(remoteDisconnect.mock.calls[1][1]).toEqual({ forget: true })
  })

  it('the ipc contract + preload grow ONE additive optional param on the EXISTING remote:disconnect surface — no new channel', () => {
    const contract = read('src/shared/ipc-contract.ts')
    expect(contract, 'the channel name/direction is unchanged').toContain("remoteDisconnect: 'remote:disconnect'")
    const iDecl = contract.indexOf('remoteDisconnect(')
    expect(iDecl, 'the TermhallaApi method exists').toBeGreaterThanOrEqual(0)
    const decl = contract.slice(iDecl, contract.indexOf(')', iDecl))
    expect(decl, 'the method carries the optional forget opt (additive — existing call shapes compile unchanged)')
      .toContain('forget')

    const preload = read('src/preload/index.ts')
    const iP = preload.indexOf('remoteDisconnect:')
    expect(iP, 'preload implements the bridge method').toBeGreaterThanOrEqual(0)
    const line = preload.slice(iP, preload.indexOf('\n', iP))
    expect(line, 'preload passes the optional second arg through to ipcRenderer.send').toMatch(/\([^)]*,[^)]*\)/)
  })
})
