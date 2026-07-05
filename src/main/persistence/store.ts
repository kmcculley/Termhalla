import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workspace, AppState } from '@shared/types'
import { serializeWorkspace, deserializeWorkspace } from '@shared/workspace-model'
import { migrateAppState } from '@shared/app-state-model'
import { DEFAULT_WINDOW_STATE } from '../window-state'
import { atomicWrite } from './atomic-write'

export class WorkspaceStore {
  constructor(private readonly baseDir: string) {}

  private wsDir() { return join(this.baseDir, 'workspaces') }
  private wsFile(id: string) { return join(this.wsDir(), `${id}.json`) }
  private appStateFile() { return join(this.baseDir, 'app-state.json') }

  async saveWorkspace(ws: Workspace): Promise<void> {
    // Atomic write: an interrupted save (e.g. an auto-update installer killing the app mid-write)
    // must never truncate a previously-good workspace file into one that loads as null.
    await atomicWrite(this.wsFile(ws.id), serializeWorkspace(ws))
  }

  async loadWorkspace(id: string): Promise<Workspace | null> {
    let raw: string
    try { raw = await readFile(this.wsFile(id), 'utf8') }
    catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      console.warn(`[workspace] failed to read ${id}:`, e)
      return null
    }
    // A corrupt/invalid file degrades to null (like quick/draft/app-state) instead of
    // rejecting the ws:load IPC call — one bad workspace must not wedge the renderer.
    try { return deserializeWorkspace(raw) }
    catch (e: unknown) {
      console.warn(`[workspace] ignoring corrupt workspace ${id}:`, e)
      return null
    }
  }

  /** Delete a workspace's on-disk record. Best-effort: a missing file (already gone) is not an
   *  error, so pruning a closed workspace from the reopen list never rejects the IPC call. */
  async deleteWorkspace(id: string): Promise<void> {
    try { await rm(this.wsFile(id), { force: true }) }
    catch (e: unknown) { console.warn(`[workspace] failed to delete ${id}:`, e) }
  }

  async listWorkspaceIds(): Promise<string[]> {
    try {
      const files = await readdir(this.wsDir())
      return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    } catch { return [] }
  }

  async saveAppState(state: AppState): Promise<void> {
    await atomicWrite(this.appStateFile(), JSON.stringify(state, null, 2))
  }

  async loadAppState(): Promise<AppState | null> {
    try {
      const data: unknown = JSON.parse(await readFile(this.appStateFile(), 'utf8'))
      // Normalizes both the current windows[] shape and the legacy single-window shape
      // (openWorkspaceIds/activeWorkspaceId) and rejects junk / future versions.
      return migrateAppState(data, DEFAULT_WINDOW_STATE)
    } catch { return null }
  }
}
