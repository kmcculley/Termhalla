/** A discovered shell the user can launch. */
export interface ShellInfo {
  id: string          // stable id: 'pwsh' | 'powershell' | 'cmd' | 'gitbash' | ...
  label: string       // human label, e.g. 'PowerShell 7'
  path: string        // absolute path to executable
  args: string[]      // launch args
}

export type TermState = 'idle' | 'busy' | 'needs-input'

export interface TerminalStatus {
  state: TermState
  lastExit?: 'success' | 'failure'
  since: number
}

export interface AlertConfig {
  border?: boolean
  tabBadge?: boolean
  osNotification?: boolean
  needsInput?: boolean
}

export interface TerminalLaunch {
  command: string
  args: string[]
  title: string
}

/** A saved SSH connection. No secrets stored — only host/user/port and an identity-file path. */
export interface SshConnection {
  id: string
  name: string
  host: string
  user: string
  port?: number          // default 22
  identityFile?: string  // path to a private key; optional
}

export interface WorkspaceTemplate {
  id: string
  name: string
  layout: MosaicNode | null
  panes: Record<string, PaneNode>
  theme?: Partial<Theme>
}

export interface Theme {
  windowBg: string
  panelBg: string
  elevatedBg: string
  border: string
  text: string
  textDim: string
  accent: string
  statusBusy: string
  statusNeedsInput: string
  fontFamily: string
  fontSize: number
  termBg: string
  termFg: string
  termFontFamily: string
  termFontSize: number
}

/** App-global favorites/recents (persisted to quick.json, not per-workspace). */
export interface QuickStore {
  connections: SshConnection[]
  recentConnections: string[]   // connection ids, most-recently-used
  favoriteDirs: string[]        // user-pinned (★)
  recentDirs: string[]          // MRU, deduped, capped, home excluded
  templates: WorkspaceTemplate[]
  theme?: Partial<Theme>
  themePresets: { id: string; name: string; theme: Theme }[]
  recordByDefault?: boolean
}

export const EMPTY_QUICK: QuickStore = {
  connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [], templates: [], themePresets: []
}

/** Per-terminal pane configuration (what gets serialized). */
export interface TerminalConfig {
  kind: 'terminal'
  shellId: string
  cwd: string
  name?: string
  alerts?: AlertConfig
  launch?: TerminalLaunch   // when set, run this instead of a discovered shell (SSH)
  connectionId?: string     // links back to the saved SshConnection, for display
  envId?: string            // links to a per-terminal env-vault entry; injected on spawn
  theme?: Partial<Theme>
}

export interface EditorConfig {
  kind: 'editor'
  files: string[]
  activePath?: string
  theme?: Partial<Theme>
}

export interface ExplorerConfig {
  kind: 'explorer'
  root: string
  theme?: Partial<Theme>
}

/** A persisted unsaved editor buffer (hot-exit). Keyed by `paneId::path` in the draft store. */
export interface EditorDraft {
  content: string    // the unsaved buffer text to restore
  baseline: string   // the disk text the buffer diverged from (for on-reopen conflict detection)
}

export type PaneConfig = TerminalConfig | EditorConfig | ExplorerConfig

export interface PaneNode {
  paneId: string
  config: PaneConfig
}

/** react-mosaic layout tree. Leaves are paneIds (strings). */
export type MosaicDirection = 'row' | 'column'
export interface MosaicParent {
  direction: MosaicDirection
  first: MosaicNode
  second: MosaicNode
  splitPercentage?: number
}
export type MosaicNode = string | MosaicParent

export interface Workspace {
  id: string
  name: string
  layout: MosaicNode | null         // null = no panes yet
  panes: Record<string, PaneNode>   // paneId -> pane
  theme?: Partial<Theme>
}

export interface AppState {
  schemaVersion: number
  openWorkspaceIds: string[]
  activeWorkspaceId: string | null
}

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export interface DirEntry { name: string; path: string; isDir: boolean }
export interface ReadResult { content: string; tooLarge: boolean }
export interface StatResult { size: number; mtimeMs: number; isDir: boolean }
export type FsEvent = 'add' | 'unlink' | 'change' | 'addDir' | 'unlinkDir'
export interface FsChange { event: FsEvent; path: string }

/** One process in a terminal's descendant tree. `depth` = 0 for direct children of the shell. */
export interface ProcNode {
  pid: number
  ppid: number
  name: string      // image name without ".exe", e.g. "node"
  command: string   // full CommandLine, or the name when CommandLine is empty
  depth: number
}

/** Foreground process + descendant tree for one terminal. */
export interface ProcInfo {
  foreground: string   // leaf process name shown on the chip when busy
  tree: ProcNode[]     // DFS pre-order; render indented by `depth`
}

/** A detected AI coding-agent session running in a terminal. */
export interface AiSession {
  tool: string    // 'claude' | 'codex'
  label: string   // 'Claude' | 'Codex'
}

export type CloudState = 'checking' | 'logged-in' | 'logged-out' | 'not-installed' | 'error'

/** Global login status for one cloud provider (AWS/Azure). Runtime-only, never persisted. */
export interface CloudStatus {
  id: string
  label: string
  state: CloudState
  account?: string                    // short identity (account id / subscription name)
  detail?: Record<string, string>     // popover rows
  checkedAt: number
  login?: TerminalLaunch              // command for the "Log in" button (reuses the launch shape)
}

/** Live usage metrics for a Claude session, parsed from its transcript. */
export interface UsageMetrics {
  input: number          // cumulative non-cached input tokens
  output: number         // cumulative output tokens
  cacheRead: number      // cumulative cache-read tokens
  cacheCreation: number  // cumulative cache-creation tokens
  contextTokens: number  // current context size (last assistant turn's input-side total)
  contextWindow: number  // the model's context window (e.g. 200000)
  contextPct: number     // round(contextTokens / contextWindow * 100)
}

/** Decrypted env-vault contents surfaced to the renderer while unlocked. */
export interface EnvVaultData { global: Record<string, string>; terminals: Record<string, Record<string, string>> }

export const SCHEMA_VERSION = 3

export type ScheduleTrigger =
  | { kind: 'delay'; ms: number }
  | { kind: 'idle' }
  | { kind: 'recurring'; everyMs: number; jitterMs: number }

export interface ScheduledTask {
  id: string
  paneId: string
  text: string
  mode: 'paste' | 'keys'
  enter: boolean
  trigger: ScheduleTrigger
  label: string
}
