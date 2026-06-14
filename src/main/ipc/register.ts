import { ipcMain, Notification, dialog, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { CH, type PtySpawnArgs, type PtyWriteArgs, type PtyResizeArgs, type NotifyArgs } from '@shared/ipc-contract'
import type { Workspace, AppState } from '@shared/types'
import { detectShells } from '../pty/shells'
import { PtyManager } from '../pty/pty-manager'
import { StatusEngine } from '../status/status-engine'
import { writeIntegrationScripts } from '../status/integration-scripts'
import { WorkspaceStore } from '../persistence/store'
import { QuickStore } from '../persistence/quick-store'
import { userDataDir } from '../persistence/paths'
import { readTextFile, writeTextFile, readDirectory, statPath } from '../fs/files'
import { WatchManager } from '../fs/watch-manager'

export function registerHandlers(win: BrowserWindow): PtyManager {
  const store = new WorkspaceStore(userDataDir())
  const quick = new QuickStore(userDataDir())
  const shells = detectShells()

  const scriptDir = join(userDataDir(), 'shell-integration')
  writeIntegrationScripts(scriptDir)

  // Main->renderer events can still fire during teardown (e.g. pty exit events
  // after the window/webContents is destroyed on app close). Guard every send so
  // it never throws "Object has been destroyed".
  const safeSend = (channel: string, ...args: unknown[]): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    try { win.webContents.send(channel, ...args) } catch { /* torn down mid-send */ }
  }

  const engine = new StatusEngine(
    (id, status) => safeSend(CH.ptyStatus, id, status),
    (id, cwd) => safeSend(CH.ptyCwd, id, cwd)
  )
  const pty = new PtyManager(
    (id, data) => safeSend(CH.ptyData, id, data),
    (id, code) => safeSend(CH.ptyExit, id, code),
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
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows, a.launch)
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

  const watcher = new WatchManager((id, change) => safeSend(CH.fsChange, id, change))
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
  ipcMain.handle(CH.revealPath, async (_e, path: string) => { await shell.openPath(path) })

  ipcMain.handle(CH.quickLoad, () => quick.load())
  ipcMain.handle(CH.quickSave, (_e, data: import('@shared/types').QuickStore) => quick.save(data))
  ipcMain.handle(CH.homeDir, () => process.env.USERPROFILE ?? process.env.HOME ?? '')

  return pty
}
