import { app } from 'electron'
import electronUpdater from 'electron-updater'

// electron-updater is CommonJS; under "type": "module" the named export isn't reachable
// directly, so reach autoUpdater off the default import.
const { autoUpdater } = electronUpdater

/**
 * Wire background auto-updates against the generic HTTP feed configured in
 * electron-builder.yml. No-op in dev: the bundled app-update.yml only exists in a
 * packaged build, and checking without it throws.
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error('[updater] update check failed', err)
  })
}
