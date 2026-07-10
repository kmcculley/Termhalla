# Tests — 0025-cursor-home-output-suppression

**Phase:** 4 (tests) — derived from `02-spec.md` (REQ-001..REQ-011) and `03-plan.md`. Written
BEFORE implementation; verified RED on 2026-07-09 (`npm test` exit 1). Frozen once the tests
gate passes (ADR-009).

## Test files

| File | Status | Purpose |
|---|---|---|
| `tests/main/status-tracker.test.ts` | extended (new `StatusTracker: repaint tail admission (0025)` describe appended; ALL pre-existing tests **assertion-body-unchanged** — the two REQ-003/REQ-008 frozen pins and the AI pin carry comment-only vocabulary amendments recorded by ESC-001, see the amendment record below) | Tracker-level behavior: REQ-001..007 + REQ-004 hold-the-line |
| `tests/main/needs-input-classifier.test.ts` | new | REQ-009 classifier contract (`isPureControl` amended + new `isRepaintChunk`), total + edge-complete |
| `tests/characterization-status.test.ts` | CHAR-001 block amended ONLY (TEST-2526); CHAR-002/003/004/005 byte-unchanged | REQ-010 recorded, deliberate CHAR-001 amendment |
| `tests/main/needs-input.test.ts` | one pre-existing `isPureControl` pin amended (TEST-2527); everything else byte-unchanged | tests-phase collision resolution (CONV-059) — see below |
| `tests/docs-feature-0025.test.ts` | new (RED until TASK-007's doc edits — the docs-feature-0022/0024 precedent) | REQ-011 doc-drift guard |
| `tests/regression-net-0025.test.ts` | new (green from day 1) | REQ-008 net-presence guard |

## TEST → REQ map

| TEST | REQ(s) | Assertion |
|---|---|---|
| TEST-2501 | REQ-001 | A marker-driven (`onMarker('C')`) busy tracker fed ONE `'\x1b[?25l\x1b[H' + screen + '\r\nOverwrite? [y/N] '` chunk reaches `'needs-input'` at `tick()` ≥ `quietMs` after the last real output. Pre-fix wedged `'busy'` — a RED witness for the fix itself. |
| TEST-2502 | REQ-001 | Same, marker-less variant (busy via prior real output). Pre-fix read `'idle'` (hard-idle misfire on the stale non-prompt tail) — RED witness. |
| TEST-2503 | REQ-002 | Real output at t0, repaint-with-prompt at t0+`quietMs`−100: `tick(t0+quietMs−1)` is still `'busy'`, `tick(t0+quietMs)` fires `'needs-input'` — quiet is timed from the REAL output; the repaint 100ms earlier did not restart the window. RED pre-fix. |
| TEST-2504 | REQ-002 | Symmetric `computeIdleFallback` vector: repaint at t0+`heuristicIdleHardMs`−100 does not delay the sustained-silence idle flip at t0+`heuristicIdleHardMs`. |
| TEST-2505 | REQ-003(a) | An idle marker-less tracker fed `'\x1b[Hfresh TUI frame content'` (NEW printable non-prompt text) stays `'idle'` on the call and across ticks — the LOCKED 2026-07-08 decision preserved verbatim. |
| TEST-2506 | REQ-003(c) | An idle tracker fed `'\x1b[HDelete file? '` (prompt-shaped repaint) stays `'idle'` across subsequent ticks — `tick()` computes needs-input only from `'busy'`. |
| TEST-2507 | REQ-003(b) | A tracker in `'needs-input'` fed a repaint carrying DIFFERENT printable text remains `'needs-input'` (the → busy reset stays exclusive to real output). |
| TEST-2508 | REQ-005 | ANSI-only (`'\x1b[2J'`), whitespace-only (`'   \r\n'`), and home-prefixed-control (`'\x1b[H\x1b[K\r\n'`) chunks are fully inert: needs-input fires on the ORIGINAL schedule with the ORIGINAL prompt (tail, timer, state all untouched; CONV-003 no silent divergence). |
| TEST-2509 | REQ-006 | ConPTY repaint ending at the prompt with erase trailers, `'\x1b[?25l\x1b[1;1H'` form: prompt not evicted, `'needs-input'` fires (regression (a) closed). |
| TEST-2510 | REQ-006 | The same chunk delivered while already `'needs-input'` → state holds. |
| TEST-2511 | REQ-006 | Bare `'\x1b[H'` home form passes identically. |
| TEST-2512 | REQ-006 | Stacked `'\x1b[?25l\x1b[?25h\x1b[H'` prefixes pass identically. |
| TEST-2513 | REQ-007 | CHOSEN behavior (concept D2 residual risk; revisit trigger for the rejected prompt-gated alternative, cited in the test comment): a repaint painting the prompt mid-screen with non-prompt lines below stays `'busy'` after quiet. RED pre-fix (old code kept the stale prompt tail and fired). |
| TEST-2514 | REQ-007 | The 400-char cap applies to repaint-admitted text (CONV-003): a 460-printable-char paint with prompt-shaped text at the FRONT evicts the `?` past the cap → stays `'busy'`; without the cap `/\?\s*$/` would wrongly fire. |
| TEST-2515 | REQ-004 | Real output still: resets `'needs-input'`→`'busy'`, restarts the quiet window, and appends the tail (the new prompt fires next). |
| TEST-2516 | REQ-004 | Real printable output still marks a marker-less pane busy. |
| TEST-2521 | REQ-009 | Both classifier exports are TOTAL: no enumerated or malformed (truncated-escape) input throws; `''` included. |
| TEST-2522 | REQ-009 | Class (i) vectors: empty, ANSI-only, whitespace-only, home-prefixed-control-only → `isPureControl` true. |
| TEST-2523 | REQ-009 | `isRepaintChunk`: start-anchored, both home forms (`\x1b[H`, `\x1b[1;1H`), optional `\x1b[?25l`/`\x1b[?25h` prefixes; home mid-chunk and plain text false. |
| TEST-2524 | REQ-009, REQ-010 | Class (ii) — the amendment: home-prefixed WITH printable text → `isPureControl` false, `isRepaintChunk` true. |
| TEST-2525 | REQ-009 | Class (iii) — plain text and `'cleared \x1b[Hmid'` are real output on both axes (anchoring preserved). |
| TEST-2526 | REQ-010 | The amended CHAR-001 pin: `isPureControl('\x1b[Hreal text') === false` (was `true` at baseline), with the citation comment (feature 0025, baseline REQ-007) required by the spec; the no-printable home case stays `true`. |
| TEST-2527 | REQ-009, REQ-010 | Collision resolution (CONV-059): `tests/main/needs-input.test.ts` had ADDITIONAL pre-existing pins of the old classification (`'\x1b[?25l\x1b[HPS C:\\> '`/`'\x1b[Hrepainted prompt'` → true) not enumerated by the spec — left frozen they would force a red implement gate. Amended at the tests phase to the new contract, with the citation comment. |
| TEST-2531 | REQ-011 | `.orky/baseline/architecture.md` bug #4 reads `KNOWN BUG — FIXED` citing 0025 (bugs #1–#3 pattern); the `confirmed, fix with care` marker is gone. |
| TEST-2532 | REQ-011 | No living surface (CLAUDE.md, docs/ minus superpowers, .orky/baseline/) still carries a present-tense retired phrasing — EIGHT enumerated regexes: the original five (all live at tests-phase time — the executable form of the CONV-023 grep) plus three added by the ESC-001 loopback (the two `.orky/baseline/inferred-spec.md` phrasings per FINDING-004, and the `pure-control repaints` vocabulary per FINDING-008). |
| TEST-2533 | REQ-011 | CLAUDE.md + docs/features/status-engine.md positively state repaint printable text is "admitted to the tail"; docs/decisions.md keeps the locked decision heading verbatim while its surrounding prose gains the 0025 context. |
| TEST-2534 | REQ-011 | `CHANGELOG.md` `[Unreleased]` mentions the cursor-home repaint admission. |
| TEST-2541 | REQ-008 | Net-presence guard: the two frozen unit pins exist under their exact names; `tests/e2e/marker-less-pane.spec.ts` still carries TEST-QA11; the fixture + `status.spec.ts` + `pane-status-css.test.ts` exist. **Residual process obligation (not npm-test-verifiable):** a recorded green run of `npm run build && npx playwright test tests/e2e/marker-less-pane.spec.ts` (workers: 1) with the spec + fixture byte-unchanged, before the review gate closes (CONV-052). |

REQ-003's and REQ-008's "assertion bodies unmodified" clauses are additionally carried by the two
pre-existing pins in `tests/main/status-tracker.test.ts` ("a screen repaint does NOT resurrect
busy…", "ignores screen-redraw chunks…") and the AI pin ("keeps an AI session BUSY while it
shows esc to interrupt") — assertion-body-unchanged and green (comments amended per the ESC-001
record below). REQ-004's byte-unchanged set
(every non-repaint case + CHAR-002/003/004) is byte-unchanged and green (TASK-005's check).

## ESC-001/ESC-002 amendment record (CONV-018)

The ESC-001 loopback (2026-07-09, FINDING-004/FINDING-008) amended this frozen suite twice, both
re-frozen through the sanctioned tests-phase path (same pattern as the TEST-2527 CONV-059
collision record above):

- **TEST-2532 banned list: 5 → 8 regexes.** Added the two `.orky/baseline/inferred-spec.md`
  present-tense phrasings (the retired REQ-007 clause + the `===true` acceptance vector) and the
  `pure-control (?:screen )?repaints` vocabulary (docs/features/ai-session-awareness.md).
- **Comment-only vocabulary amendments in three pre-existing `status-tracker.test.ts` pins**
  (the oscillation pin, the working-bar pin, and its vector comment): `isPureControl`-based
  explanations updated to the `isRepaintChunk` split. `git diff` shows comment hunks only; every
  assertion body is byte-identical. ESC-002 (FINDING-018, CONV-018) propagated this arbitration
  into 02-spec.md REQ-003/REQ-008's acceptance wording and this record.

## RED verification (REQ-010 enumeration)

`npm test` on 2026-07-09, exit code **1** — 16 failed / 2256 passed / 2 skipped (312 files,
5 failed). The failing set, file by file:

| File | Failing | Classification |
|---|---|---|
| `tests/main/status-tracker.test.ts` | TEST-2501, TEST-2502, TEST-2503, TEST-2513 (the new 0025 describe; all 15 pre-existing tests green) | feature's new suite |
| `tests/main/needs-input-classifier.test.ts` | TEST-2521, TEST-2523, TEST-2524, TEST-2525 (`isRepaintChunk` does not exist yet; TEST-2522 green — class (i) is unchanged behavior) | feature's new file |
| `tests/characterization-status.test.ts` | TEST-2526 only (CHAR-001 block; CHAR-002/003/004/005 green) | the sanctioned CHAR-001 amendment |
| `tests/main/needs-input.test.ts` | TEST-2527 only (25 other tests green) | resolved tests-phase collision (CONV-059), recorded above |
| `tests/docs-feature-0025.test.ts` | TEST-2531..TEST-2534 (6 its) | feature's new doc-drift file (green at TASK-007, the docs-feature-0022/0024 precedent) |

No OTHER pre-existing suite newly fails. `tests/regression-net-0025.test.ts` (TEST-2541) is
green from day 1 by design (it guards presence, not the fix).

Remaining hold-the-line tests (TEST-2504..2512, 2514..2516, 2522) pass pre-fix by design:
they pin behavior the spec declares UNCHANGED, freezing it against the implementation's code
reshaping.
