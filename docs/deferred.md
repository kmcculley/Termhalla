# Deferred Work

Repo-wide deferred items that don't belong to a single Orky/superpowers feature.
Per-feature deferred work lives in [`superpowers/*-review-followups.md`](superpowers/);
the *why* behind a choice lives in [`decisions.md`](decisions.md).

Each item: what, why it was deferred, and what "done" looks like.

---

## Open

### Validate the `hidden` e2e window mode across the full suite
**Added 2026-07-08.** `playwright.config.ts` now defaults to `TERMHALLA_E2E_WINDOW=hidden`, so
e2e never presents its Electron windows (see
[decisions: the e2e suite never presents its Electron windows](decisions.md)). The full-suite
run that would have validated it was cancelled partway.

Verified passing under `hidden`: `status.spec.ts` (including a `boundingBox` measurement),
`editor.spec.ts` (Monaco), `font-zoom.spec.ts`.

**The open question** is specs that read xterm's *rendered rows* rather than React state —
`cwd.spec.ts`, `ai-session.spec.ts`, `minimize-restore.spec.ts` ("output accumulates"). A
never-shown window is a background window, and xterm paints rows on `requestAnimationFrame`;
`backgroundThrottling: false` (set for this mode in `window-manager.ts`) is meant to keep rAF
alive, but that is unproven here.

**Done when:** `npm run build && npm run e2e` passes green on the default (`hidden`). Low risk to
carry: no CI workflow runs e2e, and a failure is loud rather than silent. If rAF does turn out to
be starved, fall back to `TERMHALLA_E2E_WINDOW=inactive` as the default (windows are then visible
but never focused) or add the `--disable-renderer-backgrounding` /
`--disable-background-timer-throttling` Chromium switches.

**First confirmed instance (2026-07-09): hidden-window Monaco re-render stall.** The predicted
risk materialized — for MONACO, not xterm. In `minimize-uniform.spec.ts` TEST-030's seeded
editor+explorer layout, typing into the focused Monaco editor under `hidden` updates the MODEL
(the keystrokes land — a Ctrl+S writes them to disk) but `.view-lines` never re-renders, so the
draft assertion fails deterministically. Measured on the released v0.16.1 build as well — this
was TEST-030's long-standing "flake", not a session regression — and the same probe under
`inactive` re-renders correctly. Notably `editor.spec.ts` (single-editor seed, same
click→Ctrl+Home→type idiom) passes under `hidden`, so the trigger is layout/timing-sensitive, not
a blanket Monaco rule. Disposition: TEST-030's spec now forces `TERMHALLA_E2E_WINDOW=inactive`
for its own launch (a sanctioned launch-env-only amendment, assertions untouched). If more
Monaco-typing specs start stalling under `hidden`, revisit the default per the fallback above
rather than amending specs one by one.

### `git-status.spec.ts` is intermittently flaky
**Added 2026-07-08.** Observed once in a full run: the pane's git chip stayed on `main` and never
showed the `●` dirty marker within the 25 s timeout, after a `Set-Content extra.txt hi`. Passed on
retry, so the suite is green (`retries: 2`), but the underlying race — the git-status poll not
observing a just-written file — is real and unexplained.

**Done when:** either the poll is shown to be correctly debounced against the fs watch and the
timeout is simply tight, or the race is fixed. Do not "fix" it by raising the timeout without
first understanding which of the two it is.

---

## Known bugs recorded elsewhere

`.orky/baseline/architecture.md` records four confirmed known bugs as candidate Orky features;
**#1 (unanchored AI-detection substrings), #2 (the whitespace-strict needs-input question
catch-all), and #3 (merge-conflict count) were FIXED 2026-07-09** in the quality/polish batch
(see the baseline's own entries for the audit trail), leaving only #4 open — deliberately: it is
the load-bearing one below.
One of them — the cursor-home `CURSOR_HOME_RE` catch-all (#4) — **widened** on 2026-07-08:
because a marker-less pane's busy rule now also sits behind `isPureControl`, a full-screen TUI over
ssh whose frames begin with cursor-home (`top`, `vim`) reads *idle* rather than flapping. That was
the deliberate trade over an oscillating pane; see
[decisions: a marker-less pane goes busy on real output only](decisions.md). A fix for #4 must
re-verify the repaint-eviction scenario **and** this busy-detection case.
