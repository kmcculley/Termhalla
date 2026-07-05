// FROZEN test suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-006).
// REQ-006 (one connection per workspace, coalesced triggers, unknown-agent refusal),
// REQ-007 (caller-owned cancellation via AbortSignal; diagnostics pass through unweakened;
// stop() aborts everything), REQ-012 (lease:revoked -> disconnected/lease-stolen, final-frame),
// REQ-013 (exit classification; a terminal reason is never overwritten), REQ-014 (remote:state
// pushes + currentStates snapshot).
//
// Runs RED today: src/main/remote/remote-workspace-manager.ts does not exist.
import { describe, it, expect } from 'vitest'
import { CH } from '@shared/ipc-contract'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'
import { mkHarness, mkWire, settle, AGENTS } from './remote-manager-harness'

const WS = 'ws-1'

const statesOf = (h: ReturnType<typeof mkHarness>): RemoteWorkspaceState[] =>
  h.sendsOn(CH.remoteState).map(a => a[0] as RemoteWorkspaceState)

describe('connection lifecycle (REQ-006, REQ-014)', () => {
  it('TEST-2226 REQ-014 connectWorkspace pushes connecting then connected (with the advertised capabilities + agent name); currentStates mirrors the latest', async () => {
    const h = mkHarness()
    await h.mgr.connectWorkspace(WS, 'a-1')
    await settle()
    const states = statesOf(h)
    expect(states.length).toBeGreaterThanOrEqual(2)
    expect(states[0]).toMatchObject({ workspaceId: WS, agentId: 'a-1', agentName: 'buildbox', phase: 'connecting' })
    const connected = states[states.length - 1]
    expect(connected).toMatchObject({ phase: 'connected', capabilities: ['pty', 'status'] })
    expect(h.mgr.currentStates()).toEqual([connected])
  })

  it('TEST-2227 REQ-006 concurrent triggers coalesce onto ONE in-flight attempt (never a second connect per workspace)', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>(r => { release = r })
    const h = mkHarness({
      connect: (async () => {
        await gate
        const w = mkWire({ respond: { 'pty:sessions': () => [], 'pty:spawn': () => null } })
        ;(h as unknown as { wires: unknown[] }).wires.push(w)
        return { ok: true, session: w.wire }
      }) as never
    })
    const p1 = h.mgr.connectWorkspace(WS, 'a-1')
    const p2 = h.mgr.connectWorkspace(WS, 'a-1')
    const p3 = h.mgr.spawn({ id: 'p-1', shellId: 'sh', cwd: '', cols: 80, rows: 24, remote: { workspaceId: WS, agentId: 'a-1' } } as never)
    await settle()
    expect(h.connect).toHaveBeenCalledTimes(1)
    release!()
    await Promise.all([p1, p2])
    await p3
    expect(h.connect).toHaveBeenCalledTimes(1)
  })

  it('TEST-2228 REQ-006 an unknown agentId refuses with disconnected/connect-failed naming the id — the connect fn is never invoked', async () => {
    const h = mkHarness()
    await h.mgr.connectWorkspace(WS, 'a-missing')
    await settle()
    expect(h.connect).not.toHaveBeenCalled()
    const last = statesOf(h).pop()!
    expect(last.phase).toBe('disconnected')
    expect(last.reason).toBe('connect-failed')
    expect(last.diagnostic).toContain('a-missing')
  })

  it('TEST-2229 REQ-006 an EMPTY agentId (the coerced malformed-home value) refuses actionably — never a local fallback, never a throw', async () => {
    const h = mkHarness()
    await h.mgr.connectWorkspace(WS, '')
    await settle()
    expect(h.connect).not.toHaveBeenCalled()
    const last = statesOf(h).pop()!
    expect(last.phase).toBe('disconnected')
    expect(last.reason).toBe('connect-failed')
    expect((last.diagnostic ?? '').length).toBeGreaterThan(20)
  })
})

describe('cancellation + diagnostics (REQ-007)', () => {
  it('TEST-2230 REQ-007 disconnectWorkspace during connecting ABORTS the in-flight attempt (signal observed) and settles disconnected/cancelled', async () => {
    let sawAbort = false
    const h = mkHarness({
      connect: (async (opts: { signal: AbortSignal }) => {
        return await new Promise((resolve) => {
          opts.signal.addEventListener('abort', () => {
            sawAbort = true
            resolve({ ok: false, kind: 'aborted', diagnostic: 'aborted by caller' })
          })
        })
      }) as never
    })
    const p = h.mgr.connectWorkspace(WS, 'a-1')
    await settle(1)
    h.mgr.disconnectWorkspace(WS)
    await p
    await settle()
    expect(sawAbort).toBe(true)
    const last = statesOf(h).pop()!
    expect(last.phase).toBe('disconnected')
    expect(last.reason).toBe('cancelled')
  })

  it('TEST-2231 REQ-007 a provision-ineffective failure surfaces its diagnostic UNWEAKENED (the node-missing hint survives verbatim)', async () => {
    const diag = 'provisioning did not fix the launch failure: probe exit 127 - the remote node may be missing from the login shell PATH'
    const h = mkHarness({ connectResults: [{ ok: false, kind: 'provision-ineffective', diagnostic: diag }] })
    await h.mgr.connectWorkspace(WS, 'a-1')
    await settle()
    const last = statesOf(h).pop()!
    expect(last).toMatchObject({ phase: 'disconnected', reason: 'connect-failed', diagnostic: diag })
  })

  it('TEST-2232 REQ-007 stop() aborts an in-flight attempt AND kills live sessions (nothing keeps the loop alive)', async () => {
    const h = mkHarness()
    await h.mgr.connectWorkspace('ws-live', 'a-1')
    await settle()
    let aborted = false
    const hanging = new Promise(() => { /* never settles on its own */ })
    const hAll = mkHarness({
      connect: (async (opts: { signal: AbortSignal }) => {
        opts.signal.addEventListener('abort', () => { aborted = true })
        return hanging as never
      }) as never
    })
    void hAll.mgr.connectWorkspace('ws-pending', 'a-1')
    await settle(1)
    hAll.mgr.stop()
    expect(aborted).toBe(true)
    // the first harness's live wire dies on ITS stop
    h.mgr.stop()
    expect(h.wires[0].killed()).toBe(true)
  })
})

describe('lease displacement + exit classification (REQ-012, REQ-013)', () => {
  it('TEST-2233 REQ-012 lease:revoked -> disconnected/lease-stolen pushed exactly once; frames after the revocation are ignored', async () => {
    const h = mkHarness()
    await h.mgr.connectWorkspace(WS, 'a-1')
    await settle()
    const w = h.wires[0]
    w.push({ type: 'evt', channel: 'lease:revoked', args: [] })
    await settle()
    const after = statesOf(h).filter(s => s.phase === 'disconnected')
    expect(after.length).toBe(1)
    expect(after[0].reason).toBe('lease-stolen')
    const dataBefore = h.sendsOn(CH.ptyData).length
    w.push({ type: 'evt', channel: CH.ptyData, args: ['p-x', 'late bytes'] })
    await settle()
    expect(h.sendsOn(CH.ptyData).length).toBe(dataBefore) // nothing follows the final frame
  })

  it('TEST-2234 REQ-013 wire exit classifies: code 0 -> agent-exited, non-zero -> connection-lost; a terminal reason is never overwritten', async () => {
    const h1 = mkHarness()
    await h1.mgr.connectWorkspace(WS, 'a-1')
    await settle()
    h1.wires[0].exit(0)
    await settle()
    expect(statesOf(h1).pop()).toMatchObject({ phase: 'disconnected', reason: 'agent-exited' })

    const h2 = mkHarness()
    await h2.mgr.connectWorkspace(WS, 'a-1')
    await settle()
    h2.wires[0].exit(255)
    await settle()
    expect(statesOf(h2).pop()).toMatchObject({ phase: 'disconnected', reason: 'connection-lost' })

    const h3 = mkHarness()
    await h3.mgr.connectWorkspace(WS, 'a-1')
    await settle()
    h3.wires[0].push({ type: 'evt', channel: 'lease:revoked', args: [] })
    await settle()
    h3.wires[0].exit(0) // the post-revocation exit must not repaint the reason
    await settle()
    const disc = statesOf(h3).filter(s => s.phase === 'disconnected')
    expect(disc[disc.length - 1].reason).toBe('lease-stolen')
  })

  it('TEST-2282 REQ-014 disconnecting a PANE-LESS workspace forgets its entry (CONV-011: currentStates serves no ghosts) while a workspace with tracked panes is retained — added at the 2026-07-04 review→tests loopback (FINDING-002)', async () => {
    const h = mkHarness({ wireOpts: { respond: { 'pty:sessions': () => [], 'pty:spawn': () => null } } })
    await h.mgr.connectWorkspace('ws-empty', 'a-1')
    await settle()
    h.mgr.disconnectWorkspace('ws-empty')
    await settle()
    // the cancelled push still happened (the banner's last observable state)...
    expect(h.sendsOn(CH.remoteState).map(a => a[0] as RemoteWorkspaceState)
      .some(s => s.workspaceId === 'ws-empty' && s.phase === 'disconnected' && s.reason === 'cancelled')).toBe(true)
    // ...but the entry is FORGOTTEN: no ghost in the recovery pull.
    expect(h.mgr.currentStates().map(s => s.workspaceId)).not.toContain('ws-empty')

    await h.mgr.spawn({ id: 'p-keep', shellId: 'sh', cwd: '', cols: 80, rows: 24, remote: { workspaceId: 'ws-panes', agentId: 'a-1' } } as never)
    await settle()
    h.mgr.disconnectWorkspace('ws-panes')
    await settle()
    expect(h.mgr.currentStates().map(s => s.workspaceId)).toContain('ws-panes') // frozen panes keep their state entry
    expect(h.mgr.owns('p-keep')).toBe(true)
  })

  it('TEST-2235 REQ-013 REQ-014 a reconnect after disconnect runs a FRESH attempt: connecting -> connected pushed again, new wire minted', async () => {
    const h = mkHarness()
    await h.mgr.connectWorkspace(WS, 'a-1')
    await settle()
    h.wires[0].exit(255)
    await settle()
    await h.mgr.connectWorkspace(WS, 'a-1')
    await settle()
    expect(h.connect).toHaveBeenCalledTimes(2)
    expect(h.wires.length).toBe(2)
    expect(statesOf(h).pop()).toMatchObject({ phase: 'connected' })
  })
})
