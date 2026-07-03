// FROZEN structural suite — feature 0010-orky-pane-inline-actions, ESC-001 tests LOOPBACK
// (review → tests, 2026-07-02). The CONV-046 mode-flip disarm shipped correct but under-pinned
// and under-signaled; per the ESC-001 decision this file adds the missing pins over the SHARED
// orky-entry-actions.tsx (CONV-012 co-ownership: every F8 frozen pin stays byte-green — these
// tests only ADD constraints):
//
//   TEST-641 (FINDING-011, REQ-006) — the LOAD-BEARING half of the CONV-046 fix is the armedMode
//     RENDER GUARD, not the disarm effect: a mounted child's useOpenFocusRestore effect runs
//     BEFORE the parent's disarm effect in the same commit, so without `armedMode === mode` on
//     both mode-keyed form conditions the flipped mode's focus-on-mount form mounts and steals
//     focus for a commit before unmounting. TEST-630/TEST-637 cannot observe that transient —
//     deleting the guard while keeping the effect left every F10 test green. This pin makes that
//     deletion FAIL. (Pinned GREEN against the shipped implementation — a regression pin, per the
//     ESC-001 decision.)
//   TEST-642 (FINDING-009, REQ-006) — the disarm must not destroy the user's typed draft in
//     SILENCE: a flip that discards a non-empty draft reports through the store toast chokepoint
//     with the never-suppressed 'error' kind (toasts-slice.ts:20 — 'success'/'info' are dropped
//     unless toasts are enabled; a data-loss notice must never be droppable), and the flip vector
//     where the answer toggle itself unmounts (escalation → null/stalled) must not strand
//     keyboard focus on <body> (a focus fallback exists). Supersedes TEST-630's blanket
//     pushToast/.focus bans (amended atomically in orky-entry-actions-modeflip.test.ts — CONV-019).
//     Rendered half: e2e TEST-647.
//   TEST-643 (FINDING-010, REQ-006) — the disarm must not leave the hook's FAILED escalation
//     binding to resurface as a stale role=alert beside a later re-opened form of the OTHER mode:
//     either the disarm resets the binding, or the unbound errorView branch is gated on the
//     escalation mode.
//
// Runs RED today on TEST-642/TEST-643 (no notice, no focus fallback, no binding reset/mode gate);
// TEST-641 is GREEN by design (the guard shipped — this is its missing regression pin).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')
const ACTIONS = 'src/renderer/components/orky-entry-actions.tsx'

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

/** The mode-keyed disarm effect spans — the same selection TEST-630 pins. */
function disarmSpans(src: string): string[] {
  return useEffectSpans(src).filter(s =>
    /\breason\b|\bmode\b/.test(s) && s.includes('setAnswerOpen(false)'))
}

describe('the armedMode render guard — the pre-effect-commit half of CONV-046 (FINDING-011)', () => {
  it('TEST-641 REQ-006 (FINDING-011) both mode-keyed form render conditions carry the literal `armedMode === mode`, and setArmedMode( is called exactly ONCE — inside the toggleAnswer gesture handler, never a useEffect body: deleting the guard (or arming it data-driven) fails HERE even though the settled post-flip state looks identical', () => {
    const src = read(ACTIONS)

    // both forms render only while the target's LIVE mode still equals the mode the explicit
    // gesture armed — the wrong-mode focus-on-mount form can never reach its mount effect
    for (const form of ['<EscalationAnswerForm', '<HumanReviewForm']) {
      const at = src.indexOf(form)
      expect(at, `${form} must exist`).toBeGreaterThanOrEqual(0)
      const condition = src.slice(Math.max(0, at - 200), at)
      expect(condition, `${form}'s render condition must carry the armedMode === mode guard`)
        .toContain('armedMode === mode')
    }

    // exactly ONE arming point (the setter call — the useState destructure declares, not calls)
    const armCalls = [...src.matchAll(/setArmedMode\(/g)]
    expect(armCalls.length, 'setArmedMode must have exactly one call site — the explicit gesture').toBe(1)

    // …inside the toggleAnswer gesture handler…
    const toggleAt = src.indexOf('const toggleAnswer')
    expect(toggleAt, 'toggleAnswer must exist').toBeGreaterThanOrEqual(0)
    expect(armCalls[0].index, 'the arming point must live inside toggleAnswer (after its declaration)')
      .toBeGreaterThan(toggleAt)

    // …and inside NO useEffect span: arming is a gesture, never data-driven
    for (const span of useEffectSpans(src)) {
      expect(span, 'no effect may arm the mode — that would reintroduce the data-driven focus steal')
        .not.toContain('setArmedMode(')
    }
  })
})

describe('the disarm is never SILENT and never strands focus (FINDING-009)', () => {
  it('TEST-642 REQ-006 (FINDING-009) a mode-flip disarm that discards a non-empty typed draft reports through the store toast chokepoint with the never-suppressed error kind (guarded on the draft — an empty form disarms quietly), and a focus FALLBACK exists for the flip vector whose captured opener unmounted (escalation → null): focus never falls to body', () => {
    const src = read(ACTIONS)
    const spans = disarmSpans(src)
    expect(spans.length, 'the CONV-046 mode-keyed disarm effect must exist (TEST-630)').toBeGreaterThanOrEqual(1)

    // the draft-lost notice: pushToast in the disarm, GUARDED on a non-empty draft, and carrying
    // the never-suppressed kind — toasts-slice.ts:20 drops every non-'error' kind unless the user
    // opted in, and a data-loss notice must never be droppable (CONV-034)
    const noticeSpans = spans.filter(s => s.includes('pushToast'))
    expect(noticeSpans.length,
      'the disarm must route a draft-lost notice through the store toast chokepoint (pushToast) — never a silent draft destruction'
    ).toBeGreaterThanOrEqual(1)
    for (const s of noticeSpans) {
      expect(s, 'the notice must be guarded on the draft — reference the typed decision/evidence emptiness')
        .toMatch(/(decision|evidence)[^\n]{0,80}(trim\(\)|length|!==\s*'')|(trim\(\)|length|!==\s*'')[^\n]{0,80}(decision|evidence)/)
      expect(s, "the notice rides the never-suppressed 'error' kind (toasts-slice.ts:20) — any other kind is droppable")
        .toMatch(/pushToast\((?:[^()]|\([^()]*\))*,\s*['"]error['"]\s*\)/)
      // dispatch purity survives the amendment (TEST-630's retained bans)
      for (const banned of ['api.orky', 'commitPane', 'launchTerminalAt']) {
        expect(s, `the disarm effect must still never reach ${banned}`).not.toContain(banned)
      }
    }

    // the focus fallback: EITHER the focus-on-mount forms supply useOpenFocusRestore's
    // fallbackSelector (its designed second argument — queried when the captured opener is gone),
    // OR the disarm itself re-anchors COLLAPSED focus (guarded on body/activeElement — never a
    // blind yank, CONV-020's close-half discipline)
    const formsFallback = /useOpenFocusRestore\(\s*inputRef\s*,\s*['"`]/.test(src)
    const disarmFallback = spans.some(s => /\.focus\(/.test(s) && /activeElement|body/.test(s))
    expect(formsFallback || disarmFallback,
      'a focus fallback must exist for the escalation→null flip (the toggle unmounts WITH the form): either the forms pass a fallbackSelector to useOpenFocusRestore, or the disarm re-anchors collapsed focus — focus on <body> strands a keyboard user mid-flow'
    ).toBe(true)
  })
})

describe('no stale failed binding survives the flip (FINDING-010)', () => {
  it('TEST-643 REQ-006 (FINDING-010) after a flip disarms a FAILED-binding form, an explicit re-open of the OTHER mode must not render the stale escalation-unbound alert beside the verdict form: the disarm resets the binding, or the unbound errorView branch is gated on the escalation mode', () => {
    const src = read(ACTIONS)
    const spans = disarmSpans(src)
    expect(spans.length, 'the CONV-046 mode-keyed disarm effect must exist (TEST-630)').toBeGreaterThanOrEqual(1)

    // option A: the disarm clears the binding (a pure state reset — never a bind PULL, which
    // would trip the gesture-tying pins)
    const disarmResets = spans.some(s => /setBinding\(\s*null\s*\)|resetBinding\(/.test(s))
    for (const s of spans) {
      expect(s, 'the disarm must never PULL a fresh binding (bindAnswer is gesture-only)').not.toContain('bindAnswer(')
    }

    // option B: the unbound errorView branch renders only for the ESCALATION mode — the
    // human-review form never wears the escalation path's failure
    const unboundAt = src.indexOf("'escalation-unbound'")
    expect(unboundAt, 'the unbound errorView branch must exist').toBeGreaterThanOrEqual(0)
    const unboundCondition = src.slice(Math.max(0, unboundAt - 300), unboundAt)
    const unboundModeGated = /mode\s*===\s*'escalation'/.test(unboundCondition)

    expect(disarmResets || unboundModeGated,
      'FINDING-010: either the disarm resets the failed binding, or the unbound alert is escalation-mode-gated — otherwise a flip + re-open renders a stale role=alert describing a surface the open form no longer is'
    ).toBe(true)
  })
})
