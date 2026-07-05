import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron'
import { CH } from '@shared/ipc-contract'
import { checkForUpdatesInteractive } from './updater'

/**
 * Install the application menu. Replaces Electron's default menu bar with a minimal
 * template: Edit (Settings…), View (reload / devtools / zoom / fullscreen) and Help
 * (Check for Updates, About). Call once after the windows start.
 */
export function installAppMenu(): void {
  // Fire a File-menu intent at the focused window (falling back to the first window when none is
  // focused — e.g. a headless e2e clicking a menu item programmatically). The renderer owns live
  // workspace state, so the menu only signals; the renderer performs the New/Open/Save action.
  const fileSend = (channel: string): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(channel)
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { id: 'file-new', label: 'New Workspace', click: () => fileSend(CH.fileNew) },
        { type: 'separator' },
        { id: 'file-open', label: 'Open Workspace…', click: () => fileSend(CH.fileOpen) },
        { id: 'file-reopen', label: 'Reopen Closed Workspace…', click: () => fileSend(CH.fileReopen) },
        { type: 'separator' },
        { id: 'file-save', label: 'Save Workspace', click: () => fileSend(CH.fileSave) },
        { id: 'file-save-as', label: 'Save Workspace As…', click: () => fileSend(CH.fileSaveAs) },
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
          // Open the renderer Settings modal; the focused window's renderer subscribes via
          // onOpenSettings and opens at the General section. Sends on no other channel.
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send(CH.openSettings),
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
