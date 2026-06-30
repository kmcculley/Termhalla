import { resolveAlerts, effectiveStatus } from '@shared/alerts'
import { nextRecentDirs } from '@shared/quick'
import { api } from '../api'
import { findPaneConfig } from './internals'
import type { State, SliceDeps } from './types'

type RuntimeSlice = Pick<State,
  'setStatus' | 'setCwd' | 'setProcs' | 'setGitStatus' | 'setAiSession' | 'setUsage' | 'setRecording' |
  'setExited' | 'setCloud' | 'refreshCloud' | 'setEnvState'>

/** Per-pane runtime pushed from main (status / cwd / child procs / AI session / usage /
 *  recording) plus global cloud + env-vault status. Setters mirror the wire events; setStatus
 *  also fires desktop notifications when a terminal/AI session flips to needing input. */
export function createRuntimeSlice({ set, get, scheduleAutosave, scheduleQuickSave }: SliceDeps): RuntimeSlice {
  return {
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

    setGitStatus: (id, status) => set(s => {
      const gitStatus = { ...s.gitStatus }
      if (status) gitStatus[id] = status
      else delete gitStatus[id]
      return { gitStatus }
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

    setExited: (id, on) => set(s => { const e = { ...s.exited }; if (on) e[id] = true; else delete e[id]; return { exited: e } }),

    setCloud: (statuses) => set({ cloud: statuses }),
    refreshCloud: () => { void api.cloudRefresh() },
    setEnvState: (s) => set({ envVault: s })
  }
}
