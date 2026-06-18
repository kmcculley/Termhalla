import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Workspace, PaneConfig, EditorConfig } from '@shared/types'
import { EMPTY_QUICK } from '@shared/types'
import { createWorkspace, removePane, reorderIds, movePane, carryTheme } from '@shared/workspace-model'
import { encodeBroadcast, terminalPaneIds } from '@shared/broadcast'
import { schedulesWithout } from '@shared/schedule'
import { api } from './api'
import type { State, SliceDeps } from './store/types'
import {
  placePane, firstTarget, paneCwd, applyCwds, clearPaneRuntime, teardownPanes
} from './store/internals'
import { defaultShellId, dispatchAddPane } from './store/pane-ops'
import { readPaneSnapshot, stashSnapshot } from './components/terminal-registry'
import { beginPaneTransit } from './components/pane-transit'
import { AUTOSAVE_DEBOUNCE_MS } from './timing'
import { createThemeSlice } from './store/theme-slice'
import { createRuntimeSlice } from './store/runtime-slice'
import { createQuickSlice } from './store/quick-slice'
import { createScheduleSlice } from './store/schedule-slice'
import { createRunCommandsSlice } from './store/run-commands-slice'
import { createToastsSlice } from './store/toasts-slice'
import { createSettingsSlice } from './store/settings-slice'
import { createKeybindingsSlice } from './store/keybindings-slice'
import { createNotesSlice } from './store/notes-slice'

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
  const autosave = makeDebounce(() => { void get().saveAll() }, AUTOSAVE_DEBOUNCE_MS)
  const quickSave = makeDebounce(() => { void api.saveQuick(get().quick) }, AUTOSAVE_DEBOUNCE_MS)
  const dirtyNotes = new Set<string>()
  const notesSave = makeDebounce(() => {
    const s = get()
    for (const k of dirtyNotes) void api.notesSet(k, s.notes[k] ?? '')
    dirtyNotes.clear()
  }, AUTOSAVE_DEBOUNCE_MS)
  const scheduleAutosave = autosave.schedule
  const scheduleQuickSave = quickSave.schedule
  const scheduleNotesSave = (key: string) => { dirtyNotes.add(key); notesSave.schedule() }

  /** Place `cfg` as a new pane in `wsId`, commit it to state, schedule a save, and return the
   *  new pane id. Centralizes the get-ws / placePane / set-workspaces / autosave sequence that
   *  was copy-pasted across every "open a pane" action (and unifies their persistence on the
   *  debounced autosave rather than a mix of immediate saveAll and scheduleAutosave). */
  const commitPane = (wsId: string, cfg: PaneConfig, target: string | null, dir: import('@shared/types').MosaicDirection, markEditor = false): string => {
    const ws = get().workspaces[wsId]
    const r = placePane(ws, cfg, target, dir)
    set(s => {
      const maximized = { ...s.maximized }
      delete maximized[wsId]
      return markEditor
        ? { workspaces: { ...s.workspaces, [wsId]: r.workspace }, maximized, lastEditorPaneId: r.paneId }
        : { workspaces: { ...s.workspaces, [wsId]: r.workspace }, maximized }
    })
    scheduleAutosave()
    return r.paneId
  }

  /** Tell main this window's workspace list / active tab changed (add, close, reorder, switch), so
   *  main's authoritative windows[] arrangement stays in sync. NOT called from applyAssignment —
   *  that applies a main-pushed state, and reporting it back would echo. */
  const reportAssignment = () => {
    const s = get()
    if (!s.windowId) return
    api.winReport({ windowId: s.windowId, workspaceIds: s.order, activeId: s.activeId })
  }

  const deps: SliceDeps = { set, get, scheduleAutosave, scheduleQuickSave, scheduleNotesSave, commitPane }

  return {
    // ---- initial state ----
    shells: [],
    workspaces: {},
    order: [],
    activeId: null,
    windowId: null,
    isMainWindow: true,   // true until a win:assignment says otherwise, so the first paint shows tabs
    newTerminalShellId: null,
    lastEditorPaneId: null,
    maximized: {},
    focusedPaneId: null,
    statuses: {},
    cwds: {},
    procs: {},
    gitStatus: {},
    aiSessions: {},
    usage: {},
    recording: {},
    drafts: {},
    notes: {},
    notesOpen: false,
    notesProjectKey: null,
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
    ...createRunCommandsSlice(deps),
    ...createToastsSlice(deps),
    ...createSettingsSlice(deps),
    ...createKeybindingsSlice(deps),
    ...createNotesSlice(deps),

    // ---- core: bootstrap + persistence ----
    init: async () => {
      const shells = await api.listShells()
      set({ shells, newTerminalShellId: shells[0]?.id ?? null })
      const [quick, home, drafts, notes] = await Promise.all([api.loadQuick(), api.homeDir(), api.draftsLoad(), api.notesLoad()])
      set({ quick, home, drafts, notes })
      // Workspaces are hydrated by applyAssignment when main pushes this window's win:assignment.
    },

    /** Apply the set of workspaces main says this window hosts: load any not yet in memory, drop
     *  any this window no longer owns (moved away), and set the active tab. The main window seeds a
     *  starter workspace when it has none (cold first run); a floating window never re-seeds (it
     *  legitimately closes itself when emptied). */
    applyAssignment: async ({ windowId, isMain, workspaceIds, activeId }) => {
      set({ windowId, isMainWindow: isMain })
      const missing = workspaceIds.filter(id => !get().workspaces[id])
      const loaded = await Promise.all(missing.map(id => api.loadWorkspace(id)))
      set(s => {
        const workspaces = { ...s.workspaces }
        for (const ws of loaded) if (ws) workspaces[ws.id] = ws
        for (const id of Object.keys(workspaces)) if (!workspaceIds.includes(id)) delete workspaces[id]
        const order = workspaceIds.filter(id => workspaces[id])
        return { workspaces, order, activeId: order.length ? (activeId ?? order[0]) : null }
      })
      if (isMain && get().order.length === 0) get().newWorkspace('Workspace 1')
    },

    /** Answer main's serialize request: one snapshot per terminal pane, then a `__end__` sentinel. */
    serializeWorkspace: (wsId) => {
      const ws = get().workspaces[wsId]
      if (ws) {
        for (const paneId of Object.keys(ws.panes)) {
          if (ws.panes[paneId].config.kind !== 'terminal') continue
          api.termSnapshot({ paneId, data: readPaneSnapshot(paneId) })
        }
      }
      api.termSnapshot({ paneId: `__end__:${wsId}`, data: '' })
    },

    saveAll: async () => {
      const { order, workspaces, cwds } = get()
      await Promise.all(order.map(id => api.saveWorkspace(applyCwds(workspaces[id], cwds))))
      // The windows[] arrangement (which window hosts which workspace) is persisted by main's
      // WindowManager, kept in sync via win:report — the renderer only owns workspace files now.
    },

    loadQuick: async () => {
      const [quick, home] = await Promise.all([api.loadQuick(), api.homeDir()])
      set({ quick, home })
    },

    flushQuick: quickSave.flush,
    flushNotes: notesSave.flush,
    setNewTerminalShell: (id) => set({ newTerminalShellId: id }),

    // ---- core: workspace management ----
    newWorkspace: (name) => {
      const ws = createWorkspace(name, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [ws.id]: ws }, order: [...s.order, ws.id], activeId: ws.id }))
      scheduleAutosave()
      reportAssignment()
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
      // Only the main window keeps at least one workspace; a floating window that loses its sole
      // workspace closes instead of re-seeding a phantom one.
      if (get().order.length === 0 && get().isMainWindow) get().newWorkspace('Workspace 1')
      scheduleAutosave()
      reportAssignment()
    },

    moveWorkspace: (fromId, toId) => {
      set(s => ({ order: reorderIds(s.order, fromId, toId) }))
      scheduleAutosave()
      reportAssignment()
    },

    setActive: (id) => { set({ activeId: id }); scheduleAutosave(); reportAssignment() },

    setLayout: (wsId, layout) => {
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: { ...s.workspaces[wsId], layout } } }))
      scheduleAutosave()
    },

    toggleMaximize: (wsId, paneId) => set(s => {
      const maximized = { ...s.maximized }
      if (maximized[wsId] === paneId) delete maximized[wsId]
      else maximized[wsId] = paneId
      return { maximized }
    }),

    setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

    /** Move a pane to another workspace THIS window already hosts, following it with the active tab.
     *  Terminals keep scrollback (snapshot stash) + their running PTY (re-adopted by pty:spawn);
     *  editors keep unsaved edits (in-transit draft flush). Never tears down the PTY. */
    movePaneToWorkspace: (paneId, fromWsId, toWsId) => {
      const s = get()
      const from = s.workspaces[fromWsId]
      const to = s.workspaces[toWsId]
      if (!from || !to || fromWsId === toWsId || !from.panes[paneId]) return
      const kind = from.panes[paneId].config.kind
      if (kind === 'terminal') { const snap = readPaneSnapshot(paneId); if (snap) stashSnapshot(paneId, snap) }
      if (kind === 'editor') beginPaneTransit(paneId)
      const moved = movePane(from, to, paneId)
      set(st => {
        const maximized = { ...st.maximized }
        if (maximized[fromWsId] === paneId) delete maximized[fromWsId]
        return { workspaces: { ...st.workspaces, [fromWsId]: moved.from, [toWsId]: moved.to }, activeId: toWsId, maximized }
      })
      scheduleAutosave()
      reportAssignment()
    },

    /** Move a pane into a brand-new workspace, carrying the source workspace's theme override so the
     *  pane renders the same in its new home. */
    movePaneToNewWorkspace: (paneId, fromWsId) => {
      const from = get().workspaces[fromWsId]
      if (!from?.panes[paneId]) return
      const newId = get().newWorkspace(`Workspace ${get().order.length + 1}`)
      set(s => ({ workspaces: { ...s.workspaces, [newId]: carryTheme(s.workspaces[newId], from) } }))
      get().movePaneToWorkspace(paneId, fromWsId, newId)
    },

    // ---- core: pane management ----
    addTerminal: (wsId, targetPaneId, dir) => {
      const shellId = defaultShellId(get())
      const cwd = targetPaneId ? paneCwd(get(), targetPaneId) : ''
      return commitPane(wsId, { kind: 'terminal', shellId, cwd }, targetPaneId, dir)
    },

    addPaneOfKind: (wsId, kind) => dispatchAddPane(get(), wsId, kind, () => api.openFolder()),

    closePane: (wsId, paneId) => {
      const ws = removePane(get().workspaces[wsId], paneId)
      teardownPanes([paneId])
      set(s => {
        const maximized = { ...s.maximized }
        if (maximized[wsId] === paneId) delete maximized[wsId]
        return { workspaces: { ...s.workspaces, [wsId]: ws }, maximized, ...clearPaneRuntime(s, [paneId]), schedules: schedulesWithout(s.schedules, [paneId]) }
      })
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
      const shellId = defaultShellId(get())
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
