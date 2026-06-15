import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { encodeBroadcast } from '@shared/broadcast'
import { nextRecurringDelay } from '@shared/schedule'
import type { ScheduledTask } from '@shared/types'

export function Scheduler() {
  const schedules = useStore(s => s.schedules)
  const statuses = useStore(s => s.statuses)
  const cancelSchedule = useStore(s => s.cancelSchedule)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const armed = useRef<Set<string>>(new Set())
  const schedulesRef = useRef(schedules); schedulesRef.current = schedules
  const cancelRef = useRef(cancelSchedule); cancelRef.current = cancelSchedule

  const fire = (task: ScheduledTask) => {
    api.ptyWrite({ id: task.paneId, data: encodeBroadcast(task.text, task.mode, task.enter) })
  }

  // Arm/disarm delay + recurring tasks.
  useEffect(() => {
    for (const id of [...armed.current]) {
      if (!schedules[id]) {
        const t = timers.current.get(id); if (t) clearTimeout(t)
        timers.current.delete(id); armed.current.delete(id)
      }
    }
    for (const id of Object.keys(schedules)) {
      if (armed.current.has(id)) continue
      const task = schedules[id]
      if (task.trigger.kind === 'delay') {
        armed.current.add(id)
        timers.current.set(id, setTimeout(() => { fire(task); cancelRef.current(id) }, task.trigger.ms))
      } else if (task.trigger.kind === 'recurring') {
        armed.current.add(id)
        const { everyMs, jitterMs } = task.trigger
        const reArm = () => {
          if (!schedulesRef.current[id]) return
          fire(task)
          timers.current.set(id, setTimeout(reArm, nextRecurringDelay(everyMs, jitterMs, Math.random)))
        }
        timers.current.set(id, setTimeout(reArm, nextRecurringDelay(everyMs, jitterMs, Math.random)))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules])

  // Idle tasks: fire when the target terminal is not busy.
  useEffect(() => {
    for (const id of Object.keys(schedules)) {
      const task = schedules[id]
      if (task.trigger.kind !== 'idle') continue
      if ((statuses[task.paneId]?.state ?? 'idle') !== 'busy') { fire(task); cancelSchedule(id) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, statuses])

  useEffect(() => () => {
    for (const t of timers.current.values()) clearTimeout(t)
    timers.current.clear(); armed.current.clear()
  }, [])

  return null
}
