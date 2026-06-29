import { describe, it, expect, vi } from 'vitest'
import { createQuickSlice } from '../../src/renderer/store/quick-slice'

/**
 * Feature 0001 — REQ-007 (store action half).
 * `setToastsEnabled(on)` mirrors `setCopyOnSelect`: it sets `quick.toastsEnabled` and triggers
 * the debounced `scheduleQuickSave()`. Headless harness — no `../api` import.
 *
 * RED until TASK-007 adds the action to the quick slice.
 */
function harness(quick: any = {}) {
  let state: any = { quick }
  const set = (fn: any) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  const get = () => state
  const scheduleQuickSave = vi.fn()
  const scheduleAutosave = vi.fn()
  const commitPane = vi.fn()
  const slice = createQuickSlice({ set, get, scheduleQuickSave, scheduleAutosave, commitPane } as any)
  return { slice, get, scheduleQuickSave }
}

describe('quick slice — setToastsEnabled', () => {
  it('TEST-004: setToastsEnabled(true) sets quick.toastsEnabled === true and schedules a save', () => {
    const { slice, get, scheduleQuickSave } = harness()
    expect(typeof (slice as any).setToastsEnabled).toBe('function')
    ;(slice as any).setToastsEnabled(true)
    expect(get().quick.toastsEnabled).toBe(true)
    expect(scheduleQuickSave).toHaveBeenCalledTimes(1)
  })

  it('TEST-005: setToastsEnabled(false) sets quick.toastsEnabled === false and schedules a save', () => {
    const { slice, get, scheduleQuickSave } = harness({ toastsEnabled: true })
    expect(typeof (slice as any).setToastsEnabled).toBe('function')
    ;(slice as any).setToastsEnabled(false)
    expect(get().quick.toastsEnabled).toBe(false)
    expect(scheduleQuickSave).toHaveBeenCalledTimes(1)
  })
})
