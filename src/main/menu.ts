import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron'
import { CH } from '@shared/ipc-contract'
import { checkForUpdatesInteractive } from './updater'

/**
 * Install the application menu. Replaces Electron's default menu bar with a minimal
 * template: Edit (Settings…), View (reload / devtools / zoom / fullscreen) and Help
 * (Check for Updates, About). Call once after the windows start.
 */
export function installAppMenu(): void {
  // Fire a menu intent at the focused window, falling back to the first window when none is focused.
  // The fallback is load-bearing for more than tidiness: an e2e clicking a menu item programmatically
  // has NO focused window (`TERMHALLA_E2E_WINDOW=hidden` never presents one, so
  // `BrowserWindow.getFocusedWindow()` is null), and in production a menu click always has a window
  // to land on anyway. The renderer owns live workspace state, so the menu only signals; the renderer
  // performs the New/Open/Save/Settings action.
  const menuSend = (channel: string): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(channel)
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { id: 'file-new', label: 'New Workspace', click: () => menuSend(CH.fileNew) },
        { type: 'separator' },
        { id: 'file-open', label: 'Open Workspace…', click: () => menuSend(CH.fileOpen) },
        { id: 'file-reopen', label: 'Reopen Closed Workspace…', click: () => menuSend(CH.fileReopen) },
        { type: 'separator' },
        { id: 'file-save', label: 'Save Workspace', click: () => menuSend(CH.fileSave) },
        { id: 'file-save-as', label: 'Save Workspace As…', click: () => menuSend(CH.fileSaveAs) },
        { type: 'separator' },
        { id: 'file-exit', role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          // Open the renderer Settings modal; the target window's renderer subscribes via
          // onOpenSettings and opens at the General section. Sends on no other channel.
          click: () => menuSend(CH.openSettings),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => checkForUpdatesInteractive(BrowserWindow.getFocusedWindow()),
        },
        { type: 'separator' },
        {
          label: 'About Termhalla',
          click: () => {
            const win = BrowserWindow.getFocusedWindow()
            const opts: Electron.MessageBoxOptions = {
              type: 'info',
              title: 'About Termhalla',
              message: 'Termhalla',
              detail: `Version ${app.getVersion()}`,
            }
            void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
