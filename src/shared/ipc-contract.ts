import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore, ProcInfo, CloudStatus, AiSession, UsageMetrics, EditorDraft, EnvVaultData, RecState, EnvVaultState, GitStatus, SearchHit, SearchStats, OrkyPaneStatus } from './types'

export const CH = {
  listShells: 'shells:list',
  listWorkspaceIds: 'ws:listIds',
  loadWorkspace: 'ws:load',
  saveWorkspace: 'ws:save',
  loadAppState: 'app:loadState',
  saveAppState: 'app:saveState',
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyTransitBegin: 'pty:transit-begin',   // renderer -> main (arm the same-window minimize/restore buffer)
  ptyData: 'pty:data',     // main -> renderer event
  ptyExit: 'pty:exit',     // main -> renderer event
  ptyStatus: 'pty:status',  // main -> renderer event
  notify: 'app:notify',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsReadDir: 'fs:readDir',
  fsStat: 'fs:stat',
  fsRename: 'fs:rename',
  fsTrash: 'fs:trash',
  fsRevealItem: 'fs:revealItem',
  fsWatch: 'fs:watch',
  fsUnwatch: 'fs:unwatch',
  fsChange: 'fs:change',          // main -> renderer event
  dialogOpenFolder: 'dialog:openFolder',
  dialogOpenFile: 'dialog:openFile',
  dialogSaveFile: 'dialog:saveFile',
  ptyCwd: 'pty:cwd',          // main -> renderer event
  revealPath: 'shell:reveal',
  quickLoad: 'quick:load',
  quickSave: 'quick:save',
  homeDir: 'app:homeDir',
  ptyProcs: 'pty:procs',           // main -> renderer event
  gitStatus: 'git:status',         // main -> renderer event
  cloudStatus: 'cloud:status',     // main -> renderer event
  cloudRefresh: 'cloud:refresh',
  cloudCurrent: 'cloud:current',   // renderer pulls the latest status (recovers a missed push)
  aiSession: 'ai:session',         // main -> renderer event
  usageWatch: 'usage:watch',
  usageUnwatch: 'usage:unwatch',
  usageMetrics: 'usage:metrics',    // main -> renderer event
  orkyWatch: 'orky:watch',          // renderer -> main
  orkyUnwatch: 'orky:unwatch',      // renderer -> main
  orkyStatus: 'orky:status',        // main -> renderer event (pane-scoped; null payload = cleared)
  draftsLoad: 'drafts:load',
  draftsSet: 'drafts:set',
  notesLoad: 'notes:load',
  notesSet: 'notes:set',
  draftsDelete: 'drafts:delete',
  recStart: 'rec:start',
  recStop: 'rec:stop',
  recState: 'rec:state',
  recReveal: 'rec:reveal',
  envState: 'env:state', envUnlock: 'env:unlock', envCreate: 'env:create', envLock: 'env:lock', envGet: 'env:get',  // envState: main -> renderer event
  envSetGlobal: 'env:setGlobal', envRemoveGlobal: 'env:removeGlobal', envSetTerminal: 'env:setTerminal', envRemoveTerminal: 'env:removeTerminal',
  clipboardWrite: 'clipboard:write', clipboardRead: 'clipboard:read',  // renderer -> main
  winDragEnd: 'win:dragEnd',         // renderer -> main
  winRedock: 'win:redock',           // renderer -> main
  winReport: 'win:report',           // renderer -> main (this window's workspace list/active changed)
  winReady: 'win:ready',             // renderer -> main (subscribed; request my assignment)
  winAssignment: 'win:assignment',   // main -> renderer event
  termSerialize: 'term:serialize',   // main -> renderer event (request a snapshot)
  termSnapshot: 'term:snapshot',     // renderer -> main (the snapshot reply)
  appFlush: 'app:flush',             // main -> renderer event (flush renderer-owned state before quit)
  appFlushDone: 'app:flush:done',    // renderer -> main (flush complete)
  searchQuery: 'search:query',
  searchStats: 'search:stats',
  searchClear: 'search:clear',
  searchSetMuted: 'search:setMuted',
  shellOpenExternal: 'shell:openExternal',  // renderer -> main (open a URL in the default browser)
  previewLoadImage: 'preview:loadImage',    // renderer -> main (read file / fetch url -> data URL)
  openSettings: 'menu:open-settings',       // main -> renderer event (native Edit ▸ Settings… clicked)
} as const

export interface NotifyArgs { title: string; body: string }
export interface PtySpawnArgs { id: string; shellId: string; cwd: string; cols: number; rows: number; launch?: TerminalLaunch; envId?: string }
export interface PtyWriteArgs { id: string; data: string }
export interface PtyResizeArgs { id: string; cols: number; rows: number }

export interface WinDragEndArgs { workspaceId: string; cursor: { x: number; y: number } }
export interface WinRedockArgs { workspaceId: string; targetWindowId: string }
export interface WinReportArgs { windowId: string; workspaceIds: string[]; activeId: string | null }
export interface WinAssignment { windowId: string; isMain: boolean; workspaceIds: string[]; activeId: string | null }
export interface TermSnapshotArgs { paneId: string; data: string }

export type ImageSource = { kind: 'file'; src: string } | { kind: 'url'; src: string }
export type ImageResult = { ok: true; dataUrl: string; mime: string } | { ok: false; error: string }

export interface TermhallaApi {
  listShells(): Promise<ShellInfo[]>
  listWorkspaceIds(): Promise<string[]>
  loadWorkspace(id: string): Promise<Workspace | null>
  saveWorkspace(ws: Workspace): Promise<void>
  loadAppState(): Promise<AppState | null>
  saveAppState(state: AppState): Promise<void>
  ptySpawn(args: PtySpawnArgs): Promise<void>
  ptyWrite(args: PtyWriteArgs): void
  ptyResize(args: PtyResizeArgs): void
  ptyKill(id: string): void
  /** Arm the main-side buffered transit for a pane that is about to unmount→remount in the SAME
   *  window (minimize/restore). Any pane-scoped push (esp. pty:data) emitted during the gap is
   *  buffered and replayed when the destination re-adopts the live PTY via the idempotent pty:spawn,
   *  so no output is dropped (REQ-003 / FINDING-CODEX-001). No pane re-ownership (C5). */
  ptyTransitBegin(paneId: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, code: number) => void): () => void
  onPtyStatus(cb: (id: string, status: TerminalStatus) => void): () => void
  notify(args: NotifyArgs): void
  fsRead(path: string): Promise<ReadResult>
  fsWrite(path: string, content: string): Promise<number>
  fsReadDir(path: string): Promise<DirEntry[]>
  fsStat(path: string): Promise<StatResult>
  fsWatch(id: string, path: string): void
  fsUnwatch(id: string): void
  onFsChange(cb: (id: string, change: FsChange) => void): () => void
  openFolder(): Promise<string | null>
  openFile(): Promise<string | null>
  saveFileDialog(): Promise<string | null>
  onPtyCwd(cb: (id: string, cwd: string) => void): () => void
  onPtyProcs(cb: (id: string, info: ProcInfo | null) => void): () => void
  onGitStatus(cb: (id: string, status: GitStatus | null) => void): () => void
  onCloudStatus(cb: (statuses: CloudStatus[]) => void): () => void
  cloudRefresh(): Promise<void>
  /** Pull the latest cloud status on mount, so a renderer that missed the fire-and-forget
   *  cloud:status push (e.g. it subscribed after the probe completed) isn't stuck on the empty state. */
  cloudCurrent(): Promise<CloudStatus[]>
  onAiSession(cb: (id: string, ai: AiSession | null) => void): () => void
  usageWatch(id: string, cwd: string): void
  usageUnwatch(id: string): void
  onUsageMetrics(cb: (id: string, metrics: UsageMetrics | null) => void): () => void
  /** Start/stop the per-pane Orky `.orky/` status watch (auto-bound from the pane's tracked cwd). */
  orkyWatch(id: string, cwd: string): void
  orkyUnwatch(id: string): void
  /** Live per-pane Orky status push; a `null` payload means the pane is no longer a bound Orky run. */
  onOrkyStatus(cb: (paneId: string, status: OrkyPaneStatus | null) => void): () => void
  revealPath(path: string): Promise<void>
  fsRename(oldPath: string, newPath: string): Promise<void>
  fsTrash(path: string): Promise<void>
  fsRevealItem(path: string): Promise<void>
  loadQuick(): Promise<QuickStore>
  saveQuick(data: QuickStore): Promise<void>
  homeDir(): Promise<string>
  draftsLoad(): Promise<Record<string, EditorDraft>>
  draftsSet(key: string, draft: EditorDraft): void
  draftsDelete(key: string): void
  notesLoad(): Promise<Record<string, string>>
  notesSet(key: string, text: string): void
  recStart(id: string): void
  recStop(id: string): void
  onRecState(cb: (id: string, state: RecState) => void): () => void
  recReveal(): void
  onEnvState(cb: (state: EnvVaultState) => void): () => void
  envUnlock(passphrase: string): Promise<boolean>
  envCreate(passphrase: string): Promise<void>
  envLock(): void
  envGet(): Promise<EnvVaultData | null>
  // setGlobal/setTerminal use invoke (not fire-and-forget send) so a failed disk write rejects and
  // the UI can avoid toasting a false "added".
  envSetGlobal(name: string, value: string): Promise<void>
  envRemoveGlobal(name: string): void
  envSetTerminal(envId: string, name: string, value: string): Promise<void>
  envRemoveTerminal(envId: string, name: string): void
  clipboardWrite(text: string): void
  clipboardRead(): Promise<string>
  winDragEnd(args: WinDragEndArgs): void
  winRedock(args: WinRedockArgs): void
  winReport(args: WinReportArgs): void
  winReady(): void
  onWinAssignment(cb: (a: WinAssignment) => void): () => void
  onTermSerialize(cb: (workspaceId: string) => void): () => void
  termSnapshot(args: TermSnapshotArgs): void
  /** Main requests a flush of renderer-owned state (workspaces/quick) before quitting; the renderer
   *  persists, then calls appFlushDone so main knows the writes are on disk before the process exits. */
  onAppFlush(cb: () => void): () => void
  appFlushDone(): void
  searchQuery(q: string): Promise<SearchHit[]>
  searchStats(): Promise<SearchStats>
  searchClear(): Promise<SearchStats>
  searchSetMuted(paneId: string, muted: boolean): void
  openExternal(url: string): void
  previewLoadImage(src: ImageSource): Promise<ImageResult>
  /** The native Edit ▸ Settings… menu item was clicked; open the Settings modal at General. */
  onOpenSettings(cb: () => void): () => void
}
