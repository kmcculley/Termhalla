import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore, ProcInfo, CloudStatus, AiSession, UsageMetrics, EditorDraft, EnvVaultData, RecState, EnvVaultState, GitStatus, SearchHit, SearchStats, OrkyPaneStatus, OrkyRegistrySnapshot, RegistryMutationResult, OrkyRootDetailResult, OrkyActionResult, ResolveEscalationRequest, SubmitWorkRequest, RecordHumanGateRequest, DriveStatusRequest } from './types'
import type { PhoneRemoteStatus } from './phone-remote/status'

export const CH = {
  listShells: 'shells:list',
  listWorkspaceIds: 'ws:listIds',
  loadWorkspace: 'ws:load',
  saveWorkspace: 'ws:save',
  deleteWorkspace: 'ws:delete',            // renderer -> main (remove a workspace's on-disk record)
  // Workspace documents (File menu): portable `.thws` save/open + the per-workspace bound-file map.
  wsdocPickSave: 'wsdoc:pickSave',         // renderer -> main (native Save-As dialog, .thws filter)
  wsdocPickOpen: 'wsdoc:pickOpen',         // renderer -> main (native Open dialog, .thws filter)
  wsdocRead: 'wsdoc:read',                 // renderer -> main (read a document file's text)
  wsdocWrite: 'wsdoc:write',               // renderer -> main (atomic write a document file)
  wsdocPathsLoad: 'wsdoc:pathsLoad',       // renderer -> main (load the persisted wsId->path map)
  wsdocPathSet: 'wsdoc:pathSet',           // renderer -> main (bind a workspace to a document path)
  wsdocPathClear: 'wsdoc:pathClear',       // renderer -> main (drop a workspace's document binding)
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
  fsMkdir: 'fs:mkdir',
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
  registryStatus: 'registry:status',        // main -> renderer event (APP-GLOBAL broadcast; full snapshot)
  registryCurrent: 'registry:current',      // renderer -> main (pull the current aggregate snapshot)
  registryRoots: 'registry:roots',          // renderer -> main (pull the persisted explicit root list)
  registryAddRoot: 'registry:addRoot',      // renderer -> main (add a root to the persisted list)
  registryRemoveRoot: 'registry:removeRoot', // renderer -> main (remove a root from the persisted list)
  // Native OrkyPane read surfaces (feature 0009) — both in the registry:* READ domain, grep-visibly
  // distinct from the orkyAction:* mutation domain. The pull is member-roots-only and read-only; the
  // push is the detail view's currency mechanism (fires on EVERY completed engine re-read).
  registryDetail: 'registry:detail',          // renderer -> main (pull ONE tracked root's full Orky detail)
  registryRootChanged: 'registry:rootChanged', // main -> renderer event (APP-GLOBAL; payload = the project-root string ONLY)
  // orkyAction:* (feature 0007) — Termhalla's first write-capable IPC surface into an Orky-adopted
  // project. A domain DISTINCT from the read-only orky:* channels above (grep-visible separation).
  // All four are renderer -> main request/response calls; this feature introduces NO push channel.
  orkyActionResolveEscalation: 'orkyAction:resolveEscalation', // renderer -> main
  orkyActionSubmitWork: 'orkyAction:submitWork',               // renderer -> main
  orkyActionRecordHumanGate: 'orkyAction:recordHumanGate',     // renderer -> main
  orkyActionDriveStatus: 'orkyAction:driveStatus',             // renderer -> main (read-only)
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
  winDragGhost: 'win:dragGhost',     // renderer -> main (tear-off ghost: screen-cursor move, null = drag end)
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
  // Native File menu (main -> renderer events; each fires on the focused window). The renderer owns
  // live workspace state, so the menu only signals intent and the renderer performs the action.
  fileNew: 'menu:file-new',                 // New Workspace
  fileOpen: 'menu:file-open',               // Open Workspace… (pick a .thws file)
  fileReopen: 'menu:file-reopen',           // Reopen Closed Workspace… (internal list)
  fileSave: 'menu:file-save',               // Save Workspace (write bound doc + flush internal)
  fileSaveAs: 'menu:file-save-as',          // Save Workspace As… (pick a .thws file)
  // OS-level needs-you notifications (feature 0013). The SOLE new channel: a main -> renderer focus
  // handoff fired when the user clicks a needs-you notification. Payload = the target project-root
  // string (individual toast) or `null` (a digest click → open the drawer, no specific project).
  // Deliberately OUTSIDE the frozen registry:* family — it is not a registry read/write.
  orkyNotifyFocus: 'orkyNotify:focus',      // main -> renderer event (payload: string | null)
  // Remote workspaces (feature 0022 / F21) — the per-workspace-home connection surface. The
  // pty/status traffic of a remote-home workspace rides the EXISTING pty:* channels above,
  // routed main-side; these channels carry only the connection lifecycle + the named-agent
  // registry (config only — never a secret).
  remoteAgentsList: 'remote:agentsList',    // renderer -> main (the named-agent registry, read)
  remoteAgentsSave: 'remote:agentsSave',    // renderer -> main (full-list save; rejects on disk failure)
  remoteConnect: 'remote:connect',          // renderer -> main (begin/retry a workspace's connection)
  remoteDisconnect: 'remote:disconnect',    // renderer -> main (drop; ALSO cancels an in-flight connect)
  remoteState: 'remote:state',              // main -> renderer event (APP-GLOBAL; one RemoteWorkspaceState)
  remoteCurrent: 'remote:current',          // renderer -> main (pull ALL current states — recovers a missed push)
  // Phone web remote (feature 0026) — the opt-in HTTP+WS mirror server's desktop control surface.
  // The wire protocol itself (WS vocabulary) is NOT IPC — it rides the embedded server directly;
  // these channels only carry settings/status/pairing between the renderer's Settings UI and main.
  phoneRemoteStatus: 'phoneRemote:status',                   // renderer -> main (pull the current status)
  phoneRemoteSetEnabled: 'phoneRemote:setEnabled',           // renderer -> main
  phoneRemoteSetBind: 'phoneRemote:setBind',                 // renderer -> main
  phoneRemoteSetPort: 'phoneRemote:setPort',                 // renderer -> main
  phoneRemoteRegenerateToken: 'phoneRemote:regenerateToken', // renderer -> main (returns the plaintext pairing URL)
  phoneRemoteChanged: 'phoneRemote:changed',                 // main -> renderer event (status changed / an enable error occurred)
} as const

export interface NotifyArgs { title: string; body: string }
export interface PtySpawnArgs {
  id: string; shellId: string; cwd: string; cols: number; rows: number; launch?: TerminalLaunch; envId?: string
  /** Remote routing hint (feature 0022): present iff the pane's workspace homes to a named agent —
   *  main then routes the spawn (and the pane's whole pty lifecycle) over that workspace's agent
   *  connection. ABSENT for local spawns (the byte-identical pre-F21 path). */
  remote?: { workspaceId: string; agentId: string }
}
export interface PtyWriteArgs { id: string; data: string }
export interface PtyResizeArgs { id: string; cols: number; rows: number }

export interface WinDragEndArgs { workspaceId: string; cursor: { x: number; y: number } }
/** Screen-coordinate cursor position + dragged workspace name during a tab tear-off drag. */
export interface WinDragGhostArgs { x: number; y: number; name: string }
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
  /** Delete a workspace's on-disk record (used to prune a closed workspace from the reopen list). */
  deleteWorkspace(id: string): Promise<void>
  // ── Workspace documents (File menu) ───────────────────────────────────────────────────────────
  /** Native Save-As dialog scoped to `.thws`; `defaultName` seeds the suggested filename. Null on cancel. */
  pickWorkspaceSavePath(defaultName: string): Promise<string | null>
  /** Native Open dialog scoped to `.thws`. Null on cancel. */
  pickWorkspaceOpenPath(): Promise<string | null>
  /** Read a document file's text; null if it can't be read (surfaced as a toast, never a throw). */
  readWorkspaceDoc(path: string): Promise<string | null>
  /** Atomically write a document file; false if the write failed (so the UI never toasts a false save). */
  writeWorkspaceDoc(path: string, contents: string): Promise<boolean>
  /** Load the persisted workspaceId→documentPath map (seeds the renderer's Save-vs-Save-As decision). */
  loadWorkspaceDocPaths(): Promise<Record<string, string>>
  /** Bind a workspace to a document path (fire-and-forget). */
  setWorkspaceDocPath(workspaceId: string, path: string): void
  /** Drop a workspace's document binding (fire-and-forget). */
  clearWorkspaceDocPath(workspaceId: string): void
  loadAppState(): Promise<AppState | null>
  saveAppState(state: AppState): Promise<void>
  /** Resolves TRUE when an already-running PTY was adopted instead of spawned (moved / undocked /
   *  minimize-restored pane), FALSE on a genuinely fresh spawn. This is the re-adoption signal that
   *  survives a cross-window handoff — the renderer-side snapshot stash doesn't. */
  ptySpawn(args: PtySpawnArgs): Promise<boolean>
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
  fsMkdir(path: string): Promise<void>
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
  /** Cross-project registry aggregate (feature 0005; its first renderer consumer is feature 0006's
   *  decision-queue drawer). App-global broadcast (NOT pane-scoped) of the COMPLETE current
   *  aggregate on every change. */
  onRegistryStatus(cb: (snapshot: OrkyRegistrySnapshot) => void): () => void
  /** Pull the current aggregate snapshot on demand (recovers a missed push, mirrors `cloudCurrent`). */
  registryCurrent(): Promise<OrkyRegistrySnapshot>
  /** Pull the persisted explicit root list only (excludes ephemeral pane-only roots). */
  registryRoots(): Promise<string[]>
  /** Add a root to the persisted explicit list (validated; idempotent). */
  registryAddRoot(root: string): Promise<RegistryMutationResult>
  /** Remove a root from the persisted explicit list (idempotent no-op if absent). */
  registryRemoveRoot(root: string): Promise<RegistryMutationResult>
  /** Pull ONE tracked root's full Orky detail — per-gate records, findings, escalations — for the
   *  native OrkyPane (feature 0009). Read-only; accepts only a current aggregate MEMBER root
   *  (anything else gets a structured `ok:false` result, never a throw, never an arbitrary-path
   *  read). */
  registryDetail(root: string): Promise<OrkyRootDetailResult>
  /** Per-root change notification (feature 0009): fired on EVERY completed engine re-read of a
   *  root — no delta gating — carrying the bare project-root string only (never a status/snapshot).
   *  The OrkyPane detail view's currency mechanism. */
  onRegistryRootChanged(cb: (root: string) => void): () => void
  // orkyAction:* (feature 0007) — the write-capable dispatch surface. Every mutation is performed by
  // invoking Orky's OWN CLIs server-side. First renderer consumer: feature 0012's quick-capture
  // modal (submitWork only); resolveEscalation, recordHumanGate and driveStatus are consumed by
  // feature 0008's queue entry actions (orky-entry-actions.tsx), with F10's OrkyPane as the next
  // planned reuse of the same shared action layer.
  orkyResolveEscalation(req: ResolveEscalationRequest): Promise<OrkyActionResult>
  orkySubmitWork(req: SubmitWorkRequest): Promise<OrkyActionResult>
  orkyRecordHumanGate(req: RecordHumanGateRequest): Promise<OrkyActionResult>
  orkyDriveStatus(req: DriveStatusRequest): Promise<OrkyActionResult>
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
  /** Rejects when the disk write fails, so the renderer can keep the key dirty and retry
   *  (2026-07-17 audit, Finding 6 — a send-shaped write made failures unobservable). */
  notesSet(key: string, text: string): Promise<void>
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
  /** Absolute filesystem path for a DOM File from a drag-drop (QoL 2026-07-17). Synchronous,
   *  preload-local (Electron webUtils.getPathForFile — File.path was removed in Electron 32+).
   *  Typed structurally (not `File`) so this contract stays DOM-lib-free for the node configs. */
  pathForFile(file: unknown): string
  winDragEnd(args: WinDragEndArgs): void
  winDragGhost(args: WinDragGhostArgs | null): void
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
  // Native File menu clicks (each fires on the focused window; the renderer performs the action).
  onFileNew(cb: () => void): () => void
  onFileOpen(cb: () => void): () => void
  onFileReopen(cb: () => void): () => void
  onFileSave(cb: () => void): () => void
  onFileSaveAs(cb: () => void): () => void
  /** A needs-you OS notification was clicked (feature 0013). Payload = the project root to reveal, or
   *  `null` for a digest click (open the decision-queue drawer with no specific project). The renderer
   *  focuses a matching pane via F6's shared matcher, else opens+scrolls the drawer — a read-side
   *  handoff only (no `.orky` write, no registry mutation, no action dispatch). */
  onOrkyNotifyFocus(cb: (root: string | null) => void): () => void
  // Remote workspaces (feature 0022 / F21). The named-agent registry (config only, no secrets) +
  // the per-workspace connection lifecycle. Remote pty/status traffic rides the existing pty:*
  // surface transparently.
  remoteAgentsList(): Promise<import('./remote-agents').NamedAgent[]>
  /** Full-list save through the normalizer (both doors); rejects when the disk write fails so the
   *  UI never toasts a false success (the envSetGlobal precedent). Returns the saved list. */
  remoteAgentsSave(agents: import('./remote-agents').NamedAgent[]): Promise<import('./remote-agents').NamedAgent[]>
  /** Begin (or retry) the workspace's agent connection. Fire-and-forget: outcomes ride remote:state. */
  remoteConnect(workspaceId: string, agentId: string): void
  /** Drop the workspace's connection — ALSO the user-facing CANCEL of an in-flight connect
   *  (the F19 FINDING-005 caller-owned-cancellation contract). `opts.forget` (feature 0024,
   *  REQ-019/D10) is the additive close-tab shape: the manager forgets the workspace's entry
   *  even with panes still tracked (detach-then-forget — the daemon + PTYs are untouched, a
   *  separate process). Every pre-0024 call passes no opts (byte-identical). */
  remoteDisconnect(workspaceId: string, opts?: { forget?: boolean }): void
  /** Pull ALL current per-workspace connection states (recovers a missed remote:state push). */
  remoteCurrent(): Promise<import('./remote-workspace').RemoteWorkspaceState[]>
  /** Per-workspace connection state push (app-global broadcast; key by workspaceId). */
  onRemoteState(cb: (state: import('./remote-workspace').RemoteWorkspaceState) => void): () => void
  // Phone web remote (feature 0026). The plaintext pairing token exists only in main-process
  // memory for the current app session — regenerateToken is the ONLY call that ever returns it;
  // the renderer must render the QR and never persist it (REQ-004/REQ-007).
  phoneRemoteStatus(): Promise<PhoneRemoteStatus>
  phoneRemoteSetEnabled(enabled: boolean): Promise<PhoneRemoteStatus>
  phoneRemoteSetBind(mode: 'localhost' | 'lan'): Promise<PhoneRemoteStatus>
  phoneRemoteSetPort(port: number): Promise<PhoneRemoteStatus>
  phoneRemoteRegenerateToken(): Promise<{ pairingUrl: string }>
  onPhoneRemoteChanged(cb: (status: PhoneRemoteStatus) => void): () => void
}
