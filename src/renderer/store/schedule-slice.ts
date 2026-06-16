import { v4 as uuid } from 'uuid'
import type { State, SliceDeps } from './types'

type ScheduleSlice = Pick<State, 'addSchedule' | 'cancelSchedule'>

/** Renderer-side scheduled-command registry (the Scheduler component runs the timers). */
export function createScheduleSlice({ set }: SliceDeps): ScheduleSlice {
  return {
    addSchedule: (task) => {
      const id = uuid()
      set(s => ({ schedules: { ...s.schedules, [id]: { ...task, id } } }))
      return id
    },

    cancelSchedule: (id) => set(s => {
      const schedules = { ...s.schedules }; delete schedules[id]
      return { schedules }
    })
  }
}
