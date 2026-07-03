// FROZEN structural suite — feature 0010-orky-pane-inline-actions (phase 4 / TASK-001, REQ-006).
// CONV-046: a data-driven reason flip must DISARM the open answer form instead of swapping the
// focus-on-mount substrate under the user — the fix for F8's open FINDING-022, landing in the
// SHARED orky-entry-actions.tsx (its second real mount context, D5), so BOTH the queue mount and
// the F10 pane mount get it.
//
// Per CONV-031/CONV-033 (spec REQ-006 acceptance), the pin is split honestly for this node-env,
// no-jsdom harness: THIS file pins the structural half (a mode-keyed disarm effect exists, resets
// the open state, clears the typed payload, and dispatches/focuses NOTHING), and the behavioral
// half — the real-lifecycle flip with the focus claim, under the queue mount AND the pane mount —
// rides e2e (tests/e2e/orky-pane-actions.spec.ts TEST-637).
//
// CONV-012 co-ownership: orky-entry-actions.tsx is an F8 surface. This edit MUST keep every F8
// frozen pin byte-green — TEST-598 (testid namespace; the exact-set pin below is this file's
// stricter no-NEW-testid guard), TEST-599 (no effect dispatches), TEST-601 (no host import),
// TEST-604/605 (resume/detached-outcome pins), TEST-615 (no busy pre-check before the
// continuation attaches) and the whole -core/-loopback behavior suites. None is amended by F10.
//
// Runs RED today: the shipped orky-entry-actions.tsx has NO mode-keyed disarm effect (answerOpen
// survives a target.reason flip — exactly the FINDING-022 defect), and F8's findings ledger still
// records FINDING-022 as open.
//
// [AMENDED at the ESC-001 tests LOOPBACK (review → tests), 2026-07-02 — FINDING-009 supersession
// (CONV-019)]: TEST-630 originally banned pushToast and .focus( in the disarm effect body —
// mandating a SILENT draft destruction and leaving the escalation→null flip to strand keyboard
// focus on <body>. Per the ESC-001 decision the disarm MUST now route a draft-lost notice through
// the store toast chokepoint (CONV-034) and a focus fallback MUST exist — both pinned as
// REQUIREMENTS by TEST-642 (orky-entry-actions-modeflip-loopback.test.ts). This amendment REMOVES
// exactly those two bans; the disarm's dispatch purity (api.orky/commitPane/launchTerminalAt),
// the exact-testid-set pin, the no-pre-check regex, and the FINDING-022 bookkeeping are all
// byte-unchanged. Intent preserved: the disarm still dispatches nothing and still moves focus on
// no gesture-less path EXCEPT the collapsed-focus re-anchor the fallback requires.
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

// The full F8-pinned testid namespace (frozen TEST-598's set) — F10's fix may add NONE.
const DQ_ACTION_TESTIDS = [
  'dq-action-answer', 'dq-action-preview', 'dq-action-resume', 'dq-action-answer-target',
  'dq-action-answer-input', 'dq-action-answer-submit', 'dq-action-verdict-pass',
  'dq-action-verdict-fail', 'dq-action-evidence', 'dq-action-pending', 'dq-action-result',
  'dq-action-error'
]

describe('CONV-046 — the mode-keyed disarm effect in the SHARED component (REQ-006 / F8 FINDING-022)', () => {
  it('TEST-630 REQ-006 a useEffect keyed on the target\'s reason/mode disarms the open answer form (answerOpen reset AND the typed decision/evidence cleared) — the mode-keyed twin of the FINDING-020 disarm-on-success effect; its body dispatches nothing and launches nothing; the fix introduces zero new testids; F8\'s FINDING-022 is recorded fixed by F10 [AMENDED — FINDING-009: the draft-lost notice (pushToast) and the collapsed-focus fallback are now REQUIRED, pinned by TEST-642 — the former bans on them are removed]', () => {
    const src = read(ACTIONS)

    // ── the disarm effect exists and is MODE-keyed (distinct from the phase-keyed FINDING-020
    // success disarm, which references neither reason nor mode): when target.reason flips while
    // the form is open, the form CLOSES and the typed payload clears — so the mode-keyed form
    // swap (EscalationAnswerForm ⇄ HumanReviewForm, each carrying the focus-on-mount
    // useOpenFocusRestore) can never remount a focus-stealing surface without a gesture.
    const disarm = useEffectSpans(src).filter(s =>
      /\breason\b|\bmode\b/.test(s) && s.includes('setAnswerOpen(false)'))
    expect(disarm.length,
      'CONV-046: a mode-keyed disarm effect must reset answerOpen when target.reason changes while the form is open'
    ).toBeGreaterThanOrEqual(1)
    for (const s of disarm) {
      expect(s, 'the flip must clear the typed decision — a re-open shows an empty input').toContain("setDecision('')")
      expect(s, 'the flip must clear the typed evidence too').toContain("setEvidence('')")
      // the disarm stays dispatch-pure (TEST-599 parity + CONV-046's own claim): no dispatch,
      // no pane commit, no terminal launch. [AMENDED — FINDING-009 (CONV-019)]: 'pushToast' and
      // the no-.focus ban are REMOVED from this list — the draft-lost notice through the store
      // toast chokepoint and the collapsed-focus fallback are now REQUIRED (TEST-642 pins both,
      // incl. the draft guard, the never-suppressed kind, and the collapse guard on any focus).
      for (const banned of ['api.orky', 'commitPane', 'launchTerminalAt']) {
        expect(s, `the disarm effect must never reach ${banned}`).not.toContain(banned)
      }
    }

    // ── no new rendered surface: the module's data-testid literal set is EXACTLY the twelve F8
    // pinned ones (stricter than frozen TEST-598's namespace check — a new dq-action-* id would
    // pass 598 but is still a surface change F10 does not make).
    const literals = [...src.matchAll(/data-testid=\{?["'`]([^"'`]+)["'`]/g)].map(m => m[1])
    expect(new Set(literals), 'the CONV-046 fix is a state reset, never a new testid').toEqual(new Set(DQ_ACTION_TESTIDS))

    // ── the fix must not defeat the frozen TEST-615 continuation guarantee: still no
    // isInFlight/busy pre-check bailing before a gesture's .then() attaches (the same regex
    // TEST-615 pins — re-asserted here so a REQ-006 diff that trips it fails in F10's own suite).
    expect(src).not.toMatch(/if\s*\(\s*(isInFlight\(|busy\b)[^\n]*\)\s*(\{\s*)?return/)

    // ── bookkeeping the spec makes mandatory (REQ-006 / 03-plan TASK-001): F8's open FINDING-022
    // is recorded as fixed by F10 in the F8 findings ledger.
    const raw = JSON.parse(read('.orky/features/0008-queue-answer-resume-actions/findings.json')) as unknown
    const items = (Array.isArray(raw) ? raw : (raw as { findings?: unknown[] }).findings ?? []) as Array<Record<string, unknown>>
    const f22 = items.find(f => f !== null && typeof f === 'object' && f.id === 'FINDING-022')
    expect(f22, 'FINDING-022 must exist in the F8 ledger').toBeDefined()
    expect(f22!.status, 'FINDING-022 must no longer be open once the shared fix lands').not.toBe('open')
    expect(JSON.stringify(f22), 'the resolution must name F10 / feature 0010 as the fixer').toMatch(/F10|0010/i)
  })
})
