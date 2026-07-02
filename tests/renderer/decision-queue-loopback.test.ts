// Review-loopback structural suite — feature 0006-decision-queue-panel (ESC-001, review→tests
// loopback; FROZEN once the loopback lands, like the rest of the phase-4 suite — ADR-009).
// Pins the corrected contracts for two review findings, source-scan style per the 0004 precedent
// and this feature's own structure suite (the vitest harness is node-env, no jsdom):
//
//   FINDING-020 (caller half, REQ-009) — candidate AVAILABILITY gating lives in the panel via the
//     new pure seam `selectPaneCandidates` (functionally pinned in
//     tests/shared/decision-queue-match.test.ts, TEST-368/369). The matcher seam alone cannot see
//     which signals exist, so the caller must never hand-build an unconditional all-signals array.
//   FINDING-008 (REQ-014/REQ-010) — the pane-less "open terminal here" fallback must be
//     Enter/Space-activatable and AT-exposed: the row keydown must target-guard so a bubbled
//     keydown from the nested button is never preventDefault()ed into a silent no-op, and NO
//     Children-Presentational ARIA role (role="button") may wrap the fallback — the pinned
//     corrected structure uses NATIVE <button> elements for every activation surface, with the
//     item row a generic focusable container. Behavioral keyboard coverage rides in
//     tests/e2e/decision-queue.spec.ts (TEST-372).
//
// Runs RED against the shipped implementation: the panel supplies all three candidate signals
// unconditionally, its row keydown has no target guard, and the row's role="button" strips the
// nested fallback button from the accessibility tree.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const panel = () => readFileSync(resolve(process.cwd(), 'src/renderer/components/DecisionQueuePanel.tsx'), 'utf8')

describe('DecisionQueuePanel — candidate AVAILABILITY gating at the caller (REQ-009 / FINDING-020)', () => {
  it('TEST-370 REQ-009 the panel builds pane candidates via selectPaneCandidates — never a hand-built all-signals array', () => {
    const src = panel()
    // REQ-009's when/ONLY-when availability rule (live cwd when known — even if it will not
    // match; config.cwd only when no live cwd; gitStatus.root only when neither) is the pinned
    // pure seam's job — the panel must route through it.
    expect(src).toContain('selectPaneCandidates(')
    // Never feed the matcher a hand-built candidate array literal: that is exactly the
    // unconditional all-three-signals shape FINDING-020 flagged (a stale persisted config.cwd
    // consulted despite a known live cwd — the pane that cd'd out kept matching).
    expect(src).not.toMatch(/matchPaneRootFromCandidates\(\s*\[/)
  })
})

describe('DecisionQueuePanel — keyboard-activatable, AT-exposed fallback (REQ-014/REQ-010 / FINDING-008)', () => {
  it('TEST-371 REQ-014 REQ-010 the row keydown target-guards; no ARIA button role wraps the fallback; the fallback is a native button', () => {
    const src = panel()
    // (a) The row's Enter/Space keydown must act only on ITS OWN key events: a bubbled keydown
    // from the nested fallback button must never be preventDefault()ed into a silent no-op
    // (REQ-010 "never a silent no-op"). Pinned literal: an e.target-vs-e.currentTarget guard.
    expect(
      src,
      'the row keydown must guard on e.target === e.currentTarget (or the !== early-return equivalent)'
    ).toMatch(/([A-Za-z_$][\w$]*)\.target\s*[!=]==\s*\1\.currentTarget/)
    // (b) The pinned corrected ARIA structure: NO role="button" anywhere in the panel.
    // role="button" is a Children-Presentational role — it strips nested controls from the
    // accessibility tree, so a fallback button inside it is imperceivable to AT. Every activation
    // surface is a NATIVE <button>; the item row stays a generic focusable container whose
    // keydown is the (guarded) click-to-focus convenience path.
    expect(src, 'no Children-Presentational role="button" may wrap the fallback').not.toContain('role="button"')
    // (c) The fallback carries its OWN activation: a real <button> (native Enter/Space
    // semantics), still carrying its project-root identity for F8.
    expect(src).toMatch(/<button[^<]*data-testid="decision-queue-open-terminal"/)
    // (d) The row itself remains keyboard-reachable (REQ-014's Tab path to queue items).
    expect(src).toContain('tabIndex={0}')
  })
})
