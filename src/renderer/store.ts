import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Workspace, ShellInfo, MosaicNode, MosaicDirection, TerminalConfig, TerminalStatus, PaneConfig, EditorConfig, ExplorerConfig, QuickStore, SshConnection } from '@shared/types'
import { EMPTY_QUICK } from '@shared/types'
import { buildSshArgs, nextRecentDirs, pushRecent } from '@shared/quick'
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
  lastEditorPaneId: string | null
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
  cwds: Record<string, string>
  setCwd: (id: string, cwd: string) => void
  updatePaneConfig: (wsId: string, paneId: string, patch: Partial<Omit<EditorConfig, 'kind'> & Omit<ExplorerConfig, 'kind'> & Omit<TerminalConfig, 'kind'>>) => void
  registerEditorPane: (paneId: string) => void
  addEditor: (wsId: string, targetPaneId: string | null, dir: MosaicDirection) => string
  addExplorer: (wsId: string, targetPaneId: string | null, dir: MosaicDirection, root: string) => string
  openFileInEditor: (wsId: string, path: string) => void
  openExplorerHere: (wsId: string, paneId: string) => void
  quick: QuickStore
  home: string
  paletteOpen: boolean
  connectionFormFor: SshConnection | 'new' | null
  loadQuick: () => Promise<void>
  setPaletteOpen: (open: boolean) => void
  setConnectionForm: (target: SshConnection | 'new' | null) => void
  saveConnection: (conn: SshConnection) => void
  deleteConnection: (id: string) => void
  pinDir: (dir: string) => void
  unpinDir: (dir: string) => void
  launchConnection: (connId: string) => void
  launchDir: (dir: string) => void
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function findPaneConfig(s: { workspaces: Record<string, Workspace> }, paneId: string): PaneConfig | undefined {
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane) return pane.config
  }
  return undefined
}

function applyCwds(ws: import('@shared/types').Workspace, cwds: Record<string, string>): import('@shared/types').Workspace {
  let changed = false
  const panes = { ...ws.panes }
  for (const id of Object.keys(panes)) {
    const pane = panes[id]
    if (pane.config.kind === 'terminal' && cwds[id] && cwds[id] !== pane.config.cwd) {
      panes[id] = { ...pane, config: { ...pane.config, cwd: cwds[id] } }
      changed = true
    }
  }
  return changed ? { ...ws, panes } : ws
}

export function paneCwd(
  s: { cwds: Record<string, string>; workspaces: Record<string, import('@shared/types').Workspace> },
  paneId: string
): string {
  if (s.cwds[paneId]) return s.cwds[paneId]
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane?.config.kind === 'terminal') return pane.config.cwd
  }
  return ''
}

export const useStore = create<State>((set, get) => {
  const scheduleAutosave = () => {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => { void get().saveAll() }, 500)
  }

  let quickTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleQuickSave = () => {
    if (quickTimer) clearTimeout(quickTimer)
    quickTimer = setTimeout(() => { void api.saveQuick(get().quick) }, 500)
  }

  return {
    shells: [],
    workspaces: {},
    order: [],
    activeId: null,
    newTerminalShellId: null,
    lastEditorPaneId: null,
    statuses: {},
    cwds: {},
    quick: EMPTY_QUICK,
    home: '',
    paletteOpen: false,
    connectionFormFor: null,

    init: async () => {
      const shells = await api.listShells()
      set({ shells, newTerminalShellId: shells[0]?.id ?? null })
      const [quick, home] = await Promise.all([api.loadQuick(), api.homeDir()])
      set({ quick, home })
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
      const cwd = targetPaneId ? paneCwd(get(), targetPaneId) : ''
      const cfg: TerminalConfig = { kind: 'terminal', shellId, cwd }
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
      const termCfg = cfg?.kind === 'terminal' ? cfg : undefined
      const alerts = resolveAlerts(termCfg?.alerts)
      const eff = effectiveStatus(status, termCfg?.alerts)
      set(s => ({ statuses: { ...s.statuses, [id]: eff } }))
      if (status.state === 'needs-input' && prev?.state !== 'needs-input'
          && alerts.needsInput && alerts.osNotification
          && typeof document !== 'undefined' && !document.hasFocus()) {
        api.notify({ title: 'Terminal needs input', body: termCfg?.name ?? 'A terminal is waiting for input' })
      }
    },

    setCwd: (id, cwd) => {
      if (get().cwds[id] === cwd) return
      set(s => ({ cwds: { ...s.cwds, [id]: cwd } }))
      const q = get().quick
      const recentDirs = nextRecentDirs(q.recentDirs, cwd, get().home)
      if (recentDirs !== q.recentDirs) {
        set({ quick: { ...q, recentDirs } })
        scheduleQuickSave()
      }
      scheduleAutosave()   // persist into config.cwd (debounced) so restore uses it
    },

    updatePaneConfig: (wsId, paneId, patch) => {
      const ws = get().workspaces[wsId]
      const pane = ws?.panes[paneId]
      if (!pane) return
      const config = { ...(pane.config as object), ...patch } as PaneConfig
      const updated: Workspace = { ...ws, panes: { ...ws.panes, [paneId]: { ...pane, config } } }
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: updated } }))
      void get().saveAll()
    },

    registerEditorPane: (paneId) => set({ lastEditorPaneId: paneId }),

    addEditor: (wsId, targetPaneId, dir) => {
      const ws = get().workspaces[wsId]
      const cfg: EditorConfig = { kind: 'editor', files: [] }
      const r = ws.layout === null || targetPaneId === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, targetPaneId, dir, cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace }, lastEditorPaneId: r.paneId }))
      void get().saveAll()
      return r.paneId
    },

    addExplorer: (wsId, targetPaneId, dir, root) => {
      const ws = get().workspaces[wsId]
      const cfg: ExplorerConfig = { kind: 'explorer', root }
      const r = ws.layout === null || targetPaneId === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, targetPaneId, dir, cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
      void get().saveAll()
      return r.paneId
    },

    openExplorerHere: (wsId, paneId) => {
      const root = paneCwd(get(), paneId)
      if (!root) return
      get().addExplorer(wsId, paneId, 'row', root)
    },

    loadQuick: async () => {
      const [quick, home] = await Promise.all([api.loadQuick(), api.homeDir()])
      set({ quick, home })
    },

    setPaletteOpen: (open) => set({ paletteOpen: open }),
    setConnectionForm: (target) => set({ connectionFormFor: target }),

    saveConnection: (conn) => {
      const q = get().quick
      const exists = q.connections.some(c => c.id === conn.id)
      const connections = exists
        ? q.connections.map(c => (c.id === conn.id ? conn : c))
        : [...q.connections, conn]
      set({ quick: { ...q, connections } })
      scheduleQuickSave()
    },

    deleteConnection: (id) => {
      const q = get().quick
      set({ quick: { ...q,
        connections: q.connections.filter(c => c.id !== id),
        recentConnections: q.recentConnections.filter(rid => rid !== id) } })
      scheduleQuickSave()
    },

    pinDir: (dir) => {
      const q = get().quick
      if (!dir || q.favoriteDirs.includes(dir)) return
      set({ quick: { ...q, favoriteDirs: [...q.favoriteDirs, dir] } })
      scheduleQuickSave()
    },

    unpinDir: (dir) => {
      const q = get().quick
      set({ quick: { ...q, favoriteDirs: q.favoriteDirs.filter(d => d !== dir) } })
      scheduleQuickSave()
    },

    launchConnection: (connId) => {
      const wsId = get().activeId
      if (!wsId) return
      const conn = get().quick.connections.find(c => c.id === connId)
      if (!conn) return
      const ws = get().workspaces[wsId]
      const target = ws.layout ? Object.keys(ws.panes)[0] : null
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cfg: TerminalConfig = {
        kind: 'terminal', shellId, cwd: '', name: conn.name, connectionId: conn.id,
        launch: { command: 'ssh', args: buildSshArgs(conn), title: conn.name }
      }
      const r = ws.layout === null || target === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, target, 'row', cfg, uuid)
      const q = get().quick
      set(s => ({
        workspaces: { ...s.workspaces, [wsId]: r.workspace },
        quick: { ...q, recentConnections: pushRecent(q.recentConnections, conn.id, 20) }
      }))
      scheduleAutosave()
      scheduleQuickSave()
    },

    launchDir: (dir) => {
      const wsId = get().activeId
      if (!wsId || !dir) return
      const ws = get().workspaces[wsId]
      const target = ws.layout ? Object.keys(ws.panes)[0] : null
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cfg: TerminalConfig = { kind: 'terminal', shellId, cwd: dir }
      const r = ws.layout === null || target === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, target, 'row', cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
      scheduleAutosave()
    },

    openFileInEditor: (wsId, path) => {
      const ws = get().workspaces[wsId]
      const last = get().lastEditorPaneId
      const editorId = (last && ws.panes[last]?.config.kind === 'editor')
        ? last
        : Object.keys(ws.panes).find(id => ws.panes[id].config.kind === 'editor') ?? null
      if (editorId) {
        const cfg = ws.panes[editorId].config as EditorConfig
        const files = cfg.files.includes(path) ? cfg.files : [...cfg.files, path]
        get().updatePaneConfig(wsId, editorId, { files, activePath: path })
        set({ lastEditorPaneId: editorId })
      } else {
        const target = Object.keys(ws.panes)[0] ?? null
        const cfg: EditorConfig = { kind: 'editor', files: [path], activePath: path }
        const r = target === null
          ? addFirstPane(ws, cfg, uuid)
          : splitPane(ws, target, 'row', cfg, uuid)
        set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace }, lastEditorPaneId: r.paneId }))
        void get().saveAll()
      }
    },

    saveAll: async () => {
      const { order, workspaces, activeId, cwds } = get()
      await Promise.all(order.map(id => api.saveWorkspace(applyCwds(workspaces[id], cwds))))
      await api.saveAppState({
        schemaVersion: 1, openWorkspaceIds: order, activeWorkspaceId: activeId
      })
    }
  }
})
