import { v4 as uuid } from 'uuid'
import { DEFAULT_THEME, mergeTheme } from '@shared/theme'
import type { State, SliceDeps } from './types'

type ThemeSlice = Pick<State,
  'setTheme' | 'resetTheme' | 'setThemeScoped' | 'resetThemeScope' |
  'saveThemePreset' | 'applyThemePreset' | 'deleteThemePreset'>

/** App/workspace/pane theme overrides and named presets. App theme + presets live on `quick`
 *  (per-machine); workspace/pane overrides live on the workspace (autosaved with it). */
export function createThemeSlice({ set, get, scheduleAutosave, scheduleQuickSave }: SliceDeps): ThemeSlice {
  return {
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
    }
  }
}
