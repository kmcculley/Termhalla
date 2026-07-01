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

function makeFakeRegistry() {
  const snapshotSubs: Array<(s: unknown) => void> = []
  return {
    current: vi.fn(() => ['current-snapshot']),
    roots: vi.fn(() => ['/proj/a']),
    addRoot: vi.fn(async (r: unknown) => ({ ok: true, root: r, roots: ['/proj/a'] })),
    removeRoot: vi.fn(async (r: unknown) => ({ ok: true, roots: [] })),
    onSnapshot: vi.fn((cb: (s: unknown) => void) => { snapshotSubs.push(cb); return () => { const i = snapshotSubs.indexOf(cb); if (i >= 0) snapshotSubs.splice(i, 1) } }),
    dispose: vi.fn(),
    __fireSnapshot: (s: unknown) => { for (const cb of snapshotSubs) cb(s) },
    __subCount: () => snapshotSubs.length
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
    expect(removedHandlers.sort()).toEqual([
      CH.registryAddRoot, CH.registryCurrent, CH.registryRemoveRoot, CH.registryRoots
    ].sort())
    expect(registry.__subCount()).toBe(0) // unsubscribed — no further send() after teardown
    expect(registry.dispose).not.toHaveBeenCalled()
  })
})
