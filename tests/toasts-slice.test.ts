import { describe, it, expect } from 'vitest'
import { createToastsSlice } from '../src/renderer/store/toasts-slice'

// Minimal harness: a stand-in store whose state the slice mutates via set/get.
function harness() {
  let state: any = { toasts: [] }
  const set = (fn: any) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  const get = () => state
  const slice = createToastsSlice({ set, get } as any)
  return { slice, get }
}

describe('toasts slice', () => {
  it('pushToast appends a toast and returns its id', () => {
    const { slice, get } = harness()
    const id = slice.pushToast('Saved', 'success')
    expect(typeof id).toBe('string')
    expect(get().toasts).toHaveLength(1)
    expect(get().toasts[0]).toMatchObject({ id, text: 'Saved', kind: 'success' })
  })

  it('defaults kind to success', () => {
    const { slice, get } = harness()
    slice.pushToast('Hi')
    expect(get().toasts[0].kind).toBe('success')
  })

  it('dismissToast removes by id', () => {
    const { slice, get } = harness()
    const id = slice.pushToast('Bye')
    slice.dismissToast(id)
    expect(get().toasts).toHaveLength(0)
  })

  it('caps the stack at the 4 most-recent', () => {
    const { slice, get } = harness()
    for (let i = 0; i < 6; i++) slice.pushToast(`t${i}`)
    expect(get().toasts).toHaveLength(4)
    expect(get().toasts.map((t: any) => t.text)).toEqual(['t2', 't3', 't4', 't5'])
  })
})
