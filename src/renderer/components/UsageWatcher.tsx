import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'

/** Reconciles main-process usage watches with the set of Claude AI sessions that have a known
 *  cwd. Watches on detect, unwatches on clear. Renders nothing. */
export function UsageWatcher() {
  const aiSessions = useStore(s => s.aiSessions)
  const cwds = useStore(s => s.cwds)
  const watched = useRef<Record<string, string>>({})

  useEffect(() => {
    const desired: Record<string, string> = {}
    for (const id of Object.keys(aiSessions)) {
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
  }, [aiSessions, cwds])

  // Release any active watches if this reconciler ever unmounts.
  useEffect(() => () => {
    for (const id of Object.keys(watched.current)) api.usageUnwatch(id)
    watched.current = {}
  }, [])

  return null
}
