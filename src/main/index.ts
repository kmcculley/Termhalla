import { app, BrowserWindow, screen } from 'electron'
import { resolve } from 'node:path'
import { registerHandlers } from './ipc/register'
import {
  loadWindowState, saveWindowState, clampWindowState
} from './window-state'

async function createWindow(): Promise<void> {
  const saved = await loadWindowState()
  const displays = screen.getAllDisplays().map(d => d.workArea)
  const s = clampWindowState(saved, displays)

  const win = new BrowserWindow({
    width: s.width, height: s.height, x: s.x, y: s.y, show: false,
    webPreferences: {
      preload: resolve(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  if (s.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  const pty = registerHandlers(win)

  const persist = () => {
    const b = win.getBounds()
    saveWindowState({ ...b, maximized: win.isMaximized() }).catch(() => {})
  }
  win.on('resize', persist)
  win.on('move', persist)
  win.on('close', () => { persist(); pty.killAll() })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(resolve(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
