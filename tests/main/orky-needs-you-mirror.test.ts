// FROZEN wiring suite — feature 0013-os-needs-you-notifications (phase 4 / TASK-008).
// REQ-005 (Wiring / LIVE REFRESH half, FINDING-002): the production `shouldNotify` reads a main-side
// in-memory MIRROR that is refreshed SYNCHRONOUSLY from the full QuickStore payload already flowing
// through the EXISTING quickSave handler — no new IPC channel, no async re-read on the notify hot
// path, no restart. The mechanism pinned here: `registerWorkspaces` gains an optional
// `onQuickSave?: (data: QuickStore) => void` dep, invoked at the END of its quickSave handler (an
// ADDITIONAL call — quick.save(data) is still made, per risk note #3). The composition root supplies
// `onQuickSave: (data) => { mirror = data.orkyNeedsYouNotifications !== false }`, and the observer's
// injected `shouldNotify` closes over the mirror.
//
// Mirrors the electron-mocked style of tests/main/register-registry-detail.test.ts (a fake ipcMain
// captures handlers; the REAL registerWorkspaces is driven). The behavioral half wires the REAL
// OrkyNeedsYouNotifier to a mirror-backed shouldNotify and drives it through the REAL quickSave
// handler — not only the injected stub.
//
// Runs RED today: registerWorkspaces has no onQuickSave dep (so the hook is never invoked and the
// live-refresh never mutes the next transition), and src/main/orky/orky-needs-you-notifier.ts does
// not exist (module-not-found).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (...a: unknown[]) => unknown> = {}
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers[ch] = fn },
    removeHandler: () => {}
  }
}))

import { CH } from '@shared/ipc-contract'
import { registerWorkspaces } from '../../src/main/ipc/register-workspaces'
import { OrkyNeedsYouNotifier } from '../../src/main/orky/orky-needs-you-notifier'

function feat(feature: string, reason: string | null): unknown {
  return {
    feature, kind: 'active', phase: 'implement', gateN: 1, gateM: 5, openBlocking: 0,
    needsHuman: true, failed: false, reason, lastActivityAt: 1, detail: 'x'
  }
}
function entry(root: string, features: unknown[]): unknown {
  return { root, source: 'pane', status: { kind: 'active', label: 'x', needsHuman: true, failed: false, features, chipFeature: null } }
}

const fakeDeps = () => ({
  store: {} as never,
  quick: { save: vi.fn(async () => {}), load: vi.fn(async () => ({})) } as never,
  shells: [] as never
})

beforeEach(() => { for (const k of Object.keys(handlers)) delete handlers[k] })

describe('feature 0013 — quickSave live-refresh mirror (REQ-005 Wiring)', () => {
  it('TEST-560 REQ-005 registerWorkspaces invokes onQuickSave(data) at the end of the quickSave handler AND still persists via quick.save (additive hook, not a replacement)', () => {
    const deps = fakeDeps()
    const onQuickSave = vi.fn()
    registerWorkspaces({ ...deps, onQuickSave } as never)
    const handler = handlers[CH.quickSave as string]
    expect(typeof handler).toBe('function')
    const payload = { connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [], templates: [], themePresets: [], orkyNeedsYouNotifications: false }
    handler({}, payload)
    expect(deps.quick.save).toHaveBeenCalledWith(payload)      // persistence NEVER dropped
    expect(onQuickSave).toHaveBeenCalledWith(payload)          // the mirror hook fires with the full payload
  })

  it('TEST-561 REQ-005 a quickSave(false) payload mutes the NEXT transition without restart (real handler + mirror + production shouldNotify); flipping back to true re-enables', () => {
    const deps = fakeDeps()
    // the composition-root mirror + the exact production hook + the production gate closure
    const mirror = { on: true }
    const onQuickSave = (data: { orkyNeedsYouNotifications?: boolean }) => { mirror.on = data.orkyNeedsYouNotifications !== false }
    const shouldNotify = () => mirror.on
    registerWorkspaces({ ...deps, onQuickSave } as never)
    const quickSave = handlers[CH.quickSave as string]

    const ones: unknown[] = []
    const notifier = new OrkyNeedsYouNotifier({
      now: () => 1000, shouldNotify,
      notifyOne: n => ones.push(n), notifyDigest: () => {}
    })

    // starts ENABLED (absent mirror default is on): a needs-you transition notifies
    notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)
    expect(ones).toHaveLength(1)

    // user disables via the app-wide toggle -> quickSave IPC lands -> mirror flips OFF live
    quickSave({}, { connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [], templates: [], themePresets: [], orkyNeedsYouNotifications: false })
    notifier.onSnapshot([entry('/proj/b', [feat('f2', 'stalled')])] as never)
    expect(ones).toHaveLength(1)   // the next transition is silent — no restart needed

    // user re-enables -> the following transition notifies again
    quickSave({}, { connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [], templates: [], themePresets: [], orkyNeedsYouNotifications: true })
    notifier.onSnapshot([entry('/proj/c', [feat('f3', 'human-review')])] as never)
    expect(ones).toHaveLength(2)
  })
})
