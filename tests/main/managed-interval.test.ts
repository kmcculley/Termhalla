import { describe, it, expect, vi, afterEach } from 'vitest'
import { startUnrefedInterval, startUnrefedTimeout } from '../../src/main/managed-interval'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('startUnrefedInterval', () => {
  it('fires on the interval and never again after stop()', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = startUnrefedInterval(fn, 100)
    vi.advanceTimersByTime(350)
    expect(fn).toHaveBeenCalledTimes(3)
    t.stop()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stop() is idempotent', () => {
    vi.useFakeTimers()
    const t = startUnrefedInterval(() => {}, 100)
    t.stop()
    expect(() => t.stop()).not.toThrow()
  })

  it('unrefs the underlying timer so a scheduled poll never keeps the process alive', () => {
    const unref = vi.fn()
    const fake = { unref }
    const si = vi.spyOn(globalThis, 'setInterval').mockReturnValue(fake as never)
    const ci = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
    const t = startUnrefedInterval(() => {}, 100)
    expect(si).toHaveBeenCalledWith(expect.any(Function), 100)
    expect(unref).toHaveBeenCalledTimes(1)
    t.stop()
    expect(ci).toHaveBeenCalledWith(fake)
  })

  it('tolerates a timer handle with no unref (renderer-typed numeric timers)', () => {
    vi.spyOn(globalThis, 'setInterval').mockReturnValue(42 as never)
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
    expect(() => startUnrefedInterval(() => {}, 100).stop()).not.toThrow()
  })
})

describe('startUnrefedTimeout', () => {
  it('fires once after the delay', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    startUnrefedTimeout(fn, 150)
    vi.advanceTimersByTime(149)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('stop() cancels a pending fire', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = startUnrefedTimeout(fn, 150)
    t.stop()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('unrefs the underlying timer', () => {
    const unref = vi.fn()
    const fake = { unref }
    const st = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(fake as never)
    const ct = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
    const t = startUnrefedTimeout(() => {}, 150)
    expect(st).toHaveBeenCalledWith(expect.any(Function), 150)
    expect(unref).toHaveBeenCalledTimes(1)
    t.stop()
    expect(ct).toHaveBeenCalledWith(fake)
  })
})
