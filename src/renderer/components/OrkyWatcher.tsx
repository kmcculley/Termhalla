import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { paneIsRemote } from '../store/remote-gates'

/** Reconciles main-process Orky `.orky/` watches with the set of terminal panes that have a tracked
 *  cwd. Watches on cwd-appear/change, unwatches on cwd-clear/pane-close, and releases every watch on
 *  unmount. Unlike `UsageWatcher` there is NO AI-session filter — main does the `.orky/` discovery
 *  (a bounded ancestor walk) and emits a cleared `null` when the cwd has no Orky project. Renders
 *  nothing. */
export function OrkyWatcher() {
  const cwds = useStore(s => s.cwds)
  const workspaces = useStore(s => s.workspaces)
  const watched = useRef<Record<string, string>>({})

  useEffect(() => {
    // Desired-set diff (FINDING-008, the UsageWatcher pattern): desired = LOCAL panes with a cwd.
    // Remote panes never engage the LOCAL .orky watcher (feature 0022, REQ-011) — and a pane
    // LEAVING the desired set for any reason (cwd cleared OR home turned remote) is unwatched.
    const desired: Record<string, string> = {}
    for (const id of Object.keys(cwds)) {
      if (!cwds[id]) continue
      if (paneIsRemote({ workspaces }, id)) continue
      desired[id] = cwds[id]
    }
    for (const id of Object.keys(desired)) {
      if (watched.current[id] !== desired[id]) {
        api.orkyWatch(id, desired[id])
        watched.current[id] = desired[id]
      }
    }
    for (const id of Object.keys(watched.current)) {
      if (!desired[id]) {
        api.orkyUnwatch(id)
        delete watched.current[id]
      }
    }
  }, [cwds, workspaces])

  // Release any active watches if this reconciler ever unmounts.
  useEffect(() => () => {
    for (const id of Object.keys(watched.current)) api.orkyUnwatch(id)
    watched.current = {}
  }, [])

  return null
}
