// Test suite — feature 0024-agent-daemonization (phase 4, revision 3 — REQ-019, locked D10 /
// FINDING-023; REQ-014's amended confinement): the close-tab detach path on the MAIN side.
//
// Chosen contract (frozen here — the implementer builds to this):
//   RemoteWorkspaceManager.disconnectWorkspace(workspaceId, opts?: { forget?: boolean })
//     — NO opts: BYTE-IDENTICAL to today (an entry with tracked panes survives the disconnect —
//       the banner's frozen-panes state; every existing caller passes no opts);
//     — { forget: true }: the wire tears down through the SAME teardownWire semantics (the
//       connection ends), NO pty:kill frame is EVER sent for the workspace's panes, and the
//       entry is REMOVED from currentStates() even with panes still tracked — detach-then-forget
//       (the no-ghost discipline TEST-2283 pinned, now achieved without killing): the daemon and
//       its PTYs are a SEPARATE process untouched by forgetting local bookkeeping.
//   register-remote's remote:disconnect listener reads an optional second IPC arg, VALIDATED
//   (an object with an optional boolean forget; anything else is treated as absent — renderer
//   input is never trusted blindly), and passes it to manager.disconnectWorkspace.
//
// Canned transport (the frozen remote-manager-harness); electron mocked (the register-remote
// pattern). RUNS RED until the additive param lands.
import { describe, it, expect, vi } from 'vitest'

const handlers: Record<string, (...a: unknown[]) => unknown> = {}
const onHandlers: Record<string, (...a: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers[ch] = fn },
    on: (ch: string, fn: (...a: unknown[]) => unknown) => { onHandlers[ch] = fn },
    removeHandler: (ch: string) => { delete handlers[ch] },
    removeAllListeners: (ch: string) => { delete onHandlers[ch] }
  }
}))

import { CH } from '@shared/ipc-contract'
import { mkHarness, settle, type Harness } from './remote-manager-harness'
import { registerRemote } from '../../src/main/ipc/register-remote'
import type { RemoteWorkspaceManager } from '../../src/main/remote/remote-workspace-manager'

const connectAndSpawn = async (h: Harness): Promise<void> => {
  await h.mgr.connectWorkspace('ws-1', 'a-1')
  await settle()
  await h.mgr.spawn({
    id: 'p1', shellId: 'sh', cwd: '/', cols: 80, rows: 24,
    remote: { workspaceId: 'ws-1', agentId: 'a-1' }
  })
  await settle()
}

const respond = { 'pty:sessions': (): unknown[] => [], 'pty:spawn': (): null => null }

describe('TEST-2462 REQ-019/REQ-014 disconnectWorkspace: detach-then-forget on the close-tab shape; byte-identical otherwise', () => {
  it('no opts (the banner disconnect / cancel): an entry with tracked panes SURVIVES — unchanged behavior', async () => {
    const h = mkHarness({ wireOpts: { respond } })
    await connectAndSpawn(h)
    h.mgr.disconnectWorkspace('ws-1')
    await settle()
    const states = h.mgr.currentStates()
    expect(states.map((s) => s.workspaceId), 'the frozen-panes entry is the banner\'s state (every existing caller is byte-identical)')
      .toContain('ws-1')
    expect(states.find((s) => s.workspaceId === 'ws-1')?.phase).toBe('disconnected')
  })

  it('{ forget: true } with tracked panes: the connection ends, NO pty:kill crosses the wire, and NO ghost stays in currentStates()', async () => {
    const h = mkHarness({ wireOpts: { respond } })
    await connectAndSpawn(h)
    expect(h.wires, 'one established wire').toHaveLength(1)

    ;(h.mgr.disconnectWorkspace as unknown as (id: string, opts?: { forget?: boolean }) => void)('ws-1', { forget: true })
    await settle()

    expect(h.wires[0].killed(), 'the wire tears down through the same teardownWire semantics — the connection ends').toBe(true)
    expect(h.wires[0].reqs().map((r) => r.method), 'a tab close NEVER kills the workspace\'s remote panes (not over the wire, not at all)')
      .not.toContain(CH.ptyKill)
    expect(h.mgr.currentStates().map((s) => s.workspaceId),
      'the entry is forgotten even with panes still tracked — detach-then-forget, no ghost (the TEST-2283 intent, re-pinned)')
      .not.toContain('ws-1')
  })

  it('register-remote: the optional second IPC arg passes through VALIDATED — junk from the renderer never forges a forget', () => {
    const disconnectWorkspace = vi.fn()
    const mgr = {
      disconnectWorkspace,
      connectWorkspace: vi.fn(async () => {}),
      currentStates: () => []
    } as unknown as RemoteWorkspaceManager
    const dispose = registerRemote({ manager: mgr, agentsIo: { list: async () => [], save: async () => [] } })
    const e = { sender: {} }

    // The close-tab shape reaches the manager with the flag intact.
    onHandlers[CH.remoteDisconnect](e, 'ws-9', { forget: true })
    expect(disconnectWorkspace).toHaveBeenCalledTimes(1)
    expect(disconnectWorkspace.mock.calls[0][0]).toBe('ws-9')
    expect((disconnectWorkspace.mock.calls[0][1] as { forget?: unknown } | undefined)?.forget,
      'the forget flag reaches the manager').toBe(true)

    // Malformed opts are treated as ABSENT (the disconnect still runs) — a junk shape must
    // never surface manager-side as a truthy forget.
    disconnectWorkspace.mockClear()
    onHandlers[CH.remoteDisconnect](e, 'ws-9', 'evil-string')
    onHandlers[CH.remoteDisconnect](e, 'ws-9', { forget: 'yes' })
    onHandlers[CH.remoteDisconnect](e, 'ws-9')
    expect(disconnectWorkspace, 'a malformed opts never drops the disconnect itself').toHaveBeenCalledTimes(3)
    for (const call of disconnectWorkspace.mock.calls) {
      expect(call[0]).toBe('ws-9')
      const forget = (call[1] as { forget?: unknown } | undefined)?.forget
      expect(forget, `junk opts are treated as absent — got ${JSON.stringify(call[1])}`).toBeFalsy()
    }

    // The existing validation is untouched: a non-string workspaceId is still dropped.
    disconnectWorkspace.mockClear()
    onHandlers[CH.remoteDisconnect](e, 42, { forget: true })
    expect(disconnectWorkspace).not.toHaveBeenCalled()

    dispose()
  })
})
