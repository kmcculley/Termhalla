import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Workspace, ShellInfo, MosaicNode, MosaicDirection, TerminalConfig, TerminalStatus, PaneConfig, EditorConfig, ExplorerConfig, QuickStore, SshConnection, ProcInfo, CloudStatus, TerminalLaunch, AiSession, UsageMetrics, EditorDraft, ScheduledTask, Theme } from '@shared/types'
import { EMPTY_QUICK } from '@shared/types'
import { DEFAULT_THEME, mergeTheme, resolveTheme } from '@shared/theme'
import { buildSshArgs, nextRecentDirs, pushRecent, RECENT_CONN_CAP } from '@shared/quick'
import {
  createWorkspace, addFirstPane, splitPane, removePane, reorderIds,
  templateFromWorkspace, workspaceFromTemplate
} from '@shared/workspace-model'
import { resolveAlerts, effectiveStatus } from '@shared/alerts'
import { encodeBroadcast, terminalPaneIds } from '@shared/broadcast'
import { schedulesWithout } from '@shared/schedule'
import { api } from './api'

export type ThemeScope = { kind: 'app' } | { kind: 'workspace'; wsId: string } | { kind: 'pane'; wsId: string; paneId: string }

interface State {
  shells: ShellInfo[]
  workspaces: Record<string, Workspace>
  order: string[]
  activeId: string | null
  newTerminalShellId: string | null
  lastEditorPaneId: string | null
  init: () => Promise<void>
  newWorkspace: (name: string) => string
  renameWorkspace: (id: string, name: string) => void
  closeWorkspace: (id: string) => void
  moveWorkspace: (fromId: string, toId: string) => void
  setActive: (id: string) => void
  setLayout: (wsId: string, layout: MosaicNode | null) => void
  addTerminal: (wsId: string, targetPaneId: string | null, dir: MosaicDirection) => string
  closePane: (wsId: string, paneId: string) => void
  setNewTerminalShell: (id: string) => void
  saveAll: () => Promise<void>
  flushQuick: () => void
  statuses: Record<string, TerminalStatus>
  setStatus: (id: string, status: TerminalStatus) => void
  cwds: Record<string, string>
  setCwd: (id: string, cwd: string) => void
  procs: Record<string, ProcInfo>
  setProcs: (id: string, info: ProcInfo | null) => void
  aiSessions: Record<string, AiSession>
  setAiSession: (id: string, ai: AiSession | null) => void
  usage: Record<string, UsageMetrics>
  setUsage: (id: string, metrics: UsageMetrics | null) => void
  recording: Record<string, boolean>
  setRecording: (id: string, on: boolean) => void
  setRecordByDefault: (on: boolean) => void
  drafts: Record<string, EditorDraft>
  cloud: CloudStatus[]
  setCloud: (statuses: CloudStatus[]) => void
  refreshCloud: () => void
  envVault: { exists: boolean; unlocked: boolean }
  setEnvState: (s: { exists: boolean; unlocked: boolean }) => void
  launchCommand: (launch: TerminalLaunch) => void
  updatePaneConfig: (wsId: string, paneId: string, patch: Partial<Omit<EditorConfig, 'kind'> & Omit<ExplorerConfig, 'kind'> & Omit<TerminalConfig, 'kind'>>) => void
  registerEditorPane: (paneId: string) => void
  addEditor: (wsId: string, targetPaneId: string | null, dir: MosaicDirection) => string
  addExplorer: (wsId: string, targetPaneId: string | null, dir: MosaicDirection, root: string) => string
  openFileInEditor: (wsId: string, path: string) => void
  openExplorerHere: (wsId: string, paneId: string) => void
  schedules: Record<string, ScheduledTask>
  addSchedule: (task: Omit<ScheduledTask, 'id'>) => string
  cancelSchedule: (id: string) => void
  quick: QuickStore
  home: string
  paletteOpen: boolean
  broadcastOpen: boolean
  setBroadcastOpen: (open: boolean) => void
  broadcastInput: (text: string, mode: 'paste' | 'keys', enter: boolean) => void
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
  saveTemplate: (name: string) => void
  deleteTemplate: (id: string) => void
  newWorkspaceFromTemplate: (templateId: string, name: string) => string
  setTheme: (patch: Partial<Theme>) => void
  resetTheme: () => void
  setThemeScoped: (scope: ThemeScope, patch: Partial<Theme>) => void
  resetThemeScope: (scope: ThemeScope) => void
  saveThemePreset: (name: string) => void
  applyThemePreset: (id: string) => void
  deleteThemePreset: (id: string) => void
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

export function resolvedPaneTheme(s: { quick: { theme?: Partial<Theme> }; workspaces: Record<string, Workspace> }, wsId: string, paneId: string): Theme {
  const ws = s.workspaces[wsId]
  return resolveTheme(s.quick.theme, ws?.theme, ws?.panes[paneId]?.config.theme)
}

/** Display state for an AI session pane: 'working' when busy, 'awaiting' when quiet, null if not an AI session. */
export function aiState(
  s: { aiSessions: Record<string, AiSession>; statuses: Record<string, TerminalStatus> },
  paneId: string
): 'working' | 'awaiting' | null {
  if (!s.aiSessions[paneId]) return null
  return s.statuses[paneId]?.state === 'busy' ? 'working' : 'awaiting'
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
    procs: {},
    aiSessions: {},
    usage: {},
    recording: {},
    drafts: {},
    cloud: [],
    envVault: { exists: false, unlocked: false },
    schedules: {},
    quick: EMPTY_QUICK,
    home: '',
    paletteOpen: false,
    broadcastOpen: false,
    connectionFormFor: null,

    init: async () => {
      const shells = await api.listShells()
      set({ shells, newTerminalShellId: shells[0]?.id ?? null })
      const [quick, home, drafts] = await Promise.all([api.loadQuick(), api.homeDir(), api.draftsLoad()])
      set({ quick, home, drafts })
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

    saveTemplate: (name) => {
      const n = name.trim(); if (!n) return
      const s = get(); const ws = s.activeId ? s.workspaces[s.activeId] : null
      if (!ws) return
      const tpl = templateFromWorkspace(ws, uuid(), n)
      set(st => ({ quick: { ...st.quick, templates: [...st.quick.templates, tpl] } }))
      scheduleQuickSave()
    },

    deleteTemplate: (id) => {
      set(st => ({ quick: { ...st.quick, templates: st.quick.templates.filter(t => t.id !== id) } }))
      scheduleQuickSave()
    },

    setTheme: (patch) => {
      set(s => ({ quick: { ...s.quick, theme: { ...mergeTheme(s.quick.theme), ...patch } } }))
      scheduleQuickSave()
    },
    resetTheme: () => {
      set(s => ({ quick: { ...s.quick, theme: { ...DEFAULT_THEME } } }))
      scheduleQuickSave()
    },

    setThemeScoped: (scope, patch) => {
      if (scope.kind === 'app') { get().setTheme(patch); return }
      if (scope.kind === 'workspace') {
        set(s => { const ws = s.workspaces[scope.wsId]; if (!ws) return {}
          return { workspaces: { ...s.workspaces, [scope.wsId]: { ...ws, theme: { ...(ws.theme ?? {}), ...patch } } } } })
        scheduleAutosave(); return
      }
      set(s => { const ws = s.workspaces[scope.wsId]; const pane = ws?.panes[scope.paneId]; if (!ws || !pane) return {}
        const cfg = { ...pane.config, theme: { ...(pane.config.theme ?? {}), ...patch } }
        return { workspaces: { ...s.workspaces, [scope.wsId]: { ...ws, panes: { ...ws.panes, [scope.paneId]: { ...pane, config: cfg } } } } } })
      scheduleAutosave()
    },

    resetThemeScope: (scope) => {
      if (scope.kind === 'app') { get().resetTheme(); return }
      if (scope.kind === 'workspace') {
        set(s => { const ws = s.workspaces[scope.wsId]; if (!ws) return {}
          const { theme: _omit, ...rest } = ws; void _omit
          return { workspaces: { ...s.workspaces, [scope.wsId]: rest as typeof ws } } })
        scheduleAutosave(); return
      }
      set(s => { const ws = s.workspaces[scope.wsId]; const pane = ws?.panes[scope.paneId]; if (!ws || !pane) return {}
        const { theme: _omit, ...restCfg } = pane.config; void _omit
        return { workspaces: { ...s.workspaces, [scope.wsId]: { ...ws, panes: { ...ws.panes, [scope.paneId]: { ...pane, config: restCfg as typeof pane.config } } } } } })
      scheduleAutosave()
    },
    saveThemePreset: (name) => {
      const n = name.trim(); if (!n) return
      set(s => ({ quick: { ...s.quick, themePresets: [...s.quick.themePresets, { id: uuid(), name: n, theme: mergeTheme(s.quick.theme) }] } }))
      scheduleQuickSave()
    },
    applyThemePreset: (id) => {
      const p = get().quick.themePresets.find(t => t.id === id)
      if (!p) return
      set(s => ({ quick: { ...s.quick, theme: { ...p.theme } } }))
      scheduleQuickSave()
    },
    deleteThemePreset: (id) => {
      set(s => ({ quick: { ...s.quick, themePresets: s.quick.themePresets.filter(t => t.id !== id) } }))
      scheduleQuickSave()
    },

    newWorkspaceFromTemplate: (templateId, name) => {
      const tpl = get().quick.templates.find(t => t.id === templateId)
      if (!tpl) return get().newWorkspace(name)
      const ws = workspaceFromTemplate(tpl, uuid(), name, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [ws.id]: ws }, order: [...s.order, ws.id], activeId: ws.id }))
      scheduleAutosave()
      return ws.id
    },

    renameWorkspace: (id, name) => {
      const n = name.trim()
      if (!n) return
      set(s => s.workspaces[id] ? { workspaces: { ...s.workspaces, [id]: { ...s.workspaces[id], name: n } } } : {})
      scheduleAutosave()
    },

    closeWorkspace: (id) => {
      const ws = get().workspaces[id]
      if (!ws) return
      const paneIds = Object.keys(ws.panes)
      for (const pid of paneIds) {
        if (ws.panes[pid].config.kind === 'terminal') { api.ptyKill(pid); api.usageUnwatch(pid) }
      }
      set(s => {
        const workspaces = { ...s.workspaces }; delete workspaces[id]
        const order = s.order.filter(x => x !== id)
        const statuses = { ...s.statuses }
        const cwds = { ...s.cwds }
        const procs = { ...s.procs }
        const aiSessions = { ...s.aiSessions }
        const usage = { ...s.usage }
        for (const pid of paneIds) { delete statuses[pid]; delete cwds[pid]; delete procs[pid]; delete aiSessions[pid]; delete usage[pid] }
        const activeId = s.activeId === id ? (order[0] ?? null) : s.activeId
        return { workspaces, order, activeId, statuses, cwds, procs, aiSessions, usage, schedules: schedulesWithout(s.schedules, paneIds) }
      })
      if (get().order.length === 0) get().newWorkspace('Workspace 1')
      scheduleAutosave()
    },

    moveWorkspace: (fromId, toId) => {
      set(s => ({ order: reorderIds(s.order, fromId, toId) }))
      scheduleAutosave()
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
      set(s => {
        const statuses = { ...s.statuses }; delete statuses[paneId]
        const cwds = { ...s.cwds }; delete cwds[paneId]
        const procs = { ...s.procs }; delete procs[paneId]
        const aiSessions = { ...s.aiSessions }; delete aiSessions[paneId]
        const usage = { ...s.usage }; delete usage[paneId]
        return { workspaces: { ...s.workspaces, [wsId]: ws }, statuses, cwds, procs, aiSessions, usage, schedules: schedulesWithout(s.schedules, [paneId]) }
      })
      api.usageUnwatch(paneId)
      api.ptyKill(paneId)
      api.recStop(paneId)
      scheduleAutosave()
    },

    addSchedule: (task) => {
      const id = uuid()
      set(s => ({ schedules: { ...s.schedules, [id]: { ...task, id } } }))
      return id
    },

    cancelSchedule: (id) => set(s => {
      const schedules = { ...s.schedules }; delete schedules[id]
      return { schedules }
    }),

    setNewTerminalShell: (id) => set({ newTerminalShellId: id }),

    setStatus: (id, status) => {
      const state = get()
      const prev = state.statuses[id]
      const ai = state.aiSessions[id]
      const cfg = findPaneConfig(state, id)
      const termCfg = cfg?.kind === 'terminal' ? cfg : undefined
      const alerts = resolveAlerts(termCfg?.alerts)
      const eff = effectiveStatus(status, termCfg?.alerts)
      set(s => ({ statuses: { ...s.statuses, [id]: eff } }))
      const unfocused = typeof document !== 'undefined' && !document.hasFocus()
      if (ai) {
        // AI session: notify when it flips from working (busy) to awaiting (quiet).
        if (prev?.state === 'busy' && status.state !== 'busy'
            && alerts.needsInput && alerts.osNotification && unfocused) {
          api.notify({ title: `${ai.label} is waiting for you`, body: termCfg?.name ?? `${ai.label} needs your input` })
        }
      } else if (status.state === 'needs-input' && prev?.state !== 'needs-input'
          && alerts.needsInput && alerts.osNotification && unfocused) {
        api.notify({ title: 'Terminal needs input', body: termCfg?.name ?? 'A terminal is waiting for input' })
      }
    },

    setCwd: (id, cwd) => {
      if (get().cwds[id] === cwd) return
      set(s => ({ cwds: { ...s.cwds, [id]: cwd } }))
      const q = get().quick
      const recentDirs = nextRecentDirs(q.recentDirs, cwd, get().home)
      if (recentDirs !== q.recentDirs) {
        set(s => ({ quick: { ...s.quick, recentDirs } }))
        scheduleQuickSave()
      }
      scheduleAutosave()   // persist into config.cwd (debounced) so restore uses it
    },

    setProcs: (id, info) => set(s => {
      const procs = { ...s.procs }
      if (info) procs[id] = info
      else delete procs[id]
      return { procs }
    }),

    setAiSession: (id, ai) => set(s => {
      const aiSessions = { ...s.aiSessions }
      if (ai) aiSessions[id] = ai
      else delete aiSessions[id]
      return { aiSessions }
    }),

    setUsage: (id, metrics) => set(s => {
      const usage = { ...s.usage }
      if (metrics) usage[id] = metrics
      else delete usage[id]
      return { usage }
    }),

    setRecording: (id, on) => set(s => { const r = { ...s.recording }; if (on) r[id] = true; else delete r[id]; return { recording: r } }),
    setRecordByDefault: (on) => { set(s => ({ quick: { ...s.quick, recordByDefault: on } })); scheduleQuickSave() },

    setCloud: (statuses) => set({ cloud: statuses }),

    refreshCloud: () => { void api.cloudRefresh() },

    setEnvState: (s) => set({ envVault: s }),

    launchCommand: (launch) => {
      const wsId = get().activeId
      if (!wsId) return
      const ws = get().workspaces[wsId]
      const target = ws.layout ? Object.keys(ws.panes)[0] : null
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cfg: TerminalConfig = { kind: 'terminal', shellId, cwd: '', name: launch.title, launch }
      const r = ws.layout === null || target === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, target, 'row', cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
      scheduleAutosave()
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
    setBroadcastOpen: (open) => set({ broadcastOpen: open }),

    broadcastInput: (text, mode, enter) => {
      const s = get()
      const ws = s.activeId ? s.workspaces[s.activeId] : null
      if (!ws) return
      const data = encodeBroadcast(text, mode, enter)
      for (const id of terminalPaneIds(ws)) api.ptyWrite({ id, data })
    },

    setConnectionForm: (target) => set({ connectionFormFor: target }),

    saveConnection: (conn) => {
      const q = get().quick
      const exists = q.connections.some(c => c.id === conn.id)
      const connections = exists
        ? q.connections.map(c => (c.id === conn.id ? conn : c))
        : [...q.connections, conn]
      set(s => ({ quick: { ...s.quick, connections } }))
      scheduleQuickSave()
    },

    deleteConnection: (id) => {
      set(s => ({ quick: { ...s.quick,
        connections: s.quick.connections.filter(c => c.id !== id),
        recentConnections: s.quick.recentConnections.filter(rid => rid !== id) } }))
      scheduleQuickSave()
    },

    pinDir: (dir) => {
      const q = get().quick
      if (!dir || q.favoriteDirs.includes(dir)) return
      set(s => ({ quick: { ...s.quick, favoriteDirs: [...s.quick.favoriteDirs, dir] } }))
      scheduleQuickSave()
    },

    unpinDir: (dir) => {
      set(s => ({ quick: { ...s.quick, favoriteDirs: s.quick.favoriteDirs.filter(d => d !== dir) } }))
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
      set(s => ({
        workspaces: { ...s.workspaces, [wsId]: r.workspace },
        quick: { ...s.quick, recentConnections: pushRecent(s.quick.recentConnections, conn.id, RECENT_CONN_CAP) }
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
    },

    flushQuick: () => {
      if (quickTimer) { clearTimeout(quickTimer); quickTimer = null }
      void api.saveQuick(get().quick)
    }
  }
})
