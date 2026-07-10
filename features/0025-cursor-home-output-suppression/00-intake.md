# Intake — 0025-cursor-home-output-suppression

**Phase:** 0 (intake) — captured by `/orky:new` 2026-07-09.
**Origin:** baseline KNOWN BUG #4 (`.orky/baseline/architecture.md` § Suspected/confirmed bugs) —
the last open item from the 2026-07-09 quality/annoyance triage (bugs #1–#3 fixed the same day in
7bd742d / e443dba). Deliberately routed through the full gated pipeline rather than the batch fixes
because the guard it relaxes is **load-bearing** (two prior real bugs live on either side of it).

> **Feature location note:** this is the FIRST feature under the root `features/` directory — the
> canonical Orky feature-artifact location as of plugin 0.35 ("do not put new feature state under
> `.orky/features/`"). Features 0001–0024 remain under `.orky/features/` (legacy layout); the id
> sequence continues from there. Known consequence: Termhalla's own in-app Orky mirror
> (`orky-root-engine.ts` / `orky-root-detail.ts` / `orky-action-dispatcher.ts`) reads
> `<root>/.orky/features/` only, so this run will not surface in the app's Orky pane / decision
> queue / dispatch actions — use the CLI/session directly. (Teaching the app the root-`features/`
> layout is a candidate follow-up feature, not in scope here.)

## Idea (verbatim)

Fix baseline known bug #4: isPureControl suppresses real output that begins with a cursor-home
sequence. A home-prefixed chunk carrying NEW printable text must be able to update the needs-input
tail (and possibly busy detection) WITHOUT resurrecting either (a) the ConPTY repaint
prompt-eviction bug or (b) the ssh busy⇄idle oscillation.

## Problem

`isPureControl` (`src/main/status/needs-input.ts`) returns true for any chunk matching
`CURSOR_HOME_RE = /^(?:\x1b\[\?25[lh])*\x1b\[(?:H|1;1H)/` — i.e. any chunk *beginning* with a
cursor-home escape (optionally preceded by cursor show/hide) is classified as a terminal screen
repaint, **regardless of what printable text follows**. In `StatusTracker.onOutput`
(`src/main/status/status-tracker.ts`), a pure-control chunk is excluded from:

1. the **needs-input tail** (`this.tail`) — so a TUI that redraws the screen AND prints a fresh
   input prompt in one home-prefixed chunk never gets that prompt into the tail, and
   `computeNeedsInput` can never match it → the pane never reaches needs-input (wedged busy);
2. the **quiet timer** (`lastOutputAt`) — so an actively-redrawing full-screen program reads as
   "silent", feeding `computeIdleFallback`'s sustained-silence path;
3. the **marker-less busy rule** (`!hasMarkers → busy`, moved inside the guard 2026-07-08) — so a
   marker-less pane (an `ssh` launch override gets no shell-integration injection; remote-agent
   panes inject none) running a full-screen TUI (`top`, `vim`) reads **idle** even while it
   repaints continuously: home-prefixed chunks are its *only* output.

Verbatim baseline record (bug #4): "Any chunk that *starts* with a cursor-home escape is treated
as a screen repaint and excluded from the status tail / quiet timer, even if it carries new
printable text (e.g. a TUI that redraws then prints a fresh prompt in one chunk). Load-bearing:
this guard exists to avoid prompt eviction on ConPTY full-screen repaints. A fix must distinguish
a pure repaint from a repaint-that-also-emits-a-new-prompt without reopening the eviction bug — so
its feature must re-verify the repaint-eviction scenario, not just the new case. Fix touches
REQ-007 / CHAR-001."

## Goal

A home-prefixed chunk carrying NEW printable text can update the needs-input tail (and possibly
busy detection), while BOTH historical regressions stay closed:

- **(a) ConPTY repaint prompt-eviction** — a full-screen ConPTY repaint (triggered by any layout
  change) must not evict the real prompt from the ~400-char tail or wedge the pane in "busy"
  (CLAUDE.md → "Status tail must be ANSI-stripped").
- **(b) ssh busy⇄idle oscillation** — repaints must never re-busy a quiet marker-less pane. The
  2026-07-08 decision "A marker-less pane goes busy on real output only — never on a repaint"
  (`docs/decisions.md`) is **LOCKED**; the fix must preserve it. ("A repaint is not evidence a
  program is working; treating it as such gives a pane a busy signal whose own timer immediately
  contradicts it.")

## Key context / what changed since the guard was written

- The tail is now stored **ANSI-stripped** (`this.tail = (this.tail + stripAnsi(text)).slice(-400)`),
  so a repaint's trailing erase-line/cursor bytes no longer reach it, and `lastLine()` **skips
  trailing blank lines**, so erased-line trailers after a prompt don't hide it. Together these MAY
  make it safe for a repaint chunk's stripped text to enter the tail — the eviction vector the
  guard was built against may already be neutralized downstream. **Verify, don't assume** (candidate
  brainstorm direction #1 below). Residual eviction vector to check: a repaint whose *printable*
  screen content (not its escapes) pushes the prompt out of the 400-char window — e.g. a repaint
  where the prompt is mid-screen followed by other painted text.
- The chrome-perturbation root cause of the oscillation is fixed independently (busy/idle chrome
  is paint-only — inset box-shadow, never border/padding/height; pinned by
  `tests/renderer/pane-status-css.test.ts` + a real-box measurement in `tests/e2e/status.spec.ts`),
  but the locked decision stands on its own rationale regardless.
- The AI working-indicator scan (`scanBuf` / `AGENT_WORKING_RE`) already deliberately scans ALL
  output *including* repaints — precedent that "read a repaint's text without treating it as
  activity" is a viable, already-shipped pattern.
- `hasMarkers` is false forever for `ssh` launches and remote-agent panes; output is their ONLY
  busy signal. The "(and possibly busy detection)" part of the idea is in tension with the locked
  decision — resolving that tension (e.g. is a home-prefixed chunk with *new/changed* printable
  content "real output" rather than "a repaint"?) is the central brainstorm question.

## Candidate directions for brainstorm (seeded from triage — weigh, don't assume)

1. **Tail-only update:** let a home-prefixed chunk's `stripAnsi`'d text update ONLY the tail —
   never `lastOutputAt`, never busy. Fixes the wedged needs-input case (a repaint+prompt chunk can
   now match `computeNeedsInput` once quiet); leaves the marker-less full-screen-TUI-reads-idle
   case unfixed (arguably consistent with the locked decision — `top` sitting there IS
   interruptible-idle in the "needs me?" sense). Cheapest; must re-verify eviction scenario (a).
2. **Content-delta classification:** treat a home-prefixed chunk as "real output" only if its
   stripped printable content differs from what the same region previously showed (a pure
   re-render of identical content stays a repaint). Could restore busy for `top` over ssh without
   re-opening (b) — but adds per-chunk state/cost on a hot path and a new class of edge cases.
3. **Prompt-shaped tail probe:** keep the suppression but additionally test a suppressed chunk's
   stripped last line against the needs-input patterns and admit it to the tail only when
   prompt-shaped. Narrower than #1; more special-cased.

Whatever direction: the quiet timer staying untouched by repaints looks non-negotiable (it is what
keeps (b) closed and what CLAUDE.md's marker-less bullet documents as "a repaint must stay inert").

## Existing pins & safety nets (must be respected / amended only through the tests phase)

- `tests/characterization-status.test.ts` — **CHAR-001** pins `isPureControl('\x1b[Hreal text') === true`
  (the exact behavior this feature changes) and **CHAR-004** pins StatusTracker lifecycle. These are
  change-detectors: amend them as a recorded, deliberate change in the tests phase — never blindly
  edit to green. Baseline notes the fix touches **REQ-007 / CHAR-001**.
- `tests/e2e/marker-less-pane.spec.ts` (TEST-QA11) + `tests/fixtures/fake-remote-shell.mjs` — the
  in-app net proving repaints never re-busy a quiet marker-less pane (rides the
  `TERMHALLA_E2E_REMOTE_SSH` harness; `npm run build` before e2e).
- `tests/e2e/status.spec.ts` real-box measurement + `tests/renderer/pane-status-css.test.ts`.
- Tests phase MUST pin BOTH regression scenarios explicitly: (a) full-screen ConPTY repaint with
  trailing erase bytes does not evict the prompt / wedge busy; (b) repaints never re-busy a quiet
  marker-less pane.

## Non-goals (for this feature)

- No change to the marker-driven (shell-integration) status path — OSC 133 A/B/C/D semantics stay.
- No change to AI-session working-indicator detection (`AGENT_WORKING_RE` scan already reads
  repaints; it stays as-is).
- No revisiting of the locked 2026-07-08 decision itself — the fix works within it.
- No chrome/CSS changes (the paint-only rule stands).
- Not teaching the in-app Orky mirror the root-`features/` layout (noted above as follow-up).

## Completion bookkeeping (for doc-sync / human-review)

Mark bug #4 FIXED in `.orky/baseline/architecture.md` and strike it in `docs/deferred.md`
(pattern: how #1–#3 were recorded 2026-07-09), update `CHANGELOG.md` `[Unreleased]`, and per
CONV-008 grep the whole docs tree (+ `CLAUDE.md`, `.orky/baseline/`) for every phrasing of the old
"a chunk beginning with cursor-home is excluded from the tail" claim before retiring it.

## Likely concern tags (to be committed in the spec, not yet)

- **determinism** — pure hot-path classification logic; quiet-timer/tick timing semantics; the
  CHAR change-detector amendments must be exact and recorded; deterministic tests via the fake
  remote-shell fixture (no real ssh/ConPTY in CI).
- **qol / ux** — the user-visible surface is the pane status chip: wedged-busy TUIs, falsely-idle
  ssh TUIs, needs-input reachability.
- **performance** — `onOutput` runs per-chunk on every PTY; any content-delta scheme (direction #2)
  adds state and comparison cost on that hot path.
- **doc-drift** — CLAUDE.md's two status gotcha bullets, `docs/decisions.md`, and
  `.orky/baseline/architecture.md` all document the current suppression; the fix retires/amends
  documented claims (CONV-008).
- (always-on per `.orky/config.json`: security, quality, devils-advocate.)

**Next:** phase 1 (brainstorm) is interactive and belongs to the human (ADR-006). Run
`/orky:brainstorm` to turn this intake into an agreed concept, then `/orky:run` drives
spec→plan→tests→implement→review autonomously.
