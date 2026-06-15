import { describe, it, expect } from 'vitest'
import { toMs, nextRecurringDelay, scheduleLabel, schedulesWithout } from '../../src/shared/schedule'
import type { ScheduledTask } from '../../src/shared/types'

describe('toMs', () => {
  it('converts sec and min', () => {
    expect(toMs(5, 'sec')).toBe(5000)
    expect(toMs(2, 'min')).toBe(120000)
  })
})

describe('nextRecurringDelay', () => {
  it('is the base with rand=0.5, and base ± jitter at the extremes, clamped >= 0', () => {
    expect(nextRecurringDelay(30000, 5000, () => 0.5)).toBe(30000)
    expect(nextRecurringDelay(30000, 5000, () => 1)).toBe(35000)
    expect(nextRecurringDelay(30000, 5000, () => 0)).toBe(25000)
    expect(nextRecurringDelay(1000, 5000, () => 0)).toBe(0)
  })
})

describe('scheduleLabel', () => {
  it('summarizes each trigger', () => {
    expect(scheduleLabel({ kind: 'delay', ms: 30000 })).toContain('30s')
    expect(scheduleLabel({ kind: 'idle' })).toMatch(/idle/i)
    expect(scheduleLabel({ kind: 'recurring', everyMs: 30000, jitterMs: 5000 })).toContain('±')
  })
})

describe('schedulesWithout', () => {
  it('drops tasks whose paneId is in the removed set', () => {
    const s: Record<string, ScheduledTask> = {
      a: { id: 'a', paneId: 'p1', text: 'x', mode: 'keys', enter: true, trigger: { kind: 'idle' }, label: '' },
      b: { id: 'b', paneId: 'p2', text: 'x', mode: 'keys', enter: true, trigger: { kind: 'idle' }, label: '' }
    }
    expect(Object.keys(schedulesWithout(s, ['p1']))).toEqual(['b'])
  })
})
