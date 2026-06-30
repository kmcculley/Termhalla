// FROZEN integration suite — feature 0004-orky-status-awareness (phase 4 / REQ-024 IPC hardening).
// `registerOrky` MUST (a) validate the IPC args — reject a non-string `id`/`cwd` BEFORE touching the
// tracker so a malformed message cannot become an unhandled rejection that kills the main process
// (FINDING-SEC-001), and (b) scope each `orky:watch`/`orky:unwatch` to the OWNING window — because
// `ipcMain.on` is process-global, a handler must act ONLY for events whose `sender` belongs to its own
// `BrowserWindow` (mirroring register-pty's `claimPane`), so one window cannot open/cancel/leak another
// window's watchers (FINDING-SEC-002).
//
// Chosen contract (the plan adds the owning window — see 04-tests.md):
//   registerOrky(send, win): Disposer        // win === the BrowserWindow this registrar belongs to
//
// `electron` and the OrkyTracker are mocked so the handlers run with no Electron runtime. Runs RED
// against the prior pass: the shipped `registerOrky(send)` has no arg validation and no sender scoping,
// so it calls `tracker.watch(id, 123)` and acts on events from a foreign window.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Captured ipcMain handlers, keyed by channel.
const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
// Tracker spies (the real OrkyTracker is mocked away — we only assert what the handlers DID).
const watchMock = vi.fn()
const unwatchMock = vi.fn()
const disposeMock = vi.fn()

// `BrowserWindow.fromWebContents(sender)` returns whatever window the synthetic sender carries.
vi.mock('electron', () => ({
  ipcMain: {
    on: (ch: string, fn: (...a: unknown[]) => void) => { (handlers[ch] ??= []).push(fn) },
    removeListener: vi.fn(),
    removeAllListeners: vi.fn()
  },
  BrowserWindow: { fromWebContents: (wc: { __win?: unknown } | null) => wc?.__win ?? null }
}))
vi.mock('../../src/main/orky/orky-tracker', () => ({
  OrkyTracker: vi.fn(() => ({ watch: watchMock, unwatch: unwatchMock, dispose: disposeMock }))
}))

import { CH } from '@shared/ipc-contract'
import { registerOrky } from '../../src/main/ipc/register-orky'

const winA = { id: 'A' }
const winB = { id: 'B' }
const fromA = { sender: { __win: winA } }
const fromB = { sender: { __win: winB } }

function fire(ch: string, event: unknown, ...args: unknown[]): void {
  for (const fn of handlers[ch] ?? []) fn(event, ...args)
}

describe('registerOrky — IPC arg validation + per-window sender ownership (REQ-024)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    watchMock.mockClear(); unwatchMock.mockClear(); disposeMock.mockClear()
  })

  it('TEST-054 REQ-024 rejects a non-string cwd / id without throwing and without touching the tracker', () => {
    registerOrky(() => {}, winA as never)
    expect(() => fire(CH.orkyWatch, fromA, 'p1', 123)).not.toThrow()       // non-string cwd
    expect(() => fire(CH.orkyWatch, fromA, 456, '/some/cwd')).not.toThrow() // non-string id
    expect(() => fire(CH.orkyWatch, fromA, undefined, undefined)).not.toThrow()
    expect(watchMock).not.toHaveBeenCalled() // a malformed arg never reaches tracker.watch
  })

  it('TEST-054 REQ-024 a valid watch from the OWNING window starts the tracker', () => {
    registerOrky(() => {}, winA as never)
    fire(CH.orkyWatch, fromA, 'p1', '/proj')
    expect(watchMock).toHaveBeenCalledWith('p1', '/proj')
  })

  it('TEST-054 REQ-024 a watch/unwatch from a NON-owning window is ignored (no cross-window watcher/disclosure)', () => {
    registerOrky(() => {}, winA as never) // this registrar belongs to window A
    fire(CH.orkyWatch, fromB, 'pB', '/proj')   // event from window B
    fire(CH.orkyUnwatch, fromB, 'pB')          // event from window B
    expect(watchMock).not.toHaveBeenCalled()
    expect(unwatchMock).not.toHaveBeenCalled()

    // a real unwatch from the owning window still works
    fire(CH.orkyUnwatch, fromA, 'pA')
    expect(unwatchMock).toHaveBeenCalledWith('pA')
  })
})
