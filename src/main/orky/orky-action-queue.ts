/**
 * The per-`featureDir` mutation-serialization queue (feature 0007, TASK-007, REQ-015) — the moral
 * equivalent of `OrkyRegistry`'s private `exclusive()`, generalized to a `Map<featureDir,
 * Promise<unknown>>` keyed chain so UNRELATED feature dirs never serialize against each other.
 *
 * Read-only `driveStatus` MUST NOT be routed through this queue — that is enforced at the dispatcher
 * call site (TASK-008), not inside this class (this class has no opinion about which actions are
 * mutating).
 */
export class OrkyActionQueue {
  private chains = new Map<string, Promise<unknown>>()

  /** Looks up (or creates) the promise chain tail for `featureDir`, chains `fn` onto it (`.then(fn,
   *  fn)` so a prior rejection never poisons the next queued call — mirrors `OrkyRegistry.exclusive`'s
   *  own shape), stores the new tail, and PRUNES the map entry once the chain settles back to empty
   *  (so the map does not grow unbounded for the life of the app). */
  run<T>(featureDir: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.chains.get(featureDir) ?? Promise.resolve()
    const result = prior.then(fn, fn) as Promise<T>
    const tail = result.then(() => undefined, () => undefined)
    this.chains.set(featureDir, tail)
    void tail.then(() => {
      if (this.chains.get(featureDir) === tail) this.chains.delete(featureDir)
    })
    return result
  }

  /** Number of keys with an ACTIVE (in-flight) chain — test-only introspection. */
  size(): number {
    return this.chains.size
  }
}
