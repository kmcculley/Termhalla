import { app, BrowserWindow } from 'electron'
import { buildServices } from './services'
import { WindowManager } from './window-manager'
import { registerHandlers } from './ipc/register'

async function start(): Promise<void> {
  const services = buildServices()
  const wm = new WindowManager(state => { void services.store.saveAppState(state) })

  // Order matters: prepare() creates the windows (no content loaded yet) so registerHandlers can
  // register the global ipcMain handlers BEFORE start() loads any renderer that would invoke them.
  const state = await services.store.loadAppState()
  wm.prepare(state)
  const pty = registerHandlers(services, wm)
  wm.start()

  // Snapshot the full multi-window arrangement before windows start closing, so a quit doesn't
  // shrink the saved state window-by-window.
  app.on('before-quit', () => wm.beginQuit())
  app.on('window-all-closed', () => { pty.killAll(); if (process.platform !== 'darwin') app.quit() })
}

app.whenReady().then(start)
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void start() })
