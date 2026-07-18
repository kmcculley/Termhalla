/**
 * Workspace documents (File menu) — save/close/reopen a workspace as a portable `.thws` file.
 * Extracted from store.ts (2026-07-17 quality audit, Finding 10a) along the existing slice
 * architecture: same action names, same semantics, purely a code move. The two store-root
 * closure helpers it needs ride SliceDeps: `currentRecord` (the live-state-folded serialized
 * form saveAll writes internally) and `adoptWorkspace` (register + focus a fully-formed record).
 *
 * Imports `../api` directly (the runtime-slice precedent): these actions are IPC glue around
 * pickers and disk writes — the pure document format lives in @shared/workspace-doc.
 */
import { v4 as uuid } from 'uuid'
import type { Workspace } from '@shared/types'
import { serializeWorkspace } from '@shared/workspace-model'
import { importWorkspaceDoc, defaultDocName } from '@shared/workspace-doc'
import { api } from '../api'
import type { State, SliceDeps, ClosedWorkspaceInfo } from './types'

type WorkspaceDocsSlice = Pick<State,
  'docPaths' | 'reopenOpen' | 'setReopenOpen' |
  'saveActiveWorkspace' | 'saveActiveWorkspaceAs' | 'openWorkspaceFromFile' |
  'reopenClosedWorkspace' | 'listClosedWorkspaces' | 'deleteClosedWorkspace'>

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

export function createWorkspaceDocsSlice({ set, get, currentRecord, adoptWorkspace }: SliceDeps): WorkspaceDocsSlice {
  return {
    // wsId -> bound `.thws` path (seeded from disk on init), + the Reopen dialog flag.
    docPaths: {},
    reopenOpen: false,
    setReopenOpen: (open) => set({ reopenOpen: open }),

    saveActiveWorkspace: async () => {
      const activeId = get().activeId
      if (!activeId) return
      // Flush live state (cwd / AI-resume / view-state) into the internal record for every workspace.
      await get().saveAll()
      const path = get().docPaths[activeId]
      if (!path) { get().pushToast('Workspace saved'); return }
      const ok = await api.writeWorkspaceDoc(path, serializeWorkspace(currentRecord(activeId)))
      get().pushToast(ok ? `Saved ${baseName(path)}` : `Could not write ${baseName(path)}`, ok ? 'success' : 'error')
    },

    saveActiveWorkspaceAs: async () => {
      const activeId = get().activeId
      const ws = activeId ? get().workspaces[activeId] : undefined
      if (!activeId || !ws) return
      const path = await api.pickWorkspaceSavePath(defaultDocName(ws.name))
      if (!path) return
      await get().saveAll()
      const ok = await api.writeWorkspaceDoc(path, serializeWorkspace(currentRecord(activeId)))
      if (!ok) { get().pushToast(`Could not write ${baseName(path)}`, 'error'); return }
      set(s => ({ docPaths: { ...s.docPaths, [activeId]: path } }))
      api.setWorkspaceDocPath(activeId, path)
      get().pushToast(`Saved ${baseName(path)}`)
    },

    openWorkspaceFromFile: async () => {
      const path = await api.pickWorkspaceOpenPath()
      if (!path) return null
      const json = await api.readWorkspaceDoc(path)
      if (json == null) { get().pushToast('Could not read that workspace file.', 'error'); return null }
      let ws: Workspace
      try { ws = importWorkspaceDoc(json, uuid(), uuid) }
      catch (e) { get().pushToast(`Not a valid workspace file: ${(e as Error).message}`, 'error'); return null }
      adoptWorkspace(ws)
      set(s => ({ docPaths: { ...s.docPaths, [ws.id]: path } }))
      api.setWorkspaceDocPath(ws.id, path)
      get().pushToast(`Opened ${ws.name}`)
      return ws.id
    },

    reopenClosedWorkspace: async (id) => {
      // Already open in this window → just focus it.
      if (get().workspaces[id]) { get().setActive(id); return id }
      const ws = await api.loadWorkspace(id)
      if (!ws) { get().pushToast('That workspace could not be loaded.', 'error'); return null }
      adoptWorkspace(ws)
      get().pushToast(`Reopened ${ws.name}`)
      return ws.id
    },

    listClosedWorkspaces: async () => {
      const ids = await api.listWorkspaceIds()
      const openHere = new Set(Object.keys(get().workspaces))
      const closedIds = ids.filter(id => !openHere.has(id))
      const loaded = await Promise.all(closedIds.map(async (id): Promise<ClosedWorkspaceInfo | null> => {
        const ws = await api.loadWorkspace(id)
        if (!ws) return null
        const firstTerm = Object.values(ws.panes).find(p => p.config.kind === 'terminal')
        const firstCwd = firstTerm && firstTerm.config.kind === 'terminal' ? firstTerm.config.cwd : undefined
        return { id, name: ws.name, paneCount: Object.keys(ws.panes).length, firstCwd }
      }))
      return loaded.filter((x): x is ClosedWorkspaceInfo => x !== null)
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    deleteClosedWorkspace: async (id) => {
      await api.deleteWorkspace(id)
      api.clearWorkspaceDocPath(id)
      set(s => { const docPaths = { ...s.docPaths }; delete docPaths[id]; return { docPaths } })
    }
  }
}
