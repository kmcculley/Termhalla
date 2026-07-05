import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { paneIsRemote } from '../store/remote-gates'

/** Reconciles main-process usage watches with the set of Claude AI sessions that have a known
 *  cwd. Watches on detect, unwatches on clear. Renders nothing. */
export function UsageWatcher() {
  const aiSessions = useStore(s => s.aiSessions)
  const cwds = useStore(s => s.cwds)
  const workspaces = useStore(s => s.workspaces)
  const watched = useRef<Record<string, string>>({})

  useEffect(() => {
    const desired: Record<string, string> = {}
    for (const id of Object.keys(aiSessions)) {
      // Remote panes never engage the LOCAL usage watcher (feature 0022, REQ-011): their cwd is a
      // remote path the local ~/.claude transcript reader could never resolve.
      if (paneIsRemote({ workspaces }, id)) continue
      if (aiSessions[id].tool === 'claude' && cwds[id]) desired[id] = cwds[id]
    }
    for (const id of Object.keys(desired)) {
      if (watched.current[id] !== desired[id]) {
        api.usageWatch(id, desired[id])
        watched.current[id] = desired[id]
      }
    }
    for (const id of Object.keys(watched.current)) {
      if (!desired[id]) {
        api.usageUnwatch(id)
        delete watched.current[id]
      }
    }
  }, [aiSessions, cwds, workspaces])

  // Release any active watches if this reconciler ever unmounts.
  useEffect(() => () => {
    for (const id of Object.keys(watched.current)) api.usageUnwatch(id)
    watched.current = {}
  }, [])

  return null
}
