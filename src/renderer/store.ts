import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Workspace, PaneConfig, EditorConfig } from '@shared/types'
import { EMPTY_QUICK } from '@shared/types'
import { createWorkspace, removePane, reorderIds } from '@shared/workspace-model'
import { encodeBroadcast, terminalPaneIds } from '@shared/broadcast'
import { schedulesWithout } from '@shared/schedule'
import { api } from './api'
import type { State, SliceDeps } from './store/types'
import {
  placePane, firstTarget, paneCwd, applyCwds, clearPaneRuntime, teardownPanes
} from './store/internals'
import { createThemeSlice } from './store/theme-slice'
import { createRuntimeSlice } from './store/runtime-slice'
import { createQuickSlice } from './store/quick-slice'
import { createScheduleSlice } from './store/schedule-slice'

// Re-exported so existing `import { ... } from '../store'` call sites keep working.
export type { ThemeScope } from './store/types'
export { paneCwd, resolvedPaneTheme, aiState } from './store/internals'

/** A debounced action with an immediate flush (used for the autosave / quick-save timers). */
function makeDebounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule: () => { if (timer) clearTimeout(timer); timer = setTimeout(fn, ms) },
    flush: () => { if (timer) { clearTimeout(timer); timer = null } fn() }
  }
}

export const useStore = create<State>((set, get) => {
  const autosave = makeDebounce(() => { void get().saveAll() }, 500)
  const quickSave = makeDebounce(() => { void api.saveQuick(get().quick) }, 500)
  const scheduleAutosave = autosave.schedule
  const scheduleQuickSave = quickSave.schedule

  /** Place `cfg` as a new pane in `wsId`, commit it to state, schedule a save, and return the
   *  new pane id. Centralizes the get-ws / placePane / set-workspaces / autosave sequence that
   *  was copy-pasted across every "open a pane" action (and unifies their persistence on the
   *  debounced autosave rather than a mix of immediate saveAll and scheduleAutosave). */
  const commitPane = (wsId: string, cfg: PaneConfig, target: string | null, dir: import('@shared/types').MosaicDirection, markEditor = false): string => {
    const ws = get().workspaces[wsId]
    const r = placePane(ws, cfg, target, dir)
    set(s => markEditor
      ? { workspaces: { ...s.workspaces, [wsId]: r.workspace }, lastEditorPaneId: r.paneId }
      : { workspaces: { ...s.workspaces, [wsId]: r.workspace } })
    scheduleAutosave()
    return r.paneId
  }

  const deps: SliceDeps = { set, get, scheduleAutosave, scheduleQuickSave, commitPane }

  return {
    // ---- initial state ----
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

    // ---- domain slices ----
    ...createThemeSlice(deps),
    ...createRuntimeSlice(deps),
    ...createQuickSlice(deps),
    ...createScheduleSlice(deps),

    // ---- core: bootstrap + persistence ----
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

    saveAll: async () => {
      const { order, workspaces, activeId, cwds } = get()
      await Promise.all(order.map(id => api.saveWorkspace(applyCwds(workspaces[id], cwds))))
      await api.saveAppState({ schemaVersion: 1, openWorkspaceIds: order, activeWorkspaceId: activeId })
    },

    loadQuick: async () => {
      const [quick, home] = await Promise.all([api.loadQuick(), api.homeDir()])
      set({ quick, home })
    },

    flushQuick: quickSave.flush,
    setNewTerminalShell: (id) => set({ newTerminalShellId: id }),

    // ---- core: workspace management ----
    newWorkspace: (name) => {
      const ws = createWorkspace(name, uuid)
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
      teardownPanes(paneIds)
      set(s => {
        const workspaces = { ...s.workspaces }; delete workspaces[id]
        const order = s.order.filter(x => x !== id)
        const activeId = s.activeId === id ? (order[0] ?? null) : s.activeId
        return { workspaces, order, activeId, ...clearPaneRuntime(s, paneIds), schedules: schedulesWithout(s.schedules, paneIds) }
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
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: { ...s.workspaces[wsId], layout } } }))
      scheduleAutosave()
    },

    // ---- core: pane management ----
    addTerminal: (wsId, targetPaneId, dir) => {
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cwd = targetPaneId ? paneCwd(get(), targetPaneId) : ''
      return commitPane(wsId, { kind: 'terminal', shellId, cwd }, targetPaneId, dir)
    },

    closePane: (wsId, paneId) => {
      const ws = removePane(get().workspaces[wsId], paneId)
      teardownPanes([paneId])
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: ws }, ...clearPaneRuntime(s, [paneId]), schedules: schedulesWithout(s.schedules, [paneId]) }))
      scheduleAutosave()
    },

    addEditor: (wsId, targetPaneId, dir) => commitPane(wsId, { kind: 'editor', files: [] }, targetPaneId, dir, true),

    addExplorer: (wsId, targetPaneId, dir, root) => commitPane(wsId, { kind: 'explorer', root }, targetPaneId, dir),

    openExplorerHere: (wsId, paneId) => {
      const root = paneCwd(get(), paneId)
      if (!root) return
      get().addExplorer(wsId, paneId, 'row', root)
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
        commitPane(wsId, { kind: 'editor', files: [path], activePath: path }, firstTarget(ws), 'row', true)
      }
    },

    updatePaneConfig: (wsId, paneId, patch) => {
      const ws = get().workspaces[wsId]
      const pane = ws?.panes[paneId]
      if (!pane) return
      const config = { ...(pane.config as object), ...patch } as PaneConfig
      const updated: Workspace = { ...ws, panes: { ...ws.panes, [paneId]: { ...pane, config } } }
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: updated } }))
      scheduleAutosave()
    },

    registerEditorPane: (paneId) => set({ lastEditorPaneId: paneId }),

    launchCommand: (launch) => {
      const wsId = get().activeId
      if (!wsId) return
      const ws = get().workspaces[wsId]
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      commitPane(wsId, { kind: 'terminal', shellId, cwd: '', name: launch.title, launch }, firstTarget(ws), 'row')
    },

    // ---- core: transient UI ----
    setPaletteOpen: (open) => set({ paletteOpen: open }),
    setBroadcastOpen: (open) => set({ broadcastOpen: open }),
    setConnectionForm: (target) => set({ connectionFormFor: target }),

    broadcastInput: (text, mode, enter) => {
      const s = get()
      const ws = s.activeId ? s.workspaces[s.activeId] : null
      if (!ws) return
      const data = encodeBroadcast(text, mode, enter)
      for (const id of terminalPaneIds(ws)) api.ptyWrite({ id, data })
    }
  }
})
