import { BrowserWindow, screen, ipcMain, type WebContents } from 'electron'
import { resolve } from 'node:path'
import { v4 as uuid } from 'uuid'
import {
  CH,
  type WinDragEndArgs, type WinRedockArgs, type WinReportArgs,
  type WinAssignment, type TermSnapshotArgs
} from '@shared/ipc-contract'
import { SCHEMA_VERSION, type AppState, type WindowState } from '@shared/types'
import { clampWindowState, DEFAULT_WINDOW_STATE } from './window-state'
import {
  undock, redock, decideDrop, windowOf,
  type CoreState, type Strip
} from './window-manager-core'

/** Height (px) of the main window's tab strip — the drop zone for re-docking a torn-off tab. */
const STRIP_HEIGHT = 36

/** Channels whose first argument is a paneId and therefore route to the owning window. Everything
 *  else (cloud:status, env:state, fs:change, …) is app-global and broadcasts to every window. */
const PANE_SCOPED = new Set<string>([
  CH.ptyData, CH.ptyExit, CH.ptyStatus, CH.ptyCwd, CH.ptyProcs,
  CH.aiSession, CH.usageMetrics, CH.recState, CH.termSerialize
])

/** A move currently in flight (drags are serial): the workspace being moved, its destination
 *  window, the pane ids whose snapshots have arrived, and the resolver for the await. */
interface Inflight { workspaceId: string; destWindowId: string; paneIds: string[]; resolve: () => void }

/**
 * Owns the set of OS windows for the multi-window/undock feature. The privileged service layer
 * (PtyManager, trackers, stores) is built once and window-agnostic; this class decides which
 * window a pane-scoped push event goes to (`routeToPane`), and performs tab tear-off / re-dock
 * with live-terminal handoff (serialize the source xterm → adopt the running pty in the
 * destination window → replay the snapshot + any bytes buffered during the move).
 *
 * Invariants:
 * - Exactly one pane is rendered by exactly one window → exactly one xterm per pty (no echo).
 * - Pane ownership is established from the `pty:spawn` sender (`claimPane`) and re-affirmed on
 *   every move, so main never has to guess pane→window.
 * - Only the main window is a re-dock target; floating windows hold exactly one workspace.
 */
export class WindowManager {
  private wins = new Map<string, BrowserWindow>()      // windowId -> BrowserWindow
  private core: CoreState = { windows: [] }            // authoritative window/workspace arrangement
  private paneOwner = new Map<string, string>()        // paneId -> windowId
  private transit = new Map<string, string[]>()        // paneId -> live pty:data buffered mid-move
  private snapshots = new Map<string, string>()        // paneId -> captured ANSI snapshot
  private inflight: Inflight | null = null
  private closedCbs: (() => void)[] = []

  constructor(private readonly persist: (s: AppState) => void) {}

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────────
  // Windows are created (but not loaded) in `prepare`, then `registerHandlers` registers the
  // global ipcMain handlers, then `start` loads renderer content — so a handler always exists
  // before any renderer can invoke it.

  /** Create a BrowserWindow per saved window (or a single default main window), without loading
   *  content yet, and register this manager's own IPC. */
  prepare(state: AppState | null): void {
    const displays = screen.getAllDisplays().map(d => d.workArea)
    const layouts = state && state.windows.length
      ? state.windows
      : [{ workspaceIds: [], activeId: null, bounds: DEFAULT_WINDOW_STATE, isMain: true }]
    let sawMain = false
    for (const layout of layouts) {
      const isMain = layout.isMain && !sawMain
      if (isMain) sawMain = true
      const id = uuid()
      this.core.windows.push({ id, isMain, workspaceIds: layout.workspaceIds, activeId: layout.activeId })
      this.createBrowserWindow(id, clampWindowState(layout.bounds, displays))
    }
    if (!sawMain && this.core.windows[0]) this.core.windows[0].isMain = true   // never main-less
    this.registerIpc()
  }

  /** Load renderer content into every prepared window. Assignments are pushed on did-finish-load. */
  start(): void {
    for (const [id, win] of this.wins) this.load(win, id)
  }

  private load(win: BrowserWindow, _id: string): void {
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void win.loadFile(resolve(import.meta.dirname, '../renderer/index.html'))
  }

  private createBrowserWindow(id: string, bounds: WindowState): BrowserWindow {
    const win = new BrowserWindow({
      width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, show: false,
      webPreferences: {
        preload: resolve(import.meta.dirname, '../preload/index.mjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    })
    if (bounds.maximized) win.maximize()
    this.wins.set(id, win)
    win.once('ready-to-show', () => win.show())
    // Re-send on every load so a dev hot-reload re-hydrates the window's assignment.
    win.webContents.on('did-finish-load', () => this.sendAssignment(id))
    const persist = () => this.persistState()
    win.on('resize', persist)
    win.on('move', persist)
    win.on('close', (e) => this.onClose(id, e))
    win.on('closed', () => this.onClosed(id))
    return win
  }

  /** A floating window's native X re-docks its workspace instead of killing its shells; the
   *  main window's X is a normal close (→ app quit via window-all-closed). */
  private onClose(id: string, e: Electron.Event): void {
    const cw = this.core.windows.find(w => w.id === id)
    if (cw && !cw.isMain && cw.workspaceIds.length > 0) {
      e.preventDefault()
      for (const wsId of [...cw.workspaceIds]) void this.move(wsId, this.mainWindowId())
      return
    }
    this.persistState()
  }

  private onClosed(id: string): void {
    this.wins.delete(id)
    this.core.windows = this.core.windows.filter(w => w.id !== id)
    for (const [pid, wid] of this.paneOwner) if (wid === id) this.paneOwner.delete(pid)
    if (this.wins.size === 0) for (const cb of this.closedCbs) cb()
  }

  mainWindow(): BrowserWindow { return this.wins.get(this.mainWindowId())! }
  private mainWindowId(): string { return this.core.windows.find(w => w.isMain)!.id }

  // ── Router surface (consumed by registerHandlers' `send`) ─────────────────────────────────────

  isPaneScoped(channel: string): boolean { return PANE_SCOPED.has(channel) }

  routeToPane(paneId: string, channel: string, ...args: unknown[]): void {
    // Buffer live terminal output while a pane is mid-handoff (destination not attached yet).
    if (channel === CH.ptyData && this.transit.has(paneId)) {
      this.transit.get(paneId)!.push(args[1] as string)
      return
    }
    const winId = this.paneOwner.get(paneId)
    this.safeSend(winId ? this.wins.get(winId) : this.mainWindow(), channel, ...args)
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const win of this.wins.values()) this.safeSend(win, channel, ...args)
  }

  onAllWindowsClosed(cb: () => void): void { this.closedCbs.push(cb) }

  /** Associate a pane with the window that spawned it (from the ipcMain event sender). Called on
   *  every `pty:spawn`, so ownership is correct for fresh panes and re-affirmed after a move. */
  claimPane(paneId: string, sender: WebContents): void {
    for (const [id, win] of this.wins) {
      if (!win.isDestroyed() && win.webContents.id === sender.id) { this.paneOwner.set(paneId, id); return }
    }
  }

  /** A moved pane re-spawned in its new window: it already has a live pty, so instead of spawning
   *  we replay the captured snapshot then flush any bytes buffered during the move. */
  replayInto(paneId: string): void {
    const winId = this.paneOwner.get(paneId)
    const win = winId ? this.wins.get(winId) : undefined
    const snap = this.snapshots.get(paneId)
    if (snap !== undefined) { this.safeSend(win, CH.ptyData, paneId, snap); this.snapshots.delete(paneId) }
    const buffered = this.transit.get(paneId)
    this.transit.delete(paneId)               // stop buffering; live output flows again
    if (buffered) for (const chunk of buffered) this.safeSend(win, CH.ptyData, paneId, chunk)
  }

  private safeSend(win: BrowserWindow | undefined, channel: string, ...args: unknown[]): void {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try { win.webContents.send(channel, ...args) } catch { /* torn down mid-send */ }
  }

  // ── IPC ───────────────────────────────────────────────────────────────────────────────────────

  private registerIpc(): void {
    ipcMain.on(CH.winDragEnd, (_e, a: WinDragEndArgs) => { void this.onDragEnd(a) })
    ipcMain.on(CH.winRedock, (_e, a: WinRedockArgs) => { void this.move(a.workspaceId, this.resolveTarget(a.targetWindowId)) })
    ipcMain.on(CH.winReport, (_e, a: WinReportArgs) => this.onReport(a))
    ipcMain.on(CH.termSnapshot, (_e, a: TermSnapshotArgs) => this.onSnapshot(a))
  }

  private resolveTarget(t: string): string { return t === 'main' ? this.mainWindowId() : t }

  /** The renderer reports its window's workspace list/active tab whenever the user adds, closes,
   *  reorders, or switches a workspace — keeping main's authoritative arrangement in sync. */
  private onReport(a: WinReportArgs): void {
    const w = this.core.windows.find(x => x.id === a.windowId)
    if (!w) return
    w.workspaceIds = a.workspaceIds
    w.activeId = a.activeId
    this.persistState()
  }

  // ── tear-off / re-dock with live handoff ──────────────────────────────────────────────────────

  private async onDragEnd(a: WinDragEndArgs): Promise<void> {
    const sourceWinId = windowOf(this.core, a.workspaceId)
    if (!sourceWinId) return
    const decision = decideDrop(a.cursor, sourceWinId, this.strips())
    if (decision.action === 'none') return
    if (decision.action === 'redock') { await this.move(a.workspaceId, decision.targetWindowId); return }
    await this.move(a.workspaceId, null, a.cursor)   // undock: null target = new window at cursor
  }

  /**
   * Move `workspaceId` to `destWindowId` (an existing window) or, when `destWindowId` is null, into
   * a brand-new window positioned at `cursor`. Captures the source xterms' snapshots first, updates
   * the ownership model, creates/loads the destination window if new, then re-assigns both ends.
   */
  private async move(workspaceId: string, destWindowId: string | null, cursor?: { x: number; y: number }): Promise<void> {
    const sourceWinId = windowOf(this.core, workspaceId)
    if (!sourceWinId) return
    const newWindowId = destWindowId ?? uuid()
    await this.captureSnapshots(workspaceId, newWindowId)   // sets snapshots/transit/paneOwner per pane

    let closedWindowId: string | null = null
    if (destWindowId === null) {
      this.core = undock(this.core, workspaceId, newWindowId)
      const displays = screen.getAllDisplays().map(d => d.workArea)
      const bounds = clampWindowState(
        { width: 900, height: 640, x: cursor?.x, y: cursor?.y, maximized: false }, displays)
      const win = this.createBrowserWindow(newWindowId, bounds)
      this.load(win, newWindowId)
    } else {
      const r = redock(this.core, workspaceId, destWindowId)
      this.core = r.state
      closedWindowId = r.closedWindowId
    }

    this.sendAssignment(sourceWinId)   // source drops the workspace → unmounts (disposes its xterms)
    if (destWindowId !== null) this.sendAssignment(destWindowId)
    if (closedWindowId) { const w = this.wins.get(closedWindowId); this.wins.delete(closedWindowId); w?.destroy() }
    this.persistState()
  }

  /** Ask the source window to serialize a workspace's terminals; resolve once the end sentinel
   *  arrives (or a timeout, so an unresponsive renderer can never wedge the drag). */
  private captureSnapshots(workspaceId: string, destWindowId: string): Promise<void> {
    const sourceWinId = windowOf(this.core, workspaceId)
    const win = sourceWinId ? this.wins.get(sourceWinId) : undefined
    if (!win) return Promise.resolve()
    return new Promise<void>(res => {
      let settled = false
      const finish = () => { if (settled) return; settled = true; clearTimeout(timer); this.inflight = null; res() }
      const timer = setTimeout(finish, 500)
      this.inflight = { workspaceId, destWindowId, paneIds: [], resolve: finish }
      this.safeSend(win, CH.termSerialize, workspaceId)
    })
  }

  /** One snapshot reply per terminal pane, then a `__end__:<workspaceId>` sentinel. Each pane is
   *  marked moving (buffer its live output, re-own to the destination) so the destination's xterm
   *  can replay it on attach. */
  private onSnapshot(a: TermSnapshotArgs): void {
    if (a.paneId.startsWith('__end__:')) { this.inflight?.resolve(); return }
    if (!this.inflight) return
    this.inflight.paneIds.push(a.paneId)
    this.snapshots.set(a.paneId, a.data)
    if (!this.transit.has(a.paneId)) this.transit.set(a.paneId, [])
    this.paneOwner.set(a.paneId, this.inflight.destWindowId)
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────

  /** Only the main window's tab strip is a re-dock target; floating windows hold one workspace. */
  private strips(): Strip[] {
    const main = this.core.windows.find(w => w.isMain)
    const win = main ? this.wins.get(main.id) : undefined
    if (!main || !win) return []
    const b = win.getContentBounds()
    return [{ windowId: main.id, x: b.x, y: b.y, width: b.width, height: STRIP_HEIGHT }]
  }

  private sendAssignment(windowId: string): void {
    const cw = this.core.windows.find(w => w.id === windowId)
    if (!cw) return
    const payload: WinAssignment = { windowId, isMain: cw.isMain, workspaceIds: cw.workspaceIds, activeId: cw.activeId }
    this.safeSend(this.wins.get(windowId), CH.winAssignment, payload)
  }

  private persistState(): void {
    const windows = this.core.windows.map(w => {
      const win = this.wins.get(w.id)
      const b = win && !win.isDestroyed() ? win.getBounds() : undefined
      const maximized = win && !win.isDestroyed() ? win.isMaximized() : false
      return {
        workspaceIds: w.workspaceIds, activeId: w.activeId, isMain: w.isMain,
        bounds: b ? { width: b.width, height: b.height, x: b.x, y: b.y, maximized } : { ...DEFAULT_WINDOW_STATE }
      }
    })
    this.persist({ schemaVersion: SCHEMA_VERSION, windows })
  }
}
