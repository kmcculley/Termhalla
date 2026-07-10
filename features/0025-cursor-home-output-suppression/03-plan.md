# Plan — 0025-cursor-home-output-suppression

**Phase:** 3 (plan) — derived from `02-spec.md` (REQ-001..REQ-011).

## Design decision (resolves REQ-009 / OQ6)

Single production consumer of the pure classifier is `status-tracker.ts:54`. Rather than adding a
second exported function, **amend `isPureControl`'s contract in place** and add one new tiny
exported helper so `StatusTracker` can distinguish the "no printable content" case (still fully
inert) from the "repaint with printable content" case (admitted to the tail, but never touches the
quiet timer / state). Concretely, in `src/main/status/needs-input.ts`:

- `isPureControl(s: string): boolean` keeps its name and total-function/never-throws contract, but
  DROPS the `CURSOR_HOME_RE` early-return. It becomes pure "no printable content" detection (today's
  second branch only) — i.e. classes (i) and (ii)-with-no-printable-content still return `true`;
  class (ii)-with-printable-content now returns `false` (this is the amendment CHAR-001 pins).
- New exported `isRepaintChunk(s: string): boolean` wraps the (unexported, still module-private)
  `CURSOR_HOME_RE` test — this is REQ-009's third observable axis (repaint vs not), decoupled from
  "has printable content".
- `status-tracker.ts.onOutput` recomputes its branching from these two booleans:
  - `printable = !isPureControl(text)`
  - `repaint = isRepaintChunk(text)`
  - Tail admission (`this.tail = (this.tail + stripAnsi(text)).slice(-400)`) happens whenever
    `printable` is true (repaint or not) — REQ-001, REQ-007.
  - `lastOutputAt` update, `needs-input`→`busy` reset, and the marker-less `!hasMarkers → busy`
    rule happen ONLY when `printable && !repaint` (real output) — REQ-002, REQ-003(a)(b).
  - The AI working-indicator scan (`scanBuf`/`AGENT_WORKING_RE`) is unchanged: it already runs on
    every chunk before this branching, unconditionally on `text` — REQ-003 sole exception.
  - `tick()` / `computeNeedsInput` / `computeIdleFallback` / `state === 'idle'` handling are
    entirely unchanged (REQ-003(c), REQ-004): no new call sites, no signature changes.

This satisfies REQ-009's total-classifier contract (`isPureControl` unchanged signature,
`isRepaintChunk` new, both total/never-throw, cover all enumerated vectors) with the smallest
diff: one dropped branch, one new one-line helper, and `onOutput`'s existing `if (!pure)` block
split into "admit to tail" vs "treat as real output" using the two booleans above. No new
per-chunk state (Design notes / no new buffers beyond existing `tail`/`scanBuf`).

## Target file / module layout

| File | Change |
|---|---|
| `src/main/status/needs-input.ts` | Remove `CURSOR_HOME_RE` branch from `isPureControl`; add exported `isRepaintChunk` (reuses the existing `CURSOR_HOME_RE` constant, still module-private); update the two doc comments above `isPureControl` and `CURSOR_HOME_RE` to state the new contract split. |
| `src/main/status/status-tracker.ts` | `onOutput`: compute `printable`/`repaint`; split tail-admission from real-output effects (quiet timer, needs-input reset, marker-less busy) per the branching above. Update the inline comment block (lines ~55-70) to match. No signature change. |
| `tests/characterization-status.test.ts` | REQ-010: amend the CHAR-001 `isPureControl` assertion for `'\x1b[Hreal text'` from `true` to `false`, with a comment citing this feature id and baseline REQ-007. CHAR-002/003/004 byte-unchanged. Add/extend CHAR-001 vectors for `isRepaintChunk` per REQ-009 (new; additive, doesn't touch the CHAR-001 pin's amended assertion's neighbors). |
| `tests/main/status-tracker.test.ts` | Add new vectors for REQ-001, REQ-002, REQ-003(new sub-vectors), REQ-005, REQ-006, REQ-007. The two existing REQ-003/REQ-008 pins ("a screen repaint does NOT resurrect busy…", "ignores screen-redraw chunks…") MUST pass unmodified — do not edit those two `it` blocks. |
| `tests/main/needs-input.test.ts` (new, if no existing unit-test file solely for `needs-input.ts` exports beyond characterization — verify at tests phase; may instead extend `tests/characterization-status.test.ts`) | REQ-009's exact enumerated vectors against the exported seam (`isPureControl`, `isRepaintChunk`): empty string, ANSI-only, whitespace-only, home-mid-chunk, home-prefixed-no-printable, home-prefixed-with-printable, plain text. |
| `tests/e2e/marker-less-pane.spec.ts`, `tests/fixtures/fake-remote-shell.mjs` | REQ-008: byte-unchanged; re-run and witness green post-implementation (no plan task edits these files). |
| `tests/e2e/status.spec.ts`, `tests/renderer/pane-status-css.test.ts` | REQ-008: byte-unchanged; re-run and witness green (no chrome/CSS change). |
| `CLAUDE.md` | REQ-011: amend the "Status tail must be ANSI-stripped" bullet and the "A marker-less pane treats output as the only busy signal" bullet to state repaint text is now admitted to the tail (quiet-timer/state exclusion only). |
| `docs/decisions.md` | REQ-011: amend surrounding prose (not the locked decision text itself) to reflect the new tail-admission behavior. |
| `.orky/baseline/architecture.md` | REQ-011: mark known bug #4 FIXED with this feature's id, following the pattern of bugs #1-#3's fixed annotations. |
| `docs/deferred.md` | REQ-011: strike the corresponding deferred entry, if present (search first — spec says "if present" implicitly via CONV-023 grep; confirm at doc-sync). |
| `docs/features/status-engine.md` | REQ-011: amend the "ANSI-strip tail hazard" and "A repaint must not mark a marker-less pane busy" bullets (lines ~74-75) to describe the new admitted-to-tail behavior; keep the oscillation-prevention explanation (still true) but drop/rephrase the "excluded from the tail" claim. |
| `CHANGELOG.md` | REQ-011: add an `[Unreleased]` entry per CONV-008/repo convention, referencing this feature id and baseline bug #4. |

## Ordered tasks

- **TASK-001** — Implement `isRepaintChunk` and amend `isPureControl` in
  `src/main/status/needs-input.ts` per the Design decision above (drop the `CURSOR_HOME_RE` branch
  from `isPureControl`; add the new exported helper; update doc comments).
  Files: `src/main/status/needs-input.ts`.
  Depends on: none.
  Satisfies: REQ-009.

- **TASK-002** — Amend `StatusTracker.onOutput` in `src/main/status/status-tracker.ts` to split
  tail-admission (all printable content, repaint or not) from real-output-only effects (quiet
  timer, needs-input→busy reset, marker-less busy rule), using `isPureControl`/`isRepaintChunk`
  from TASK-001. Update the inline comment block to match the new contract.
  Files: `src/main/status/status-tracker.ts`.
  Depends on: TASK-001.
  Satisfies: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005.

- **TASK-003** — Amend the CHAR-001 pin in `tests/characterization-status.test.ts`: change the
  `isPureControl('\x1b[Hreal text')` assertion from `true` to `false`, with a comment citing this
  feature and baseline REQ-007; add REQ-009's enumerated classifier vectors (empty, ANSI-only,
  whitespace-only, home-mid-chunk, home-no-printable, home-with-printable, plain text) covering
  both `isPureControl` and the new `isRepaintChunk`, colocated in this file (extending CHAR-001's
  describe block or a new adjacent describe, per what reads cleanest at tests-phase authoring
  time) — CHAR-002/003/004 blocks stay byte-unchanged.
  Files: `tests/characterization-status.test.ts`.
  Depends on: TASK-001.
  Satisfies: REQ-009, REQ-010.

- **TASK-004** — Add new `StatusTracker`-level unit vectors to `tests/main/status-tracker.test.ts`
  covering: REQ-001 (repaint-with-prompt reaches needs-input, both marker-driven and marker-less
  busy trackers), REQ-002 (repaint chunk does not restart the quiet timer, for both
  `computeNeedsInput` timing and the symmetric `computeIdleFallback` vector), REQ-003 additional
  sub-vectors ((a) idle marker-less tracker stays idle on new-printable repaint text and on
  prompt-shaped repaint text; (b) needs-input holds under a repaint carrying different printable
  text), REQ-005 (the three no-printable-content chunk shapes stay fully inert against a
  pattern-matching tail already set by real output), REQ-006 (both `\x1b[H` and `\x1b[1;1H` forms,
  with/without `\x1b[?25l`/`\x1b[?25h` prefixes, prompt-as-last-painted-line repaint does not evict
  the prompt or wedge busy — covers the busy→needs-input, already-needs-input-holds, and
  no-prefix-variant sub-cases), REQ-007 (below-prompt displacement characterization vector,
  including a >400-char variant, with a test comment citing concept D2 and this REQ as the
  revisit trigger for the rejected prompt-gated alternative). The two pre-existing pins named in
  REQ-003/REQ-008's acceptance criteria MUST NOT be edited.
  Files: `tests/main/status-tracker.test.ts`.
  Depends on: TASK-002.
  Satisfies: REQ-001, REQ-002, REQ-003, REQ-005, REQ-006, REQ-007.

- **TASK-005** — Re-verify REQ-004's byte-unchanged acceptance set (every non-repaint case in
  `tests/main/status-tracker.test.ts`, plus CHAR-002/CHAR-003/CHAR-004) stays green with no edits;
  record this as an explicit pass/fail check at the tests phase (no file changes expected — this
  task is a verification gate, not an edit).
  Files: `tests/main/status-tracker.test.ts` (read-only check), `tests/characterization-status.test.ts` (read-only check).
  Depends on: TASK-002, TASK-003, TASK-004.
  Satisfies: REQ-004.

- **TASK-006** — Build (`npm run build`) then run `npx playwright test
  tests/e2e/marker-less-pane.spec.ts` (workers: 1) against the implemented feature and record a
  green run, with the spec file and `tests/fixtures/fake-remote-shell.mjs` byte-unchanged. Also
  re-run `tests/e2e/status.spec.ts` and `tests/renderer/pane-status-css.test.ts` and confirm green,
  byte-unchanged.
  Files: none changed; verification only (touches no repo files besides the build output).
  Depends on: TASK-002.
  Satisfies: REQ-008.

- **TASK-007** — Run the CONV-023 grep (`(?i)cursor-home|cursor home|\x1b\[H|1;1H`) over
  `docs/`, `CLAUDE.md`, `.orky/baseline/` to enumerate every doc site to amend, THEN update:
  `CLAUDE.md` (the two named status gotcha bullets), `docs/decisions.md` (surrounding prose only),
  `.orky/baseline/architecture.md` (mark bug #4 FIXED with this feature's id, matching bugs #1-#3's
  style), `docs/deferred.md` (strike the entry if present), `docs/features/status-engine.md` (the
  "ANSI-strip tail hazard" and marker-less-busy bullets), and add a `CHANGELOG.md` `[Unreleased]`
  entry. Re-run the same grep after editing and confirm no remaining current-behavior claim of
  tail-exclusion for repaint chunks (historical/past-tense mentions allowed). Confirm
  `tests/docs-feature-*.test.ts` stay green.
  Files: `CLAUDE.md`, `docs/decisions.md`, `.orky/baseline/architecture.md` (via the Gatekeeper CLI,
  not direct file edit, per repo control-file rule), `docs/deferred.md`, `docs/features/status-engine.md`,
  `CHANGELOG.md`.
  Depends on: TASK-006.
  Satisfies: REQ-011.

## Open issues

None. Every REQ-001..REQ-011 is covered by at least one task above; no REQ was found
under-specified during planning.
