// FROZEN integration suite — feature 0007-orky-action-dispatch (phase 4 / TASK-010).
// REQ-001 / REQ-003 / REQ-018.
//
// Targets `src/main/ipc/register-orky-action.ts` — the `orkyAction:*` IPC registrar. Mirrors
// tests/main/register-registry.test.ts's mocking style: `electron` is mocked (`ipcMain.handle`/
// `removeHandler`) and a FAKE dispatcher object (satisfying the `OrkyActionDispatcher` surface this
// registrar depends on) is injected, so this drives the REAL `registerOrkyAction` with no Electron runtime
// and no real CLI/audit/queue machinery.
//
// Chosen contract (TASK-010 prose is authoritative; this suite freezes the exact shape):
//   registerOrkyAction(dispatcher: OrkyActionDispatcher, isKnownWindowSender?: (sender: WebContents) => boolean): Disposer
// A rejected sender NEVER calls into the dispatcher (REQ-003's "without invoking any CLI" is satisfied
// trivially — sender rejection happens strictly BEFORE the dispatcher method runs) and returns the exact
// literal rejection object TASK-010 specifies:
//   { ok:false, path:null, dispatched:false, errorKind:'unknown-sender', error:'rejected: sender is not a known app window' }
// `isKnownWindowSender` defaults to allow-all (`() => true`) exactly like `registerRegistry`'s own
// predicate default, so tests that omit it are unaffected; the composition root passes the real
// `wm.isKnownWindowSender`. No push-event wiring exists anywhere in this registrar (REQ-001: no
// main->renderer channel in this feature).
//
// Runs RED today: `src/main/ipc/register-orky-action.ts` does not exist yet (module-not-found).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (...a: unknown[]) => unknown> = {}
const removedHandlers: string[] = []
const onListeners: string[] = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers[ch] = fn },
    removeHandler: (ch: string) => { removedHandlers.push(ch) },
    on: (ch: string) => { onListeners.push(ch) },
    removeListener: () => {}
  }
}))

import { CH } from '@shared/ipc-contract'
import { registerOrkyAction } from '../../src/main/ipc/register-orky-action'

const REJECTED = { ok: false, path: null, dispatched: false, errorKind: 'unknown-sender', error: 'rejected: sender is not a known app window' }

function makeFakeDispatcher() {
  return {
    resolveEscalation: vi.fn(async () => ({ ok: true, path: 'feedback', dispatched: true })),
    submitWork: vi.fn(async () => ({ ok: true, path: 'feedback', dispatched: true })),
    recordHumanGate: vi.fn(async () => ({ ok: true, path: 'gatekeeper', dispatched: true })),
    driveStatus: vi.fn(async () => ({ ok: true, path: 'gatekeeper', dispatched: false })),
    dispose: vi.fn()
  }
}

describe('registerOrkyAction — ipcMain.handle wiring (REQ-001/REQ-018)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    removedHandlers.length = 0
    onListeners.length = 0
  })

  it('TEST-271 REQ-001/018 registers ipcMain.handle for exactly the 4 orkyAction:* channels', () => {
    const dispatcher = makeFakeDispatcher()
    registerOrkyAction(dispatcher as never)
    expect(typeof handlers[CH.orkyActionResolveEscalation]).toBe('function')
    expect(typeof handlers[CH.orkyActionSubmitWork]).toBe('function')
    expect(typeof handlers[CH.orkyActionRecordHumanGate]).toBe('function')
    expect(typeof handlers[CH.orkyActionDriveStatus]).toBe('function')
  })

  it('TEST-272 REQ-003 an unknown sender is rejected for EVERY handler with the exact literal shape, and the dispatcher is NEVER invoked', async () => {
    const dispatcher = makeFakeDispatcher()
    registerOrkyAction(dispatcher as never, () => false)
    const fakeEvent = { sender: { id: 1 } }
    const req = { projectRoot: '/p' }
    await expect(handlers[CH.orkyActionResolveEscalation](fakeEvent, req)).resolves.toEqual(REJECTED)
    await expect(handlers[CH.orkyActionSubmitWork](fakeEvent, req)).resolves.toEqual(REJECTED)
    await expect(handlers[CH.orkyActionRecordHumanGate](fakeEvent, req)).resolves.toEqual(REJECTED)
    await expect(handlers[CH.orkyActionDriveStatus](fakeEvent, req)).resolves.toEqual(REJECTED)
    expect(dispatcher.resolveEscalation).not.toHaveBeenCalled()
    expect(dispatcher.submitWork).not.toHaveBeenCalled()
    expect(dispatcher.recordHumanGate).not.toHaveBeenCalled()
    expect(dispatcher.driveStatus).not.toHaveBeenCalled()
  })

  it('TEST-273 REQ-003 a known sender delegates orkyAction:resolveEscalation to dispatcher.resolveEscalation(req, senderId)', async () => {
    const dispatcher = makeFakeDispatcher()
    registerOrkyAction(dispatcher as never, () => true)
    const req = { projectRoot: '/p', feature: 'f', escalationId: 'E', decision: 'd' }
    await handlers[CH.orkyActionResolveEscalation]({ sender: { id: 5 } }, req)
    expect(dispatcher.resolveEscalation).toHaveBeenCalledWith(req, 5)
  })

  it('TEST-274 REQ-003 a known sender delegates orkyAction:submitWork to dispatcher.submitWork(req, senderId)', async () => {
    const dispatcher = makeFakeDispatcher()
    registerOrkyAction(dispatcher as never, () => true)
    const req = { projectRoot: '/p', title: 't' }
    await handlers[CH.orkyActionSubmitWork]({ sender: { id: 6 } }, req)
    expect(dispatcher.submitWork).toHaveBeenCalledWith(req, 6)
  })

  it('TEST-275 REQ-003 a known sender delegates orkyAction:recordHumanGate to dispatcher.recordHumanGate(req, senderId)', async () => {
    const dispatcher = makeFakeDispatcher()
    registerOrkyAction(dispatcher as never, () => true)
    const req = { projectRoot: '/p', feature: 'f', gate: 'brainstorm', verdict: 'pass' }
    await handlers[CH.orkyActionRecordHumanGate]({ sender: { id: 7 } }, req)
    expect(dispatcher.recordHumanGate).toHaveBeenCalledWith(req, 7)
  })

  it('TEST-276 REQ-003 a known sender delegates orkyAction:driveStatus to dispatcher.driveStatus(req, senderId)', async () => {
    const dispatcher = makeFakeDispatcher()
    registerOrkyAction(dispatcher as never, () => true)
    const req = { projectRoot: '/p', feature: 'f' }
    await handlers[CH.orkyActionDriveStatus]({ sender: { id: 8 } }, req)
    expect(dispatcher.driveStatus).toHaveBeenCalledWith(req, 8)
  })

  it('TEST-277 REQ-018 the returned disposer removes all four handlers', () => {
    const dispatcher = makeFakeDispatcher()
    const dispose = registerOrkyAction(dispatcher as never)
    dispose()
    expect(removedHandlers.sort()).toEqual([
      CH.orkyActionResolveEscalation, CH.orkyActionSubmitWork, CH.orkyActionRecordHumanGate, CH.orkyActionDriveStatus
    ].sort())
  })

  it('TEST-278 REQ-003 isKnownWindowSender defaults to allow-all when omitted (mirrors registerRegistry\'s own default)', async () => {
    const dispatcher = makeFakeDispatcher()
    registerOrkyAction(dispatcher as never) // no predicate passed
    await handlers[CH.orkyActionDriveStatus]({ sender: { id: 1 } }, { projectRoot: '/p', feature: 'f' })
    expect(dispatcher.driveStatus).toHaveBeenCalled()
  })

  it('TEST-279 REQ-001 this registrar subscribes NO push event (no ipcMain.on listener registered) — the feature ships zero main->renderer channels', () => {
    const dispatcher = makeFakeDispatcher()
    registerOrkyAction(dispatcher as never)
    expect(onListeners).toHaveLength(0)
  })
})
