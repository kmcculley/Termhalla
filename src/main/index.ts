import { app, BrowserWindow } from 'electron'
import { buildServices } from './services'
import { WindowManager } from './window-manager'
import { registerHandlers } from './ipc/register'
import { initAutoUpdate } from './updater'
import { installAppMenu } from './menu'

/** Upper bound on how long a quit waits for renderers to flush their state. A flush normally takes a
 *  few ms; this only caps the wait if a renderer hangs or crashed, so the quit can never wedge. */
const QUIT_FLUSH_TIMEOUT_MS = 2000

async function start(): Promise<void> {
  const services = buildServices()
  const wm = new WindowManager(state => { void services.store.saveAppState(state) })

  // Order matters: prepare() creates the windows (no content loaded yet) so registerHandlers can
  // register the global ipcMain handlers BEFORE start() loads any renderer that would invoke them.
  const state = await services.store.loadAppState()
  wm.prepare(state)
  const pty = await registerHandlers(services, wm)
  wm.start()

  // Replace Electron's default menu with our Help (Check for Updates) + View menu.
  installAppMenu()

  // Background check against the GitHub Releases feed (packaged builds only).
  initAutoUpdate()

  // Snapshot the full multi-window arrangement before windows start closing, so a quit doesn't
  // shrink the saved state window-by-window — then defer the actual quit until every renderer has
  // flushed its workspace/quick state to disk. Without this, those writes are fire-and-forget on
  // `beforeunload` and race the process exit during an auto-update install, losing cwd/SSH state.
  let quitFlushed = false
  app.on('before-quit', (e) => {
    wm.beginQuit()
    if (quitFlushed) return
    e.preventDefault()
    void wm.flushRenderers(QUIT_FLUSH_TIMEOUT_MS).finally(() => { quitFlushed = true; app.quit() })
  })
  app.on('window-all-closed', () => { pty.killAll(); if (process.platform !== 'darwin') app.quit() })
}

app.whenReady().then(start)
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void start() })
