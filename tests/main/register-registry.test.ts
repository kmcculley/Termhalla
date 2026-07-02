// FROZEN integration suite — feature 0005-cross-project-orky-registry (phase 4 / TASK-011).
// REQ-008 / REQ-009 / REQ-010 / REQ-011 / REQ-012 / REQ-016 / REQ-020 / REQ-022.
//
// Targets `src/main/ipc/register-registry.ts` — the `registry:*` IPC registrar. Mirrors the mocking style
// of tests/main/orky-ipc-validation.test.ts: `electron` is mocked (`ipcMain.handle`/`removeHandler`) and a
// FAKE registry object (satisfying the `OrkyRegistry` surface this registrar depends on) is injected, so
// this drives the REAL `registerRegistry` with no Electron runtime and no real engine/store.
//
// Chosen contract (mirrors register-cloud.ts/register-usage.ts's existing `ipcMain.handle` + disposer
// pattern; `registry:status` is wired by SUBSCRIBING to the registry's `onSnapshot`, per
// tests/main/orky-registry-service.test.ts's frozen `OrkyRegistry` contract — "wired to registry:status BY
// THE REGISTRAR" per the plan's TASK-007 prose):
//
//   registerRegistry(registry: OrkyRegistry, send: Send): Disposer
//
// `registry.dispose()` is explicitly NOT called by this registrar's disposer (plan risk note #3: the
// shared `OrkyRootEngine`/`OrkyRegistry` lifecycle is owned ONCE by the composition root, not duplicated
// across `registerOrky` and `registerRegistry`'s disposers).
//
// Runs RED today: `src/main/ipc/register-registry.ts` does not exist yet (module-not-found).
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// AMENDED by feature 0009-native-orky-pane (REQ-003's CONV-019 protocol; DISCOVERED at F9's test
// design — see 0009's 04-tests.md): F9 extends this registrar with the registry:detail pull and the
// registry:rootChanged push (0009 REQ-006/REQ-022), so the fake registry surface gains the two new
// members the REAL registrar now consumes (`detail`, `onRootChanged`). Every F5 assertion below is
// otherwise byte-unchanged except TEST-138's closed removed-handler set (open-formed; the exact
// post-F9 set is pinned in tests/main/register-registry-detail.test.ts, TEST-413).
function makeFakeRegistry() {
  const snapshotSubs: Array<(s: unknown) => void> = []
  const rootChangedSubs: Array<(root: string) => void> = []
  return {
    current: vi.fn(() => ['current-snapshot']),
    roots: vi.fn(() => ['/proj/a']),
    addRoot: vi.fn(async (r: unknown) => ({ ok: true, root: r, roots: ['/proj/a'] })),
    removeRoot: vi.fn(async (r: unknown) => ({ ok: true, roots: [] })),
    detail: vi.fn(async (root: unknown) => ({ ok: false, root: String(root), error: 'fake', errorKind: 'root-not-tracked' })),
    onSnapshot: vi.fn((cb: (s: unknown) => void) => { snapshotSubs.push(cb); return () => { const i = snapshotSubs.indexOf(cb); if (i >= 0) snapshotSubs.splice(i, 1) } }),
    onRootChanged: vi.fn((cb: (root: string) => void) => { rootChangedSubs.push(cb); return () => { const i = rootChangedSubs.indexOf(cb); if (i >= 0) rootChangedSubs.splice(i, 1) } }),
    dispose: vi.fn(),
    __fireSnapshot: (s: unknown) => { for (const cb of snapshotSubs) cb(s) },
    __subCount: () => snapshotSubs.length,
    __fireRootChanged: (root: string) => { for (const cb of rootChangedSubs) cb(root) },
    __rootChangedSubCount: () => rootChangedSubs.length
  }
}

describe('registerRegistry — ipcMain.handle wiring (REQ-008/REQ-009/REQ-010/REQ-011/REQ-012/REQ-022)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    removedHandlers.length = 0
  })

  it('TEST-133 REQ-022 registers handle() for current/roots/addRoot/removeRoot under the exact registry:* channel names', () => {
    const registry = makeFakeRegistry()
    registerRegistry(registry as never, () => {})
    expect(typeof handlers[CH.registryCurrent]).toBe('function')
    expect(typeof handlers[CH.registryRoots]).toBe('function')
    expect(typeof handlers[CH.registryAddRoot]).toBe('function')
    expect(typeof handlers[CH.registryRemoveRoot]).toBe('function')
  })

  it('TEST-134 REQ-011/REQ-012 registry:current / registry:roots handlers delegate to registry.current()/registry.roots() (pure reads)', async () => {
    const registry = makeFakeRegistry()
    registerRegistry(registry as never, () => {})
    await expect(handlers[CH.registryCurrent]({})).resolves.toEqual(['current-snapshot'])
    await expect(handlers[CH.registryRoots]({})).resolves.toEqual(['/proj/a'])
    expect(registry.current).toHaveBeenCalled()
    expect(registry.roots).toHaveBeenCalled()
  })

  it('TEST-135 REQ-009/REQ-016 registry:addRoot passes the raw (possibly malformed) arg straight through to registry.addRoot — validation lives INSIDE addRoot, not the registrar', async () => {
    const registry = makeFakeRegistry()
    registerRegistry(registry as never, () => {})
    await handlers[CH.registryAddRoot]({}, 42) // a non-string arg — must NOT throw at the registrar
    expect(registry.addRoot).toHaveBeenCalledWith(42)
  })

  it('TEST-136 REQ-010 registry:removeRoot passes the raw arg straight through to registry.removeRoot', async () => {
    const registry = makeFakeRegistry()
    registerRegistry(registry as never, () => {})
    await handlers[CH.registryRemoveRoot]({}, '/proj/a')
    expect(registry.removeRoot).toHaveBeenCalledWith('/proj/a')
  })

  it('TEST-137 REQ-008/REQ-020/REQ-022 subscribes to registry.onSnapshot and routes every push to send(CH.registryStatus, snapshot) — app-global broadcast, not pane-scoped', () => {
    const registry = makeFakeRegistry()
    const sent: Array<[string, unknown[]]> = []
    registerRegistry(registry as never, (ch: string, ...args: unknown[]) => sent.push([ch, args]))
    expect(registry.onSnapshot).toHaveBeenCalled()
    registry.__fireSnapshot([{ root: '/proj/x', source: 'pane', status: null }])
    expect(sent).toEqual([[CH.registryStatus, [[{ root: '/proj/x', source: 'pane', status: null }]]]])
  })

  it('TEST-138 REQ-019/REQ-022 the returned disposer removes all four handlers and unsubscribes onSnapshot, but does NOT call registry.dispose() (the composition root owns that single shared lifecycle)', () => {
    const registry = makeFakeRegistry()
    const dispose = registerRegistry(registry as never, () => {})
    expect(registry.__subCount()).toBe(1)

    dispose()
    // AMENDED by 0009 REQ-003's protocol (see the makeFakeRegistry note): open-formed — the F5 four
    // must all be removed; F9's registrar additionally removes its own registry:detail handler
    // (exact post-F9 set pinned in tests/main/register-registry-detail.test.ts, TEST-413).
    expect(removedHandlers).toEqual(expect.arrayContaining([
      CH.registryAddRoot, CH.registryCurrent, CH.registryRemoveRoot, CH.registryRoots
    ]))
    expect(registry.__subCount()).toBe(0) // unsubscribed — no further send() after teardown
    expect(registry.dispose).not.toHaveBeenCalled()
  })
})
