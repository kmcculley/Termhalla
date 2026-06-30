// AMENDED at feature 0005-cross-project-orky-registry (phase 4 / TASK-008/TASK-009, REQ-002 / REQ-016 /
// REQ-020) — supersedes the 0004 `registerOrky(send, win)` per-window-only contract. This is the ONE
// existing FROZEN (0004) test file this feature intentionally touches; the change is called out
// explicitly in 03-plan.md's risk note #2 ("Cross-window sender scoping... a real (if narrow) behavior
// change to 0004's wiring... touches existing security-hardening code"), NOT a regression.
//
// WHY: 0004's `registerOrky(send, win)` validated `BrowserWindow.fromWebContents(e.sender) === win`,
// which silently dropped `orky:watch`/`orky:unwatch` from any window OTHER than the single window
// `register.ts` happened to pass in. REQ-002/REQ-020 require cross-project pane-root membership
// aggregated ACROSS ALL windows — so 0004's "exactly one owning window" rule is replaced with "ANY
// currently-tracked app window" (the ORIGINAL FINDING-SEC-002 security intent — reject a truly
// foreign/unrecognized/destroyed sender — is PRESERVED, just widened in scope). The previously-frozen
// "a watch/unwatch from a NON-owning window is ignored" assertion is GONE (a second, legitimate window's
// events must now be honored); a new "a TRULY FOREIGN sender is rejected" assertion replaces it.
//
// New chosen contract (TASK-009's prose is authoritative; this suite freezes the exact shape):
//   registerOrky(send: Send, isKnownWindowSender: (sender: WebContents) => boolean,
//                onPaneRoot: (id: string, root: string | null) => void): Disposer
//
// `onPaneRoot` mirrors EXACTLY what `OrkyTracker.watch()` resolves (TASK-009: "with no second
// findOrkyRoot walk") — `OrkyTracker.watch(id, cwd)` now RESOLVES to the project root (or null), an
// ADDITIVE change to its return type (previously effectively `Promise<void>`); 0004's frozen
// tests/main/orky-tracker.test.ts never inspects the return value, so this is non-breaking there.
//
// `electron` and `OrkyTracker` are mocked so the handlers run with no Electron runtime. Runs RED against
// the prior pass: the shipped `registerOrky(send, win)` has the OLD 2-arg signature (no
// `isKnownWindowSender`/`onPaneRoot` params), so calling it per the new 3-arg contract mismatches.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
const watchMock = vi.fn()
const unwatchMock = vi.fn()
const disposeMock = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    on: (ch: string, fn: (...a: unknown[]) => void) => { (handlers[ch] ??= []).push(fn) },
    removeListener: vi.fn(),
    removeAllListeners: vi.fn()
  }
}))
vi.mock('../../src/main/orky/orky-tracker', () => ({
  OrkyTracker: vi.fn(() => ({ watch: watchMock, unwatch: unwatchMock, dispose: disposeMock }))
}))

import { CH } from '@shared/ipc-contract'
import { registerOrky } from '../../src/main/ipc/register-orky'

const senderA = { id: 'A' }
const senderB = { id: 'B' } // a SECOND, equally legitimate window (REQ-002/REQ-020 — must now be honored)
const senderForeign = { id: 'unknown' } // never created by this app's WindowManager
const fromA = { sender: senderA }
const fromB = { sender: senderB }
const fromForeign = { sender: senderForeign }

/** Recognizes A and B as known app windows; rejects anything else — mirrors
 *  `WindowManager.isKnownWindowSender` (tests/main/window-manager-registry-sender.test.ts). */
const isKnownWindowSender = (s: { id: string }): boolean => s === senderA || s === senderB

function fire(ch: string, event: unknown, ...args: unknown[]): void {
  for (const fn of handlers[ch] ?? []) fn(event, ...args)
}

/** Flush pending microtasks/macrotasks so an async onWatch handler's internal `await tracker.watch()`
 *  (and the subsequent onPaneRoot call) has settled before assertions run. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('registerOrky — IPC arg validation + cross-window (ANY known sender) acceptance (REQ-002/REQ-016/REQ-020)', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    watchMock.mockReset(); unwatchMock.mockReset(); disposeMock.mockClear()
    watchMock.mockResolvedValue(null)
  })

  it('TEST-139 REQ-016 rejects a non-string cwd / id without throwing and without touching the tracker (preserves 0004 TEST-054)', () => {
    registerOrky(() => {}, isKnownWindowSender as never, () => {})
    expect(() => fire(CH.orkyWatch, fromA, 'p1', 123)).not.toThrow()
    expect(() => fire(CH.orkyWatch, fromA, 456, '/some/cwd')).not.toThrow()
    expect(() => fire(CH.orkyWatch, fromA, undefined, undefined)).not.toThrow()
    expect(watchMock).not.toHaveBeenCalled()
  })

  it('TEST-140 REQ-020 a valid watch from EITHER known window (A or B) starts the tracker — the REQ-002/REQ-020 cross-window widening', async () => {
    registerOrky(() => {}, isKnownWindowSender as never, () => {})
    fire(CH.orkyWatch, fromA, 'p1', '/proj')
    await flush()
    expect(watchMock).toHaveBeenCalledWith('p1', '/proj')

    watchMock.mockClear()
    fire(CH.orkyWatch, fromB, 'p2', '/proj2') // window B — REJECTED under 0004's old rule, MUST work now
    await flush()
    expect(watchMock).toHaveBeenCalledWith('p2', '/proj2')
  })

  it('TEST-141 REQ-016/REQ-020 a watch/unwatch from a TRULY FOREIGN/unrecognized sender is still ignored (the original FINDING-SEC-002 security intent survives, just widened in scope)', async () => {
    registerOrky(() => {}, isKnownWindowSender as never, () => {})
    fire(CH.orkyWatch, fromForeign, 'pX', '/proj')
    fire(CH.orkyUnwatch, fromForeign, 'pX')
    await flush()
    expect(watchMock).not.toHaveBeenCalled()
    expect(unwatchMock).not.toHaveBeenCalled()

    // a real unwatch from a KNOWN window still works
    fire(CH.orkyUnwatch, fromA, 'pA')
    expect(unwatchMock).toHaveBeenCalledWith('pA')
  })

  it('TEST-142 REQ-002 a successful watch resolution invokes onPaneRoot(id, root) with EXACTLY what tracker.watch() resolved — no second findOrkyRoot walk', async () => {
    watchMock.mockResolvedValueOnce('/resolved/project/root')
    const paneRoots: Array<[string, string | null]> = []
    registerOrky(() => {}, isKnownWindowSender as never, (id, root) => paneRoots.push([id, root]))
    fire(CH.orkyWatch, fromA, 'p1', '/some/cwd')
    await flush()
    expect(paneRoots).toEqual([['p1', '/resolved/project/root']])
  })

  it('TEST-143 REQ-003 a watch resolving to null (no .orky ancestor) invokes onPaneRoot(id, null); unwatch also invokes onPaneRoot(id, null)', async () => {
    watchMock.mockResolvedValueOnce(null)
    const paneRoots: Array<[string, string | null]> = []
    registerOrky(() => {}, isKnownWindowSender as never, (id, root) => paneRoots.push([id, root]))
    fire(CH.orkyWatch, fromA, 'p1', '/bare/cwd')
    await flush()
    expect(paneRoots).toEqual([['p1', null]])

    fire(CH.orkyUnwatch, fromA, 'p1')
    expect(paneRoots).toEqual([['p1', null], ['p1', null]]) // unwatch ALSO clears pane-root membership (REQ-003)
  })
})
