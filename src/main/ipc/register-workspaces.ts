import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { Workspace, AppState, QuickStore } from '@shared/types'
import type { ShellInfo } from '@shared/types'
import type { PhoneRemoteSettings } from '@shared/phone-remote/settings'
import type { WorkspaceStore } from '../persistence/store'
import type { QuickStore as QuickStoreService } from '../persistence/quick-store'

/** Workspace + app-state + quick-store persistence handlers, the shell list, and homeDir. */
export function registerWorkspaces(
  deps: {
    store: WorkspaceStore; quick: QuickStoreService; shells: ShellInfo[]
    /** Feature 0013 live-refresh hook: invoked with the full QuickStore payload at the END of the
     *  quickSave handler (an ADDITIONAL call — quick.save is still made). The composition root uses it
     *  to refresh the main-side needs-you opt-in mirror synchronously — no new IPC channel, no async
     *  re-read on the notify hot path (REQ-005 Wiring). */
    onQuickSave?: (data: QuickStore) => void
    /** Feature 0026 v2 (REQ-011): invoked with the FULL workspace record on every `ws:save` —
     *  main's only source of real workspace id/name + per-pane title/kind. Called BEFORE the
     *  (possibly async) disk write so the phone-remote metadata mirror stays current even if the
     *  write itself is slow; the write is not delayed or altered by this hook. */
    onWorkspaceSaved?: (ws: Workspace) => void
    /** Feature 0026 (FINDING-095): main is the ONE coherent owner of quick.json's `phoneRemote`
     *  field. The renderer holds a startup-time snapshot of the whole QuickStore and every
     *  `quick:save` (debounced settings save AND the mandatory quit flush) sends that FULL stale
     *  record, which `QuickStore.save` replaces wholesale — so a renderer save used to erase
     *  enable/bind/port/externalHost/tokenHash written by the phone-remote service. When this
     *  accessor is supplied, the handler overlays its result (the authoritative main-owned
     *  phoneRemote state, read AT save time) over the renderer payload before persisting; every
     *  renderer-owned field keeps its exact existing semantics. */
    phoneRemoteSettings?: () => Promise<PhoneRemoteSettings | undefined>
  }
): void {
  const { store, quick, shells, onQuickSave, onWorkspaceSaved, phoneRemoteSettings } = deps

  ipcMain.handle(CH.listShells, () => shells)
  ipcMain.handle(CH.listWorkspaceIds, () => store.listWorkspaceIds())
  ipcMain.handle(CH.loadWorkspace, (_e, id: string) => store.loadWorkspace(id))
  ipcMain.handle(CH.saveWorkspace, (_e, ws: Workspace) => {
    onWorkspaceSaved?.(ws)
    return store.saveWorkspace(ws)
  })
  ipcMain.handle(CH.deleteWorkspace, (_e, id: string) => store.deleteWorkspace(id))
  ipcMain.handle(CH.loadAppState, () => store.loadAppState())
  ipcMain.handle(CH.saveAppState, (_e, s: AppState) => store.saveAppState(s))

  ipcMain.handle(CH.quickLoad, () => quick.load())
  ipcMain.handle(CH.quickSave, (_e, data: QuickStore) => {
    // FINDING-095 overlay: the renderer's payload never decides `phoneRemote` — main's current
    // state does. Without the accessor (tests / compositions without the phone-remote service)
    // the payload is persisted verbatim, exactly as before.
    const saved = phoneRemoteSettings
      ? phoneRemoteSettings().then((phoneRemote) => quick.save({ ...data, phoneRemote }))
      : quick.save(data)                     // persistence is NEVER dropped (risk note #3)
    onQuickSave?.(data)                      // refresh the main-side opt-in mirror from the same payload
    return saved
  })
  ipcMain.handle(CH.homeDir, () => process.env.USERPROFILE ?? process.env.HOME ?? '')
}
