import type { StoreApi } from 'zustand'
import type {
  Workspace, ShellInfo, MosaicNode, MosaicDirection, SplitDir4, TerminalConfig, TerminalStatus,
  PaneConfig, EditorConfig, ExplorerConfig, QuickStore, SshConnection, ProcInfo, CloudStatus,
  TerminalLaunch, AiSession, UsageMetrics, EditorDraft, ScheduledTask, Theme, EnvVaultState, GitStatus, RunCommand,
  OrkyPaneStatus, OrkyRegistrySnapshot
} from '@shared/types'
import type { DecisionQueueGroup } from '@shared/decision-queue'
import type { Chord, CommandId } from '@shared/keybindings'
import type { ImageSource } from '@shared/ipc-contract'
import type { PaneKind } from './pane-ops'
import type { OrkyPaneDetailEntry } from './orky-pane-slice'

export type ThemeScope =
  | { kind: 'app' }
  | { kind: 'workspace'; wsId: string }
  | { kind: 'pane'; wsId: string; paneId: string }

export type ToastKind = 'success' | 'error' | 'info'
export interface Toast { id: string; kind: ToastKind; text: string }

export type SettingsSection = 'general' | 'appearance' | 'environment' | 'terminal' | 'keybindings' | 'phoneRemote'
export interface SettingsTarget { section: SettingsSection; paneId?: string }

/** A closed (on-disk but not open in this window) workspace, listed in the Reopen dialog. */
export interface ClosedWorkspaceInfo {
  id: string
  name: string
  paneCount: number
  firstCwd?: string   // the first terminal pane's cwd, shown as a hint of what the workspace is
}

export interface PreviewState {
  open: boolean
  source?: ImageSource
  status: 'loading' | 'ready' | 'error'
  dataUrl?: string
  error?: string
}

export interface State {
  shells: ShellInfo[]
  workspaces: Record<string, Workspace>
  order: string[]
  activeId: string | null
  // Multi-window: this renderer's own window id + whether it is the main window, plus the handler
  // that applies a main-pushed assignment (which workspaces this window hosts). See window-manager.
  windowId: string | null
  isMainWindow: boolean
  applyAssignment: (a: { windowId: string; isMain: boolean; workspaceIds: string[]; activeId: string | null }) => Promise<void>
  serializeWorkspace: (wsId: string) => void
  newTerminalShellId: string | null
  lastEditorPaneId: string | null
  init: () => Promise<void>
  newWorkspace: (name: string) => string
  renameWorkspace: (id: string, name: string) => void
  closeWorkspace: (id: string) => void
  // ── Workspace documents (File menu) ───────────────────────────────────────────────────────────
  docPaths: Record<string, string>   // wsId -> bound `.thws` file path (seeded from disk on init)
  reopenOpen: boolean                // the Reopen Closed Workspace dialog is showing
  setReopenOpen: (open: boolean) => void
  /** Save the active workspace: flush live state to the internal record, and (if bound) write its
   *  `.thws` document. Unbound workspaces are simply flushed — every workspace is always persisted. */
  saveActiveWorkspace: () => Promise<void>
  /** Pick a `.thws` path, write the active workspace there, and bind it for future Saves. */
  saveActiveWorkspaceAs: () => Promise<void>
  /** Pick a `.thws` file and open it as a fresh workspace (new ids), binding it for Save. */
  openWorkspaceFromFile: () => Promise<string | null>
  /** Reopen a previously-closed internal workspace by id (keeps its identity), or focus it if open. */
  reopenClosedWorkspace: (id: string) => Promise<string | null>
  /** List on-disk workspaces not currently open in this window (for the Reopen dialog). */
  listClosedWorkspaces: () => Promise<ClosedWorkspaceInfo[]>
  /** Permanently delete a closed workspace's on-disk record (+ its doc binding). */
  deleteClosedWorkspace: (id: string) => Promise<void>
  moveWorkspace: (fromId: string, toId: string) => void
  duplicateWorkspace: (id: string) => string | null
  setActive: (id: string, opts?: { refocusPane?: boolean }) => void
  maximized: Record<string, string>   // wsId -> the paneId currently maximized in that workspace (persisted)
  minimized: Record<string, string[]> // wsId -> paneIds minimized off-layout in that workspace (persisted)
  focusedPaneId: string | null
  toggleMaximize: (wsId: string, paneId: string) => void
  toggleMinimize: (wsId: string, paneId: string) => void
  restorePane: (wsId: string, paneId: string) => void
  setFocusedPane: (paneId: string) => void
  refocusActivePane: () => void
  movePaneToWorkspace: (paneId: string, fromWsId: string, toWsId: string) => void
  movePaneToNewWorkspace: (paneId: string, fromWsId: string) => void
  setLayout: (wsId: string, layout: MosaicNode | null) => void
  addTerminal: (wsId: string, targetPaneId: string | null, dir: MosaicDirection, splitDir?: SplitDir4) => string
  addPaneOfKind: (wsId: string, kind: PaneKind) => Promise<void>
  closePane: (wsId: string, paneId: string) => void
  setNewTerminalShell: (id: string) => void
  saveAll: () => Promise<void>
  flushQuick: () => void
  statuses: Record<string, TerminalStatus>
  setStatus: (id: string, status: TerminalStatus) => void
  cwds: Record<string, string>
  setCwd: (id: string, cwd: string) => void
  procs: Record<string, ProcInfo>
  setProcs: (id: string, info: ProcInfo | null) => void
  gitStatus: Record<string, GitStatus>
  setGitStatus: (id: string, status: GitStatus | null) => void
  aiSessions: Record<string, AiSession>
  setAiSession: (id: string, ai: AiSession | null) => void
  usage: Record<string, UsageMetrics>
  setUsage: (id: string, metrics: UsageMetrics | null) => void
  // Per-pane live Orky run status (feature 0004). A `null` push clears the key (cwd left .orky/).
  orky: Record<string, OrkyPaneStatus>
  setOrky: (id: string, status: OrkyPaneStatus | null) => void
  // ── Cross-project decision queue (feature 0006) — runtime-only, nothing persisted (REQ-017). ──
  // The last VALID registry:status snapshot (null until first receipt), the error text shown when
  // none is held, the session-scoped drawer state, and the monotonic generation the recovery pull
  // is arbitrated on (REQ-003). Loading is DERIVED: snapshot === null && error === null (REQ-011).
  registrySnapshot: OrkyRegistrySnapshot | null
  registryError: string | null
  queueOpen: boolean
  snapshotGeneration: number
  setQueueOpen: (open: boolean) => void
  setRegistrySnapshot: (input: unknown) => void
  applyRecoveryPull: (input: unknown, issuedAtGeneration: number) => void
  recoveryPullFailed: () => void
  queueGroups: () => DecisionQueueGroup[]
  queueCount: () => number
  // ── Native OrkyPane (feature 0009) — per-pane detail runtime, runtime-only; pruned through the
  // SAME clearPaneRuntime seam as every other per-pane map (CONV-011/REQ-017). Actions live in
  // orky-pane-slice.ts (fetch/coalesce/discard, per-root notification fan-out, hidden boundary,
  // rebind). orkyRootPickOpen is the one-shot OrkyRootPicker request the creation affordances and
  // the split compass share (resolved with the picked root, or null on cancel).
  orkyPaneDetail: Record<string, OrkyPaneDetailEntry>
  fetchOrkyDetail: (paneId: string, root: string) => void
  notifyOrkyRootChanged: (root: string) => void
  setOrkyPaneHidden: (paneId: string, hidden: boolean) => void
  rebindOrkyPane: (wsId: string, paneId: string, root: string) => void
  addOrky: (wsId: string, targetPaneId: string | null, dir: MosaicDirection, root: string, splitDir?: SplitDir4) => string
  orkyRootPickOpen: boolean
  pickOrkyRoot: () => Promise<string | null>
  resolveOrkyRootPick: (root: string | null) => void
  // ── Per-project Orky cockpit workspace (feature 0011) — the single-gesture "work this project"
  // entry point. newOrkyWorkspace: no argument = the F11-labelled shared-picker flow (cancel
  // resolves null, creates nothing); with an argument = the pre-selected path — the picker is
  // skipped and the root is membership-validated against the HELD registry snapshot via the
  // fold-injected sameProjectRoot equality (refusals toast and resolve null; all four registry
  // states are honored). orkyCockpitPickOpen/resolveOrkyCockpitPick are the F11-owned one-shot
  // picker request (the pickOrkyRoot pattern — deliberately NOT the shared F9 request, which
  // stays default-labelled for its three existing callers).
  newOrkyWorkspace: (root?: string) => Promise<string | null>
  orkyCockpitPickOpen: boolean
  resolveOrkyCockpitPick: (root: string | null) => void
  // ── Quick-capture new-work inbox (feature 0012) — session-scoped chrome state only, nothing
  // persisted. `null` = closed; `{root:null}` = picker-first; `{root:string}` = form-direct with
  // the pre-selected root held byte-verbatim (D4 — the entry point F10's OrkyPane "inject" later
  // calls). Re-invoking while open is a reference-stable no-op; close discards unconditionally.
  // ── Remote workspaces (feature 0022 / F21) — per-workspace-home connection state + the
  // named-agent registry mirror + the single-gesture create flow. remoteAgentPickerOpen is the
  // session-scoped picker request flag (the cockpit-picker pattern).
  remoteStates: Record<string, import('@shared/remote-workspace').RemoteWorkspaceState>
  namedAgents: import('@shared/remote-agents').NamedAgent[]
  ingestRemoteState: (s: import('@shared/remote-workspace').RemoteWorkspaceState) => void
  seedRemoteStates: () => Promise<void>
  connectRemote: (workspaceId: string, agentId: string) => void
  disconnectRemote: (workspaceId: string, opts?: { forget?: boolean }) => void
  loadNamedAgents: () => Promise<void>
  saveNamedAgents: (agents: import('@shared/remote-agents').NamedAgent[]) => Promise<boolean>
  pruneRemoteStates: (liveWorkspaceIds: string[]) => void
  newRemoteWorkspace: (agentId?: string) => Promise<string | null>
  remoteAgentPickerOpen: boolean
  closeRemoteAgentPicker: () => void
  orkyCaptureRequest: { root: string | null } | null
  openOrkyCapture: (root?: string) => void
  closeOrkyCapture: () => void
  // paneId -> monotonic focus sequence (REQ-009's MRU recency), stamped by setFocusedPane and
  // pruned by the SAME clearPaneRuntime call that drops every other per-pane map (CONV-011).
  paneFocusSeq: Record<string, number>
  recording: Record<string, boolean>
  setRecording: (id: string, on: boolean) => void
  // A terminal whose shell process exited. A minimized pane is NOT auto-closed on exit (its
  // scrollback stays restorable), so its tray chip needs an `exited` indicator distinct from a live
  // idle pane (REQ-005 / FINDING-DA-003). Set on pty:exit, cleared when the pane is closed.
  exited: Record<string, boolean>
  setExited: (id: string, on: boolean) => void
  // OSC 0/2 window titles per pane (QoL 2026-07-17): shown on the pane chrome when the user
  // hasn't set a manual name. Runtime-only, never persisted.
  oscTitles: Record<string, string>
  setOscTitle: (id: string, title: string) => void
  // Editor panes with any unsaved tab (QoL 2026-07-17): drives the pane-title • so a dirty tab
  // stays visible when the strip is scrolled or the pane minimized. Runtime-only.
  editorDirty: Record<string, boolean>
  setEditorDirty: (id: string, dirty: boolean) => void
  setRecordByDefault: (on: boolean) => void
  setAutoResumeClaude: (on: boolean) => void
  setCopyOnSelect: (on: boolean) => void
  setCleanCopy: (on: boolean) => void
  setToastsEnabled: (on: boolean) => void
  setOrkyNeedsYouNotifications: (on: boolean) => void
  setTermScrollback: (lines: number) => void
  setEditorWordWrap: (on: boolean) => void
  setEditorMinimap: (on: boolean) => void
  setThemeFollowSystem: (on: boolean) => void
  drafts: Record<string, EditorDraft>
  setDraft: (key: string, draft: EditorDraft) => void
  deleteDraft: (key: string) => void
  notes: Record<string, string>
  notesOpen: boolean
  notesProjectKey: string | null
  setNotesOpen: (open: boolean) => void
  setNotesProject: (key: string) => void
  setNote: (key: string, text: string) => void
  flushNotes: () => void
  cloud: CloudStatus[]
  setCloud: (statuses: CloudStatus[]) => void
  refreshCloud: () => void
  envVault: EnvVaultState
  setEnvState: (s: EnvVaultState) => void
  launchCommand: (launch: TerminalLaunch) => void
  /** The NARROW resume-in-terminal composition (feature 0008, REQ-014 / FINDING-008): opens ONE
   *  terminal pane at `cwd` running `launch` — the pairing neither launchDir (cwd only) nor
   *  launchCommand (launch only, cwd '') covers. Kind, shell and placement are fixed internally
   *  (the launchCommand-shaped pattern); no capability-bearing field rides through. The raw
   *  pane-commit primitive stays store-internal, threaded to slices via SliceDeps below. */
  launchTerminalAt: (cwd: string, launch: TerminalLaunch) => void
  updatePaneConfig: (wsId: string, paneId: string, patch: Partial<Omit<EditorConfig, 'kind'> & Omit<ExplorerConfig, 'kind'> & Omit<TerminalConfig, 'kind'>>) => void
  registerEditorPane: (paneId: string) => void
  addEditor: (wsId: string, targetPaneId: string | null, dir: MosaicDirection, splitDir?: SplitDir4) => string
  addExplorer: (wsId: string, targetPaneId: string | null, dir: MosaicDirection, root: string, splitDir?: SplitDir4) => string
  openFileInEditor: (wsId: string, path: string) => void
  openExplorerHere: (wsId: string, paneId: string) => void
  schedules: Record<string, ScheduledTask>
  addSchedule: (task: Omit<ScheduledTask, 'id'>) => string
  cancelSchedule: (id: string) => void
  setWorkspaceRunCommands: (wsId: string, runCommands: RunCommand[]) => void
  runCommand: (paneId: string, command: string) => void
  quick: QuickStore
  home: string
  paletteOpen: boolean
  broadcastOpen: boolean
  setBroadcastOpen: (open: boolean) => void
  broadcastInput: (text: string, mode: 'paste' | 'keys', enter: boolean) => void
  connectionFormFor: SshConnection | 'new' | null
  loadQuick: () => Promise<void>
  setPaletteOpen: (open: boolean) => void
  setConnectionForm: (target: SshConnection | 'new' | null) => void
  saveConnection: (conn: SshConnection) => void
  deleteConnection: (id: string) => void
  pinDir: (dir: string) => void
  unpinDir: (dir: string) => void
  launchConnection: (connId: string) => void
  launchDir: (dir: string) => void
  saveTemplate: (name: string) => void
  deleteTemplate: (id: string) => void
  newWorkspaceFromTemplate: (templateId: string, name: string) => string
  setTheme: (patch: Partial<Theme>) => void
  resetTheme: () => void
  setThemeScoped: (scope: ThemeScope, patch: Partial<Theme>) => void
  resetThemeScope: (scope: ThemeScope) => void
  saveThemePreset: (name: string) => void
  applyThemePreset: (id: string) => void
  deleteThemePreset: (id: string) => void
  toasts: Toast[]
  pushToast: (text: string, kind?: ToastKind) => string
  dismissToast: (id: string) => void
  preview: PreviewState
  openImagePreview: (source: ImageSource) => void
  closeImagePreview: () => void
  setBinding: (id: CommandId, chord: Chord) => void
  unbindCommand: (id: CommandId) => void
  resetBinding: (id: CommandId) => void
  resetAllBindings: () => void
  settings: SettingsTarget | null
  openSettings: (t: SettingsTarget) => void
  closeSettings: () => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  revealPaneFromSearch: (paneId: string) => void
  relaunchFromSearch: (cwd: string) => void
}

/** Wiring handed to every slice creator: the store's set/get plus the shared debounced-save and
 *  pane-commit helpers that live on the composition root (store.ts). Slices read cross-slice
 *  state through `get()` — the store is one object; the split is for code organization. */
export interface SliceDeps {
  set: StoreApi<State>['setState']
  get: StoreApi<State>['getState']
  scheduleAutosave: () => void
  scheduleQuickSave: () => void
  scheduleNotesSave: (key: string) => void
  /** Place + commit a new pane. `splitDir` (a compass split) fully determines direction and
   *  position, overriding `dir`/`position` — the derivation the four add* actions used to
   *  copy-paste now lives inside commitPane (2026-07-17 audit, Finding 26). */
  commitPane: (wsId: string, cfg: PaneConfig, opts: {
    target: string | null
    dir: MosaicDirection
    splitDir?: SplitDir4
    position?: 'before' | 'after'
    markEditor?: boolean
  }) => string
  /** The store-root workspace-registration ritual (store.ts / workspace-registration.ts): set the
   *  record + schedule the autosave + report the arrangement into main's authoritative windows[].
   *  Threaded to slices (superseding the raw reportAssignment dep of feature 0011's decision-9
   *  repair, FINDING-001) so `newWorkspaceFromTemplate` registers exactly like every other
   *  workspace-adding action; kept OFF the public State surface (the FINDING-008 narrow-surface
   *  discipline). */
  registerWorkspace: (ws: Workspace) => void
  /** The active-record serializer (live cwd / AI-resume / view-state folded in — the exact form
   *  saveAll writes internally), threaded to the workspace-docs slice for `.thws` writes. */
  currentRecord: (wsId: string) => Workspace
  /** Register a fully-formed workspace record and land focus in its first pane (the shared
   *  openWorkspaceFromFile / reopenClosedWorkspace adoption ritual). */
  adoptWorkspace: (ws: Workspace) => void
}
