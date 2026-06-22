import { describe, it, expect, vi } from 'vitest'
import { writeTextReliably, type ClipboardLike } from '../../src/main/clipboard/reliable-clipboard'

const noSleep = () => Promise.resolve()

/** A fake clipboard whose writes "fail" (no-op) for the first `failFor` attempts, simulating a
 *  redirector holding the lock, then start sticking. */
function flakyClipboard(failFor: number): ClipboardLike & { writes: number } {
  let stored = 'INITIAL'
  let writes = 0
  return {
    get writes() { return writes },
    writeText(t: string) { writes++; if (writes > failFor) stored = t /* else lock held: no-op */ },
    readText() { return stored }
  }
}

describe('writeTextReliably', () => {
  it('succeeds on the first try when the clipboard is free', async () => {
    const clip = flakyClipboard(0)
    const sleep = vi.fn(noSleep)
    const ok = await writeTextReliably(clip, 'HELLO', sleep)
    expect(ok).toBe(true)
    expect(clip.writes).toBe(1)
    expect(sleep).not.toHaveBeenCalled()      // no retry needed
    expect(clip.readText()).toBe('HELLO')
  })

  it('retries through transient lock contention and eventually sticks', async () => {
    const clip = flakyClipboard(3)             // first 3 writes are swallowed by the "lock"
    const sleep = vi.fn(noSleep)
    const ok = await writeTextReliably(clip, 'WORLD', sleep)
    expect(ok).toBe(true)
    expect(clip.writes).toBe(4)                // 3 failed + 1 that stuck
    expect(sleep).toHaveBeenCalledTimes(3)     // backoff between the 4 attempts
    expect(clip.readText()).toBe('WORLD')
  })

  it('gives up after the attempt budget when the lock never releases', async () => {
    const clip = flakyClipboard(Infinity)      // permanently locked
    const sleep = vi.fn(noSleep)
    const ok = await writeTextReliably(clip, 'NOPE', sleep, { attempts: 4 })
    expect(ok).toBe(false)
    expect(clip.writes).toBe(4)
    expect(sleep).toHaveBeenCalledTimes(3)      // one fewer than attempts
    expect(clip.readText()).toBe('INITIAL')     // never overwrote
  })

  it('uses a linearly growing backoff', async () => {
    const clip = flakyClipboard(Infinity)
    const delays: number[] = []
    const sleep = (ms: number) => { delays.push(ms); return Promise.resolve() }
    await writeTextReliably(clip, 'x', sleep, { attempts: 4, delayMs: 10 })
    expect(delays).toEqual([10, 20, 30])
  })
})
