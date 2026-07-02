// FROZEN integration suite — feature 0009-native-orky-pane (phase 4 / TASK-005 + TASK-006 + TASK-007
// + TASK-008). REQ-006 (the registry:detail pull: exact channel names, sender gate, delegation,
// disposer) + REQ-022 (the registry:rootChanged push: bare-string payload, registrar wiring,
// disposer unsubscription). Mirrors the mocking style of tests/main/register-registry.test.ts
// (electron mocked, a fake OrkyRegistry injected, the REAL registerRegistry driven).
//
// Chosen contract (freezing the plan's TASK-006/TASK-007 prose):
//   - `OrkyRegistry` gains `detail(root: unknown): Promise<OrkyRootDetailResult>` (membership
//     validation lives INSIDE it, mirroring addRoot/removeRoot owning argument validation) and
//     `onRootChanged(cb: (root: string) => void): () => void` (riding the EXISTING engine.onStatus
//     subscription — no new engine consumer).
//   - `registerRegistry` keeps its (registry, send, isKnownWindowSender?) signature; it registers
//     `ipcMain.handle(CH.registryDetail, ...)` (sender-gated: an unknown sender receives the
//     structured `{ ok:false, errorKind:'unknown-sender' }` rejection and registry.detail is NEVER
//     invoked — no fs read), subscribes `registry.onRootChanged(root => send(CH.registryRootChanged,
//     root))`, and its disposer removes the new handler + unsubscribes.
//
// NOTE (REQ-006 "exactly two new CH.* constants" / proposed convention #1): TEST-409 pins the exact
// post-F9 registry:* channel set. A LATER feature that legitimately extends the family must amend
// TEST-409 on the sanctioned tests-phase path (CONV-019) — this header names that path deliberately.
//
// Runs RED today: CH.registryDetail / CH.registryRootChanged do not exist, the registrar registers
// no detail handler, and it never subscribes onRootChanged.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const handlers: Record<string, (...a: unknown[]) => unknown> = {}
const removedHandlers: string[] = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers[ch] = fn },
    removeHandler: (ch: string) => { removedHandlers.push(ch) }
  }
}))

import { CH } from '@shared/ipc-contract'
import { registerRegistry } from '../../src/main/ipc/register-registry'

const OK_DETAIL = { ok: true, root: 'C:\\proj\\a', activeFeature: null, computedAt: 1, features: [], skippedFeatures: [], featuresCapped: false }

function makeFakeRegistry() {
  const snapshotSubs: Array<(s: unknown) => void> = []
  const rootChangedSubs: Array<(root: string) => void> = []
  return {
    current: vi.fn(() => ['current-snapshot']),
    roots: vi.fn(() => ['/proj/a']),
    addRoot: vi.fn(async (r: unknown) => ({ ok: true, root: r, roots: ['/proj/a'] })),
    removeRoot: vi.fn(async () => ({ ok: true, roots: [] })),
    detail: vi.fn(async () => OK_DETAIL),
    onSnapshot: vi.fn((cb: (s: unknown) => void) => { snapshotSubs.push(cb); return () => { const i = snapshotSubs.indexOf(cb); if (i >= 0) snapshotSubs.splice(i, 1) } }),
    onRootChanged: vi.fn((cb: (root: string) => void) => { rootChangedSubs.push(cb); return () => { const i = rootChangedSubs.indexOf(cb); if (i >= 0) rootChangedSubs.splice(i, 1) } }),
    dispose: vi.fn(),
    __fireRootChanged: (root: string) => { for (const cb of rootChangedSubs) cb(root) },
    __rootChangedSubCount: () => rootChangedSubs.length
  }
}

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k]
  removedHandlers.length = 0
})

describe('the two new read-domain channels (REQ-006 / REQ-022)', () => {
  it('TEST-409 REQ-006 REQ-022 CH declares registry:detail + registry:rootChanged; neither matches the renderer mutation-guard pattern; the registry:* family is EXACTLY the post-F9 seven', () => {
    const ch = CH as Record<string, string>
    expect(ch.registryDetail).toBe('registry:detail')
    expect(ch.registryRootChanged).toBe('registry:rootChanged')
    // the narrowed renderer mutation-surface guard (tests/shared/registry-no-renderer-ui.test.ts:40)
    // must NOT fire on the new read-surface call sites (spec decision #3 — TEST-362 stays green)
    const MUTATION = /RegistryMutationResult|registryRoots\s*\(|registryAddRoot\s*\(|registryRemoveRoot\s*\(/
    expect('registryDetail(root)').not.toMatch(MUTATION)
    expect('onRegistryRootChanged(cb)').not.toMatch(MUTATION)
    // exactly TWO new CH.* constants (REQ-006): F5's five + F9's two, nothing else
    const registryValues = Object.values(ch).filter(v => typeof v === 'string' && v.startsWith('registry:')).sort()
    expect(registryValues).toEqual([
      'registry:addRoot', 'registry:current', 'registry:detail',
      'registry:removeRoot', 'registry:rootChanged', 'registry:roots', 'registry:status'
    ])
    expect(new Set(Object.values(ch)).size).toBe(Object.values(ch).length) // no duplicate channel string
  })

  it('TEST-410 REQ-006 registry:detail is a registered handle() that delegates the RAW argument to registry.detail (validation lives inside the registry, not the registrar)', async () => {
    const registry = makeFakeRegistry()
    registerRegistry(registry as never, () => {})
    expect(typeof handlers[CH.registryDetail as string]).toBe('function')
    await expect(handlers[CH.registryDetail as string]({}, 'C:\\proj\\a')).resolves.toEqual(OK_DETAIL)
    expect(registry.detail).toHaveBeenCalledWith('C:\\proj\\a')
    // a malformed (non-string) arg passes through raw — never a registrar throw (CONV-002)
    await handlers[CH.registryDetail as string]({}, 42)
    expect(registry.detail).toHaveBeenCalledWith(42)
  })

  it('TEST-411 REQ-006 an unknown sender receives the STRUCTURED unknown-sender rejection — registry.detail is never invoked (no fs read), nothing throws', async () => {
    const registry = makeFakeRegistry()
    registerRegistry(registry as never, () => {}, () => false)
    const res = await handlers[CH.registryDetail as string]({ sender: {} }, 'C:\\proj\\a') as { ok: boolean; errorKind?: string; error?: string; root?: unknown }
    expect(res.ok).toBe(false)
    expect(res.errorKind).toBe('unknown-sender')
    expect(typeof res.error).toBe('string')
    expect(res.error!.length).toBeGreaterThan(0)
    expect(typeof res.root).toBe('string')
    expect(registry.detail).not.toHaveBeenCalled() // the real payload path never ran
  })

  it('TEST-412 REQ-022 registry.onRootChanged is wired to send(CH.registryRootChanged, root) — an APP-GLOBAL broadcast whose payload is the BARE project-root string only', () => {
    const registry = makeFakeRegistry()
    const sent: Array<[string, unknown[]]> = []
    registerRegistry(registry as never, (ch: string, ...args: unknown[]) => sent.push([ch, args]))
    expect(registry.onRootChanged).toHaveBeenCalled()
    registry.__fireRootChanged('C:\\proj\\a')
    const pushes = sent.filter(([ch]) => ch === (CH.registryRootChanged as string))
    expect(pushes).toEqual([[CH.registryRootChanged, ['C:\\proj\\a']]]) // one send, one bare string — never a status/snapshot
  })

  it('TEST-413 REQ-006 REQ-022 the disposer removes the registry:detail handler (exact post-F9 removed set) and unsubscribes onRootChanged — no send after dispose', () => {
    const registry = makeFakeRegistry()
    const sent: unknown[] = []
    const dispose = registerRegistry(registry as never, (ch: string) => sent.push(ch))
    expect(registry.__rootChangedSubCount()).toBe(1)
    dispose()
    // the EXACT post-F9 removed-handler set (the open-formed F5 TEST-138 defers to this pin)
    expect(removedHandlers.sort()).toEqual([
      CH.registryAddRoot, CH.registryCurrent, CH.registryDetail, CH.registryRemoveRoot, CH.registryRoots
    ].sort())
    expect(registry.__rootChangedSubCount()).toBe(0)
    sent.length = 0
    registry.__fireRootChanged('C:\\proj\\a')
    expect(sent).toEqual([]) // unsubscribed — nothing reaches send after teardown
  })

  it('TEST-414 REQ-006 REQ-022 preload bridges exactly the two new surfaces (invoke pull + pushChannel event); the registrar never send()s on the pull channel (it is pull-only)', () => {
    const preload = readFileSync(resolve(process.cwd(), 'src/preload/index.ts'), 'utf8')
    expect(preload).toMatch(/registryDetail:\s*\(root[^)]*\)\s*=>\s*ipcRenderer\.invoke\(CH\.registryDetail/)
    expect(preload).toMatch(/onRegistryRootChanged:\s*pushChannel/) // the onRegistryStatus template (preload/index.ts:77)
    const registrar = readFileSync(resolve(process.cwd(), 'src/main/ipc/register-registry.ts'), 'utf8')
    expect(registrar).not.toMatch(/send\(\s*CH\.registryDetail/) // no broadcast on the pull channel
    // and the typed contract names both methods (TermhallaApi)
    const contract = readFileSync(resolve(process.cwd(), 'src/shared/ipc-contract.ts'), 'utf8')
    expect(contract).toContain('registryDetail')
    expect(contract).toContain('onRegistryRootChanged')
  })
})
