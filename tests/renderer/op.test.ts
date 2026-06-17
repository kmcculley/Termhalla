import { describe, it, expect } from 'vitest'
import { runOp } from '../../src/renderer/op'

describe('runOp', () => {
  it('returns true and never toasts when the op succeeds', async () => {
    const toasts: [string, string][] = []
    const ok = await runOp(() => Promise.resolve(), (t, k) => toasts.push([t, k]), 'Save failed')
    expect(ok).toBe(true)
    expect(toasts).toEqual([])
  })

  it('treats a non-promise return as success', async () => {
    const ok = await runOp(() => 42, () => { throw new Error('should not toast') }, 'x')
    expect(ok).toBe(true)
  })

  it('returns false and toasts the error message on rejection', async () => {
    const toasts: [string, string][] = []
    const ok = await runOp(() => Promise.reject(new Error('ENOENT')), (t, k) => toasts.push([t, k]), 'Save failed')
    expect(ok).toBe(false)
    expect(toasts).toEqual([['Save failed: ENOENT', 'error']])
  })

  it('stringifies non-Error throws', async () => {
    const toasts: [string, string][] = []
    const ok = await runOp(() => { throw 'boom' }, (t, k) => toasts.push([t, k]), 'Nope')
    expect(ok).toBe(false)
    expect(toasts).toEqual([['Nope: boom', 'error']])
  })
})
