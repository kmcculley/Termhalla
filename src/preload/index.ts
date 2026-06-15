import { contextBridge, ipcRenderer } from 'electron'
import { CH, type TermhallaApi } from '@shared/ipc-contract'

const api: TermhallaApi = {
  listShells: () => ipcRenderer.invoke(CH.listShells),
  listWorkspaceIds: () => ipcRenderer.invoke(CH.listWorkspaceIds),
  loadWorkspace: (id) => ipcRenderer.invoke(CH.loadWorkspace, id),
  saveWorkspace: (ws) => ipcRenderer.invoke(CH.saveWorkspace, ws),
  loadAppState: () => ipcRenderer.invoke(CH.loadAppState),
  saveAppState: (s) => ipcRenderer.invoke(CH.saveAppState, s),
  ptySpawn: (a) => ipcRenderer.invoke(CH.ptySpawn, a),
  ptyWrite: (a) => ipcRenderer.send(CH.ptyWrite, a),
  ptyResize: (a) => ipcRenderer.send(CH.ptyResize, a),
  ptyKill: (id) => ipcRenderer.send(CH.ptyKill, id),
  onPtyData: (cb) => {
    const h = (_e: unknown, id: string, data: string) => cb(id, data)
    ipcRenderer.on(CH.ptyData, h as never)
    return () => ipcRenderer.removeListener(CH.ptyData, h as never)
  },
  onPtyExit: (cb) => {
    const h = (_e: unknown, id: string, code: number) => cb(id, code)
    ipcRenderer.on(CH.ptyExit, h as never)
    return () => ipcRenderer.removeListener(CH.ptyExit, h as never)
  },
  notify: (a) => ipcRenderer.send(CH.notify, a),
  onPtyStatus: (cb) => {
    const h = (_e: unknown, id: string, status: import('@shared/types').TerminalStatus) => cb(id, status)
    ipcRenderer.on(CH.ptyStatus, h as never)
    return () => ipcRenderer.removeListener(CH.ptyStatus, h as never)
  },
  fsRead: (path) => ipcRenderer.invoke(CH.fsRead, path),
  fsWrite: (path, content) => ipcRenderer.invoke(CH.fsWrite, path, content),
  fsReadDir: (path) => ipcRenderer.invoke(CH.fsReadDir, path),
  fsStat: (path) => ipcRenderer.invoke(CH.fsStat, path),
  fsWatch: (id, path) => ipcRenderer.send(CH.fsWatch, id, path),
  fsUnwatch: (id) => ipcRenderer.send(CH.fsUnwatch, id),
  onFsChange: (cb) => {
    const h = (_e: unknown, id: string, change: import('@shared/types').FsChange) => cb(id, change)
    ipcRenderer.on(CH.fsChange, h as never)
    return () => ipcRenderer.removeListener(CH.fsChange, h as never)
  },
  openFolder: () => ipcRenderer.invoke(CH.dialogOpenFolder),
  openFile: () => ipcRenderer.invoke(CH.dialogOpenFile),
  saveFileDialog: () => ipcRenderer.invoke(CH.dialogSaveFile),
  revealPath: (path) => ipcRenderer.invoke(CH.revealPath, path),
  loadQuick: () => ipcRenderer.invoke(CH.quickLoad),
  saveQuick: (data) => ipcRenderer.invoke(CH.quickSave, data),
  homeDir: () => ipcRenderer.invoke(CH.homeDir),
  draftsLoad: () => ipcRenderer.invoke(CH.draftsLoad),
  draftSet: (key, draft) => ipcRenderer.send(CH.draftsSet, key, draft),
  draftDelete: (key) => ipcRenderer.send(CH.draftsDelete, key),
  onPtyCwd: (cb) => {
    const h = (_e: unknown, id: string, cwd: string) => cb(id, cwd)
    ipcRenderer.on(CH.ptyCwd, h as never)
    return () => ipcRenderer.removeListener(CH.ptyCwd, h as never)
  },
  onPtyProcs: (cb) => {
    const h = (_e: unknown, id: string, info: import('@shared/types').ProcInfo | null) => cb(id, info)
    ipcRenderer.on(CH.ptyProcs, h as never)
    return () => ipcRenderer.removeListener(CH.ptyProcs, h as never)
  },
  onCloudStatus: (cb) => {
    const h = (_e: unknown, statuses: import('@shared/types').CloudStatus[]) => cb(statuses)
    ipcRenderer.on(CH.cloudStatus, h as never)
    return () => ipcRenderer.removeListener(CH.cloudStatus, h as never)
  },
  cloudRefresh: () => ipcRenderer.invoke(CH.cloudRefresh),
  onAiSession: (cb) => {
    const h = (_e: unknown, id: string, ai: import('@shared/types').AiSession | null) => cb(id, ai)
    ipcRenderer.on(CH.aiSession, h as never)
    return () => ipcRenderer.removeListener(CH.aiSession, h as never)
  },
  usageWatch: (id, cwd) => ipcRenderer.send(CH.usageWatch, id, cwd),
  usageUnwatch: (id) => ipcRenderer.send(CH.usageUnwatch, id),
  onUsageMetrics: (cb) => {
    const h = (_e: unknown, id: string, m: import('@shared/types').UsageMetrics | null) => cb(id, m)
    ipcRenderer.on(CH.usageMetrics, h as never)
    return () => ipcRenderer.removeListener(CH.usageMetrics, h as never)
  },
}

contextBridge.exposeInMainWorld('termhalla', api)
