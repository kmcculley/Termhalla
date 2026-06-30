import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'

/** Reconciles main-process Orky `.orky/` watches with the set of terminal panes that have a tracked
 *  cwd. Watches on cwd-appear/change, unwatches on cwd-clear/pane-close, and releases every watch on
 *  unmount. Unlike `UsageWatcher` there is NO AI-session filter — main does the `.orky/` discovery
 *  (a bounded ancestor walk) and emits a cleared `null` when the cwd has no Orky project. Renders
 *  nothing. */
export function OrkyWatcher() {
  const cwds = useStore(s => s.cwds)
  const watched = useRef<Record<string, string>>({})

  useEffect(() => {
    for (const id of Object.keys(cwds)) {
      if (cwds[id] && watched.current[id] !== cwds[id]) {
        api.orkyWatch(id, cwds[id])
        watched.current[id] = cwds[id]
      }
    }
    for (const id of Object.keys(watched.current)) {
      if (!cwds[id]) {
        api.orkyUnwatch(id)
        delete watched.current[id]
      }
    }
  }, [cwds])

  // Release any active watches if this reconciler ever unmounts.
  useEffect(() => () => {
    for (const id of Object.keys(watched.current)) api.orkyUnwatch(id)
    watched.current = {}
  }, [])

  return null
}
