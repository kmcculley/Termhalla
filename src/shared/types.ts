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

/** App-global favorites/recents (persisted to quick.json, not per-workspace). */
export interface QuickStore {
  connections: SshConnection[]
  recentConnections: string[]   // connection ids, most-recently-used
  favoriteDirs: string[]        // user-pinned (★)
  recentDirs: string[]          // MRU, deduped, capped, home excluded
}

export const EMPTY_QUICK: QuickStore = {
  connections: [], recentConnections: [], favoriteDirs: [], recentDirs: []
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
}

export interface EditorConfig {
  kind: 'editor'
  files: string[]
  activePath?: string
}

export interface ExplorerConfig {
  kind: 'explorer'
  root: string
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

export const SCHEMA_VERSION = 3
