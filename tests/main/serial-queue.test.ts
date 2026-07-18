import { describe, it, expect } from 'vitest'
import { SerialQueue } from '../../src/main/serial-queue'

const tick = () => new Promise<void>(r => setTimeout(r, 0))

describe('SerialQueue', () => {
  it('runs tasks strictly one at a time, in FIFO order', async () => {
    const q = new SerialQueue()
    const events: string[] = []
    let releaseA!: () => void
    const gateA = new Promise<void>(r => { releaseA = r })

    const a = q.run(async () => { events.push('a:start'); await gateA; events.push('a:end') })
    const b = q.run(async () => { events.push('b:start'); events.push('b:end') })
    await tick()
    // B must not have started while A is still running.
    expect(events).toEqual(['a:start'])
    releaseA()
    await Promise.all([a, b])
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('a rejected task never wedges the chain — later tasks still run', async () => {
    const q = new SerialQueue()
    const failed = q.run(() => Promise.reject(new Error('boom')))
    await expect(failed).rejects.toThrow('boom')   // the rejection reaches ITS caller…
    const ran: string[] = []
    await q.run(async () => { ran.push('next') })  // …but the next task still runs
    expect(ran).toEqual(['next'])
  })

  it('a task enqueued from a sequential for-await loop composes without deadlock', async () => {
    // Mirrors redockAll: `for (const ws of list) await move(ws)` where move() enqueues.
    const q = new SerialQueue()
    const order: number[] = []
    for (const n of [1, 2, 3]) {
      await q.run(async () => { await tick(); order.push(n) })
    }
    expect(order).toEqual([1, 2, 3])
  })

  it("run() resolves with the task's value", async () => {
    const q = new SerialQueue()
    await expect(q.run(async () => 42)).resolves.toBe(42)
  })
})
