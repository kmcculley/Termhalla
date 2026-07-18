// FROZEN test suite — feature 0026-phone-web-remote (phase 4, v2 loopback — FINDING-047/032).
// REQ-032: every phoneRemote:* IPC handler is sender-gated on `WindowManager.isKnownWindowSender`
// BEFORE any handler logic runs (the register-orky-action / register-registry / register-remote
// precedent — this suite mirrors tests/main/orky-ipc-validation.test.ts).
// REQ-003 (v2): the setPort handler coerces every invalid argument to PHONE_REMOTE_PORT_DEFAULT —
// port 0 (OS-assigned) is reserved to the REQ-025 e2e seam and is NEVER reachable from a
// production IPC call.
// REQ-007/REQ-031: the registrar carries the v2 channels — `phoneRemote:pairingUrl` (re-fetch
// without a revoking regenerate) and `phoneRemote:setExternalHost`.
//
// Contract set here for the implementer — src/main/ipc/register-phone-remote.ts exports:
//   registerPhoneRemote(
//     service: PhoneRemoteService,
//     send: Send,
//     isKnownWindowSender: (sender: unknown) => boolean
//   ): Disposer
// An unknown sender is rejected before the service is touched; the handler must not throw
// (no uncaught throw in an ipcMain listener — the modal-dialog freeze).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (...a: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers[ch] = fn },
    removeHandler: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn()
  }
}))

import { PHONE_REMOTE_PORT_DEFAULT } from '../../src/shared/phone-remote/settings'
import { registerPhoneRemote } from '../../src/main/ipc/register-phone-remote'

const senderKnown = { id: 'main-window' }
const senderForeign = { id: 'foreign' }
const fromKnown = { sender: senderKnown }
const fromForeign = { sender: senderForeign }
const isKnownWindowSender = (s: unknown): boolean => s === senderKnown

interface SvcSpies {
  svc: Record<string, ReturnType<typeof vi.fn>>
}

const mkService = (): SvcSpies => {
  const svc = {
    status: vi.fn(() => ({ enabled: false, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT, running: false, urls: [], hasToken: false, tokenAvailableThisSession: false })),
    setEnabled: vi.fn(async () => {}),
    setBind: vi.fn(async () => {}),
    setPort: vi.fn(async () => {}),
    setExternalHost: vi.fn(async () => {}),
    regenerateToken: vi.fn(async () => ({ pairingUrl: 'http://127.0.0.1:8199/?token=SECRET' })),
    pairingUrl: vi.fn(async () => ({ pairingUrl: 'http://127.0.0.1:8199/?token=SECRET' })),
    stop: vi.fn(async () => {}),
    init: vi.fn(async () => {})
  }
  return { svc }
}

const call = (ch: string, evt: unknown, ...args: unknown[]): unknown => {
  const h = handlers[ch]
  expect(h, `a handler must be registered for '${ch}'`).toBeTypeOf('function')
  return h(evt, ...args)
}

describe('registerPhoneRemote — sender gating + port coercion (REQ-032 / REQ-003 v2)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
  })

  it('TEST-2696 REQ-032 an unknown sender is rejected BEFORE any handler logic runs — on every channel', async () => {
    const { svc } = mkService()
    registerPhoneRemote(svc as never, () => {}, isKnownWindowSender)
    const channels: Array<[string, unknown[]]> = [
      ['phoneRemote:setEnabled', [true]],
      ['phoneRemote:setBind', ['lan']],
      ['phoneRemote:setPort', [8200]],
      ['phoneRemote:setExternalHost', ['host.ts.net']],
      ['phoneRemote:regenerateToken', []],
      ['phoneRemote:pairingUrl', []],
      ['phoneRemote:status', []]
    ]
    for (const [ch, args] of channels) {
      let threw = false
      try { await call(ch, fromForeign, ...args) } catch { threw = true }
      expect(threw, `'${ch}' must reject a foreign sender without throwing`).toBe(false)
    }
    // secret-bearing + write-capable service surface: NEVER touched by a foreign sender
    expect(svc.setEnabled).not.toHaveBeenCalled()
    expect(svc.setBind).not.toHaveBeenCalled()
    expect(svc.setPort).not.toHaveBeenCalled()
    expect(svc.setExternalHost).not.toHaveBeenCalled()
    expect(svc.regenerateToken).not.toHaveBeenCalled()
    expect(svc.pairingUrl).not.toHaveBeenCalled()
    expect(svc.status).not.toHaveBeenCalled()
  })

  it('TEST-2696 REQ-032 a currently-tracked window sender passes through to the service', async () => {
    const { svc } = mkService()
    registerPhoneRemote(svc as never, () => {}, isKnownWindowSender)
    await call('phoneRemote:setEnabled', fromKnown, true)
    expect(svc.setEnabled).toHaveBeenCalledWith(true)
    await call('phoneRemote:regenerateToken', fromKnown)
    expect(svc.regenerateToken).toHaveBeenCalled()
    await call('phoneRemote:status', fromKnown)
    expect(svc.status).toHaveBeenCalled()
  })

  it('TEST-2697 REQ-003 setPort coerces NaN/float/out-of-range/0/non-number to the default — never 0', async () => {
    const { svc } = mkService()
    registerPhoneRemote(svc as never, () => {}, isKnownWindowSender)
    for (const bad of [NaN, 1.5, -1, 0, 65536, 70000, '8199', null, undefined, {}]) {
      svc.setPort.mockClear()
      await call('phoneRemote:setPort', fromKnown, bad)
      expect(svc.setPort, `invalid port ${String(bad)} must coerce to the default`).toHaveBeenCalledWith(PHONE_REMOTE_PORT_DEFAULT)
      expect(svc.setPort).not.toHaveBeenCalledWith(0)
    }
    svc.setPort.mockClear()
    await call('phoneRemote:setPort', fromKnown, 8200)
    expect(svc.setPort).toHaveBeenCalledWith(8200)
    expect(PHONE_REMOTE_PORT_DEFAULT).toBe(8199)
  })

  it('TEST-2698 REQ-007/REQ-031 pairingUrl re-fetches WITHOUT a regenerate; setExternalHost reaches the service', async () => {
    const { svc } = mkService()
    registerPhoneRemote(svc as never, () => {}, isKnownWindowSender)
    const out = await call('phoneRemote:pairingUrl', fromKnown)
    expect(svc.pairingUrl).toHaveBeenCalled()
    expect(svc.regenerateToken, 'reopening Settings must never force a revoking regenerate').not.toHaveBeenCalled()
    expect(out).toEqual({ pairingUrl: 'http://127.0.0.1:8199/?token=SECRET' })
    await call('phoneRemote:setExternalHost', fromKnown, 'myhost.ts.net')
    expect(svc.setExternalHost).toHaveBeenCalledWith('myhost.ts.net')
  })
})
