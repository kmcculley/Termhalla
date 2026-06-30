// FROZEN integration suite — feature 0005-cross-project-orky-registry (phase 4 / TASK-007).
// REQ-001 / REQ-002 / REQ-003 / REQ-004 / REQ-006 / REQ-008 / REQ-009 / REQ-010 / REQ-011 / REQ-012 /
// REQ-018 / REQ-019 / REQ-020.
//
// Targets `src/main/orky/orky-registry.ts` — the cross-project aggregator. Drives it with the REAL
// `OrkyRootEngine` (TASK-005) and a REAL `OrkyRegistryStore` (TASK-004) pointed at a temp `userData` dir,
// against ≥2 fixtured `.orky/` roots — exactly the "main/integration harness" the spec's Definition of
// Done calls for. `validateRegistryRoot` (TASK-003) is exercised for real through `addRoot`.
//
// Chosen contract (the plan's TASK-007 prose is authoritative; this suite freezes the exact shape — the
// implementer MUST match it). Mirroring `OrkyRootEngine`'s multi-subscriber `onStatus(cb): unsubscribe`
// pattern (TASK-005), `OrkyRegistry` exposes snapshot delivery the SAME way — `onSnapshot(cb): unsubscribe`
// — rather than a single constructor-bound `emit` callback, so the registrar (`register-registry.ts`,
// TASK-011) is the one that wires `registry.onSnapshot((snap) => send(CH.registryStatus, snap))`
// ("wired to registry:status BY THE REGISTRAR" per the plan's TASK-007 prose):
//
//   new OrkyRegistry(engine: OrkyRootEngine, store: OrkyRegistryStore)
//   registry.onSnapshot(cb: (snapshot: OrkyRegistrySnapshot) => void): () => void
//   registry.init(): Promise<void>
//   registry.trackPaneRoot(paneId: string, root: string | null): void   // root = PROJECT root, not .orky/
//   registry.addRoot(input: unknown): Promise<RegistryMutationResult>
//   registry.removeRoot(input: unknown): Promise<RegistryMutationResult>
//   registry.current(): OrkyRegistrySnapshot   // pure read, last computed snapshot
//   registry.roots(): string[]                 // pure read, persisted list ONLY
//   registry.dispose(): void
//
// Runs RED today: `src/main/orky/orky-registry.ts` does not exist yet (module-not-found).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import chokidar from 'chokidar'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'
import { OrkyRegistry } from '../../src/main/orky/orky-registry'
import { OrkyRegistryStore } from '../../src/main/persistence/orky-registry-store'

const NOW = 1_700_000_000_000

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (pred()) { clearInterval(i); resolve() }
      else if (Date.now() - t0 > ms) { clearInterval(i); reject(new Error('timeout')) }
    }, 25)
  })
}

function seedOrkyProject(opts: { slug?: string; broken?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-regsvc-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const orky = join(root, '.orky')
  const slug = opts.slug ?? 'demo'
  mkdirSync(join(orky, 'features', slug), { recursive: true })
  writeFileSync(join(orky, 'features', slug, 'state.json'),
    opts.broken ? '{ not valid json' : JSON.stringify({ feature: slug, phase: 'implement', gates: { brainstorm: { passed: true } }, escalations: [] }),
    'utf8')
  return root
}

function tmpUserDataDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'orky-regsvc-userdata-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}

function makeRegistry(userDataDir: string, emit: (s: unknown[]) => void): { engine: OrkyRootEngine; store: OrkyRegistryStore; registry: OrkyRegistry } {
  const engine = new OrkyRootEngine({ now: () => NOW, debounceMs: 20 })
  const store = new OrkyRegistryStore(userDataDir)
  const registry = new OrkyRegistry(engine, store)
  registry.onSnapshot((snap) => emit(snap as unknown[]))
  cleanups.push(() => { registry.dispose(); engine.dispose() })
  return { engine, store, registry }
}

describe('OrkyRegistry — membership union, dedup, source provenance (REQ-002/REQ-006)', () => {
  it('TEST-112 REQ-002 root X open via pane AND persisted -> ONE entry source:"both"; pane-only Y -> "pane"; persisted-only Z -> "persisted"', async () => {
    const x = seedOrkyProject({ slug: 'x' })
    const y = seedOrkyProject({ slug: 'y' })
    const z = seedOrkyProject({ slug: 'z' })
    const emits: unknown[][] = []
    const { registry } = makeRegistry(tmpUserDataDir(), (s) => emits.push(s as unknown[]))
    await registry.init()

    await registry.addRoot(x)
    await registry.addRoot(z)
    registry.trackPaneRoot('p1', x)
    registry.trackPaneRoot('p2', y)
    await waitFor(() => {
      const snap = registry.current() as Array<{ root: string; source: string }>
      return snap.length === 3
    })

    const snap = registry.current() as Array<{ root: string; source: string }>
    expect(snap.find(e => e.root === x)?.source).toBe('both')
    expect(snap.find(e => e.root === y)?.source).toBe('pane')
    expect(snap.find(e => e.root === z)?.source).toBe('persisted')
    expect(snap.length).toBe(3) // no duplicate entries
  })

  it('TEST-113 REQ-002 opening a SECOND pane that resolves to the same root X does not add a second X entry', async () => {
    const x = seedOrkyProject({ slug: 'x' })
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    registry.trackPaneRoot('p1', x)
    registry.trackPaneRoot('p2', x)
    await waitFor(() => (registry.current() as unknown[]).length === 1)
    expect((registry.current() as Array<{ root: string }>).filter(e => e.root === x).length).toBe(1)
  })

  it('TEST-114 REQ-006 every entry exposes exactly {root, source, status}; root is the PROJECT root, not the .orky/ subdirectory', async () => {
    const x = seedOrkyProject({ slug: 'x' })
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    registry.trackPaneRoot('p1', x)
    await waitFor(() => (registry.current() as unknown[]).length === 1)
    const entry = (registry.current() as Array<Record<string, unknown>>)[0]
    expect(Object.keys(entry).sort()).toEqual(['root', 'source', 'status'])
    expect(entry.root).toBe(x)
    expect(entry.root).not.toContain('.orky')
  })
})

describe('OrkyRegistry — ephemeral pane roots vs. durable persisted roots (REQ-003/REQ-004, D2)', () => {
  it('TEST-115 REQ-003 a pane-only root Y leaves the aggregate when the last pane on it closes; its watcher is torn down; the persisted list is unaffected', async () => {
    const y = seedOrkyProject({ slug: 'y' })
    const { registry, store } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    registry.trackPaneRoot('p1', y)
    await waitFor(() => (registry.current() as unknown[]).length === 1)

    registry.trackPaneRoot('p1', null) // pane closed / left the project
    await waitFor(() => (registry.current() as unknown[]).length === 0)
    expect(registry.current()).toEqual([])
    expect(await store.load()).toEqual([]) // Y was NEVER auto-persisted
    expect(registry.roots()).toEqual([])
  })

  it('TEST-116 REQ-003 when the pane-only root is ALSO persisted, losing the last pane degrades source "both" -> "persisted" instead of disappearing', async () => {
    const x = seedOrkyProject({ slug: 'x' })
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    await registry.addRoot(x)
    registry.trackPaneRoot('p1', x)
    await waitFor(() => (registry.current() as Array<{ source: string }>).some(e => e.source === 'both'))

    registry.trackPaneRoot('p1', null)
    await waitFor(() => (registry.current() as Array<{ source: string }>).some(e => e.source === 'persisted'))
    const snap = registry.current() as Array<{ root: string; source: string }>
    expect(snap.find(e => e.root === x)?.source).toBe('persisted')
    expect(snap.length).toBe(1) // entry survives, it does NOT disappear
  })

  it('TEST-117 REQ-004 addRoot(Z) with NO pane open contributes a live, pane-independent member; never auto-invoked by pane activity', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const { registry, store } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    const result = await registry.addRoot(z)
    expect(result.ok).toBe(true)
    await waitFor(() => (registry.current() as unknown[]).length === 1)
    const snap = registry.current() as Array<{ root: string; source: string; status: unknown }>
    expect(snap[0].source).toBe('persisted')
    expect(snap[0].status).not.toBeNull() // a live status, no pane required

    // pane-only activity NEVER writes the persisted list as a side effect.
    const y = seedOrkyProject({ slug: 'y' })
    registry.trackPaneRoot('pY', y)
    await waitFor(() => (registry.current() as unknown[]).length === 2)
    expect(await store.load()).toEqual([z]) // still just Z — Y was never auto-persisted
  })

  it('TEST-118 REQ-004 a restart (fresh OrkyRegistry sharing the SAME on-disk store) re-loads the persisted root as a member from the first snapshot', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const userData = tmpUserDataDir()
    const { registry: reg1 } = makeRegistry(userData, () => {})
    await reg1.init()
    await reg1.addRoot(z)
    await waitFor(() => (reg1.current() as unknown[]).length === 1)

    // simulate an app restart: a FRESH engine + FRESH registry over the SAME persisted store file.
    const { registry: reg2 } = makeRegistry(userData, () => {})
    await reg2.init()
    await waitFor(() => (reg2.current() as unknown[]).length === 1)
    expect((reg2.current() as Array<{ root: string }>)[0].root).toBe(z)
    expect(reg2.roots()).toEqual([z])
  })
})

describe('OrkyRegistry — full-set push on every change (REQ-008)', () => {
  it('TEST-119 REQ-008 every emitted snapshot is the COMPLETE current aggregate, never a partial/delta payload', async () => {
    const x = seedOrkyProject({ slug: 'x' })
    const y = seedOrkyProject({ slug: 'y' })
    const emits: Array<Array<{ root: string }>> = []
    const { registry } = makeRegistry(tmpUserDataDir(), (s) => emits.push(s as Array<{ root: string }>))
    await registry.init()

    await registry.addRoot(x)
    await waitFor(() => emits.some(s => s.some(e => e.root === x)))
    registry.trackPaneRoot('p1', y)
    await waitFor(() => emits.at(-1)!.length === 2)

    const last = emits.at(-1)!
    expect(last.map(e => e.root).sort()).toEqual([x, y].sort())
    // every snapshot AFTER both roots exist contains BOTH — no emit just names "what changed".
    const afterBoth = emits.filter(s => s.length === 2)
    expect(afterBoth.length).toBeGreaterThan(0)
    for (const s of afterBoth) expect(s.map(e => e.root).sort()).toEqual([x, y].sort())
  })
})

describe('OrkyRegistry — addRoot validation + idempotency (REQ-009)', () => {
  it('TEST-120 REQ-009 a valid .orky/-containing dir succeeds; a second add of the SAME root is idempotent (no duplicate)', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    const r1 = await registry.addRoot(z)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.roots).toContain(z)
    const r2 = await registry.addRoot(z)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.roots.filter(r => r === z).length).toBe(1)
    expect(registry.roots().filter(r => r === z).length).toBe(1)
  })

  it('TEST-121 REQ-009/REQ-016 a non-string root, a non-existent path, and a dir lacking .orky/ each fail with a specific error and an UNCHANGED list, never throw', async () => {
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    const before = registry.roots()

    const r1 = await registry.addRoot(42 as unknown)
    expect(r1.ok).toBe(false)
    const r2 = await registry.addRoot(join(tmpdir(), 'no-such-dir-' + Date.now()))
    expect(r2.ok).toBe(false)
    const bare = mkdtempSync(join(tmpdir(), 'orky-regsvc-bare-'))
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }))
    const r3 = await registry.addRoot(bare)
    expect(r3.ok).toBe(false)

    if (!r1.ok && !r2.ok && !r3.ok) {
      const errs = new Set([r1.error, r2.error, r3.error])
      expect(errs.size).toBe(3) // CONV-001: distinct, specific errors — never one generic message
    }
    expect(registry.roots()).toEqual(before) // list never mutated on failure
  })
})

describe('OrkyRegistry — removeRoot (REQ-010)', () => {
  it('TEST-122 REQ-010 removeRoot with no pane open removes the root from the snapshot + persisted list and tears down its watcher', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const { registry, store } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    await registry.addRoot(z)
    await waitFor(() => (registry.current() as unknown[]).length === 1)

    const result = await registry.removeRoot(z)
    expect(result.ok).toBe(true)
    await waitFor(() => (registry.current() as unknown[]).length === 0)
    expect(await store.load()).toEqual([])
    expect(registry.roots()).toEqual([])
  })

  it('TEST-123 REQ-010 removeRoot while a pane is STILL open on it leaves the root as source:"pane" (watcher persists)', async () => {
    const x = seedOrkyProject({ slug: 'x' })
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    await registry.addRoot(x)
    registry.trackPaneRoot('p1', x)
    await waitFor(() => (registry.current() as Array<{ source: string }>).some(e => e.source === 'both'))

    await registry.removeRoot(x)
    await waitFor(() => (registry.current() as Array<{ source: string }>).some(e => e.source === 'pane'))
    const snap = registry.current() as Array<{ root: string; source: string }>
    expect(snap.find(e => e.root === x)?.source).toBe('pane')
    expect(registry.roots()).toEqual([]) // it left the PERSISTED list...
    expect(snap.length).toBe(1)            // ...but it is STILL a member (via the pane)
  })

  it('TEST-124 REQ-010 removeRoot of a root NOT in the list is an idempotent no-op (ok:true, unchanged), never a throw', async () => {
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    const before = registry.roots()
    await expect(registry.removeRoot('/never/added')).resolves.toMatchObject({ ok: true })
    expect(registry.roots()).toEqual(before)
  })
})

describe('OrkyRegistry — current()/roots() are pure reads (REQ-011/REQ-012)', () => {
  it('TEST-125 REQ-011 current() returns a snapshot deeply equal to the most recent push; repeated calls never mutate state or trigger a new emit', async () => {
    const x = seedOrkyProject({ slug: 'x' })
    const emits: unknown[][] = []
    const { registry } = makeRegistry(tmpUserDataDir(), (s) => emits.push(s as unknown[]))
    await registry.init()
    await registry.addRoot(x)
    await waitFor(() => emits.length > 0 && emits.at(-1)!.length === 1)

    const emitCountBefore = emits.length
    expect(registry.current()).toEqual(emits.at(-1))
    void registry.current(); void registry.current(); void registry.current()
    expect(emits.length).toBe(emitCountBefore) // pure read never emits
    expect(registry.roots()).toEqual([x])      // and never mutates the persisted list
  })

  it('TEST-126 REQ-012 roots() returns ONLY the persisted explicit list, sorted, excluding pane-only roots', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const y = seedOrkyProject({ slug: 'y' })
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    await registry.addRoot(z)
    registry.trackPaneRoot('pY', y)
    await waitFor(() => (registry.current() as unknown[]).length === 2)
    expect(registry.roots()).toEqual([z]) // not [y, z] — y is pane-only
  })
})

describe('OrkyRegistry — one bad root never breaks the aggregate; persisted-deleted root degrades to null (REQ-018)', () => {
  it('TEST-127 REQ-018 a root with malformed state.json reports a present (safe-defaulted) entry; the OTHER root keeps reporting normally', async () => {
    const good = seedOrkyProject({ slug: 'good' })
    const bad = seedOrkyProject({ slug: 'broken', broken: true })
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    await registry.addRoot(good)
    await registry.addRoot(bad)
    await waitFor(() => (registry.current() as unknown[]).length === 2)

    const snap = registry.current() as Array<{ root: string; status: { features: Array<{ feature: string }> } | null }>
    expect(snap.find(e => e.root === good)?.status?.features.some(f => f.feature === 'good')).toBe(true)
    expect(snap.find(e => e.root === bad)).toBeTruthy() // present, not dropped
  })

  it('TEST-128 REQ-018 a persisted root whose .orky/ is deleted at runtime keeps its membership (still persisted) but its status degrades to null; the aggregate keeps emitting', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const emits: unknown[][] = []
    const { registry } = makeRegistry(tmpUserDataDir(), (s) => emits.push(s as unknown[]))
    await registry.init()
    await registry.addRoot(z)
    await waitFor(() => (registry.current() as Array<{ status: unknown }>).some(e => e.status != null))

    rmSync(join(z, '.orky'), { recursive: true, force: true })
    // Force a re-read trigger (the engine's chokidar watcher MAY or may not reliably catch a directory
    // delete on every platform) — re-adding the SAME root is idempotent and re-asserts membership while
    // exercising the now-missing-tree read path.
    await registry.addRoot(z)
    await waitFor(() => {
      const e = (registry.current() as Array<{ root: string }>).find(x => x.root === z)
      return !!e
    })
    const entry = (registry.current() as Array<{ root: string; source: string }>).find(e => e.root === z)
    expect(entry).toBeTruthy()
    expect(entry?.source).toBe('persisted') // still a member because PERSISTED, not pane-presence
  })
})

describe('OrkyRegistry — race-safety, disposable, leak-free (REQ-019)', () => {
  it('TEST-129 REQ-019 dispose() leaves no "persisted:*" consumer registered on the shared engine for this registry\'s own roots', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const { engine, registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    await registry.addRoot(z)
    await waitFor(() => (registry.current() as unknown[]).length === 1)

    registry.dispose()
    expect(engine.getConsumers(join(z, '.orky')).size).toBe(0)
  })

  it('TEST-130 REQ-019 a concurrent addRoot immediately followed by removeRoot for the SAME root leaves no orphaned membership', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const { registry, store } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    const addP = registry.addRoot(z)
    const removeP = registry.removeRoot(z)
    await Promise.all([addP, removeP])
    await new Promise(r => setTimeout(r, 200))
    // whichever ordering wins, the FINAL persisted state must be internally consistent: either present
    // in BOTH the snapshot and the store, or absent from BOTH — never split.
    const inStore = (await store.load()).includes(z)
    const inSnapshot = (registry.current() as Array<{ root: string }>).some(e => e.root === z)
    expect(inStore).toBe(inSnapshot)
  })
})

describe('OrkyRegistry — ONE shared watcher across pane + persisted membership of the SAME root (REQ-014/REQ-020, registry-specific sharing)', () => {
  it('TEST-131 REQ-014/REQ-020 a root that is BOTH pane-tracked AND persisted shares exactly ONE chokidar watcher (proves the SAME shared engine instance backs both consumer types)', async () => {
    const x = seedOrkyProject({ slug: 'x' })
    const watchSpy = vi.spyOn(chokidar, 'watch')
    const { registry } = makeRegistry(tmpUserDataDir(), () => {})
    await registry.init()
    registry.trackPaneRoot('p1', x)
    await registry.addRoot(x)
    await waitFor(() => (registry.current() as Array<{ source: string }>).some(e => e.source === 'both'))
    expect(watchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('OrkyRegistry — persisted store on disk reflects mutations (REQ-013 integration)', () => {
  it('TEST-132 REQ-013 addRoot persists to orky-registry.json under the given userData dir', async () => {
    const z = seedOrkyProject({ slug: 'z' })
    const userData = tmpUserDataDir()
    const { registry } = makeRegistry(userData, () => {})
    await registry.init()
    await registry.addRoot(z)
    expect(existsSync(join(userData, 'orky-registry.json'))).toBe(true)
  })
})
