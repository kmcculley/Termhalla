// FROZEN loopback suite — feature 0008-queue-answer-resume-actions, tests phase, LOOPBACK 1
// (review → tests, per ESC-001: the 6-lens review found one contract blocker + real MEDIUMs; the
// human decision ordered the fixes pinned RED here BEFORE the implementer touches them).
//
// New pins in this file (ids continue from the repo max TEST-614):
//   TEST-615 — FINDING-009 (REQ-007/REQ-011): the core's withSingleFlight FANS OUT the settled
//              outcome to every caller of the same key — and the hook must not defeat that with a
//              redundant `if (isInFlight(key)) return` pre-check that bails BEFORE a gesture's own
//              .then() continuation attaches. This is the F10-reuse-critical vector: an F8 queue
//              row starts the flight, an F10 OrkyPane row of the SAME target gestures while it is
//              in the air — the second instance must render the SETTLED RESULT after the flight
//              resolves, never silently revert to idle. (No harness here can mount two React
//              instances — node-env, no jsdom — so the pin is the honest pair: the core fan-out
//              driven behaviorally + the hook structurally banned from short-circuiting; the
//              rendered post-settle behavior itself is unreachable until F10 mounts the second
//              instance, which is exactly why it must be made impossible to regress NOW.)
//   TEST-616 — FINDING-016 (REQ-012): opening the inline answer flow moves keyboard focus INTO
//              the decision input — the spec's Verified contract names useOpenFocusRestore as the
//              substrate to reuse (as F12 does, OrkyCaptureModal.tsx:191). Behavioral half:
//              tests/e2e/orky-queue-actions-loopback.spec.ts TEST-620.
//   TEST-617 — FINDING-017 (REQ-006/REQ-012): Enter in the single decision input submits (a form
//              submit or an input-scoped onKeyDown — target-scoped by construction, CONV-030) —
//              the canonical single-line-input keystroke must not be dead. Behavioral half:
//              TEST-620 (incl. the whitespace refusal gate).
//   TEST-618 — FINDING-019 (REQ-008/REQ-012): dq-action-result and dq-action-pending are polite
//              live regions (role="status") so AT announces the pending state and the honest
//              success copy, not only the role="alert" failure.
//   TEST-619 — FINDING-008 (REQ-014/REQ-001): the raw commitPane primitive comes OFF the public
//              State surface — a narrow launchTerminalAt(cwd, launch) store action (the
//              launchCommand-shaped wrapper every other pane-opening entry point already follows)
//              replaces it; resumeInTerminal rides the narrow action; slices keep their
//              SliceDeps-injected copy. (Verified before pinning: NO frozen test requires
//              commitPane on public State — the slice suites inject it via SliceDeps, and the
//              decision-queue-panel-structure `/launchDir|commitPane/` pin reads the PANEL's own
//              F6 source, untouched by this change.) The REQ-014 composition itself is re-pinned
//              in the AMENDED frozen TEST-604 (see orky-entry-actions-structure.test.ts).
//
// Runs RED today against the reviewed implementation: the hook carries three
// `if (isInFlight(key)) return` pre-checks (615), no focus-on-open substrate (616), no Enter path
// on the decision input (617), no role="status" (618), and commitPane is exposed on State with no
// launchTerminalAt (619).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flightKey, withSingleFlight } from '../../src/renderer/components/orky-entry-actions-core'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const ACTIONS = 'src/renderer/components/orky-entry-actions.tsx'
const actions = () => read(ACTIONS)

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** Balanced-paren spans of every useEffect(...) call (the 0012 TEST-489 technique). */
function useEffectSpans(src: string): string[] {
  const spans: string[] = []
  let i = src.indexOf('useEffect(')
  while (i !== -1) {
    let depth = 0
    let j = i + 'useEffect'.length
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') { depth--; if (depth === 0) break }
    }
    spans.push(src.slice(i, j + 1))
    i = src.indexOf('useEffect(', j)
  }
  return spans
}

/** A window of source text around the first occurrence of `needle`. */
function around(src: string, needle: string, before = 400, after = 400): string {
  const at = src.indexOf(needle)
  expect(at, `${needle} must exist`).toBeGreaterThanOrEqual(0)
  return src.slice(Math.max(0, at - before), at + needle.length + after)
}

describe('FINDING-009 — the shared flight fans out to EVERY caller; the hook must not defeat it (REQ-007/REQ-011)', () => {
  it('TEST-615 REQ-007 REQ-011 a second consumer arriving MID-FLIGHT receives the settled outcome through its own continuation (the F10 same-target vector), and the hook attaches every gesture UNCONDITIONALLY through withSingleFlight(...).then(...) — no isInFlight/busy pre-check may bail before the continuation exists', async () => {
    // ── behavioral, at the core seam: the fan-out the pre-check was throwing away.
    // Instance 1 (an F8 queue row) starts the flight; instance 2 (an F10 pane row for the SAME
    // target) gestures while it is in the air. The core returns the existing flight AS-IS and
    // never starts fn again — but the second caller's .then() MUST still receive the settled
    // outcome, because that .then() is what renders the second instance's result (not a silent
    // revert to idle once its shared-gate pending derivation drops).
    const key = flightKey('C:\\proj\\alpha', 'fanout-post-settle', 'answer')
    let release!: (v: { status: string; message: string }) => void
    const first = withSingleFlight(key, () => new Promise<{ status: string; message: string }>((r) => { release = r }))
    const secondSaw: Array<{ status: string; message: string }> = []
    const fnNeverStarts = vi.fn(async () => ({ status: 'never', message: 'never started' }))
    void withSingleFlight(key, fnNeverStarts).then((settled) => secondSaw.push(settled))
    expect(fnNeverStarts, 'the second gesture must not start a duplicate flight (REQ-007)').not.toHaveBeenCalled()

    release({ status: 'success', message: 'Escalation answered — the decision was submitted.' })
    await first
    await tick()
    expect(secondSaw, 'the SECOND caller must receive the settled RESULT after the flight resolves — never nothing').toEqual([
      { status: 'success', message: 'Escalation answered — the decision was submitted.' }
    ])

    // ── structural, at the hook: a caller that never reaches withSingleFlight never attaches a
    // continuation and can never learn the outcome. The redundant pre-check is BANNED — the core's
    // own dedup (existing flight returned as-is, fn never re-invoked) already guarantees the
    // single dispatch, so the pre-check bought nothing and cost the second instance its result.
    const src = actions()
    expect(
      src,
      'FINDING-009: no isInFlight/busy-guarded early return may short-circuit a gesture before its .then() attaches — let every caller reach withSingleFlight (the core dedups; the continuation delivers)'
    ).not.toMatch(/if\s*\(\s*(isInFlight\(|busy\b)[^\n]*\)\s*(\{\s*)?return/)
    // every async gesture still routes through the shared gate and delivers its settle:
    expect(src.split('withSingleFlight(').length - 1, 'answer (escalation), answer (review) and preview each gate through the shared registry').toBeGreaterThanOrEqual(3)
    expect((src.match(/\.then\(/g) ?? []).length, 'each flight settle must be delivered through a continuation').toBeGreaterThanOrEqual(3)
  })
})

describe('FINDING-016 — opening the answer flow moves focus into the decision input (REQ-012)', () => {
  it('TEST-616 REQ-012 the module reuses the shared useOpenFocusRestore substrate (the spec\'s named focus substrate, CONV-020\'s open half — as F12 does) with the focus ref on dq-action-answer-input, so a keyboard open never strands focus on the toggle', () => {
    const src = actions()
    expect(src, 'the shared open-focus substrate must be reused, never re-derived').toMatch(/from ['"]\.\/use-open-focus-restore['"]/)
    expect(src).toContain('useOpenFocusRestore(')
    const inputRegion = around(src, 'dq-action-answer-input', 300, 300)
    expect(inputRegion, 'the decision input must carry the open-focus ref').toMatch(/ref=\{/)
  })
})

describe('FINDING-017 — Enter in the decision input submits (REQ-006/REQ-012)', () => {
  it('TEST-617 REQ-006 REQ-012 the single decision input paired with exactly ONE submit control dispatches that submit on Enter: a form submit or an input-scoped onKeyDown (target-scoped by construction — CONV-030), respecting the same refusal gates as the submit button (behavioral: e2e TEST-620)', () => {
    const src = actions()
    const inputRegion = around(src, 'dq-action-answer-input', 600, 600)
    expect(
      inputRegion,
      'FINDING-017: Enter in the decision input must submit — add a form/onSubmit or an Enter onKeyDown on the input; today the canonical keystroke is dead'
    ).toMatch(/onKeyDown|onSubmit|<form/)
  })
})

describe('FINDING-019 — symmetric outcome announcement for assistive technology (REQ-008/REQ-012)', () => {
  it('TEST-618 REQ-008 REQ-012 dq-action-result and dq-action-pending are polite live regions (role="status") so the pending state and the honest success/preview copy are announced — matching the role="alert" the error surface already carries', () => {
    const src = actions()
    for (const tid of ['dq-action-result', 'dq-action-pending']) {
      const region = around(src, `"${tid}"`, 150, 150)
      expect(region, `${tid} must carry role="status" (a polite live region)`).toContain('role="status"')
    }
    // the asymmetry's other half stays: failures remain assertive
    expect(around(src, '"dq-action-error"', 150, 150)).toContain('role="alert"')
  })
})

describe('FINDING-008 — the raw pane primitive comes off the public State surface (REQ-014/REQ-001)', () => {
  it('TEST-619 REQ-014 REQ-001 State exposes the NARROW launchTerminalAt(cwd, launch) action instead of raw commitPane (SliceDeps keeps its injected copy); resumeInTerminal rides the narrow action; no useEffect can launch a terminal', () => {
    const types = read('src/renderer/store/types.ts')
    const stateStart = types.indexOf('export interface State')
    const depsStart = types.indexOf('export interface SliceDeps')
    expect(stateStart).toBeGreaterThanOrEqual(0)
    expect(depsStart).toBeGreaterThan(stateStart)
    const stateRegion = types.slice(stateStart, depsStart)
    expect(
      stateRegion,
      'FINDING-008: the public State surface must not expose the arbitrary-PaneConfig commitPane primitive — every other pane-opening entry point is a narrowly-scoped named action'
    ).not.toContain('commitPane')
    expect(stateRegion, 'the narrow launchTerminalAt(cwd, launch) wrapper replaces it (the launchCommand-shaped pattern)').toMatch(
      /launchTerminalAt:\s*\(cwd: string, launch: TerminalLaunch\)/
    )
    expect(types.slice(depsStart), 'slices keep their SliceDeps-injected commitPane (the pre-F8 pattern)').toContain('commitPane')

    const store = read('src/renderer/store.ts')
    expect(store, 'the returned store object must not re-expose commitPane as a public property').not.toMatch(/^\s*commitPane,\s*$/m)
    expect(store, 'the narrow action is implemented in store.ts alongside launchCommand').toContain('launchTerminalAt:')

    const src = actions()
    expect(src, 'the hook composes the NARROW action, never the raw primitive').not.toContain('commitPane')
    expect(src).toContain('launchTerminalAt(')
    for (const span of useEffectSpans(src)) {
      expect(span, 'a useEffect body must never launch a terminal (REQ-006 parity for the narrow action)').not.toContain('launchTerminalAt')
    }
  })
})
