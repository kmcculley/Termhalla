// Regression suite for the un-serialized workspace-move race (2026-07 whole-project audit,
// finding 2): three entry points call `move()` — tab drag-end, the `win:redock` IPC handler, and
// `redockAll` (serialized only internally) — and a move claims the SHARED `this.inflight` slot.
// If move B claimed `inflight` while move A was still pending, A's `finish` (500 ms timeout or a
// late sentinel) nulled B's slot unconditionally; B's `term:snapshot` replies then hit the
// `!this.inflight` guard in `onSnapshot` and were dropped — silent scrollback loss.
//
// Fix under test: (1) ALL moves are serialized through one queue (SerialQueue), so a second move
// never starts while one is in flight; (2) belt — `finish` clears `inflight` only when it still
// points at its own move record, so even a timed-out move can never damage a successor's slot.
//
// `electron` is mocked (same pattern as window-manager-registry-sender.test.ts, which is FROZEN —
// hence this separate file): the REAL WindowManager runs with fake BrowserWindows whose
// webContents record every `send`, and the ipcMain.on registrations are invoked directly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { FakeBrowserWindow, createdWindows, resetCreated } = vi.hoisted(() => {
  interface Sent { channel: string; args: unknown[] }
  let nextWcId = 1
  class FakeWebContents {
    id = nextWcId++
    sent: Sent[] = []
    constructor(private readonly owner: { isDestroyed(): boolean }) {}
    isDestroyed(): boolean { return this.owner.isDestroyed() }
    on(): void {}
    send(channel: string, ...args: unknown[]): void { this.sent.push({ channel, args }) }
  }
  const createdWindows: FakeBrowserWindow[] = []
  class FakeBrowserWindow {
    webContents: FakeWebContents
    private destroyed = false
    constructor(_opts: unknown) {
      this.webContents = new FakeWebContents(this)
      createdWindows.push(this)
    }
    once(): void {}
    on(): void {}
    show(): void {}
    showInactive(): void {}
    maximize(): void {}
    destroy(): void { this.destroyed = true }
    isDestroyed(): boolean { return this.destroyed }
    getBounds() { return { x: 0, y: 0, width: 900, height: 640 } }
    getContentBounds() { return { x: 0, y: 0, width: 900, height: 640 } }
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

import { ipcMain } from 'electron'
import { WindowManager } from '../../src/main/window-manager'
import { CH } from '@shared/ipc-contract'

/** The most recently registered ipcMain.on handler for `channel`. */
function handlerFor(channel: string): (...a: unknown[]) => void {
  const calls = vi.mocked(ipcMain.on).mock.calls
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i][0] === channel) return calls[i][1] as never
  throw new Error(`no ipcMain.on handler registered for ${channel}`)
}

/** All args-tuples `wc` was sent on `channel`. */
function sentOn(wc: { sent: Array<{ channel: string; args: unknown[] }> }, channel: string): unknown[][] {
  return wc.sent.filter(s => s.channel === channel).map(s => s.args)
}

const tick = () => new Promise<void>(r => { setTimeout(r, 0) })

/** Main window with 'a', two floating windows with 'b' and 'c'. */
function prepareThreeWindows(): WindowManager {
  const wm = new WindowManager(() => {})
  const bounds = { x: 0, y: 0, width: 900, height: 640, maximized: false }
  wm.prepare({
    windows: [
      { workspaceIds: ['a'], activeId: 'a', bounds, isMain: true },
      { workspaceIds: ['b'], activeId: 'b', bounds, isMain: false },
      { workspaceIds: ['c'], activeId: 'c', bounds, isMain: false }
    ]
  } as never)
  return wm
}

describe('WindowManager — workspace moves are serialized (audit finding 2)', () => {
  beforeEach(() => { resetCreated(); vi.mocked(ipcMain.on).mockClear() })
  afterEach(() => { vi.useRealTimers() })

  it('a second win:redock does NOT start while the first move is still capturing snapshots; both deliver their snapshots', async () => {
    const wm = prepareThreeWindows()
    const [wcMain, wcB, wcC] = createdWindows.map(w => w.webContents)
    const redock = handlerFor(CH.winRedock)
    const snapshot = handlerFor(CH.termSnapshot)

    // Move A: workspace 'b' -> main. The source renderer is asked to serialize once the queued
    // move runs (the queue defers even an immediately-runnable move by a microtask).
    redock({}, { workspaceId: 'b', targetWindowId: 'main' })
    await tick()
    expect(sentOn(wcB, CH.termSerialize)).toEqual([['b']])

    // Move B: workspace 'c' -> main, fired while A is still pending. It must be QUEUED, not
    // started — an un-serialized start would claim the shared inflight slot out from under A.
    redock({}, { workspaceId: 'c', targetWindowId: 'main' })
    await tick()
    expect(sentOn(wcC, CH.termSerialize)).toEqual([])

    // A's renderer replies: one pane snapshot, then the end sentinel. A completes; B then starts.
    snapshot({}, { paneId: 'p1', data: 'SNAP-B' })
    snapshot({}, { paneId: '__end__:b' })
    await tick()
    expect(sentOn(wcC, CH.termSerialize)).toEqual([['c']])

    // B's renderer replies; its snapshot must be recorded (this is what the race dropped).
    snapshot({}, { paneId: 'p2', data: 'SNAP-C' })
    snapshot({}, { paneId: '__end__:c' })
    await tick()

    // Both panes replay their captured scrollback into the destination (main) window.
    wm.replayInto('p1')
    wm.replayInto('p2')
    expect(sentOn(wcMain, CH.ptyData)).toEqual([['p1', 'SNAP-B'], ['p2', 'SNAP-C']])
  })

  it('a move whose renderer never replies (500 ms timeout) cannot null the NEXT move\'s inflight slot — the successor\'s snapshots survive', async () => {
    vi.useFakeTimers()
    const wm = prepareThreeWindows()
    const [wcMain, wcB, wcC] = createdWindows.map(w => w.webContents)
    const redock = handlerFor(CH.winRedock)
    const snapshot = handlerFor(CH.termSnapshot)

    // Move A ('b' -> main) starts; its renderer never replies. Move B ('c' -> main) queues behind.
    redock({}, { workspaceId: 'b', targetWindowId: 'main' })
    redock({}, { workspaceId: 'c', targetWindowId: 'main' })
    await vi.advanceTimersByTimeAsync(0)   // run A's queued start without reaching its 500 ms timeout
    expect(sentOn(wcB, CH.termSerialize)).toEqual([['b']])
    expect(sentOn(wcC, CH.termSerialize)).toEqual([])

    // A times out; B starts. A's timed-out finish must not touch B's freshly-claimed slot.
    await vi.advanceTimersByTimeAsync(500)
    expect(sentOn(wcC, CH.termSerialize)).toEqual([['c']])

    // A late end-sentinel from A's move is ignored (wrong workspace, and A already settled).
    snapshot({}, { paneId: '__end__:b' })

    // B's replies must still be accepted and delivered — the racy version dropped them here.
    snapshot({}, { paneId: 'p2', data: 'SNAP-C' })
    snapshot({}, { paneId: '__end__:c' })
    await vi.advanceTimersByTimeAsync(1)
    wm.replayInto('p2')
    expect(sentOn(wcMain, CH.ptyData)).toEqual([['p2', 'SNAP-C']])
  })
})
