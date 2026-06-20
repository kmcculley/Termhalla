import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { coordinateFlush } from '../../src/main/quit-flush'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('coordinateFlush', () => {
  it('resolves "all" once every window confirms', async () => {
    const { confirm, promise } = coordinateFlush(['a', 'b'], 2000)
    confirm('a')
    confirm('b')
    await expect(promise).resolves.toBe('all')
  })

  it('does not resolve until the last window confirms', async () => {
    const { confirm, promise } = coordinateFlush(['a', 'b'], 2000)
    let settled: string | undefined
    void promise.then(r => { settled = r })
    confirm('a')
    await Promise.resolve()
    expect(settled).toBeUndefined()   // still waiting on 'b'
    confirm('b')
    await expect(promise).resolves.toBe('all')
  })

  it('resolves "timeout" when a window never confirms', async () => {
    const { confirm, promise } = coordinateFlush(['a', 'b'], 2000)
    confirm('a')
    vi.advanceTimersByTime(2000)
    await expect(promise).resolves.toBe('timeout')
  })

  it('resolves "all" immediately for an empty window set', async () => {
    const { promise } = coordinateFlush([], 2000)
    await expect(promise).resolves.toBe('all')
  })

  it('ignores duplicate and unknown confirmations', async () => {
    const { confirm, promise } = coordinateFlush(['a'], 2000)
    confirm('a')
    confirm('a')        // duplicate
    confirm('zzz')      // unknown id
    await expect(promise).resolves.toBe('all')
  })

  it('does not fire a late timeout after all confirmed', async () => {
    const { confirm, promise } = coordinateFlush(['a'], 2000)
    confirm('a')
    await expect(promise).resolves.toBe('all')
    // Advancing past the timeout must not change the (already settled) result.
    vi.advanceTimersByTime(5000)
    await expect(promise).resolves.toBe('all')
  })
})
