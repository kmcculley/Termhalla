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
  }
}

contextBridge.exposeInMainWorld('termhalla', api)
