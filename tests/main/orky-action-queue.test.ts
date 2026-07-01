// FROZEN unit suite — feature 0007-orky-action-dispatch (phase 4 / TASK-007, REQ-015).
// Targets `src/main/orky/orky-action-queue.ts` — the per-featureDir mutation-serialization queue, the
// moral equivalent of `OrkyRegistry.exclusive()` (see src/main/orky/orky-registry.ts's private
// `exclusive<T>()`) generalized to a `Map<featureDir, Promise<unknown>>` keyed chain so UNRELATED feature
// dirs never serialize against each other (REQ-015).
//
// Chosen contract:
//   class OrkyActionQueue {
//     run<T>(featureDir: string, fn: () => Promise<T>): Promise<T>
//     size(): number   // number of keys with an ACTIVE (in-flight) chain — test-only introspection,
//                       // mirrors OrkyRootEngine.getConsumers()'s precedent for asserting CONV-011 pruning
//   }
//
// Runs RED today: `src/main/orky/orky-action-queue.ts` does not exist yet (module-not-found).
import { describe, it, expect } from 'vitest'
import { OrkyActionQueue } from '../../src/main/orky/orky-action-queue'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('OrkyActionQueue.run — same key serializes (REQ-015)', () => {
  it('TEST-224 REQ-015 two calls on the SAME featureDir run strictly sequentially: the second never starts until the first resolves', async () => {
    const q = new OrkyActionQueue()
    const order: string[] = []
    const d1 = deferred<void>()
    const p1 = q.run('C:/f1', async () => { order.push('1-start'); await d1.promise; order.push('1-end') })
    const p2 = q.run('C:/f1', async () => { order.push('2-start'); order.push('2-end') })
    await new Promise(r => setTimeout(r, 20))
    expect(order).toEqual(['1-start']) // call 2 has NOT started yet — it is queued behind call 1
    d1.resolve()
    await Promise.all([p1, p2])
    expect(order).toEqual(['1-start', '1-end', '2-start', '2-end'])
  })

  it('TEST-225 REQ-015 run() resolves/rejects with the SAME value/error as the wrapped fn (pass-through)', async () => {
    const q = new OrkyActionQueue()
    await expect(q.run('C:/f1', async () => 42)).resolves.toBe(42)
    await expect(q.run('C:/f1', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })

  it('TEST-226 REQ-015 a REJECTING call on a key never poisons the NEXT queued call on the same key', async () => {
    const q = new OrkyActionQueue()
    const first = q.run('C:/f1', async () => { throw new Error('first fails') })
    const second = q.run('C:/f1', async () => 'second succeeds')
    await expect(first).rejects.toThrow('first fails')
    await expect(second).resolves.toBe('second succeeds')
  })
})

describe('OrkyActionQueue.run — different keys never serialize against each other (REQ-015)', () => {
  it('TEST-227 REQ-015 two calls on DIFFERENT featureDirs overlap in time: the second key\'s fn starts BEFORE the first key\'s fn resolves', async () => {
    const q = new OrkyActionQueue()
    const order: string[] = []
    const d1 = deferred<void>()
    const p1 = q.run('C:/f1', async () => { order.push('f1-start'); await d1.promise; order.push('f1-end') })
    const p2 = q.run('C:/f2', async () => { order.push('f2-start'); order.push('f2-end') })
    await p2
    expect(order).toEqual(['f1-start', 'f2-start', 'f2-end']) // f2 completed WITHOUT waiting on f1
    d1.resolve()
    await p1
  })
})

describe('OrkyActionQueue.size() — prunes settled keys (CONV-011 spirit, applied to a queue)', () => {
  it('TEST-228 REQ-015 size() is 0 before any call, grows while a call for a NEW key is in-flight, and prunes back to 0 once it settles', async () => {
    const q = new OrkyActionQueue()
    expect(q.size()).toBe(0)
    const d1 = deferred<void>()
    const p1 = q.run('C:/f1', async () => { await d1.promise })
    await new Promise(r => setTimeout(r, 10))
    expect(q.size()).toBe(1)
    d1.resolve()
    await p1
    await new Promise(r => setTimeout(r, 10))
    expect(q.size()).toBe(0) // pruned — does not grow unbounded for the life of the queue
  })
})
