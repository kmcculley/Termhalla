import { ipcMain, Notification, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { CH, type PtySpawnArgs, type PtyWriteArgs, type PtyResizeArgs, type NotifyArgs } from '@shared/ipc-contract'
import type { Workspace, AppState } from '@shared/types'
import { detectShells } from '../pty/shells'
import { PtyManager } from '../pty/pty-manager'
import { StatusEngine } from '../status/status-engine'
import { writeIntegrationScripts } from '../status/integration-scripts'
import { WorkspaceStore } from '../persistence/store'
import { userDataDir } from '../persistence/paths'
import { readTextFile, writeTextFile, readDirectory, statPath } from '../fs/files'
import { WatchManager } from '../fs/watch-manager'

export function registerHandlers(win: BrowserWindow): PtyManager {
  const store = new WorkspaceStore(userDataDir())
  const shells = detectShells()

  const scriptDir = join(userDataDir(), 'shell-integration')
  writeIntegrationScripts(scriptDir)

  const engine = new StatusEngine((id, status) => win.webContents.send(CH.ptyStatus, id, status))
  const pty = new PtyManager(
    (id, data) => win.webContents.send(CH.ptyData, id, data),
    (id, code) => win.webContents.send(CH.ptyExit, id, code),
    engine, scriptDir
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

  ipcMain.on(CH.notify, (_e, a: NotifyArgs) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: a.title, body: a.body })
    n.on('click', () => { win.show(); win.focus() })
    n.show()
  })

  const watcher = new WatchManager((id, change) => win.webContents.send(CH.fsChange, id, change))
  win.on('closed', () => watcher.closeAll())

  ipcMain.handle(CH.fsRead, (_e, path: string) => readTextFile(path))
  ipcMain.handle(CH.fsWrite, (_e, path: string, content: string) => writeTextFile(path, content))
  ipcMain.handle(CH.fsReadDir, (_e, path: string) => readDirectory(path))
  ipcMain.handle(CH.fsStat, (_e, path: string) => statPath(path))
  ipcMain.on(CH.fsWatch, (_e, id: string, path: string) => watcher.watch(id, path))
  ipcMain.on(CH.fsUnwatch, (_e, id: string) => watcher.unwatch(id))

  ipcMain.handle(CH.dialogOpenFolder, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(CH.dialogOpenFile, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  return pty
}
