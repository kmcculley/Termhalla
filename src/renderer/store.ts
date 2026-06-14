import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Workspace, ShellInfo, MosaicNode, MosaicDirection, TerminalConfig, TerminalStatus } from '@shared/types'
import {
  createWorkspace, addFirstPane, splitPane, removePane
} from '@shared/workspace-model'
import { resolveAlerts, effectiveStatus } from '@shared/alerts'
import { api } from './api'

interface State {
  shells: ShellInfo[]
  workspaces: Record<string, Workspace>
  order: string[]
  activeId: string | null
  newTerminalShellId: string | null
  init: () => Promise<void>
  newWorkspace: (name: string) => string
  setActive: (id: string) => void
  setLayout: (wsId: string, layout: MosaicNode | null) => void
  addTerminal: (wsId: string, targetPaneId: string | null, dir: MosaicDirection) => string
  closePane: (wsId: string, paneId: string) => void
  setNewTerminalShell: (id: string) => void
  saveAll: () => Promise<void>
  statuses: Record<string, TerminalStatus>
  setStatus: (id: string, status: TerminalStatus) => void
  updatePaneConfig: (wsId: string, paneId: string, patch: Partial<TerminalConfig>) => void
}

const defaultTerminal = (shellId: string): TerminalConfig =>
  ({ kind: 'terminal', shellId, cwd: '' })

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function findPaneConfig(s: { workspaces: Record<string, import('@shared/types').Workspace> }, paneId: string): TerminalConfig | undefined {
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane) return pane.config
  }
  return undefined
}

export const useStore = create<State>((set, get) => {
  const scheduleAutosave = () => {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => { void get().saveAll() }, 500)
  }

  return {
    shells: [],
    workspaces: {},
    order: [],
    activeId: null,
    newTerminalShellId: null,
    statuses: {},

    init: async () => {
      const shells = await api.listShells()
      set({ shells, newTerminalShellId: shells[0]?.id ?? null })
      const state = await api.loadAppState()
      if (state && Array.isArray(state.openWorkspaceIds) && state.openWorkspaceIds.length > 0) {
        const loaded = await Promise.all(state.openWorkspaceIds.map(id => api.loadWorkspace(id)))
        const workspaces: Record<string, Workspace> = {}
        for (const ws of loaded) if (ws) workspaces[ws.id] = ws
        const order = state.openWorkspaceIds.filter(id => workspaces[id])
        if (order.length > 0) {
          set({ workspaces, order, activeId: state.activeWorkspaceId ?? order[0] })
          return
        }
      }
      get().newWorkspace('Workspace 1')
    },

    newWorkspace: (name) => {
      const ws = createWorkspace(name, uuid)
      set(s => ({
        workspaces: { ...s.workspaces, [ws.id]: ws },
        order: [...s.order, ws.id],
        activeId: ws.id
      }))
      scheduleAutosave()
      return ws.id
    },

    setActive: (id) => { set({ activeId: id }); scheduleAutosave() },

    setLayout: (wsId, layout) => {
      set(s => ({
        workspaces: { ...s.workspaces, [wsId]: { ...s.workspaces[wsId], layout } }
      }))
      scheduleAutosave()
    },

    addTerminal: (wsId, targetPaneId, dir) => {
      const ws = get().workspaces[wsId]
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cfg = defaultTerminal(shellId)
      const r = ws.layout === null || targetPaneId === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, targetPaneId, dir, cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
      scheduleAutosave()
      return r.paneId
    },

    closePane: (wsId, paneId) => {
      const ws = removePane(get().workspaces[wsId], paneId)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: ws } }))
      api.ptyKill(paneId)
      scheduleAutosave()
    },

    setNewTerminalShell: (id) => set({ newTerminalShellId: id }),

    setStatus: (id, status) => {
      const prev = get().statuses[id]
      const cfg = findPaneConfig(get(), id)
      const alerts = resolveAlerts(cfg?.alerts)
      const eff = effectiveStatus(status, cfg?.alerts)
      set(s => ({ statuses: { ...s.statuses, [id]: eff } }))
      if (status.state === 'needs-input' && prev?.state !== 'needs-input'
          && alerts.needsInput && alerts.osNotification
          && typeof document !== 'undefined' && !document.hasFocus()) {
        api.notify({ title: 'Terminal needs input', body: cfg?.name ?? 'A terminal is waiting for input' })
      }
    },

    updatePaneConfig: (wsId, paneId, patch) => {
      const ws = get().workspaces[wsId]
      const pane = ws?.panes[paneId]
      if (!pane) return
      const updated = { ...ws, panes: { ...ws.panes, [paneId]: { ...pane, config: { ...pane.config, ...patch } } } }
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: updated } }))
      void get().saveAll()
    },

    saveAll: async () => {
      const { order, workspaces, activeId } = get()
      await Promise.all(order.map(id => api.saveWorkspace(workspaces[id])))
      await api.saveAppState({
        schemaVersion: 1, openWorkspaceIds: order, activeWorkspaceId: activeId
      })
    }
  }
})
