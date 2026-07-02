// Hardening suite — OrkyRegistry persist-first mutations + statusByRoot pruning.
//
// (1) Persist-first (never-throws contract): `addRoot`/`removeRoot` previously mutated
// `this.persistedRoots` in memory BEFORE `await store.save(...)`, so a save rejection (disk full /
// EPERM) left memory diverged from disk AND propagated a rejection through register-registry.ts to the
// renderer — contradicting the documented "NEVER throws; on failure the list is left unchanged"
// contract. Now the next list is saved FIRST; a rejected save resolves to a structured `{ok:false}`
// with memory unchanged, and a later retry of the same root starts clean.
//
// (2) statusByRoot pruning: the engine-emit subscription `set`s an entry per root but nothing ever
// deleted it — unbounded growth over a long session. Entries are pruned when a root leaves BOTH
// membership sources (removeRoot with no pane on it; last pane detaching from a non-persisted root).
// The private map is read directly at runtime, mirroring the frozen OSC suite's precedent of reading
// a private-in-TypeScript-only field (tests/main/orky-osc-parser.test.ts's `buf`).
//
// Mirrors tests/main/orky-registry-service.test.ts's fixture techniques (temp `.orky/` projects, a
// real OrkyRootEngine, waitFor, cleanups) WITHOUT editing that frozen file; the store is a stub whose
// `save` can be made to reject on demand (the on-disk store itself is exercised by the frozen suite).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'
import { OrkyRegistry } from '../../src/main/orky/orky-registry'
import type { OrkyRegistryStore } from '../../src/main/persistence/orky-registry-store'

const NOW = 1_700_000_000_000

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  return new Promise((res, rej) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (pred()) { clearInterval(i); res() }
      else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')) }
    }, 25)
  })
}

function seedOrkyProject(slug = 'demo'): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-reghard-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.orky', 'features', slug), { recursive: true })
  writeFileSync(join(root, '.orky', 'features', slug, 'state.json'),
    JSON.stringify({ feature: slug, phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] }), 'utf8')
  return root
}

/** In-memory stand-in for OrkyRegistryStore whose save can be made to reject once, on demand. */
class StubStore {
  failNextSave = false
  saved: string[][] = []
  async load(): Promise<string[]> { return [] }
  async save(roots: string[]): Promise<void> {
    if (this.failNextSave) { this.failNextSave = false; throw new Error('ENOSPC: no space left on device (stub)') }
    this.saved.push([...roots])
  }
}

function makeRegistry(): { engine: OrkyRootEngine; store: StubStore; registry: OrkyRegistry } {
  const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
  const store = new StubStore()
  const registry = new OrkyRegistry(engine, store as unknown as OrkyRegistryStore)
  cleanups.push(() => { registry.dispose(); engine.dispose() })
  return { engine, store, registry }
}

const statusMap = (registry: OrkyRegistry): Map<string, unknown> =>
  (registry as unknown as { statusByRoot: Map<string, unknown> }).statusByRoot

describe('OrkyRegistry — persist-first addRoot (a save rejection never throws, never diverges memory from disk)', () => {
  it('a rejected store.save makes addRoot RESOLVE ok:false with roots() unchanged and no consumer registered', async () => {
    const z = seedOrkyProject('z')
    const { engine, store, registry } = makeRegistry()
    await registry.init()

    store.failNextSave = true
    const result = await registry.addRoot(z) // resolves — never rejects through the IPC registrar
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/persist/)
    expect(result.roots).toEqual([])
    expect(registry.roots()).toEqual([])                              // memory unchanged
    expect(engine.getConsumers(join(z, '.orky')).size).toBe(0)        // never began tracking
    expect((registry.current() as Array<{ root: string }>).some(e => e.root === z)).toBe(false)
  })

  it('a subsequent addRoot of the SAME root actually retries (no poisoned in-memory state)', async () => {
    const z = seedOrkyProject('z')
    const { store, registry } = makeRegistry()
    await registry.init()

    store.failNextSave = true
    await registry.addRoot(z)
    const retry = await registry.addRoot(z) // the failed add left no phantom membership → real retry
    expect(retry.ok).toBe(true)
    expect(registry.roots()).toEqual([z])
    expect(store.saved.at(-1)).toEqual([z]) // and this time the store really holds it
    await waitFor(() => (registry.current() as unknown[]).length === 1)
  })
})

describe('OrkyRegistry — persist-first removeRoot (the root SURVIVES a failed save, then a retry removes it)', () => {
  it('a rejected store.save makes removeRoot RESOLVE ok:false with the root still a live member', async () => {
    const z = seedOrkyProject('z')
    const { engine, store, registry } = makeRegistry()
    await registry.init()
    await registry.addRoot(z)
    await waitFor(() => (registry.current() as unknown[]).length === 1)

    store.failNextSave = true
    const result = await registry.removeRoot(z)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/persist/)
    expect(registry.roots()).toEqual([z])                              // memory unchanged — root survives
    expect(engine.getConsumers(join(z, '.orky')).size).toBe(1)         // still watched
    expect((registry.current() as Array<{ root: string }>).some(e => e.root === z)).toBe(true)

    const retry = await registry.removeRoot(z)
    expect(retry.ok).toBe(true)
    expect(registry.roots()).toEqual([])
    expect(store.saved.at(-1)).toEqual([])
  })
})

describe('OrkyRegistry — statusByRoot pruning (no unbounded growth across a long session)', () => {
  it('removeRoot with no pane on the root drops its statusByRoot entry', async () => {
    const z = seedOrkyProject('z')
    const { registry } = makeRegistry()
    await registry.init()
    await registry.addRoot(z)
    await waitFor(() => statusMap(registry).has(z)) // the engine emit landed an entry

    await registry.removeRoot(z)
    expect(statusMap(registry).has(z)).toBe(false)
  })

  it('the last pane detaching from a NON-persisted root drops its entry; a persisted root keeps it', async () => {
    const y = seedOrkyProject('y')
    const z = seedOrkyProject('z')
    const { registry } = makeRegistry()
    await registry.init()
    registry.trackPaneRoot('p1', y)
    await registry.addRoot(z)
    registry.trackPaneRoot('p2', z)
    await waitFor(() => statusMap(registry).has(y) && statusMap(registry).has(z))

    registry.trackPaneRoot('p1', null) // pane-only root y loses its last pane
    expect(statusMap(registry).has(y)).toBe(false)

    registry.trackPaneRoot('p2', null) // z is still persisted → its status survives the pane detach
    expect(statusMap(registry).has(z)).toBe(true)
    expect((registry.current() as Array<{ root: string; status: unknown }>).find(e => e.root === z)?.status).not.toBeNull()
  })

  it('removeRoot while a pane is STILL open keeps the surviving pane entry\'s status (not blanked)', async () => {
    const x = seedOrkyProject('x')
    const { registry } = makeRegistry()
    await registry.init()
    await registry.addRoot(x)
    registry.trackPaneRoot('p1', x)
    await waitFor(() => (registry.current() as Array<{ source: string }>).some(e => e.source === 'both'))

    await registry.removeRoot(x)
    expect(statusMap(registry).has(x)).toBe(true) // still a pane member → status preserved
    const entry = (registry.current() as Array<{ root: string; source: string; status: unknown }>).find(e => e.root === x)
    expect(entry?.source).toBe('pane')
    expect(entry?.status).not.toBeNull()
  })
})
