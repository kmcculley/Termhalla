import { ipcMain, type BrowserWindow } from 'electron'
import { CH, type PtySpawnArgs, type PtyWriteArgs, type PtyResizeArgs } from '@shared/ipc-contract'
import type { Workspace, AppState } from '@shared/types'
import { detectShells } from '../pty/shells'
import { PtyManager } from '../pty/pty-manager'
import { WorkspaceStore } from '../persistence/store'
import { userDataDir } from '../persistence/paths'

export function registerHandlers(win: BrowserWindow): PtyManager {
  const store = new WorkspaceStore(userDataDir())
  const shells = detectShells()
  const pty = new PtyManager(
    (id, data) => win.webContents.send(CH.ptyData, id, data),
    (id, code) => win.webContents.send(CH.ptyExit, id, code)
  )

  ipcMain.handle(CH.listShells, () => shells)
  ipcMain.handle(CH.listWorkspaceIds, () => store.listWorkspaceIds())
  ipcMain.handle(CH.loadWorkspace, (_e, id: string) => store.loadWorkspace(id))
  ipcMain.handle(CH.saveWorkspace, (_e, ws: Workspace) => store.saveWorkspace(ws))
  ipcMain.handle(CH.loadAppState, () => store.loadAppState())
  ipcMain.handle(CH.saveAppState, (_e, s: AppState) => store.saveAppState(s))

  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows)
  })
  ipcMain.on(CH.ptyWrite, (_e, a: PtyWriteArgs) => pty.write(a.id, a.data))
  ipcMain.on(CH.ptyResize, (_e, a: PtyResizeArgs) => pty.resize(a.id, a.cols, a.rows))
  ipcMain.on(CH.ptyKill, (_e, id: string) => pty.kill(id))

  return pty
}
