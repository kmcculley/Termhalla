import { v4 as uuid } from 'uuid'
import { buildSshArgs, pushRecent, RECENT_CONN_CAP } from '@shared/quick'
import { templateFromWorkspace, workspaceFromTemplate } from '@shared/workspace-model'
import { firstTarget, defaultShellId } from './pane-ops'
import type { State, SliceDeps } from './types'

type QuickSlice = Pick<State,
  'saveTemplate' | 'deleteTemplate' | 'newWorkspaceFromTemplate' |
  'saveConnection' | 'deleteConnection' | 'pinDir' | 'unpinDir' |
  'launchConnection' | 'launchDir' | 'setRecordByDefault' | 'setAutoResumeClaude' | 'setCopyOnSelect' | 'setCleanCopy' | 'setToastsEnabled' | 'setOrkyNeedsYouNotifications'>

/** The "quick.json" domain: workspace templates, SSH connection favorites, pinned/recent dirs,
 *  the launch shortcuts that open a favorite as a new terminal pane, and the record-by-default
 *  toggle. All persisted via the debounced quick-save (workspace creation also autosaves). */
export function createQuickSlice({ set, get, scheduleQuickSave, commitPane, registerWorkspace }: SliceDeps): QuickSlice {
  return {
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

    newWorkspaceFromTemplate: (templateId, name) => {
      const tpl = get().quick.templates.find(t => t.id === templateId)
      if (!tpl) return get().newWorkspace(name)
      const ws = workspaceFromTemplate(tpl, uuid(), name, uuid)
      // Feature 0011 (REQ-006 / FINDING-001): registration MUST include the arrangement report —
      // without it the next pushed assignment silently deletes the workspace and a quit→relaunch
      // loses it. The shared ritual owns that (set + autosave + report). The !tpl fallback above
      // needs nothing: it routes to newWorkspace, which registers itself.
      registerWorkspace(ws)
      return ws.id
    },

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
      const shellId = defaultShellId(get())
      commitPane(wsId, {
        kind: 'terminal', shellId, cwd: '', name: conn.name, connectionId: conn.id,
        launch: { command: 'ssh', args: buildSshArgs(conn), title: conn.name }
      }, firstTarget(ws), 'row')
      set(s => ({ quick: { ...s.quick, recentConnections: pushRecent(s.quick.recentConnections, conn.id, RECENT_CONN_CAP) } }))
      scheduleQuickSave()
    },

    launchDir: (dir) => {
      const wsId = get().activeId
      if (!wsId || !dir) return
      const ws = get().workspaces[wsId]
      const shellId = defaultShellId(get())
      commitPane(wsId, { kind: 'terminal', shellId, cwd: dir }, firstTarget(ws), 'row')
    },

    setRecordByDefault: (on) => { set(s => ({ quick: { ...s.quick, recordByDefault: on } })); scheduleQuickSave() },
    setAutoResumeClaude: (on) => { set(s => ({ quick: { ...s.quick, autoResumeClaude: on } })); scheduleQuickSave() },
    setCopyOnSelect: (on) => { set(s => ({ quick: { ...s.quick, copyOnSelect: on } })); scheduleQuickSave() },
    setCleanCopy: (on) => { set(s => ({ quick: { ...s.quick, cleanCopy: on } })); scheduleQuickSave() },
    setToastsEnabled: (on) => { set(s => ({ quick: { ...s.quick, toastsEnabled: on } })); scheduleQuickSave() },
    // Feature 0013: the app-wide OS needs-you-notifications opt-in (default enabled). Mirrors
    // setToastsEnabled — the debounced quickSave carries the full payload to main, whose live-refresh
    // mirror re-reads orkyNeedsYouNotifications so a toggle takes effect without a restart.
    setOrkyNeedsYouNotifications: (on) => { set(s => ({ quick: { ...s.quick, orkyNeedsYouNotifications: on } })); scheduleQuickSave() }
  }
}
