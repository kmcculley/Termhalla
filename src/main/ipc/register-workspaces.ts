import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { Workspace, AppState, QuickStore } from '@shared/types'
import type { ShellInfo } from '@shared/types'
import type { WorkspaceStore } from '../persistence/store'
import type { QuickStore as QuickStoreService } from '../persistence/quick-store'

/** Workspace + app-state + quick-store persistence handlers, the shell list, and homeDir. */
export function registerWorkspaces(
  deps: { store: WorkspaceStore; quick: QuickStoreService; shells: ShellInfo[] }
): void {
  const { store, quick, shells } = deps

  ipcMain.handle(CH.listShells, () => shells)
  ipcMain.handle(CH.listWorkspaceIds, () => store.listWorkspaceIds())
  ipcMain.handle(CH.loadWorkspace, (_e, id: string) => store.loadWorkspace(id))
  ipcMain.handle(CH.saveWorkspace, (_e, ws: Workspace) => store.saveWorkspace(ws))
  ipcMain.handle(CH.loadAppState, () => store.loadAppState())
  ipcMain.handle(CH.saveAppState, (_e, s: AppState) => store.saveAppState(s))

  ipcMain.handle(CH.quickLoad, () => quick.load())
  ipcMain.handle(CH.quickSave, (_e, data: QuickStore) => quick.save(data))
  ipcMain.handle(CH.homeDir, () => process.env.USERPROFILE ?? process.env.HOME ?? '')
}
