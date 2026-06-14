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

/** Per-terminal pane configuration (what gets serialized). */
export interface TerminalConfig {
  kind: 'terminal'
  shellId: string
  cwd: string
  name?: string
  alerts?: AlertConfig
}

/** Phase 1 has only terminals; editor/explorer added in Phase 3. */
export type PaneConfig = TerminalConfig

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

export const SCHEMA_VERSION = 2
