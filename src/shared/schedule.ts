import type { ScheduleTrigger, ScheduledTask } from './types'

export function toMs(value: number, unit: 'sec' | 'min'): number {
  return unit === 'min' ? value * 60000 : value * 1000
}

/** Next recurring fire delay: base ± up to jitter, clamped to >= 0. */
export function nextRecurringDelay(everyMs: number, jitterMs: number, rand: () => number): number {
  return Math.max(0, Math.round(everyMs + (rand() * 2 - 1) * jitterMs))
}

function secs(ms: number): string {
  return ms % 60000 === 0 && ms >= 60000 ? `${ms / 60000}m` : `${Math.round(ms / 1000)}s`
}

export function scheduleLabel(trigger: ScheduleTrigger): string {
  if (trigger.kind === 'idle') return 'when idle'
  if (trigger.kind === 'delay') return `in ${secs(trigger.ms)}`
  return `every ${secs(trigger.everyMs)} ±${secs(trigger.jitterMs)}`
}

/** Drop any scheduled task whose paneId is in `removed`. */
export function schedulesWithout(schedules: Record<string, ScheduledTask>, removed: string[]): Record<string, ScheduledTask> {
  const set = new Set(removed)
  const out: Record<string, ScheduledTask> = {}
  for (const [id, t] of Object.entries(schedules)) if (!set.has(t.paneId)) out[id] = t
  return out
}
