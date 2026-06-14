import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Workspace, ShellInfo, MosaicNode, MosaicDirection, TerminalConfig } from '@shared/types'
import {
  createWorkspace, addFirstPane, splitPane, removePane
} from '@shared/workspace-model'
import { api } from './api'

interface State {
  shells: ShellInfo[]
  workspaces: Record<string, Workspace>
  order: string[]
  activeId: string | null
  init: () => Promise<void>
  newWorkspace: (name: string) => string
  setActive: (id: string) => void
  setLayout: (wsId: string, layout: MosaicNode | null) => void
  addTerminal: (wsId: string, targetPaneId: string | null, dir: MosaicDirection) => string
  closePane: (wsId: string, paneId: string) => void
  save: (wsId: string) => Promise<void>
}

const defaultTerminal = (shellId: string): TerminalConfig =>
  ({ kind: 'terminal', shellId, cwd: '' })

export const useStore = create<State>((set, get) => ({
  shells: [],
  workspaces: {},
  order: [],
  activeId: null,

  init: async () => {
    const shells = await api.listShells()
    set({ shells })
    const state = await api.loadAppState()
    if (state && state.openWorkspaceIds.length > 0) {
      const loaded = await Promise.all(state.openWorkspaceIds.map(id => api.loadWorkspace(id)))
      const workspaces: Record<string, Workspace> = {}
      for (const ws of loaded) if (ws) workspaces[ws.id] = ws
      const order = state.openWorkspaceIds.filter(id => workspaces[id])
      set({ workspaces, order, activeId: state.activeWorkspaceId ?? order[0] ?? null })
    } else {
      get().newWorkspace('Workspace 1')
    }
  },

  newWorkspace: (name) => {
    const ws = createWorkspace(name, uuid)
    set(s => ({
      workspaces: { ...s.workspaces, [ws.id]: ws },
      order: [...s.order, ws.id],
      activeId: ws.id
    }))
    return ws.id
  },

  setActive: (id) => set({ activeId: id }),

  setLayout: (wsId, layout) => set(s => ({
    workspaces: { ...s.workspaces, [wsId]: { ...s.workspaces[wsId], layout } }
  })),

  addTerminal: (wsId, targetPaneId, dir) => {
    const ws = get().workspaces[wsId]
    const shellId = get().shells[0]?.id ?? 'cmd'
    const cfg = defaultTerminal(shellId)
    const r = ws.layout === null || targetPaneId === null
      ? addFirstPane(ws, cfg, uuid)
      : splitPane(ws, targetPaneId, dir, cfg, uuid)
    set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
    return r.paneId
  },

  closePane: (wsId, paneId) => {
    const ws = removePane(get().workspaces[wsId], paneId)
    set(s => ({ workspaces: { ...s.workspaces, [wsId]: ws } }))
    api.ptyKill(paneId)
  },

  save: async (wsId) => {
    await api.saveWorkspace(get().workspaces[wsId])
    await api.saveAppState({
      schemaVersion: 1, openWorkspaceIds: get().order, activeWorkspaceId: get().activeId
    })
  }
}))
