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
import { ProcessTracker } from '../proc/process-tracker'
import { CloudStatusService } from '../cloud/cloud-status-service'
import { AiSessionTracker } from '../ai/ai-session-tracker'
import { UsageTracker } from '../usage/usage-tracker'
import { DraftStore } from '../persistence/draft-store'
import { Recorder } from '../recording/recorder'
import { EnvVault } from '../env-vault/env-vault'

export function registerHandlers(win: BrowserWindow): PtyManager {
  const store = new WorkspaceStore(userDataDir())
  const quick = new QuickStore(userDataDir())
  const shells = detectShells()
  const recorder = new Recorder()
  const envVault = new EnvVault(userDataDir())

  const scriptDir = join(userDataDir(), 'shell-integration')
  writeIntegrationScripts(scriptDir)

  // Main->renderer events can still fire during teardown (e.g. pty exit events
  // after the window/webContents is destroyed on app close). Guard every send so
  // it never throws "Object has been destroyed".
  const safeSend = (channel: string, ...args: unknown[]): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    try { win.webContents.send(channel, ...args) } catch { /* torn down mid-send */ }
  }

  let tracker: ProcessTracker | undefined
  let ai: AiSessionTracker | undefined
  const engine = new StatusEngine(
    (id, status) => { safeSend(CH.ptyStatus, id, status); tracker?.setBusy(id, status.state === 'busy') },
    (id, cwd) => safeSend(CH.ptyCwd, id, cwd),
    undefined,
    (id) => ai?.commandDone(id)
  )
  const pty = new PtyManager(
    (id, data) => { safeSend(CH.ptyData, id, data); recorder.data(id, data) },
    (id, code) => { safeSend(CH.ptyExit, id, code); tracker?.unregister(id); ai?.unregister(id); recorder.stop(id); safeSend(CH.recState, id, false, null) },
    engine, scriptDir
  )
  tracker = new ProcessTracker(
    (id) => pty.pidOf(id),
    (id, info) => { safeSend(CH.ptyProcs, id, info); ai?.onProcs(id, info) }
  )
  ai = new AiSessionTracker((id, session) => safeSend(CH.aiSession, id, session))

  const usage = new UsageTracker((id, metrics) => safeSend(CH.usageMetrics, id, metrics))
  ipcMain.on(CH.usageWatch, (_e, id: string, cwd: string) => { void usage.watch(id, cwd) })
  ipcMain.on(CH.usageUnwatch, (_e, id: string) => usage.unwatch(id))
  win.on('closed', () => usage.dispose())

  const drafts = new DraftStore(userDataDir())
  void drafts.load()
  ipcMain.handle(CH.draftsLoad, () => drafts.load())
  ipcMain.on(CH.draftsSet, (_e, key: string, draft: import('@shared/types').EditorDraft) => drafts.set(key, draft))
  ipcMain.on(CH.draftsDelete, (_e, key: string) => drafts.delete(key))
  win.on('close', () => drafts.flush())

  const cloud = new CloudStatusService((statuses) => safeSend(CH.cloudStatus, statuses))
  cloud.start()
  ipcMain.handle(CH.cloudRefresh, () => cloud.refresh())

  let lastFocusRefresh = 0
  win.on('focus', () => {
    const t = Date.now()
    if (t - lastFocusRefresh > 5000) { lastFocusRefresh = t; void cloud.refresh() }
  })
  win.on('closed', () => cloud.stop())

  ipcMain.handle(CH.listShells, () => shells)
  ipcMain.handle(CH.listWorkspaceIds, () => store.listWorkspaceIds())
  ipcMain.handle(CH.loadWorkspace, (_e, id: string) => store.loadWorkspace(id))
  ipcMain.handle(CH.saveWorkspace, (_e, ws: Workspace) => store.saveWorkspace(ws))
  ipcMain.handle(CH.loadAppState, () => store.loadAppState())
  ipcMain.handle(CH.saveAppState, (_e, s: AppState) => store.saveAppState(s))

  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    tracker!.register(a.id)   // register BEFORE spawn: a failed spawn calls onExit->unregister synchronously, keeping the registry clean
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows, a.launch, envVault.envFor(a.envId))
  })
  ipcMain.on(CH.ptyWrite, (_e, a: PtyWriteArgs) => pty.write(a.id, a.data))
  ipcMain.on(CH.ptyResize, (_e, a: PtyResizeArgs) => { pty.resize(a.id, a.cols, a.rows); recorder.resize(a.id, a.cols, a.rows) })
  // ai/tracker unregister here is synchronous; the async pty onExit fires them again but
  // both are idempotent (Map.delete returns false), so the renderer sees a single clear.
  ipcMain.on(CH.ptyKill, (_e, id: string) => { pty.kill(id); tracker!.unregister(id); ai!.unregister(id) })

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
  ipcMain.handle(CH.dialogSaveFile, async () => {
    // Test hook: hermetic e2e can't drive a native dialog (mirrors TERMHALLA_CLAUDE_HOME).
    if (process.env.TERMHALLA_SAVE_PATH) return process.env.TERMHALLA_SAVE_PATH
    const r = await dialog.showSaveDialog(win, {})
    return r.canceled || !r.filePath ? null : r.filePath
  })
  ipcMain.handle(CH.revealPath, async (_e, path: string) => { await shell.openPath(path) })

  ipcMain.handle(CH.quickLoad, () => quick.load())
  ipcMain.handle(CH.quickSave, (_e, data: import('@shared/types').QuickStore) => quick.save(data))
  ipcMain.handle(CH.homeDir, () => process.env.USERPROFILE ?? process.env.HOME ?? '')

  ipcMain.on(CH.recStart, (_e, id: string) => {
    const sz = pty.sizeOf(id) ?? { cols: 80, rows: 24 }
    const file = recorder.start(id, sz.cols, sz.rows, userDataDir())
    safeSend(CH.recState, id, true, file)
  })
  ipcMain.on(CH.recStop, (_e, id: string) => { const f = recorder.stop(id); safeSend(CH.recState, id, false, f) })
  ipcMain.on(CH.recReveal, () => { void shell.openPath(join(userDataDir(), 'recordings')) })
  win.on('closed', () => recorder.dispose())

  const emitEnvState = (): void => safeSend(CH.envState, { exists: envVault.exists(), unlocked: envVault.isUnlocked() })
  ipcMain.handle(CH.envUnlock, (_e, p: string) => { const ok = envVault.unlock(p); emitEnvState(); return ok })
  ipcMain.handle(CH.envCreate, (_e, p: string) => { envVault.create(p); emitEnvState() })
  ipcMain.on(CH.envLock, () => { envVault.lock(); emitEnvState() })
  ipcMain.handle(CH.envGet, () => envVault.current())
  ipcMain.on(CH.envSetGlobal, (_e, n: string, v: string) => { envVault.setGlobal(n, v); emitEnvState() })
  ipcMain.on(CH.envRemoveGlobal, (_e, n: string) => { envVault.removeGlobal(n); emitEnvState() })
  ipcMain.on(CH.envSetTerminal, (_e, id: string, n: string, v: string) => { envVault.setTerminal(id, n, v); emitEnvState() })
  ipcMain.on(CH.envRemoveTerminal, (_e, id: string, n: string) => { envVault.removeTerminal(id, n); emitEnvState() })
  // No existing initial-state push hook in this file; emit once the renderer is ready to receive it.
  win.webContents.on('did-finish-load', emitEnvState)

  return pty
}
