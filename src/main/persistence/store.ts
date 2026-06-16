import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workspace, AppState } from '@shared/types'
import { serializeWorkspace, deserializeWorkspace } from '@shared/workspace-model'
import { migrateAppState } from '@shared/app-state-model'
import { DEFAULT_WINDOW_STATE } from '../window-state'

export class WorkspaceStore {
  constructor(private readonly baseDir: string) {}

  private wsDir() { return join(this.baseDir, 'workspaces') }
  private wsFile(id: string) { return join(this.wsDir(), `${id}.json`) }
  private appStateFile() { return join(this.baseDir, 'app-state.json') }

  async saveWorkspace(ws: Workspace): Promise<void> {
    await mkdir(this.wsDir(), { recursive: true })
    await writeFile(this.wsFile(ws.id), serializeWorkspace(ws), 'utf8')
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

  async listWorkspaceIds(): Promise<string[]> {
    try {
      const files = await readdir(this.wsDir())
      return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    } catch { return [] }
  }

  async saveAppState(state: AppState): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(this.appStateFile(), JSON.stringify(state, null, 2), 'utf8')
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
