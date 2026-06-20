import { app, dialog, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { updateDialog, type UpdateEvent } from './update-ui'

// electron-updater is CommonJS; under "type": "module" the named export isn't reachable
// directly, so reach autoUpdater off the default import.
const { autoUpdater } = electronUpdater

// A user-initiated (menu) check pops dialogs; the launch-time check stays silent.
// The flag is shared across the global autoUpdater event emitter. Safe here because the
// only background check runs once at startup, before any interactive check can fire.
let interactive = false
let wired = false
let parentWin: BrowserWindow | null = null

function present(event: UpdateEvent, info?: { version?: string; error?: string }): void {
  const d = updateDialog(event, {
    isPackaged: app.isPackaged,
    interactive,
    version: info?.version,
    error: info?.error,
  })
  if (!d) return
  const opts: Electron.MessageBoxOptions = {
    type: d.kind === 'restart' ? 'info' : d.kind,
    title: d.title,
    message: d.message,
    ...(d.buttons ? { buttons: d.buttons, defaultId: 0, cancelId: 1 } : {}),
  }
  const p = parentWin ? dialog.showMessageBox(parentWin, opts) : dialog.showMessageBox(opts)
  if (d.kind === 'restart') {
    // isSilent=true runs the NSIS installer with /S so the update applies the same way it was
    // already installed (per-user, since perMachine:false) with no wizard — no install-scope or
    // "launch now?" prompts. isForceRunAfter=true relaunches Termhalla once the install completes.
    void p.then(r => { if (r.response === 0) autoUpdater.quitAndInstall(true, true) })
  } else {
    void p
  }
}

function wireOnce(): void {
  if (wired) return
  wired = true
  autoUpdater.on('checking-for-update', () => present('checking'))
  autoUpdater.on('update-available', info => present('available', { version: info.version }))
  autoUpdater.on('update-not-available', () => present('not-available', { version: app.getVersion() }))
  autoUpdater.on('update-downloaded', info => present('downloaded', { version: info.version }))
  autoUpdater.on('error', err => present('error', { error: err?.message }))
}

/**
 * Background auto-update against the GitHub Releases feed (packaged builds only).
 * Silent: dialogs are suppressed (interactive=false); checkForUpdatesAndNotify shows its
 * own native notification when an update is ready. No-op in dev (no app-update.yml).
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  wireOnce()
  interactive = false
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error('[updater] update check failed', err)
  })
}

/** Menu-driven check that reports results to the user (up-to-date / downloading / restart). */
export function checkForUpdatesInteractive(win: BrowserWindow | null): void {
  parentWin = win
  interactive = true
  if (!app.isPackaged) { present('checking'); return }
  wireOnce()
  autoUpdater.checkForUpdates().catch(err => {
    present('error', { error: err instanceof Error ? err.message : String(err) })
  })
}
