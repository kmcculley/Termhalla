import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH, type TermhallaApi } from '@shared/ipc-contract'

/**
 * One renderer-side subscription point per push channel. Many components subscribe to the same
 * channel (e.g. every TerminalPane listens for `pty:data`), and all workspaces stay mounted — so
 * attaching one raw `ipcRenderer.on` per subscriber would add N listeners to the single shared
 * IpcRenderer emitter and trip Node's 10-per-event MaxListeners warning. Instead we attach exactly
 * ONE underlying listener per channel and fan out to a Set of callbacks (detaching when the last
 * subscriber leaves). This also isolates the single unavoidable listener-type cast in one place.
 */
function pushChannel<A extends unknown[]>(channel: string): (cb: (...args: A) => void) => () => void {
  const subs = new Set<(...args: A) => void>()
  const dispatch = (_e: IpcRendererEvent, ...args: A): void => { for (const cb of [...subs]) cb(...args) }
  let attached = false
  return (cb) => {
    subs.add(cb)
    if (!attached) { ipcRenderer.on(channel, dispatch); attached = true }
    return () => {
      subs.delete(cb)
      if (subs.size === 0 && attached) { ipcRenderer.removeListener(channel, dispatch); attached = false }
    }
  }
}

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
  onPtyData: pushChannel<[string, string]>(CH.ptyData),
  onPtyExit: pushChannel<[string, number]>(CH.ptyExit),
  notify: (a) => ipcRenderer.send(CH.notify, a),
  onPtyStatus: pushChannel<[string, import('@shared/types').TerminalStatus]>(CH.ptyStatus),
  fsRead: (path) => ipcRenderer.invoke(CH.fsRead, path),
  fsWrite: (path, content) => ipcRenderer.invoke(CH.fsWrite, path, content),
  fsReadDir: (path) => ipcRenderer.invoke(CH.fsReadDir, path),
  fsStat: (path) => ipcRenderer.invoke(CH.fsStat, path),
  fsWatch: (id, path) => ipcRenderer.send(CH.fsWatch, id, path),
  fsUnwatch: (id) => ipcRenderer.send(CH.fsUnwatch, id),
  onFsChange: pushChannel<[string, import('@shared/types').FsChange]>(CH.fsChange),
  openFolder: () => ipcRenderer.invoke(CH.dialogOpenFolder),
  openFile: () => ipcRenderer.invoke(CH.dialogOpenFile),
  saveFileDialog: () => ipcRenderer.invoke(CH.dialogSaveFile),
  revealPath: (path) => ipcRenderer.invoke(CH.revealPath, path),
  fsRename: (oldPath, newPath) => ipcRenderer.invoke(CH.fsRename, oldPath, newPath),
  fsTrash: (path) => ipcRenderer.invoke(CH.fsTrash, path),
  fsRevealItem: (path) => ipcRenderer.invoke(CH.fsRevealItem, path),
  loadQuick: () => ipcRenderer.invoke(CH.quickLoad),
  saveQuick: (data) => ipcRenderer.invoke(CH.quickSave, data),
  homeDir: () => ipcRenderer.invoke(CH.homeDir),
  draftsLoad: () => ipcRenderer.invoke(CH.draftsLoad),
  draftsSet: (key, draft) => ipcRenderer.send(CH.draftsSet, key, draft),
  draftsDelete: (key) => ipcRenderer.send(CH.draftsDelete, key),
  onPtyCwd: pushChannel<[string, string]>(CH.ptyCwd),
  onPtyProcs: pushChannel<[string, import('@shared/types').ProcInfo | null]>(CH.ptyProcs),
  onGitStatus: pushChannel<[string, import('@shared/types').GitStatus | null]>(CH.gitStatus),
  onCloudStatus: pushChannel<[import('@shared/types').CloudStatus[]]>(CH.cloudStatus),
  cloudRefresh: () => ipcRenderer.invoke(CH.cloudRefresh),
  onAiSession: pushChannel<[string, import('@shared/types').AiSession | null]>(CH.aiSession),
  usageWatch: (id, cwd) => ipcRenderer.send(CH.usageWatch, id, cwd),
  usageUnwatch: (id) => ipcRenderer.send(CH.usageUnwatch, id),
  onUsageMetrics: pushChannel<[string, import('@shared/types').UsageMetrics | null]>(CH.usageMetrics),
  recStart: (id) => ipcRenderer.send(CH.recStart, id),
  recStop: (id) => ipcRenderer.send(CH.recStop, id),
  onRecState: pushChannel<[string, import('@shared/types').RecState]>(CH.recState),
  recReveal: () => ipcRenderer.send(CH.recReveal),
  onEnvState: pushChannel<[import('@shared/types').EnvVaultState]>(CH.envState),
  envUnlock: (p) => ipcRenderer.invoke(CH.envUnlock, p),
  envCreate: (p) => ipcRenderer.invoke(CH.envCreate, p),
  envLock: () => ipcRenderer.send(CH.envLock),
  envGet: () => ipcRenderer.invoke(CH.envGet),
  envSetGlobal: (n, v) => ipcRenderer.invoke(CH.envSetGlobal, n, v),
  envRemoveGlobal: (n) => ipcRenderer.send(CH.envRemoveGlobal, n),
  envSetTerminal: (id, n, v) => ipcRenderer.invoke(CH.envSetTerminal, id, n, v),
  envRemoveTerminal: (id, n) => ipcRenderer.send(CH.envRemoveTerminal, id, n),
  clipboardWrite: (text) => ipcRenderer.send(CH.clipboardWrite, text),
  clipboardRead: () => ipcRenderer.invoke(CH.clipboardRead),
  winDragEnd: (a) => ipcRenderer.send(CH.winDragEnd, a),
  winRedock: (a) => ipcRenderer.send(CH.winRedock, a),
  winReport: (a) => ipcRenderer.send(CH.winReport, a),
  winReady: () => ipcRenderer.send(CH.winReady),
  onWinAssignment: pushChannel<[import('@shared/ipc-contract').WinAssignment]>(CH.winAssignment),
  onTermSerialize: pushChannel<[string]>(CH.termSerialize),
  termSnapshot: (a) => ipcRenderer.send(CH.termSnapshot, a),
}

contextBridge.exposeInMainWorld('termhalla', api)
