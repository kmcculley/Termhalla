// Pure decision core for update dialogs. No Electron imports → unit-testable.
// The impure shell (updater.ts) maps autoUpdater events + app state onto these
// descriptors and renders them with dialog.showMessageBox.

export type UpdateEvent = 'checking' | 'available' | 'not-available' | 'downloaded' | 'error'

export interface UpdateContext {
  isPackaged: boolean
  /** True only for a user-initiated (menu) check. Background checks are silent. */
  interactive: boolean
  /** Current app version (not-available) or the new version (available/downloaded). */
  version?: string
  error?: string
}

export interface UpdateDialog {
  kind: 'info' | 'error' | 'restart'
  title: string
  message: string
  /** Present only for kind === 'restart': ['Restart now', 'Later']. */
  buttons?: string[]
}

/** Map an updater event + context to the dialog to show, or null to stay silent. */
export function updateDialog(event: UpdateEvent, ctx: UpdateContext): UpdateDialog | null {
  // Background checks never pop a dialog (checkForUpdatesAndNotify handles its own
  // native "ready" notification).
  if (!ctx.interactive) return null

  // Dev / unpackaged: there is no app-update.yml, so a real check would throw.
  if (!ctx.isPackaged) {
    if (event === 'checking') {
      return { kind: 'info', title: 'Check for Updates', message: 'Updates are only available in installed builds.' }
    }
    return null
  }

  switch (event) {
    case 'checking':
      return null
    case 'not-available':
      return { kind: 'info', title: 'Check for Updates', message: `You're up to date (v${ctx.version}).` }
    case 'available':
      return {
        kind: 'info',
        title: 'Update Available',
        message: `An update (v${ctx.version}) is available and is downloading in the background. You'll be prompted to restart when it's ready.`,
      }
    case 'downloaded':
      return {
        kind: 'restart',
        title: 'Update Ready',
        message: `Version ${ctx.version} has been downloaded. Restart Termhalla to apply it.`,
        buttons: ['Restart now', 'Later'],
      }
    case 'error':
      return {
        kind: 'error',
        title: 'Update Error',
        message: `Could not check for updates.\n\n${ctx.error ?? 'Unknown error'}`,
      }
  }
}
