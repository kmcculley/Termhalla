import type { StoreApi } from 'zustand'
import type {
  Workspace, ShellInfo, MosaicNode, MosaicDirection, TerminalConfig, TerminalStatus,
  PaneConfig, EditorConfig, ExplorerConfig, QuickStore, SshConnection, ProcInfo, CloudStatus,
  TerminalLaunch, AiSession, UsageMetrics, EditorDraft, ScheduledTask, Theme, EnvVaultState, GitStatus, RunCommand
} from '@shared/types'
import type { Chord, CommandId } from '@shared/keybindings'
import type { PaneKind } from './pane-ops'

export type ThemeScope =
  | { kind: 'app' }
  | { kind: 'workspace'; wsId: string }
  | { kind: 'pane'; wsId: string; paneId: string }

export type ToastKind = 'success' | 'error' | 'info'
export interface Toast { id: string; kind: ToastKind; text: string }

export type SettingsSection = 'general' | 'appearance' | 'environment' | 'terminal' | 'keybindings'
export interface SettingsTarget { section: SettingsSection; paneId?: string }

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
  moveWorkspace: (fromId: string, toId: string) => void
  setActive: (id: string) => void
  maximized: Record<string, string>   // wsId -> the paneId currently maximized in that workspace
  focusedPaneId: string | null
  toggleMaximize: (wsId: string, paneId: string) => void
  setFocusedPane: (paneId: string) => void
  movePaneToWorkspace: (paneId: string, fromWsId: string, toWsId: string) => void
  movePaneToNewWorkspace: (paneId: string, fromWsId: string) => void
  setLayout: (wsId: string, layout: MosaicNode | null) => void
  addTerminal: (wsId: string, targetPaneId: string | null, dir: MosaicDirection) => string
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
  recording: Record<string, boolean>
  setRecording: (id: string, on: boolean) => void
  setRecordByDefault: (on: boolean) => void
  drafts: Record<string, EditorDraft>
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
  updatePaneConfig: (wsId: string, paneId: string, patch: Partial<Omit<EditorConfig, 'kind'> & Omit<ExplorerConfig, 'kind'> & Omit<TerminalConfig, 'kind'>>) => void
  registerEditorPane: (paneId: string) => void
  addEditor: (wsId: string, targetPaneId: string | null, dir: MosaicDirection) => string
  addExplorer: (wsId: string, targetPaneId: string | null, dir: MosaicDirection, root: string) => string
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
  commitPane: (wsId: string, cfg: PaneConfig, target: string | null, dir: MosaicDirection, markEditor?: boolean) => string
}
