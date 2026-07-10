# Concept — 0025-cursor-home-output-suppression

**Phase:** 1 (brainstorm) — settled with the human 2026-07-09 (three explicit forks, all answered).
**Intake:** `00-intake.md` (baseline KNOWN BUG #4).

## Decisions

### D1 — Scope: needs-input reachability ONLY; busy detection stays untouched
A home-prefixed (repaint-classified) chunk's printable text becomes admissible to the
**needs-input tail**. The **quiet timer** (`lastOutputAt`) and **busy detection** (including the
marker-less `!hasMarkers → busy` rule) remain completely untouched by home-prefixed chunks.

Accepted consequences (all deliberate, to be documented as intended behavior):
- A marker-less pane (bare `ssh` launch, remote-agent pane) running a continuously-repainting
  full-screen TUI (`top`, `vim`) **continues to read idle**. Rationale: an unattended full-screen
  TUI is not "needing you" and the locked 2026-07-08 decision ("a marker-less pane goes busy on
  real output only — never on a repaint", `docs/decisions.md`) is preserved **verbatim**, not
  reinterpreted.
- needs-input can now fire from a prompt that arrived *only* via a repaint chunk, timed by a quiet
  timer that repaints do not refresh — this is the fix working (the wedged case: a TUI redraws and
  prints a fresh prompt in one home-prefixed chunk, then waits). The theoretical false positive —
  an actively-working TUI whose painted last line happens to be prompt-shaped — is accepted as
  needs-input-pattern territory (same class of risk as the existing `?` catch-all).
- A repaint-admitted chunk does **not** reset an existing `needs-input` state back to `busy`
  (that reset stays exclusive to real output): a repaint is not evidence the program resumed.

### D2 — Mechanism: full admission of the repaint chunk's stripped text
In `StatusTracker.onOutput`, a chunk classified as a screen repaint (`CURSOR_HOME_RE` match)
appends its `stripAnsi`'d text to the tail exactly the way real output does
(`(tail + stripAnsi(text)).slice(-400)`; `lastLine()` already skips trailing blank lines) — while
skipping every other effect of real output (quiet timer, needs-input→busy reset, marker-less busy
rule). Chunks that are pure control *without* printable content behave as today (nothing to admit).

- Residual risk explicitly carried into the tests phase: with full admission, a repaint that
  paints content **below** the prompt line can displace an earlier prompt inside the 400-char
  window / change `lastLine()`. The mainline ConPTY case (the repainted screen ends at the prompt,
  where the cursor sits) must keep needs-input reachable; the below-prompt case gets characterized
  by a test as chosen behavior. (The prompt-gated alternative was considered and rejected as more
  special-cased; revisit only if tests falsify the mainline assumption.)
- Performance: no new per-chunk cost class — `stripAnsi` already runs on **every** chunk for the
  AI working-indicator `scanBuf` (`status-tracker.ts:47`), which is also the shipped precedent for
  "read a repaint's text without treating it as activity".
- Exact code shape (amend `isPureControl` into a three-way classification vs. special-casing
  `CURSOR_HOME_RE` in the tracker) is a spec/plan decision, not design-changing; `isPureControl`
  has exactly one production consumer (`status-tracker.ts:54`). CHAR-001's pin
  (`isPureControl('\x1b[Hreal text') === true`) is amended **through the tests phase** as the
  recorded, deliberate change (baseline: fix touches REQ-007 / CHAR-001).

### D3 — Verification: unit simulation + existing e2e nets; no new e2e spec
- **Scenario (a) — ConPTY repaint prompt-eviction (the guard's raison d'être):** new unit tests
  feed synthetic full-screen repaint chunks (optional `\x1b[?25l/h` prefix + `\x1b[H`/`\x1b[1;1H`
  + screen content + trailing erase-line/newline bytes) through `StatusTracker` with a pending
  pattern-matching prompt, asserting the prompt survives in the tail, needs-input still
  fires/holds, and nothing wedges busy.
- **The fix itself:** a redraw+fresh-prompt-in-one-chunk sequence flips needs-input after quiet.
- **Scenario (b) — ssh busy⇄idle oscillation:** the existing pins stay green **unchanged** —
  `tests/main/status-tracker.test.ts` ("a screen repaint does NOT resurrect busy on a marker-less
  pane", "repaint must NOT revert to busy nor reset quiet") and e2e
  `tests/e2e/marker-less-pane.spec.ts` TEST-QA11.
- No new e2e spec file; existing e2e (`status.spec.ts` real-box, marker-less TEST-QA11) ride along.

## Concerns (review-routing tags for the spec)

- **determinism** — hot-path classification logic; quiet-timer/tick semantics; exact, recorded
  CHAR-001/CHAR-004 amendments; fully deterministic unit simulation (no real ConPTY/ssh in CI).
- **qol** — the user-visible surface is the pane status chip: wedged-busy TUIs become
  needs-input-capable; marker-less TUIs reading idle is documented intended behavior.
- **doc-drift** — CLAUDE.md's two status gotcha bullets, `docs/decisions.md`,
  `.orky/baseline/architecture.md` bug #4, and `docs/deferred.md` all describe the current
  suppression; CONV-008 (grep the whole docs tree for every phrasing) applies at doc-sync.
- (always-on per `.orky/config.json`: security, quality, devils-advocate.)

Considered and dropped: **performance** (no new per-chunk cost class — see D2); **networking**
(no wire/transport change; marker-less panes are affected but only in pure local logic).

## Open questions

| # | Question | Status | Resolution |
|---|---|---|---|
| OQ1 | Fix scope: needs-input only, or also busy-on-changing-repaints? | **resolved** | needs-input only (human, 2026-07-09; locked decision preserved verbatim). |
| OQ2 | Tail admission: full vs prompt-gated? | **resolved** | Full admission (human, 2026-07-09); below-prompt displacement risk carried into tests. |
| OQ3 | Re-verification depth for scenario (a)? | **resolved** | Unit simulation + existing e2e nets; no new e2e spec (human, 2026-07-09). |
| OQ4 | Should a marker-less full-screen TUI ever read busy (content-delta classification)? | **deferred** | Out of scope; candidate follow-up ledger entry if it ever bites in practice. |
| OQ5 | Teach Termhalla's in-app Orky mirror the root-`features/` layout (this feature is invisible to it). | **deferred** | Separate candidate feature (see intake location note). |
| OQ6 | Exact code shape: three-way classifier vs tracker special-case. | **deferred** | To spec/plan — not design-changing (single consumer). |
| OQ7 | Does a repaint-admitted prompt reset needs-input→busy? | **resolved** | No — reset stays exclusive to real output (D1). |

No `blocking` open questions remain.

**Next:** on human confirmation, record the brainstorm gate and hand to `/orky:run`
(spec → plan → tests → implement → review, autonomous; human surfaces again at final review or an
escalation).
