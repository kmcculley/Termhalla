// Undocked windows and app-global state (window-management follow-up, fixed 2026-07-09).
// The env vault's one-time initial emit rode ONLY main's did-finish-load, so a floating window's
// env UI showed stale state until the next vault mutation happened to re-broadcast. The registrar
// now ALSO re-emits on every `win:ready` signal — the same ready signal every window's renderer
// already sends (App.tsx api.winReady()), and the same broadcast `send` all emits ride.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import { registerEnv } from '../../src/main/ipc/register-env'
import type { EnvVault } from '../../src/main/env-vault/env-vault'

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k]
  for (const k of Object.keys(onHandlers)) delete onHandlers[k]
})

const fakeWin = () => ({ webContents: { on: vi.fn() } }) as never
const fakeVault = () => ({ exists: () => true, isUnlocked: () => false }) as unknown as EnvVault

describe('registerEnv initial-state emits', () => {
  it('re-emits the vault state on every win:ready (the undocked-window seed)', () => {
    const send = vi.fn()
    registerEnv(fakeWin(), fakeVault(), send)
    expect(onHandlers[CH.winReady]).toBeTypeOf('function')
    onHandlers[CH.winReady]()
    expect(send).toHaveBeenCalledWith(CH.envState, { exists: true, unlocked: false })
    // A second window's ready signal re-emits again — idempotent state, never a one-shot.
    onHandlers[CH.winReady]()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('keeps the original did-finish-load emit for main', () => {
    const win = { webContents: { on: vi.fn() } }
    const send = vi.fn()
    registerEnv(win as never, fakeVault(), send)
    const call = win.webContents.on.mock.calls.find(c => c[0] === 'did-finish-load')
    expect(call).toBeTruthy()
    ;(call![1] as () => void)()
    expect(send).toHaveBeenCalledWith(CH.envState, { exists: true, unlocked: false })
  })
})
