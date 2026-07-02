// FROZEN pure-logic suite — feature 0013-os-needs-you-notifications (phase 4 / TASK-001..TASK-004).
// The transition diff (off the shared buildDecisionQueue selector), the (projectRoot, featureSlug,
// reason) dedupe map with its full lifecycle, the TUMBLING-window throttle/coalesce/digest, the
// opt-in gate inertness, notification-copy honesty, total tolerance over malformed snapshots, and
// the construct/observe/flush/dispose lifecycle — ALL driven by injected ambients (now / shouldNotify
// / notifyOne / notifyDigest). Zero Electron, zero real clock, zero disk I/O (vitest node env).
//
// ─── SANCTIONED LOOPBACK AMENDMENT (review → tests, ESC-001 / FINDING-005, 2026-07-02) ───────────────
// This file is amended IN PLACE (the single frozen suite whose contract genuinely changed) because the
// notifier's `NeedsYouDeps` shape GAINS a fakeable timer scheduler (`setTimer`/`clearTimer`). The
// shipped observer armed NO timer, so a burst-then-quiet digest was stranded until the next unrelated
// transition or app teardown — REQ-004's "flushed exactly at windowOpenedAt + COALESCE_WINDOW_MS"
// MUST was not honored on the quiet-elapse path (five-lens convergence; determinism/quality/ux/DA).
// Amendment scope: the `harness()` deps object now supplies `setTimer`/`clearTimer` (a controllable
// fake scheduler) and exposes `advance()`/`timerCount()`; TWO new timer-contract vectors are added
// (TEST-575/576). EVERY pre-existing assertion (TEST-530..555) is byte-preserved — they still hold
// because they drive the window boundary via a later transition / flush() / dispose() and never fire
// the scheduler. register.ts wires the real `setTimeout`/`clearTimeout` (pinned structurally in
// tests/main/orky-needs-you-loopback.test.ts, TEST-577).
//
// Chosen contract (this suite FREEZES it — the implementer conforms, per ADR-009 / the spec's
// Public interface):
//
//   // src/main/orky/orky-needs-you-notifier.ts (new)
//   export const COALESCE_WINDOW_MS = 4000
//   export const DIGEST_THRESHOLD = 3
//   export interface NeedsYouDeps {
//     now: () => number
//     shouldNotify: (projectRoot: string) => boolean
//     notifyOne: (n: { title: string; body: string; projectRoot: string }) => void
//     notifyDigest: (n: { title: string; body: string; projectCount: number }) => void
//     // FINDING-005 timer seam: arm the window-close flush at windowOpenedAt + COALESCE_WINDOW_MS on
//     // window open; clear it on window roll / flush() / dispose(). Injected so the boundary flush is
//     // testable with a fake scheduler and no real clock. Production wires setTimeout/clearTimeout.
//     setTimer: (fn: () => void, ms: number) => unknown   // returns an opaque handle
//     clearTimer: (handle: unknown) => void
//   }
//   export class OrkyNeedsYouNotifier {
//     constructor(deps: NeedsYouDeps)
//     onSnapshot(snapshot: OrkyRegistrySnapshot): void   // diff + dedupe + throttle entry point
//     flush(): void                                      // emit any pending coalesced digest
//     dispose(): void                                    // clear all state; idempotent; post-dispose inert
//   }
//
// Digest semantics pinned (REQ-004): within a TUMBLING window (opens at the first transition emitted
// while no window is open; closes at windowOpenedAt + COALESCE_WINDOW_MS) at most DIGEST_THRESHOLD
// INDIVIDUAL toasts fire (the first three transitions, in order); every FURTHER transition is buffered
// and coalesced into at most ONE digest, whose count = the number of DISTINCT projectRoots among the
// buffered transitions that were NOT already surfaced individually this window. A pending digest is
// emitted at window close — driven by the ARMED timer at windowOpenedAt + COALESCE_WINDOW_MS even with
// no further transition (FINDING-005), by the first transition past the boundary, on flush(), or on
// dispose() — whichever comes first — never mid-window, never doubled. The opt-in gate is consulted at
// notification-construction time (per item): a denied item is neither shown nor counted (spec risk
// note #2 — the gate placement is load-bearing for the throttle arithmetic).
//
// Runs RED today: src/main/orky/orky-needs-you-notifier.ts does not exist (module-not-found), so the
// whole file fails to import.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  OrkyNeedsYouNotifier, COALESCE_WINDOW_MS, DIGEST_THRESHOLD
} from '../../src/main/orky/orky-needs-you-notifier'

type OneCall = { title: string; body: string; projectRoot: string }
type DigestCall = { title: string; body: string; projectCount: number }

/** Build a needs-you OrkyFeatureStatus that passes buildDecisionQueue's deep field validation. */
function feat(feature: string, reason: string | null, over: Record<string, unknown> = {}): unknown {
  return {
    feature, kind: 'active', phase: 'implement', gateN: 1, gateM: 5, openBlocking: 0,
    needsHuman: true, failed: false, reason, lastActivityAt: 1, detail: 'do the thing', ...over
  }
}

/** A registry entry for a root carrying zero or more needs-you features. */
function entry(root: string, features: unknown[], source = 'pane'): unknown {
  return {
    root, source,
    status: features.length
      ? { kind: 'active', label: 'x', needsHuman: true, failed: false, features, chipFeature: null }
      : null
  }
}

/** Test harness: an injected clock + gate + capturing sinks + a controllable fake timer scheduler.
 *  `advance(t)` moves the fake clock to t AND fires every armed timer whose deadline has elapsed (in
 *  deadline order) with NO further onSnapshot — the quiet-elapse path (FINDING-005). The pre-existing
 *  vectors never call `advance`, so their lazy window-close behavior is unchanged. */
function harness(opts: { start?: number; allow?: (root: string) => boolean } = {}) {
  const state = { clock: opts.start ?? 1000 }
  const ones: OneCall[] = []
  const digests: DigestCall[] = []
  const timers = new Map<number, { fireAt: number; fn: () => void }>()
  let seq = 0
  const notifier = new OrkyNeedsYouNotifier({
    now: () => state.clock,
    shouldNotify: opts.allow ?? (() => true),
    notifyOne: (n: OneCall) => ones.push(n),
    notifyDigest: (n: DigestCall) => digests.push(n),
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { fireAt: state.clock + ms, fn }); return id },
    clearTimer: (handle: unknown) => { timers.delete(handle as number) }
  })
  return {
    notifier, ones, digests,
    at: (t: number) => { state.clock = t },
    advance: (t: number) => {
      state.clock = t
      for (const [id, tm] of [...timers.entries()].sort((a, b) => a[1].fireAt - b[1].fireAt)) {
        if (tm.fireAt <= t) { timers.delete(id); tm.fn() }
      }
    },
    timerCount: () => timers.size
  }
}

describe('OrkyNeedsYouNotifier — pane-less notify + reuse (REQ-001/REQ-002)', () => {
  it('TEST-530 REQ-001 a snapshot whose only needs-you entry is a pane-less (source:persisted) root fires exactly one notification', () => {
    const h = harness()
    h.notifier.onSnapshot([entry('/proj/paneless', [feat('auth', 'escalation')], 'persisted')] as never)
    expect(h.ones).toHaveLength(1)
    expect(h.ones[0].projectRoot).toBe('/proj/paneless')
    expect(h.digests).toHaveLength(0)
  })

  it('TEST-531 REQ-002 replaying the identical snapshot sequence twice (fresh observer, same clock) yields byte-identical candidate streams', () => {
    const run = () => {
      const h = harness()
      h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)
      h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')]), entry('/proj/b', [feat('f2', 'stalled')])] as never)
      return h.ones.map(o => o.projectRoot)
    }
    expect(run()).toEqual(run())
    expect(run()).toEqual(['/proj/a', '/proj/b'])
  })

  it('TEST-532 REQ-002 a value-identical re-push (deep-equal, !==) of the current snapshot produces zero new candidates', () => {
    const h = harness()
    const push1 = [entry('/proj/a', [feat('f1', 'escalation')])]
    const push2 = [entry('/proj/a', [feat('f1', 'escalation')])]   // deep-equal, different array identity
    expect(push1).not.toBe(push2)
    h.notifier.onSnapshot(push1 as never)
    h.notifier.onSnapshot(push2 as never)
    expect(h.ones).toHaveLength(1)   // the second push is steady-state, not a transition
  })

  it('TEST-533 REQ-002 REQ-013 the observer module imports the shared buildDecisionQueue selector and does not fork needs-you gate logic', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/main/orky/orky-needs-you-notifier.ts'), 'utf8')
    expect(src).toMatch(/import\s*\{[^}]*buildDecisionQueue[^}]*\}\s*from\s*['"]@shared\/decision-queue['"]/)
    // no re-implementation of the membership gate (that lives in the shared selector only)
    expect(src).not.toMatch(/\.needsHuman\s*===\s*true/)
  })
})

describe('OrkyNeedsYouNotifier — dedupe lifecycle (REQ-003)', () => {
  it('TEST-534 REQ-003 a key that STAYS needs-you across pushes does not re-notify (steady-state silence)', () => {
    const h = harness()
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)
    expect(h.ones).toHaveLength(1)
  })

  it('TEST-535 REQ-003 a reason change is a new transition (re-notify) AND the old (…,reason) key is cleared', () => {
    const h = harness()
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)   // notify #1
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'stalled')])] as never)      // notify #2 (new reason key)
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'stalled')])] as never)      // steady — silent
    expect(h.ones).toHaveLength(2)
    // the old escalation key was cleared, so returning to it is a fresh transition (notify #3)
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)
    expect(h.ones).toHaveLength(3)
    expect(h.ones.map(o => o.projectRoot)).toEqual(['/proj/a', '/proj/a', '/proj/a'])
  })

  it('TEST-536 REQ-003 a feature that resolves (needsHuman:false) clears its keys so a later genuine re-entry re-notifies', () => {
    const h = harness()
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)                  // notify #1
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation', { needsHuman: false })])] as never) // resolved -> no candidate
    h.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)                  // re-enter -> notify #2
    expect(h.ones).toHaveLength(2)
  })

  it('TEST-537 REQ-003 a vanished project (absent from the snapshot OR status:null) has ALL its keys pruned', () => {
    // Vector (a): the root leaves membership entirely.
    const a = harness()
    a.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)   // notify #1
    a.notifier.onSnapshot([] as never)                                               // R absent -> prune
    a.notifier.onSnapshot([entry('/proj/a', [feat('f1', 'escalation')])] as never)   // re-enter -> notify #2
    expect(a.ones).toHaveLength(2)

    // Vector (b): the root stays a member but its status goes null (not-yet-read / unreadable).
    const b = harness()
    b.notifier.onSnapshot([entry('/proj/b', [feat('f1', 'escalation')])] as never)   // notify #1
    b.notifier.onSnapshot([entry('/proj/b', [])] as never)                           // status:null -> prune
    b.notifier.onSnapshot([entry('/proj/b', [feat('f1', 'escalation')])] as never)   // re-enter -> notify #2
    expect(b.ones).toHaveLength(2)
  })
})

describe('OrkyNeedsYouNotifier — tumbling-window throttle / coalesce / digest (REQ-004)', () => {
  it('TEST-538 REQ-004 exactly DIGEST_THRESHOLD transitions in one window fire that many individual toasts and NO digest', () => {
    const h = harness()
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]),
      entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')])
    ] as never)
    expect(h.ones).toHaveLength(3)
    h.notifier.flush()                  // window close with an empty buffer emits nothing
    expect(h.digests).toHaveLength(0)
  })

  it('TEST-539 REQ-004 6 distinct projects in one window -> 3 individual toasts + exactly ONE digest naming count 3 (never 6)', () => {
    const h = harness()
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')]),
      entry('/proj/p5', [feat('f', 'escalation')]), entry('/proj/p6', [feat('f', 'escalation')])
    ] as never)
    expect(h.ones).toHaveLength(3)
    expect(h.digests).toHaveLength(0)   // digest is pending until window close
    h.notifier.flush()
    expect(h.digests).toHaveLength(1)
    expect(h.digests[0].projectCount).toBe(3)
  })

  it('TEST-540 REQ-004 a buffered transition for a project already shown individually this window is NOT re-counted in the digest', () => {
    const h = harness()
    // p1,p2,p3 individual (window opens at t=1000)
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('a', 'escalation')]),
      entry('/proj/p2', [feat('a', 'escalation')]),
      entry('/proj/p3', [feat('a', 'escalation')])
    ] as never)
    expect(h.ones).toHaveLength(3)
    // same window (clock unchanged): p1 gains a SECOND needs-you feature (buffered, already-shown ->
    // excluded) and p4 enters (buffered, not shown -> counted).
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('a', 'escalation'), feat('b', 'stalled')]),
      entry('/proj/p2', [feat('a', 'escalation')]),
      entry('/proj/p3', [feat('a', 'escalation')]),
      entry('/proj/p4', [feat('a', 'escalation')])
    ] as never)
    h.notifier.flush()
    expect(h.digests).toHaveLength(1)
    expect(h.digests[0].projectCount).toBe(1)   // only p4 — p1 was already surfaced individually
  })

  it('TEST-541 REQ-004 transitions spaced beyond COALESCE_WINDOW_MS each open a FRESH window and each fire their own individual toast', () => {
    const h = harness({ start: 0 })
    for (let i = 0; i < 5; i++) {
      h.at(i * (COALESCE_WINDOW_MS + 1000))          // each strictly past the previous window close
      h.notifier.onSnapshot([entry(`/proj/p${i}`, [feat('f', 'escalation')])] as never)
    }
    expect(h.ones).toHaveLength(5)                    // never throttled into a digest
    h.notifier.flush()
    expect(h.digests).toHaveLength(0)
  })

  it('TEST-542 REQ-004 a pending digest is flushed at window close (the first transition past the boundary) and a fresh window opens', () => {
    const h = harness({ start: 1000 })
    // window 1 at t=1000: p1,p2,p3 individual + p4 buffered
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')])
    ] as never)
    expect(h.ones).toHaveLength(3)
    expect(h.digests).toHaveLength(0)
    // a transition exactly at windowOpenedAt + COALESCE_WINDOW_MS closes window 1 (flush) and opens a
    // fresh window for p5.
    h.at(1000 + COALESCE_WINDOW_MS)
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')]),
      entry('/proj/p5', [feat('f', 'escalation')])
    ] as never)
    expect(h.digests).toHaveLength(1)
    expect(h.digests[0].projectCount).toBe(1)        // window 1's single buffered project (p4)
    expect(h.ones.map(o => o.projectRoot)).toContain('/proj/p5')   // p5 individual in the fresh window
  })

  it('TEST-543 REQ-004 flush() emits the pending digest once; a dispose() afterwards does not double it', () => {
    const h = harness()
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')])
    ] as never)
    h.notifier.flush()
    expect(h.digests).toHaveLength(1)
    h.notifier.dispose()
    expect(h.digests).toHaveLength(1)                // already flushed — never re-emitted
  })

  it('TEST-544 REQ-004 the window + threshold are stated constants (CONV-003)', () => {
    expect(COALESCE_WINDOW_MS).toBe(4000)
    expect(DIGEST_THRESHOLD).toBe(3)
  })

  it('TEST-545 REQ-004 the individual-vs-digest decision and digest count are pure functions of the timestamps/identities (same sequence twice -> identical outputs)', () => {
    const run = () => {
      const h = harness({ start: 500 })
      h.notifier.onSnapshot([
        entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
        entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')]),
        entry('/proj/p5', [feat('f', 'escalation')])
      ] as never)
      h.at(500 + COALESCE_WINDOW_MS + 1)
      h.notifier.onSnapshot([entry('/proj/p9', [feat('f', 'stalled')])] as never)
      h.notifier.flush()
      return { ones: h.ones, digests: h.digests }
    }
    expect(run()).toEqual(run())
  })
})

describe('OrkyNeedsYouNotifier — opt-in gate (REQ-005 pure half)', () => {
  it('TEST-546 REQ-005 with shouldNotify=false the observer constructs NO notification; with true the transition notifies', () => {
    const off = harness({ allow: () => false })
    off.notifier.onSnapshot([entry('/proj/a', [feat('f', 'escalation')])] as never)
    off.notifier.flush()
    expect(off.ones).toHaveLength(0)
    expect(off.digests).toHaveLength(0)

    const on = harness({ allow: () => true })
    on.notifier.onSnapshot([entry('/proj/a', [feat('f', 'escalation')])] as never)
    expect(on.ones).toHaveLength(1)
  })

  it('TEST-547 REQ-005 the gate is consulted per item at construction time: a denied item is neither shown individually NOR counted in the digest', () => {
    // deny only /proj/denied
    const h = harness({ allow: (root: string) => root !== '/proj/denied' })
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]),   // three allowed individuals
      entry('/proj/denied', [feat('f', 'escalation')]),  // buffered but gate-denied -> dropped, uncounted
      entry('/proj/p5', [feat('f', 'escalation')])       // buffered + allowed -> counted
    ] as never)
    expect(h.ones.map(o => o.projectRoot)).toEqual(['/proj/p1', '/proj/p2', '/proj/p3'])
    h.notifier.flush()
    expect(h.digests).toHaveLength(1)
    expect(h.digests[0].projectCount).toBe(1)         // only p5 — the denied project never counts
  })
})

describe('OrkyNeedsYouNotifier — copy honesty (REQ-010)', () => {
  it('TEST-548 REQ-010 an individual escalation toast names the project basename, the feature slug and the reason, with no completeness/false word', () => {
    const h = harness()
    h.notifier.onSnapshot([entry('C:\\work\\myproj', [feat('auth-feature', 'escalation')])] as never)
    expect(h.ones).toHaveLength(1)
    const text = `${h.ones[0].title}\n${h.ones[0].body}`
    expect(text).toContain('myproj')            // basename of the root, never the full path only
    expect(text).toContain('auth-feature')      // the feature slug
    expect(text).toMatch(/escalation/i)         // the reason phrase
    expect(text).not.toMatch(/\bdone\b/i)
    expect(text).not.toMatch(/\bcomplete/i)
    expect(text).not.toMatch(/\bnull\b/i)
    expect(text).not.toMatch(/\berror\b/i)
  })

  it('TEST-549 REQ-010 a digest names the count and reads as a "N projects need a decision" summary', () => {
    const h = harness()
    // 3 individual + 4 buffered distinct = digest count 4
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')]),
      entry('/proj/p5', [feat('f', 'escalation')]), entry('/proj/p6', [feat('f', 'escalation')]),
      entry('/proj/p7', [feat('f', 'escalation')])
    ] as never)
    h.notifier.flush()
    expect(h.digests).toHaveLength(1)
    expect(h.digests[0].projectCount).toBe(4)
    const text = `${h.digests[0].title}\n${h.digests[0].body}`
    expect(text).toContain('4')
    expect(text).toMatch(/need/i)
    expect(text).not.toMatch(/\bdone\b/i)
  })

  it('TEST-550 REQ-010 a needs-you feature whose reason is absent (null) never renders the literal "null" — it falls back to a generic decision phrasing', () => {
    const h = harness()
    h.notifier.onSnapshot([entry('/proj/quiet', [feat('mystery', null)])] as never)
    expect(h.ones).toHaveLength(1)
    const text = `${h.ones[0].title}\n${h.ones[0].body}`
    expect(text).not.toMatch(/\bnull\b/i)
    expect(text).toMatch(/decision|needs you|review/i)
  })
})

describe('OrkyNeedsYouNotifier — total tolerance + bounded state (REQ-011)', () => {
  it('TEST-551 REQ-011 null / [] / a non-array / a garbage entry among valid ones never throws and yields candidates only for the valid needs-you entries', () => {
    const h = harness()
    expect(() => h.notifier.onSnapshot(null as never)).not.toThrow()
    expect(() => h.notifier.onSnapshot([] as never)).not.toThrow()
    expect(() => h.notifier.onSnapshot('not-an-array' as never)).not.toThrow()
    expect(h.ones).toHaveLength(0)
    // one garbage entry alongside a valid needs-you sibling
    h.notifier.onSnapshot([
      42, null, { root: 123 }, { root: '/proj/bad', status: 'nope' },
      entry('/proj/good', [feat('f', 'escalation')])
    ] as never)
    expect(h.ones.map(o => o.projectRoot)).toEqual(['/proj/good'])
  })

  it('TEST-552 REQ-011 dedupe/throttle state stays bounded across a long membership churn (a departed root re-notifies on re-entry — no stale suppression, no leak)', () => {
    const h = harness({ start: 0 })
    let t = 0
    for (let i = 0; i < 200; i++) {
      t += COALESCE_WINDOW_MS + 100
      h.at(t)
      h.notifier.onSnapshot([entry('/proj/churn', [feat('f', 'escalation')])] as never)  // enter -> notify
      t += COALESCE_WINDOW_MS + 100
      h.at(t)
      h.notifier.onSnapshot([] as never)                                                 // leave -> prune
    }
    // each of the 200 genuine re-entries notified (keys pruned each departure — no stale key blocked one)
    expect(h.ones).toHaveLength(200)
  })
})

describe('OrkyNeedsYouNotifier — lifecycle / dispose (REQ-012)', () => {
  it('TEST-553 REQ-012 after dispose a further onSnapshot constructs no notification and does not throw', () => {
    const h = harness()
    h.notifier.onSnapshot([entry('/proj/a', [feat('f', 'escalation')])] as never)
    h.notifier.dispose()
    expect(() => h.notifier.onSnapshot([entry('/proj/b', [feat('f', 'stalled')])] as never)).not.toThrow()
    expect(h.ones).toHaveLength(1)   // only the pre-dispose transition
  })

  it('TEST-554 REQ-012 a pending coalesced digest is flushed exactly once on dispose; dispose/flush are idempotent afterwards', () => {
    const h = harness()
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')])
    ] as never)
    h.notifier.dispose()
    expect(h.digests).toHaveLength(1)          // trailing burst flushed, never dropped
    h.notifier.dispose()
    h.notifier.flush()
    expect(h.digests).toHaveLength(1)          // never doubled after teardown
  })

  it('TEST-555 REQ-012 no timer remains armed after dispose (fake-timer assertion)', () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.notifier.onSnapshot([
        entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
        entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')])
      ] as never)
      h.notifier.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── FINDING-005 timer contract (LOOPBACK, ESC-001) — the window-close flush is DRIVEN, not lazy ─────
// These vectors are RED against the shipped observer (it arms no timer, so the injected setTimer is
// never called): the pending digest is stranded on the quiet-elapse path. They go GREEN once the
// observer arms setTimer(closeWindow, COALESCE_WINDOW_MS) on window open and clears it on
// roll/flush/dispose. Uses the fake scheduler in `harness()`: `advance(t)` fires due timers with NO
// further onSnapshot.
describe('OrkyNeedsYouNotifier — armed window-close timer (REQ-004/REQ-012, FINDING-005)', () => {
  it('TEST-575 REQ-004 a buffered digest is flushed EXACTLY ONCE at windowOpenedAt + COALESCE_WINDOW_MS on the quiet-elapse path — no further onSnapshot, no flush()/dispose()', () => {
    const h = harness({ start: 1000 })
    // 3 individual + 1 buffered (p4); window opens at 1000, the flush timer is armed for +COALESCE_WINDOW_MS
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')])
    ] as never)
    expect(h.digests).toHaveLength(0)                 // pending — window still open
    h.advance(1000 + COALESCE_WINDOW_MS)              // quiet elapse: the ARMED timer fires the flush
    expect(h.digests).toHaveLength(1)
    expect(h.digests[0].projectCount).toBe(1)         // p4
    // exactly once — advancing further does not re-fire (the timer is one-shot and cleared on close)
    h.advance(1000 + COALESCE_WINDOW_MS + 100000)
    expect(h.digests).toHaveLength(1)
  })

  it('TEST-576 REQ-012 dispose() before the scheduled flush fires clears the armed timer (no leak, no double-fire) and flushes the pending digest exactly once', () => {
    const h = harness({ start: 1000 })
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')])
    ] as never)
    expect(h.timerCount()).toBe(1)                    // a window-close flush timer is armed on window open
    h.notifier.dispose()
    expect(h.digests).toHaveLength(1)                 // dispose flushes the pending digest once
    expect(h.timerCount()).toBe(0)                    // dispose cleared the armed timer — no leak
    h.advance(1000 + COALESCE_WINDOW_MS + 100000)     // the cleared timer never fires
    expect(h.digests).toHaveLength(1)                 // so the digest is never doubled
  })
})
