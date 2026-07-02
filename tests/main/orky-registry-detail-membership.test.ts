// FROZEN integration suite — feature 0009-native-orky-pane (phase 4 / TASK-006 + TASK-007).
// REQ-006 (member-roots-ONLY validation on the detail read — the channel can never read arbitrary
// filesystem paths) + REQ-008/REQ-013 (the detail read adds NO engine consumer/watcher and leaves
// the tree byte-identical) + REQ-022 (OrkyRegistry.onRootChanged fires per COMPLETED engine re-read
// — including the null-status vanish emit and roll-up-invisible edits — with the case-preserved
// project-root string). Drives the REAL OrkyRegistry + OrkyRootEngine + OrkyRegistryStore against
// temp fixtures (the tests/main/orky-registry-service.test.ts harness pattern).
//
// Chosen contract (see tests/main/register-registry-detail.test.ts):
//   registry.detail(root: unknown): Promise<OrkyRootDetailResult>   // membership-gated, never throws
//   registry.onRootChanged(cb: (root: string) => void): () => void  // rides the EXISTING engine.onStatus sub
//
// Runs RED today: OrkyRegistry has neither `detail` nor `onRootChanged`.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrkyRootEngine } from '../../src/main/orky/orky-root-engine'
import { OrkyRegistry } from '../../src/main/orky/orky-registry'
import { OrkyRegistryStore } from '../../src/main/persistence/orky-registry-store'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  return new Promise((res, rej) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (pred()) { clearInterval(i); res() }
      else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')) }
    }, 25)
  })
}

function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'orky-detmem-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, '.orky', 'features', 'demo-feat')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    feature: 'demo-feat', phase: 'implement',
    gates: { brainstorm: { passed: true, at: '2026-06-30T00:00:00.000Z' } }, escalations: []
  }), 'utf8')
  writeFileSync(join(dir, 'findings.json'), JSON.stringify([{ lens: 'x', claim: 'c', severity: 'MEDIUM', status: 'open', id: 'F-1' }]), 'utf8')
  return root
}

function makeRegistry(): { engine: OrkyRootEngine; registry: OrkyRegistry } {
  const userData = mkdtempSync(join(tmpdir(), 'orky-detmem-ud-'))
  cleanups.push(() => rmSync(userData, { recursive: true, force: true }))
  const engine = new OrkyRootEngine({ now: () => Date.now(), debounceMs: 20 })
  const registry = new OrkyRegistry(engine, new OrkyRegistryStore(userData))
  cleanups.push(() => { registry.dispose(); engine.dispose() })
  return { engine, registry }
}

function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) Object.assign(out, snapshotTree(p))
    else out[p] = readFileSync(p, 'utf8')
  }
  return out
}

describe('registry.detail — member roots only (REQ-006)', () => {
  it('TEST-415 REQ-006 a current aggregate member returns ok:true with the real payload', async () => {
    const root = seedProject()
    const { registry } = makeRegistry()
    await registry.init()
    await registry.addRoot(root)
    const res = await registry.detail(root)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.features.map(f => f.status.feature)).toEqual(['demo-feat'])
    expect(res.features[0].findings).toHaveLength(1)
  })

  it('TEST-416 REQ-006 a non-member path and a non-string both return ok:false root-not-tracked with an error NAMING the input — never a throw, never an arbitrary-path read', async () => {
    const root = seedProject()
    const stranger = seedProject() // a real .orky/ project that is NOT tracked — must still be refused
    const { registry } = makeRegistry()
    await registry.init()
    await registry.addRoot(root)

    const notTracked = await registry.detail(stranger)
    expect(notTracked.ok).toBe(false)
    if (notTracked.ok) return
    expect(notTracked.errorKind).toBe('root-not-tracked')
    expect(notTracked.error).toContain(stranger) // CONV-001: names the rejected input

    const nonString = await registry.detail(42 as never)
    expect(nonString.ok).toBe(false)
    if (nonString.ok) return
    expect(nonString.errorKind).toBe('root-not-tracked')
    expect(nonString.error).toContain('42')
  })

  it('TEST-417 REQ-006 membership is matched by NORMALIZED key: a slash-divergent (and, on win32, case-divergent) spelling of a member root is accepted', async () => {
    const root = seedProject()
    const { registry } = makeRegistry()
    await registry.init()
    await registry.addRoot(root)
    const slashVariant = root.replace(/\\/g, '/')
    const viaSlash = await registry.detail(slashVariant)
    expect(viaSlash.ok).toBe(true)
    if (process.platform === 'win32') {
      const viaCase = await registry.detail(root.toUpperCase())
      expect(viaCase.ok).toBe(true)
    }
  })

  it('TEST-418 REQ-008 REQ-013 the detail read adds NO engine consumer, leaves the tree byte-identical, and a deleted .orky/ on a still-tracked root returns orky-missing naming the path', async () => {
    const root = seedProject()
    const orkyDir = join(root, '.orky')
    const { engine, registry } = makeRegistry()
    await registry.init()
    await registry.addRoot(root)

    const consumersBefore = [...engine.getConsumers(orkyDir)]
    const treeBefore = snapshotTree(orkyDir)
    const res = await registry.detail(root)
    expect(res.ok).toBe(true)
    expect([...engine.getConsumers(orkyDir)]).toEqual(consumersBefore) // one-shot: no consumer registered
    expect(snapshotTree(orkyDir)).toEqual(treeBefore)                  // read-only: byte-identical

    rmSync(orkyDir, { recursive: true, force: true })
    const missing = await registry.detail(root) // persisted → still a member (REQ-011's unreadable state upstream)
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.errorKind).toBe('orky-missing')
    expect(missing.error).toContain('.orky')
  })
})

describe('registry.onRootChanged — per completed re-read, no delta gating (REQ-022)', () => {
  it('TEST-419 REQ-022 a roll-up-invisible findings edit notifies with the project root; deleting .orky/ (the null-status emit) notifies too; unsubscribe stops delivery', async () => {
    const root = seedProject()
    const { registry } = makeRegistry()
    await registry.init()

    const changed: string[] = []
    const unsubscribe = registry.onRootChanged((r: string) => changed.push(r))
    await registry.addRoot(root) // begins tracking → the initial read completes → notification(s) arrive
    await waitFor(() => changed.length >= 1)
    for (const r of changed) expect(r).toBe(root) // the case-preserved project ROOT, not the orkyDir

    // a MEDIUM finding's claim edit leaves openBlockingCount (and the roll-up) value-identical —
    // exactly the FINDING-003 staleness class the notification exists to carry (no delta gating).
    const before = changed.length
    const fPath = join(root, '.orky', 'features', 'demo-feat', 'findings.json')
    writeFileSync(fPath, JSON.stringify([{ lens: 'x', claim: 'EDITED claim', severity: 'MEDIUM', status: 'open', id: 'F-1' }]), 'utf8')
    await waitFor(() => changed.length > before)
    expect(changed[changed.length - 1]).toBe(root)

    // vanish: the engine's null-status emit for a deleted orkyDir MUST also notify (REQ-011's re-fetch cue)
    const beforeVanish = changed.length
    rmSync(join(root, '.orky'), { recursive: true, force: true })
    await waitFor(() => changed.length > beforeVanish)
    expect(changed[changed.length - 1]).toBe(root)

    unsubscribe()
    const afterUnsub = changed.length
    mkdirSync(join(root, '.orky', 'features'), { recursive: true }) // provoke another re-read
    await new Promise(r => setTimeout(r, 400))
    expect(changed.length).toBe(afterUnsub) // unsubscribed — no further delivery
  })
})
