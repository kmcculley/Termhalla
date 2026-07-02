// NEW loopback suite — feature 0013-os-needs-you-notifications (review -> tests, ESC-001, 2026-07-02).
// Pins the review blockers/residuals that live in the main-process observer + its composition-root
// wiring, RED against the shipped code and frozen once this gate passes (ADR-009). Covers:
//   FINDING-005 (structural) — register.ts wires the REAL setTimeout/clearTimeout into the notifier's
//                              new setTimer/clearTimer deps (the behavioral vectors are TEST-575/576
//                              in tests/main/orky-needs-you-notifier.test.ts).
//   FINDING-015 — closeWindow re-consults shouldNotify before notifyDigest: a mute that lands AFTER
//                 roots are buffered but BEFORE the window closes suppresses the pending digest too.
//   FINDING-014 — keyOf builds a collision-safe identity key (NUL / structural), never a printable
//                 newline join an OS permits inside a path or slug (TEST-579, RED). TEST-580 is a GREEN
//                 distinctness fence over a \n-bearing slug — the practical collision is currently
//                 masked by the root-scoped dedupe (reason is a fixed trailing token), so the fence
//                 stays green; it guards against a regression to a flat newline-keyed map.
//   FINDING-012 — the notification body escapes/strips Pango-significant markup drawn from the
//                 on-disk project basename + feature slug, so a crafted name renders safely.
//
// FINDING-011 (0004 per-pane vs F13 app-wide double-notify) is an ACCEPTED residual per ESC-001 and is
// deliberately NOT pinned here (see 04-tests.md loopback log).
//
// Runs RED today: the observer arms no timer / does not re-gate the digest / joins the key on '\n' /
// interpolates raw markup, and register.ts constructs the notifier with no timer deps.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OrkyNeedsYouNotifier } from '../../src/main/orky/orky-needs-you-notifier'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const OBSERVER = 'src/main/orky/orky-needs-you-notifier.ts'
const REGISTER = 'src/main/ipc/register.ts'

type OneCall = { title: string; body: string; projectRoot: string }
type DigestCall = { title: string; body: string; projectCount: number }

function feat(feature: string, reason: string | null): unknown {
  return {
    feature, kind: 'active', phase: 'implement', gateN: 1, gateM: 5, openBlocking: 0,
    needsHuman: true, failed: false, reason, lastActivityAt: 1, detail: 'x'
  }
}
function entry(root: string, features: unknown[], source = 'pane'): unknown {
  return {
    root, source,
    status: features.length
      ? { kind: 'active', label: 'x', needsHuman: true, failed: false, features, chipFeature: null }
      : null
  }
}

/** Harness with a mutable app-wide gate + a fake timer scheduler (records only; never auto-fires). */
function harness(opts: { start?: number; allow?: () => boolean } = {}) {
  const state = { clock: opts.start ?? 1000 }
  const ones: OneCall[] = []
  const digests: DigestCall[] = []
  const timers = new Map<number, () => void>()
  let seq = 0
  const notifier = new OrkyNeedsYouNotifier({
    now: () => state.clock,
    shouldNotify: opts.allow ?? (() => true),
    notifyOne: (n: OneCall) => ones.push(n),
    notifyDigest: (n: DigestCall) => digests.push(n),
    setTimer: (fn: () => void) => { const id = ++seq; timers.set(id, fn); return id },
    clearTimer: (handle: unknown) => { timers.delete(handle as number) }
  })
  return { notifier, ones, digests, at: (t: number) => { state.clock = t } }
}

describe('composition-root wires REAL timers into the notifier (REQ-004/REQ-012, FINDING-005)', () => {
  it('TEST-577 REQ-004 register.ts supplies setTimer/clearTimer bound to the real setTimeout/clearTimeout so the window-close flush actually fires in production', () => {
    const src = read(REGISTER)
    // the notifier construction gains the injected timer scheduler...
    expect(src).toMatch(/setTimer\s*:/)
    expect(src).toMatch(/clearTimer\s*:/)
    // ...wired to the real Node timers (not a no-op) — the production driver the shipped wiring lacked.
    expect(src).toMatch(/setTimeout\s*\(/)
    expect(src).toMatch(/clearTimeout\s*\(/)
  })
})

describe('digest emit re-consults the opt-in gate (REQ-005, FINDING-015)', () => {
  it('TEST-578 REQ-005 a mute that lands AFTER roots are buffered but BEFORE the window closes suppresses the pending digest (closeWindow re-checks shouldNotify)', () => {
    const gate = { on: true }
    const h = harness({ allow: () => gate.on })
    // window opens; p1..p3 individual, p4 buffered — all while enabled
    h.notifier.onSnapshot([
      entry('/proj/p1', [feat('f', 'escalation')]), entry('/proj/p2', [feat('f', 'escalation')]),
      entry('/proj/p3', [feat('f', 'escalation')]), entry('/proj/p4', [feat('f', 'escalation')])
    ] as never)
    expect(h.ones).toHaveLength(3)
    // the user mutes the app-wide toggle before the window closes
    gate.on = false
    h.notifier.flush()                       // window close consults the gate again -> no digest
    expect(h.digests).toHaveLength(0)
    // re-enabling and closing a fresh empty window still emits nothing (buffer was cleared)
    gate.on = true
    h.notifier.flush()
    expect(h.digests).toHaveLength(0)
  })
})

describe('collision-safe dedupe identity key (REQ-002/REQ-003, FINDING-014)', () => {
  it('TEST-579 REQ-003 keyOf uses a separator that cannot occur in a path/slug/reason (NUL or structural) — never a printable newline join', () => {
    const src = read(OBSERVER)
    // a POSIX slug/root may legally contain a newline byte, so a '\n' join can collapse two distinct
    // (root, slug, reason) tuples into one dedupe key (false-dedupe -> a suppressed notification).
    expect(src).not.toMatch(/\.join\(\s*['"]\\n['"]\s*\)/)     // no newline-joined identity key
    // the key must be provably collision-safe: NUL delimiter or a structural (JSON/length-prefixed) key
    expect(src).toMatch(/\\0|\\u0000|JSON\.stringify/)
  })

  it('TEST-580 REQ-003 (distinctness fence) two features under one root whose slugs differ only by an embedded newline stay DISTINCT — a \\n-bearing slug never collapses onto a sibling', () => {
    // GREEN today (root-scoped dedupe + trailing fixed-vocab reason already keeps these distinct) and
    // GREEN after the collision-safe key fix — a regression fence for the FINDING-014 vector.
    const h = harness()
    h.notifier.onSnapshot([
      entry('/proj/x', [feat('a', 'escalation'), feat('a\nb', 'escalation')])
    ] as never)
    expect(h.ones).toHaveLength(2)   // two distinct features -> two individual toasts, never deduped to 1
  })
})

describe('notification body renders markup-bearing names safely (REQ-010, FINDING-012)', () => {
  it('TEST-581 REQ-010 a project basename / feature slug carrying Pango markup chars (& < >) is escaped or stripped — no raw tag survives in the title/body', () => {
    const h = harness()
    // both the basename and the slug are on-disk-derived, attacker-influenced strings.
    h.notifier.onSnapshot([entry('C:\\repos\\a&b<c>', [feat('<b>pwn</b>', 'escalation')])] as never)
    expect(h.ones).toHaveLength(1)
    const text = `${h.ones[0].title}\n${h.ones[0].body}`
    // no raw markup tag survives (escaped to entities or stripped — either is safe)
    expect(text).not.toMatch(/<\/?[a-zA-Z]/)
    // no raw ampersand that is not already a well-formed entity (Pango would mis-parse it)
    expect(text).not.toMatch(/&(?!amp;|lt;|gt;|#)/)
    // the informative text is preserved (not wholesale dropped): the slug's word still reads
    expect(text).toContain('pwn')
  })
})
