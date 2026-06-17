import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron'
import { checkForUpdatesInteractive } from './updater'

/**
 * Install the application menu. Replaces Electron's default menu bar with a minimal
 * template: View (reload / devtools / zoom / fullscreen) and Help (Check for Updates,
 * About). Call once after the windows start.
 */
export function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
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
