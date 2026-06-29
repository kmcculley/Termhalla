import { describe, it, expect } from 'vitest'
import { createToastsSlice } from '../src/renderer/store/toasts-slice'

/**
 * Feature 0001 — REQ-005 (success/info toasts default OFF) / REQ-006 (single kind-branched
 * chokepoint + MAX_TOASTS cap) / REQ-010 (error toasts are NEVER suppressed by the preference).
 *
 * RECONCILIATION NOTE (TASK-010, CONV-003): this suite previously seeded `{ toasts: [] }` with
 * NO `quick`, asserting that `pushToast` always renders. REQ-005 deliberately changes that —
 * `success`/`info` toasts now render only when `quick.toastsEnabled === true`. The render/cap
 * behaviors below are therefore re-seeded with `{ quick: { toastsEnabled: true } }` (their intent
 * is to exercise rendering), and explicit default-OFF / disabled assertions are added.
 *
 * ITERATION-1 AMENDMENT (ESC-001 / REQ-010): the disable preference must NOT suppress `error`-kind
 * toasts (the editor "Save failed" signal). The gate branches on `kind` — `success`/`info` drop
 * when disabled, but `error` always enqueues. Accordingly:
 *   - TEST-010 was changed: it previously called `pushToast('Nope', 'error')` and asserted
 *     suppression. Under REQ-010 that is now WRONG (error must bypass), so the suppression test was
 *     re-scoped to `info`/`success` ONLY. See TEST-019/TEST-020 for the error-bypass carve-out.
 *
 * The enabled-path tests pass with or without the gate; the default-OFF / disabled tests and the
 * error-bypass tests are RED until TASK-008 gates `pushToast` on `kind`.
 */

// Stand-in store. `quick` defaults to {} so the gate's `quick.toastsEnabled` read is defined and
// the effective state is OFF (matching a fresh install / legacy quick.json).
function harness(quick: any = {}) {
  let state: any = { toasts: [], quick }
  const set = (fn: any) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  const get = () => state
  const slice = createToastsSlice({ set, get } as any)
  return { slice, get }
}
const enabled = () => harness({ toastsEnabled: true })

describe('toasts slice — default OFF for success/info (REQ-005)', () => {
  it('TEST-009: suppresses success/info toasts when toastsEnabled is unset (fresh/legacy => effective OFF)', () => {
    const { slice, get } = harness() // no toastsEnabled
    const id = slice.pushToast('Saved', 'success')
    slice.pushToast('FYI', 'info')
    expect(get().toasts).toHaveLength(0)
    // Default is pinned explicitly as OFF.
    expect(get().quick.toastsEnabled === true).toBe(false)
    // The return-value contract is preserved (still a string id) even when suppressed.
    expect(typeof id).toBe('string')
  })

  it('TEST-010: suppresses success/info toasts when toastsEnabled === false', () => {
    // NOTE (REQ-010): this suppression test must use NON-error kinds only. `error` is exempt from
    // the gate and is covered separately by TEST-019/TEST-020.
    const { slice, get } = harness({ toastsEnabled: false })
    slice.pushToast('Nope', 'info')
    slice.pushToast('Still nope', 'success')
    expect(get().toasts).toHaveLength(0)
  })
})

describe('toasts slice — error carve-out is never suppressed (REQ-010)', () => {
  it('TEST-019: error toasts enqueue even when toastsEnabled is unset AND when false', () => {
    // unset (fresh/legacy) => error still surfaces
    const a = harness()
    const idUnset = a.slice.pushToast('Save failed', 'error')
    expect(a.get().toasts).toHaveLength(1)
    expect(a.get().toasts[0]).toMatchObject({ id: idUnset, text: 'Save failed', kind: 'error' })

    // explicitly disabled => error still surfaces
    const b = harness({ toastsEnabled: false })
    b.slice.pushToast('Write failed', 'error')
    expect(b.get().toasts).toHaveLength(1)
    expect(b.get().toasts.map((t: any) => t.kind)).toEqual(['error'])
  })

  it('TEST-020: in the disabled state, the bypass is keyed on kind === error (info/success enqueue nothing, error enqueues)', () => {
    const { slice, get } = harness({ toastsEnabled: false })
    // Negative control: non-error kinds add nothing.
    slice.pushToast('fyi', 'info')
    slice.pushToast('saved', 'success')
    expect(get().toasts).toHaveLength(0)
    // Only the error toast breaks through the disabled gate.
    slice.pushToast('boom', 'error')
    expect(get().toasts).toHaveLength(1)
    expect(get().toasts[0]).toMatchObject({ text: 'boom', kind: 'error' })
  })
})

describe('toasts slice — enabled (REQ-006 single chokepoint)', () => {
  it('TEST-011: when enabled, every kind surfaces a toast through the one pushToast gate', () => {
    const { slice, get } = enabled()
    const id = slice.pushToast('Saved', 'success')
    slice.pushToast('Boom', 'error')
    slice.pushToast('FYI', 'info')
    expect(get().toasts).toHaveLength(3)
    expect(get().toasts[0]).toMatchObject({ id, text: 'Saved', kind: 'success' })
    expect(get().toasts.map((t: any) => t.kind)).toEqual(['success', 'error', 'info'])
  })

  it('TEST-012: when enabled, the stack is capped at the 4 most-recent (MAX_TOASTS)', () => {
    const { slice, get } = enabled()
    for (let i = 0; i < 6; i++) slice.pushToast(`t${i}`)
    expect(get().toasts).toHaveLength(4)
    expect(get().toasts.map((t: any) => t.text)).toEqual(['t2', 't3', 't4', 't5'])
  })

  it('defaults kind to success (preserved behavior, enabled)', () => {
    const { slice, get } = enabled()
    slice.pushToast('Hi')
    expect(get().toasts[0].kind).toBe('success')
  })

  it('dismissToast removes by id (preserved behavior, enabled)', () => {
    const { slice, get } = enabled()
    const id = slice.pushToast('Bye')
    slice.dismissToast(id)
    expect(get().toasts).toHaveLength(0)
  })
})
