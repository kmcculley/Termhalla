// FROZEN integration suite — feature 0005-cross-project-orky-registry (phase 4 / TASK-008, REQ-002 /
// REQ-016 / REQ-020, security).
//
// 0004's `registerOrky(send, win)` validated `BrowserWindow.fromWebContents(e.sender) === win`, which
// silently dropped `orky:watch`/`orky:unwatch` from any window OTHER than the single window
// `register.ts` happened to pass in. REQ-002/REQ-020 require pane-root membership aggregated ACROSS ALL
// windows, so `WindowManager` MUST expose a public sender check that recognizes ANY currently-tracked app
// window (main or floating) — false for a destroyed/foreign/unrecognized sender, preserving the original
// security intent (FINDING-SEC-002: a truly out-of-process or already-closed sender is still rejected).
//
// `electron` is mocked (BrowserWindow/screen/ipcMain/app) so this drives the REAL `WindowManager` with no
// Electron runtime — `prepare()` creates real (synchronous, fake) BrowserWindow instances; `start()`
// (which loads renderer content) is never called. The fake constructor + collected-instances array live
// inside `vi.hoisted()` (vitest's documented fix for "no top level variables inside a vi.mock factory" —
// a bare module-scope `class` referenced directly inside the factory hits the TDZ because `vi.mock` calls
// are hoisted above ALL other top-level statements, including ones textually before them).
//
// Runs RED today: `WindowManager.isKnownWindowSender` does not exist yet (TypeError: not a function).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { FakeBrowserWindow, createdWindows, resetCreated } = vi.hoisted(() => {
  interface FakeWebContents { id: number; isDestroyed(): boolean; on(ev: string, cb: (...a: unknown[]) => void): void }
  let nextWcId = 1
  const createdWindows: Array<{ webContents: FakeWebContents }> = []
  class FakeBrowserWindow {
    webContents: FakeWebContents
    private destroyed = false
    constructor(_opts: unknown) {
      const wc: FakeWebContents = { id: nextWcId++, isDestroyed: () => this.destroyed, on: () => {} }
      this.webContents = wc
      createdWindows.push({ webContents: wc })
    }
    once(): void {}
    on(): void {}
    show(): void {}
    maximize(): void {}
    isDestroyed(): boolean { return this.destroyed }
    getBounds() { return { x: 0, y: 0, width: 900, height: 640 } }
    isMaximized(): boolean { return false }
    loadURL(): Promise<void> { return Promise.resolve() }
    loadFile(): Promise<void> { return Promise.resolve() }
  }
  const resetCreated = (): void => { createdWindows.length = 0; nextWcId = 1 }
  return { FakeBrowserWindow, createdWindows, resetCreated }
})

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeListener: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() },
  BrowserWindow: FakeBrowserWindow
}))

import { WindowManager } from '../../src/main/window-manager'
import { CH } from '@shared/ipc-contract'

describe('WindowManager.isKnownWindowSender — recognizes ANY tracked app window (REQ-002/REQ-016/REQ-020)', () => {
  beforeEach(() => { resetCreated() })

  it('TEST-107 REQ-016/REQ-020 a sender belonging to the (single, default) prepared window is recognized', () => {
    const wm = new WindowManager(() => {})
    wm.prepare(null) // one default main window (no saved AppState)
    expect(typeof (wm as unknown as { isKnownWindowSender: unknown }).isKnownWindowSender).toBe('function')
    const ownWc = createdWindows[0].webContents
    expect(wm.isKnownWindowSender(ownWc as never)).toBe(true)
  })

  it('TEST-108 REQ-002/REQ-020 a sender belonging to EITHER of two prepared windows is recognized (cross-window — the REQ-002/REQ-020 gap fix)', () => {
    const wm = new WindowManager(() => {})
    wm.prepare({
      windows: [
        { workspaceIds: ['a'], activeId: 'a', bounds: { x: 0, y: 0, width: 900, height: 640, maximized: false }, isMain: true },
        { workspaceIds: ['b'], activeId: 'b', bounds: { x: 0, y: 0, width: 900, height: 640, maximized: false }, isMain: false }
      ]
    } as never)
    expect(createdWindows.length).toBe(2)
    expect(wm.isKnownWindowSender(createdWindows[0].webContents as never)).toBe(true)
    expect(wm.isKnownWindowSender(createdWindows[1].webContents as never)).toBe(true)
  })

  it('TEST-109 REQ-016 a truly foreign/unrecognized sender (never created by this WindowManager) is REJECTED — the original FINDING-SEC-002 intent survives', () => {
    const wm = new WindowManager(() => {})
    wm.prepare(null)
    const foreign = { id: 999_999, isDestroyed: () => false, on: () => {} }
    expect(wm.isKnownWindowSender(foreign as never)).toBe(false)
  })

  it('TEST-110 REQ-016 a DESTROYED window\'s sender is no longer recognized', () => {
    const wm = new WindowManager(() => {})
    wm.prepare(null)
    const wc = createdWindows[0].webContents
    expect(wm.isKnownWindowSender(wc as never)).toBe(true)
    vi.spyOn(wc, 'isDestroyed').mockReturnValue(true)
    expect(wm.isKnownWindowSender(wc as never)).toBe(false)
  })
})

describe('registry:status is APP-GLOBAL, never pane-scoped (REQ-020/REQ-022)', () => {
  it('TEST-111 REQ-020/REQ-022 CH.registryStatus is NOT in the pane-scoped set — its first arg is a snapshot array, not a paneId, so the existing send() broadcasts it to every window', () => {
    const wm = new WindowManager(() => {})
    expect(wm.isPaneScoped((CH as Record<string, string>).registryStatus)).toBe(false)
  })
})
