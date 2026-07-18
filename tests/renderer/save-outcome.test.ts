// 2026-07-17 whole-project quality audit, Finding 6: the debounced persistence writers
// (autosave / quickSave / notesSave) `void`ed their IPC writes, so a failed disk write was
// silently dropped. Each writer now routes its settle through a save-outcome notifier that
// pushes ONE error toast per failure STREAK (a persistent failure must not toast per keystroke)
// and re-arms after a success so a NEW failure streak toasts again.
//
// Pure, api-free module (store/save-outcome.ts) — the injected-pushToast op.ts pattern.
import { describe, it, expect, vi } from 'vitest'
import { makeSaveOutcome } from '../../src/renderer/store/save-outcome'

describe('makeSaveOutcome (per-writer failure-streak toast gate)', () => {
  it('the first failure pushes exactly one toast carrying the writer text and the error detail', () => {
    const pushError = vi.fn()
    const o = makeSaveOutcome(d => `Saving quick failed: ${d}`, pushError)
    o.failed(new Error('EIO boom'))
    expect(pushError).toHaveBeenCalledTimes(1)
    expect(pushError.mock.calls[0][0]).toBe('Saving quick failed: EIO boom')
  })

  it('repeat failures in the same streak push NO further toast (a failing disk must not toast per keystroke)', () => {
    const pushError = vi.fn()
    const o = makeSaveOutcome(d => `fail: ${d}`, pushError)
    o.failed(new Error('one'))
    o.failed(new Error('two'))
    o.failed(new Error('three'))
    expect(pushError).toHaveBeenCalledTimes(1)
  })

  it('a success re-arms the gate: the NEXT failure streak toasts again', () => {
    const pushError = vi.fn()
    const o = makeSaveOutcome(d => `fail: ${d}`, pushError)
    o.failed(new Error('one'))
    o.succeeded()
    o.failed(new Error('two'))
    expect(pushError).toHaveBeenCalledTimes(2)
    expect(pushError.mock.calls[1][0]).toBe('fail: two')
  })

  it('a success with no prior failure is a no-op; non-Error rejections stringify', () => {
    const pushError = vi.fn()
    const o = makeSaveOutcome(d => `fail: ${d}`, pushError)
    o.succeeded()
    expect(pushError).not.toHaveBeenCalled()
    o.failed('raw-string-reason')
    expect(pushError.mock.calls[0][0]).toBe('fail: raw-string-reason')
  })
})
