import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore, ProcInfo } from './types'

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
  ptyExit: 'pty:exit',     // main -> renderer event
  ptyStatus: 'pty:status',  // main -> renderer event
  notify: 'app:notify',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsReadDir: 'fs:readDir',
  fsStat: 'fs:stat',
  fsWatch: 'fs:watch',
  fsUnwatch: 'fs:unwatch',
  fsChange: 'fs:change',          // main -> renderer event
  dialogOpenFolder: 'dialog:openFolder',
  dialogOpenFile: 'dialog:openFile',
  ptyCwd: 'pty:cwd',          // main -> renderer event
  revealPath: 'shell:reveal',
  quickLoad: 'quick:load',
  quickSave: 'quick:save',
  homeDir: 'app:homeDir',
  ptyProcs: 'pty:procs'       // main -> renderer event
} as const

export interface NotifyArgs { title: string; body: string }
export interface PtySpawnArgs { id: string; shellId: string; cwd: string; cols: number; rows: number; launch?: TerminalLaunch }
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
  onPtyCwd(cb: (id: string, cwd: string) => void): () => void
  onPtyProcs(cb: (id: string, info: ProcInfo | null) => void): () => void
  revealPath(path: string): Promise<void>
  loadQuick(): Promise<QuickStore>
  saveQuick(data: QuickStore): Promise<void>
  homeDir(): Promise<string>
}
