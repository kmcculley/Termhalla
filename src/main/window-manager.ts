import { app, BrowserWindow, screen, ipcMain, type WebContents } from 'electron'
import { resolve } from 'node:path'
import { v4 as uuid } from 'uuid'
import {
  CH,
  type WinDragEndArgs, type WinDragGhostArgs, type WinRedockArgs, type WinReportArgs,
  type WinAssignment, type TermSnapshotArgs
} from '@shared/ipc-contract'
import { SCHEMA_VERSION, type AppState, type WindowState } from '@shared/types'
import { clampWindowState, DEFAULT_WINDOW_STATE } from './window-state'
import {
  undock, redock, decideDrop, ghostVisibleAt, windowOf,
  type CoreState, type Strip
} from './window-manager-core'
import { DragGhost } from './drag-ghost'
import { coordinateFlush } from './quit-flush'

/** Height (px) of the main window's tab strip — the drop zone for re-docking a torn-off tab. */
const STRIP_HEIGHT = 36

/** Grace period before a mid-move pane whose destination never re-attached is flushed and
 *  un-buffered, so a dropped/failed handoff can't leak memory or wedge the terminal forever. */
const TRANSIT_GC_MS = 10_000

/** Hard cap on events buffered for one pane mid-transit. A wedged or maliciously re-armed transit
 *  (FINDING-SEC-003) must not grow the buffer without bound: once exceeded we flush via the existing
 *  `replayInto` drain and resume live delivery, rather than buffer forever. */
const TRANSIT_BUFFER_MAX = 1024

/** Debounce for persisting window bounds during a resize/move drag (which fires continuously). */
const PERSIST_DEBOUNCE_MS = 300

/** Default size for a freshly torn-off (undocked) window before the user moves/resizes it. */
const NEW_WINDOW_SIZE = { width: 900, height: 640 }

/** Channels whose first argument is a paneId and therefore route to the owning window. Everything
 *  else (cloud:status, env:state, fs:change, …) is app-global and broadcasts to every window. */
const PANE_SCOPED = new Set<string>([
  CH.ptyData, CH.ptyExit, CH.ptyStatus, CH.ptyCwd, CH.ptyProcs, CH.gitStatus,
  CH.aiSession, CH.usageMetrics, CH.orkyStatus, CH.recState, CH.termSerialize
])

/** A move currently in flight (moves are serialized): the workspace being moved, its destination
 *  window, the pane ids whose snapshots have arrived, and the resolver for the await. */
interface Inflight { workspaceId: string; destWindowId: string; paneIds: string[]; resolve: () => void }

/** A pane-scoped push event buffered while its pane is mid-move (channel + original args). */
interface BufferedEvent { channel: string; args: unknown[] }

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
  private transit = new Map<string, BufferedEvent[]>() // paneId -> pane-scoped events buffered mid-move
  private transitTimers = new Map<string, ReturnType<typeof setTimeout>>() // paneId -> GC timer
  private snapshots = new Map<string, string>()        // paneId -> captured ANSI snapshot
  private inflight: Inflight | null = null
  private ghost = new DragGhost()                       // OS-level tear-off drag ghost (cosmetic)
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private quitting = false
  private closedCbs: (() => void)[] = []
  private windowCloseCbs: (() => void)[] = []
  private flushConfirm: ((windowId: string) => void) | null = null

  constructor(private readonly persist: (s: AppState) => void) {}

  /** The app is quitting: snapshot the final arrangement+bounds once, and let every window close
   *  normally (no re-dock interception, no shrinking per-window persist). */
  beginQuit(): void { this.quitting = true; this.ghost.destroy(); this.persistState() }

  /** Ask every live window to flush its renderer-owned state (workspaces, quick) to disk, and wait
   *  until all confirm or `timeoutMs` elapses. The renderer flush is fire-and-forget on `beforeunload`
   *  otherwise, which races process exit during an auto-update install — so the quit awaits this first.
   *  Bounded by the timeout so a hung/crashed renderer can never block the quit. */
  async flushRenderers(timeoutMs: number): Promise<void> {
    const live = [...this.wins.entries()].filter(([, w]) => !w.isDestroyed() && !w.webContents.isDestroyed())
    if (live.length === 0) return
    const { confirm, promise } = coordinateFlush(live.map(([id]) => id), timeoutMs)
    this.flushConfirm = confirm
    for (const [, win] of live) this.safeSend(win, CH.appFlush)
    await promise
    this.flushConfirm = null
  }

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
    for (const win of this.wins.values()) this.load(win)
  }

  private load(win: BrowserWindow): void {
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
    // Re-send on every load so a dev hot-reload re-hydrates the window's assignment. This is the
    // source of truth for a brand-new window's first assignment; `move`'s explicit send only
    // reaches windows whose content has already loaded (assignment delivery is idempotent).
    win.webContents.on('did-finish-load', () => this.sendAssignment(id))
    // resize/move fire continuously during a drag → debounce the (full app-state) write.
    const persist = () => this.schedulePersist()
    win.on('resize', persist)
    win.on('move', persist)
    win.on('close', (e) => this.onClose(id, e))
    win.on('closed', () => this.onClosed(id))
    return win
  }

  /** A floating window's native X re-docks its workspace(s) instead of killing its shells (unless
   *  the app is quitting, when every window must close normally). The arrangement is persisted on
   *  structural changes + beginQuit, so a per-window close never overwrites it with a shrinking set.
   *  The main window's X quits the app. */
  private onClose(id: string, e: Electron.Event): void {
    // Fire flush hooks for EVERY window's close (incl. during quit), before the redock/quit branches
    // below can return — so a floating window closing first still flushes, not just the main window.
    for (const cb of this.windowCloseCbs) cb()
    if (this.quitting) return
    const cw = this.core.windows.find(w => w.id === id)
    if (cw && !cw.isMain && cw.workspaceIds.length > 0) {
      e.preventDefault()
      void this.redockAll([...cw.workspaceIds])   // serialized: each move owns `inflight` in turn
      return
    }
    if (cw?.isMain) app.quit()   // closing main tears down the whole app (incl. any floating windows)
  }

  /** Re-dock workspaces back to main one at a time — moves must not overlap (they share `inflight`
   *  and the per-pane transit handoff). */
  private async redockAll(workspaceIds: string[]): Promise<void> {
    for (const wsId of workspaceIds) await this.move(wsId, this.mainWindowId())
  }

  private onClosed(id: string): void {
    this.wins.delete(id)
    const wasMain = this.core.windows.find(w => w.id === id)?.isMain ?? false
    this.core.windows = this.core.windows.filter(w => w.id !== id)
    // Never end up main-less if some other window survives (defends mainWindowId()'s `!`); the
    // promoted window must switch from the floating header to the tab strip, so re-assign it.
    if (wasMain && this.core.windows.length > 0 && !this.core.windows.some(w => w.isMain)) {
      this.core.windows[0].isMain = true
      this.sendAssignment(this.core.windows[0].id)
    }
    // Drop ownership + any in-flight buffering for panes that died with this window.
    for (const [pid, wid] of this.paneOwner) {
      if (wid === id) { this.paneOwner.delete(pid); this.endTransit(pid); this.transit.delete(pid); this.snapshots.delete(pid) }
    }
    if (this.wins.size === 0) { this.ghost.destroy(); for (const cb of this.closedCbs) cb() }
  }

  mainWindow(): BrowserWindow { return this.wins.get(this.mainWindowId())! }
  private mainWindowId(): string { return this.core.windows.find(w => w.isMain)!.id }

  // ── Router surface (consumed by registerHandlers' `send`) ─────────────────────────────────────

  isPaneScoped(channel: string): boolean { return PANE_SCOPED.has(channel) }

  /** True iff `sender` belongs to ANY currently-tracked app window (main or floating) — false for a
   *  destroyed/foreign/unrecognized sender. Public accessor over `windowIdOf` (feature 0005, TASK-008):
   *  0004's `registerOrky` validated a sender against exactly ONE window, which silently dropped
   *  `orky:watch`/`orky:unwatch` from any OTHER window — REQ-002/REQ-020 require pane-root membership
   *  aggregated across ALL windows, so this widens "exactly one owning window" to "any known app
   *  window" while preserving the original security intent (a truly out-of-process or already-closed
   *  sender is still rejected — FINDING-SEC-002). */
  isKnownWindowSender(sender: WebContents): boolean {
    if (sender.isDestroyed()) return false // the sender itself may be destroyed independently of its window
    return this.windowIdOf(sender) !== undefined
  }

  routeToPane(paneId: string, channel: string, ...args: unknown[]): void {
    // While a pane is mid-handoff, buffer EVERY pane-scoped event (data, status, cwd, exit, …) so
    // nothing is delivered to the destination before its xterm mounts and nothing is lost.
    const buf = this.transit.get(paneId)
    if (buf) {
      buf.push({ channel, args })
      // Bound the buffer (FINDING-SEC-003): a transit that never re-attaches — or is re-armed
      // repeatedly — must not accumulate pty:data without limit. Flush+resume once over the cap.
      if (buf.length > TRANSIT_BUFFER_MAX) this.replayInto(paneId)
      return
    }
    // An unowned pane (sender vanished between spawn and route) defaults to the main window. Resolve
    // the id without mainWindow()'s `!` assertion: a late pty:data chunk can arrive during shutdown
    // after the window list is already main-less, and safeSend() no-ops on an undefined window.
    const winId = this.paneOwner.get(paneId) ?? this.core.windows.find(w => w.isMain)?.id
    this.safeSend(winId ? this.wins.get(winId) : undefined, channel, ...args)
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const win of this.wins.values()) this.safeSend(win, channel, ...args)
  }

  onAllWindowsClosed(cb: () => void): void { this.closedCbs.push(cb) }

  /** Run `cb` synchronously whenever any window is closing (the 'close' event, while the window still
   *  exists — safe for synchronous flushes). Used to persist drafts/notes regardless of which window
   *  (main or floating) closes. */
  onWindowClose(cb: () => void): void { this.windowCloseCbs.push(cb) }

  /** Associate a pane with the window that spawned it (from the ipcMain event sender). Called on
   *  every `pty:spawn`, so ownership is correct for fresh panes and re-affirmed after a move. */
  claimPane(paneId: string, sender: WebContents): void {
    const id = this.windowIdOf(sender)
    if (id) this.paneOwner.set(paneId, id)
  }

  /** Arm the buffered transit for a SAME-WINDOW minimize/restore: the renderer is about to unmount
   *  the pane's TerminalPane and remount a fresh one (in the off-layout host, or back in a tile), and
   *  during that gap there is no `pty:data` subscriber, so without buffering the gap bytes are dropped
   *  (FINDING-CODEX-001). This REUSES the multi-window `transit` buffer + `replayInto` drain: while a
   *  buffer is set, `routeToPane` buffers every pane-scoped event; the destination's idempotent
   *  `pty:spawn` re-adoption drains it via `replayInto`. NO snapshot is captured here and the pane is
   *  NOT re-owned (same window — C5: main still owns windows[]); only the gap bytes are buffered.
   *
   *  Ownership is validated against the calling window (FINDING-SEC-003): mirroring `claimPane`/
   *  `winReady`, the caller is resolved via `windowIdOf(sender)` and the arm is a SILENT no-op when
   *  the sender is unknown, the pane is unowned, or it is owned by a DIFFERENT window — so one
   *  renderer can never arm (and thereby withhold output from) another window's pane (C5).
   *
   *  A re-arm while a buffer is still pending flushes the stale buffer via the existing `replayInto`
   *  drain before arming a fresh one, so repeated arms can't extend an old buffer without bound. */
  beginSameWindowTransit(paneId: string, sender: WebContents): void {
    const winId = this.windowIdOf(sender)
    if (!winId || this.paneOwner.get(paneId) !== winId) return   // unknown sender / unowned / foreign pane
    if (this.transit.has(paneId)) this.replayInto(paneId)        // flush any pending buffer before re-arming
    this.transit.set(paneId, [])
    this.endTransit(paneId)
    this.transitTimers.set(paneId, setTimeout(() => this.replayInto(paneId), TRANSIT_GC_MS))
  }

  /** A moved pane re-spawned in its new window: it already has a live pty, so instead of spawning
   *  we replay the captured snapshot then the events buffered during the move, in order. Also the
   *  GC path for a handoff whose destination never re-attached (see TRANSIT_GC_MS). */
  replayInto(paneId: string): void {
    this.endTransit(paneId)
    const winId = this.paneOwner.get(paneId)
    const win = winId ? this.wins.get(winId) : undefined
    const snap = this.snapshots.get(paneId)
    this.snapshots.delete(paneId)
    const buffered = this.transit.get(paneId)
    this.transit.delete(paneId)               // stop buffering; live output flows again
    if (snap !== undefined) this.safeSend(win, CH.ptyData, paneId, snap)
    if (buffered) for (const ev of buffered) this.safeSend(win, ev.channel, ...ev.args)
  }

  private endTransit(paneId: string): void {
    const t = this.transitTimers.get(paneId)
    if (t) { clearTimeout(t); this.transitTimers.delete(paneId) }
  }

  private safeSend(win: BrowserWindow | undefined, channel: string, ...args: unknown[]): void {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try { win.webContents.send(channel, ...args) } catch { /* torn down mid-send */ }
  }

  // ── IPC ───────────────────────────────────────────────────────────────────────────────────────

  private registerIpc(): void {
    ipcMain.on(CH.winDragEnd, (_e, a: WinDragEndArgs) => { void this.onDragEnd(a) })
    ipcMain.on(CH.winDragGhost, (e, a: WinDragGhostArgs | null) => this.onDragGhost(e.sender, a))
    ipcMain.on(CH.winRedock, (_e, a: WinRedockArgs) => { void this.move(a.workspaceId, this.resolveTarget(a.targetWindowId)) })
    ipcMain.on(CH.winReport, (_e, a: WinReportArgs) => this.onReport(a))
    ipcMain.on(CH.termSnapshot, (_e, a: TermSnapshotArgs) => this.onSnapshot(a))
    // The renderer signals ready AFTER subscribing to win:assignment, so the first assignment is
    // never lost to a push that races ahead of the listener. (did-finish-load is the dev-reload path.)
    ipcMain.on(CH.winReady, (e) => { const id = this.windowIdOf(e.sender); if (id) this.sendAssignment(id) })
    ipcMain.on(CH.appFlushDone, (e) => { const id = this.windowIdOf(e.sender); if (id) this.flushConfirm?.(id) })
  }

  private windowIdOf(sender: WebContents): string | undefined {
    for (const [id, win] of this.wins) if (!win.isDestroyed() && win.webContents.id === sender.id) return id
    return undefined
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

  /** Tear-off ghost updates (validated + sender-scoped like every renderer→main window channel).
   *  The OS ghost shows only while the cursor is outside every app window — inside one, the
   *  renderer's DOM ghost covers it (an OS chip there would double the visual). `null` = drag end. */
  private onDragGhost(sender: WebContents, a: WinDragGhostArgs | null): void {
    if (!this.windowIdOf(sender)) return
    if (!a || typeof a.x !== 'number' || typeof a.y !== 'number' ||
        !Number.isFinite(a.x) || !Number.isFinite(a.y) || typeof a.name !== 'string') {
      this.ghost.destroy()
      return
    }
    const bounds = [...this.wins.values()].filter(w => !w.isDestroyed()).map(w => w.getBounds())
    if (ghostVisibleAt({ x: a.x, y: a.y }, bounds)) this.ghost.moveTo(a.x, a.y, a.name.slice(0, 60))
    else this.ghost.hide()
  }

  // ── tear-off / re-dock with live handoff ──────────────────────────────────────────────────────

  private async onDragEnd(a: WinDragEndArgs): Promise<void> {
    this.ghost.destroy()   // belt: the drop consumes the drag regardless of the renderer's null send
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
        { ...NEW_WINDOW_SIZE, x: cursor?.x, y: cursor?.y, maximized: false }, displays)
      const win = this.createBrowserWindow(newWindowId, bounds)
      this.load(win)
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
   *  marked moving (buffer its events, re-own to the destination) so the destination's xterm can
   *  replay it on attach. The sentinel only resolves the move it belongs to. */
  private onSnapshot(a: TermSnapshotArgs): void {
    const end = /^__end__:(.+)$/.exec(a.paneId)
    if (end) { if (this.inflight && this.inflight.workspaceId === end[1]) this.inflight.resolve(); return }
    if (!this.inflight) return
    this.inflight.paneIds.push(a.paneId)
    this.snapshots.set(a.paneId, a.data)
    this.paneOwner.set(a.paneId, this.inflight.destWindowId)
    if (!this.transit.has(a.paneId)) {
      this.transit.set(a.paneId, [])
      // If the destination never re-attaches this pane, GC the buffer so it can't grow forever.
      this.transitTimers.set(a.paneId, setTimeout(() => this.replayInto(a.paneId), TRANSIT_GC_MS))
    }
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

  /** Debounced persist for the high-frequency resize/move path (avoids rewriting the whole
   *  app-state JSON dozens of times per second during a window drag). */
  private cancelPersist(): void {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
  }

  private schedulePersist(): void {
    this.cancelPersist()
    this.persistTimer = setTimeout(() => this.persistState(), PERSIST_DEBOUNCE_MS)
  }

  private persistState(): void {
    this.cancelPersist()  // a direct call supersedes any pending debounced one
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
