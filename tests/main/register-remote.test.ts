// FROZEN test suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-003 +
// TASK-004 + TASK-009 + TASK-015).
// REQ-005 (the remote:* contract surface + preload bridge), REQ-004 (the registrar's agents
// handlers ride the injected IO seam), REQ-019 + REQ-008 (the register-pty delegation branch:
// remote spawns never touch the local stack; local ops never touch the manager — structural,
// CONV-032-anchored source pins), REQ-010/REQ-006 (composition: register.ts composes the remote
// registrar; services.ts constructs the manager ONCE with the routed send + real scheduler and
// stops it on shutdown).
//
// The registrar is driven with electron MOCKED (the register-registry-detail.test.ts pattern).
//
// Runs RED today: CH has no remote:* channels, register-remote.ts does not exist, and the
// register-pty source has no delegation branch.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
import { registerRemote } from '../../src/main/ipc/register-remote'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k]
  for (const k of Object.keys(onHandlers)) delete onHandlers[k]
})

describe('contract surface (REQ-005)', () => {
  it('TEST-2254 REQ-005 the six remote:* channels exist with domain:verb names, and PtySpawnArgs grows an OPTIONAL remote field', () => {
    expect(CH.remoteAgentsList).toBe('remote:agentsList')
    expect(CH.remoteAgentsSave).toBe('remote:agentsSave')
    expect(CH.remoteConnect).toBe('remote:connect')
    expect(CH.remoteDisconnect).toBe('remote:disconnect')
    expect(CH.remoteState).toBe('remote:state')
    expect(CH.remoteCurrent).toBe('remote:current')
    const contract = read('src/shared/ipc-contract.ts')
    // The optional remote routing hint lives on PtySpawnArgs (absent for local spawns):
    const iArgs = contract.indexOf('interface PtySpawnArgs')
    expect(iArgs).toBeGreaterThanOrEqual(0)
    const argsLine = contract.slice(iArgs, contract.indexOf('}', iArgs))
    expect(argsLine).toMatch(/remote\?\s*:/)
    // The renderer-facing api methods exist on the TermhallaApi interface:
    for (const m of ['remoteAgentsList', 'remoteAgentsSave', 'remoteConnect', 'remoteDisconnect', 'remoteCurrent', 'onRemoteState']) {
      expect(contract).toContain(m)
    }
    // Preload implements them (the bridge is the only Node/renderer boundary):
    const preload = read('src/preload/index.ts')
    for (const m of ['remoteAgentsList', 'remoteAgentsSave', 'remoteConnect', 'remoteDisconnect', 'remoteCurrent', 'onRemoteState']) {
      expect(preload).toContain(m)
    }
  })
})

describe('registrar handlers (REQ-004, REQ-005)', () => {
  const mkManager = () => ({
    connectWorkspace: vi.fn(async () => {}),
    disconnectWorkspace: vi.fn(),
    currentStates: vi.fn(() => [{ workspaceId: 'ws-1', agentId: 'a-1', agentName: 'n', phase: 'connected', capabilities: ['pty'] }])
  })

  it('TEST-2255 REQ-004 REQ-005 registerRemote wires list/save through the injected IO, current through the manager, and connect/disconnect as fire-and-forget', async () => {
    const io = {
      list: vi.fn(async () => [{ id: 'a-1', name: 'n', host: 'h', user: 'u' }]),
      save: vi.fn(async (agents: unknown) => agents as never)
    }
    const mgr = mkManager()
    registerRemote({ manager: mgr as never, agentsIo: io as never })
    // handle-style surfaces:
    expect(typeof handlers[CH.remoteAgentsList]).toBe('function')
    expect(typeof handlers[CH.remoteAgentsSave]).toBe('function')
    expect(typeof handlers[CH.remoteCurrent]).toBe('function')
    // fire-and-forget surfaces:
    expect(typeof onHandlers[CH.remoteConnect]).toBe('function')
    expect(typeof onHandlers[CH.remoteDisconnect]).toBe('function')

    const listed = await handlers[CH.remoteAgentsList]({} as never)
    expect(io.list).toHaveBeenCalled()
    expect(listed).toEqual([{ id: 'a-1', name: 'n', host: 'h', user: 'u' }])
    await handlers[CH.remoteAgentsSave]({} as never, [{ id: 'a-2', name: 'n2', host: 'h2', user: 'u2' }])
    expect(io.save).toHaveBeenCalled()
    const current = await handlers[CH.remoteCurrent]({} as never)
    expect(mgr.currentStates).toHaveBeenCalled()
    expect(Array.isArray(current)).toBe(true)
    onHandlers[CH.remoteConnect]({} as never, { workspaceId: 'ws-1', agentId: 'a-1' })
    expect(mgr.connectWorkspace).toHaveBeenCalledWith('ws-1', 'a-1')
    onHandlers[CH.remoteDisconnect]({} as never, 'ws-1')
    expect(mgr.disconnectWorkspace).toHaveBeenCalledWith('ws-1')
  })
})

describe('sender gating (REQ-005 / FINDING-001 — added at the 2026-07-04 review→tests loopback)', () => {
  it('TEST-2281 REQ-005 with isKnownWindowSender provided, an unknown sender is refused on every remote:* surface and the manager is never touched', async () => {
    const io = { list: vi.fn(async () => []), save: vi.fn(async (a: unknown) => a as never) }
    const mgr = { connectWorkspace: vi.fn(async () => {}), disconnectWorkspace: vi.fn(), currentStates: vi.fn(() => []) }
    registerRemote({ manager: mgr as never, agentsIo: io as never, isKnownWindowSender: () => false })
    const evt = { sender: {} } as never
    await expect(Promise.resolve(handlers[CH.remoteAgentsList](evt)).then(v => v)).resolves.toEqual([])
    expect(io.list).not.toHaveBeenCalled()
    await expect(Promise.resolve(handlers[CH.remoteAgentsSave](evt, [{ id: 'a', name: 'n', host: 'h', user: 'u' }]))).rejects.toBeTruthy()
    expect(io.save).not.toHaveBeenCalled()
    await expect(Promise.resolve(handlers[CH.remoteCurrent](evt))).resolves.toEqual([])
    expect(mgr.currentStates).not.toHaveBeenCalled()
    onHandlers[CH.remoteConnect](evt, { workspaceId: 'ws-1', agentId: 'a-1' })
    onHandlers[CH.remoteDisconnect](evt, 'ws-1')
    expect(mgr.connectWorkspace).not.toHaveBeenCalled()
    expect(mgr.disconnectWorkspace).not.toHaveBeenCalled()
    // and a KNOWN sender still flows (the gate is a filter, not a lock):
    registerRemote({ manager: mgr as never, agentsIo: io as never, isKnownWindowSender: () => true })
    onHandlers[CH.remoteConnect](evt, { workspaceId: 'ws-1', agentId: 'a-1' })
    expect(mgr.connectWorkspace).toHaveBeenCalledWith('ws-1', 'a-1')
  })
})

describe('delegation + composition (REQ-008, REQ-010, REQ-019 — structural, CONV-032-anchored)', () => {
  it('TEST-2256 REQ-019 REQ-008 register-pty: the remote spawn branch returns BEFORE the local stack is touched, and write/resize/kill consult the remote probe before the local pty', () => {
    const src = read('src/main/ipc/register-pty.ts')
    // Spawn handler: the remote branch precedes (and short-circuits) tracker.register + pty.spawn.
    const iSpawnHandler = src.indexOf('CH.ptySpawn')
    const iRemoteBranch = src.indexOf('.remote', iSpawnHandler)
    const iRegister = src.indexOf('tracker.register', iSpawnHandler)
    const iLocalSpawn = src.indexOf('pty.spawn', iSpawnHandler)
    expect(iSpawnHandler).toBeGreaterThanOrEqual(0)
    expect(iRemoteBranch, 'ptySpawn must branch on args.remote').toBeGreaterThan(iSpawnHandler)
    expect(iRemoteBranch).toBeLessThan(iRegister)
    expect(iRemoteBranch).toBeLessThan(iLocalSpawn)
    // Ops: each local call site is guarded by the remote-ownership probe first.
    for (const [handler, localCall] of [
      ['CH.ptyWrite', 'pty.write'],
      ['CH.ptyResize', 'pty.resize'],
      ['CH.ptyKill', 'pty.kill']
    ] as const) {
      const iH = src.indexOf(handler)
      expect(iH, `${handler} handler exists`).toBeGreaterThanOrEqual(0)
      const iProbe = src.indexOf('owns(', iH)
      const iLocal = src.indexOf(localCall, iH)
      expect(iProbe, `${handler} consults the remote probe`).toBeGreaterThan(iH)
      expect(iProbe, `${handler} probe precedes the local ${localCall}`).toBeLessThan(iLocal)
    }
  })

  it('TEST-2257 REQ-010 REQ-006 composition: register.ts composes registerRemote; services.ts constructs ONE manager with real timers and stops it on shutdown', () => {
    const reg = read('src/main/ipc/register.ts')
    expect(reg).toMatch(/registerRemote/)
    const services = read('src/main/services.ts')
    expect(services).toMatch(/RemoteWorkspaceManager/)
    expect((services.match(/new RemoteWorkspaceManager/g) ?? []).length).toBe(1) // ONE instance app-wide
    expect(services).toMatch(/\.stop\(\)/) // shutdown abort wiring (the long-lived-child gotcha)
  })
})
