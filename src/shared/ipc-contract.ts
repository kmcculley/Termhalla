import type { ShellInfo, Workspace, AppState } from './types'

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
  ptyData: 'pty:data',     // main -> renderer event
  ptyExit: 'pty:exit'      // main -> renderer event
} as const

export interface PtySpawnArgs { id: string; shellId: string; cwd: string; cols: number; rows: number }
export interface PtyWriteArgs { id: string; data: string }
export interface PtyResizeArgs { id: string; cols: number; rows: number }

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
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, code: number) => void): () => void
}
