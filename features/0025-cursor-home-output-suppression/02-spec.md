# Spec — 0025-cursor-home-output-suppression

**Phase:** 2 (spec) — derived from `01-concept.md` (D1/D2/D3, settled with the human 2026-07-09)
and `00-intake.md` (baseline KNOWN BUG #4).

## Concerns

`["determinism", "qol", "doc-drift"]`

- **determinism** — hot-path classification logic; quiet-timer/tick semantics; exact, recorded
  CHAR amendments; fully deterministic unit simulation (no real ConPTY/ssh in CI).
- **qol** — the user-visible surface is the pane status chip: wedged-busy TUIs become
  needs-input-capable; marker-less full-screen TUIs reading idle is documented intended behavior.
- **doc-drift** — CLAUDE.md's status gotcha bullets, `docs/decisions.md` context,
  `.orky/baseline/architecture.md` bug #4, and `docs/deferred.md` all describe the current
  suppression; CONV-008 applies at doc-sync.
- (always-on per `.orky/config.json`: security, quality, devils-advocate.)

Considered and dropped (recorded in the concept): **performance** (no new per-chunk cost class —
see Design notes), **networking** (no wire/transport change).

## Baseline supersession (brownfield contract)

This feature **intentionally amends baseline REQ-007** ("Status tail is ANSI-stripped and
screen-repaints are excluded", `.orky/baseline/inferred-spec.md`), specifically its clause that a
chunk beginning with a cursor-home sequence is *excluded from the tail*. The ANSI-stripping clause
and the quiet-timer exclusion clause of baseline REQ-007 are **preserved**. The corresponding
characterization pin — **CHAR-001**'s `isPureControl('\x1b[Hreal text') === true`
(`tests/characterization-status.test.ts:31`) — is amended **through the tests phase** as a
recorded, deliberate change (see REQ-010). The LOCKED 2026-07-08 decision in `docs/decisions.md`
("a marker-less pane goes busy on real output only — never on a repaint") is preserved **verbatim**
— nothing in this spec gives a repaint any busy effect.

## Vocabulary (used by the requirements)

- **Repaint chunk** — an output chunk matching `CURSOR_HOME_RE`: zero or more cursor show/hide
  prefixes (`\x1b[?25l` / `\x1b[?25h`) followed by a cursor-home sequence (`\x1b[H` or
  `\x1b[1;1H`) at the very start of the chunk. A home sequence *not* at the start does not make a
  chunk a repaint (existing anchoring, unchanged).
- **Printable content** — `stripAnsi(chunk)` with control characters (`\x00–\x1f`, `\x7f`) and
  whitespace removed is non-empty (the existing second branch of `isPureControl`, unchanged).
- **The tail** — `StatusTracker`'s ~400-char ANSI-stripped needs-input buffer
  (`(tail + stripAnsi(text)).slice(-400)`; `lastLine()` skips trailing blank lines).
- **Real output** — a chunk that is neither a repaint chunk nor without printable content.

The three resulting observable classes: (i) no printable content, (ii) repaint chunk **with**
printable content, (iii) real output. Class (ii) is the class whose behavior this feature changes.

## Requirements

### REQ-001 — A repaint chunk's printable text is admitted to the needs-input tail (the fix)
`StatusTracker.onOutput` MUST append a repaint chunk's `stripAnsi`'d text to the tail with exactly
the same append-and-cap discipline as real output (`(tail + stripAnsi(text)).slice(-400)` — full
admission per concept D2, no prompt-gating), so a TUI that redraws the screen AND prints a fresh
input prompt in one home-prefixed chunk can reach `needs-input` once quiet.
**Acceptance:** a unit test builds a busy `StatusTracker` (both variants: marker-driven via
`onMarker('C', …)` and marker-less via prior real output), feeds ONE chunk
`'\x1b[?25l\x1b[H' + <multi-line screen content> + '\r\nOverwrite? [y/N] '`, then calls
`tick()` at ≥ `quietMs` of real-output silence → state is `'needs-input'`. (Pre-fix this wedges
`'busy'` forever — the tests-phase RED witness for the fix itself.)

### REQ-002 — Repaint chunks never touch the quiet timer
A repaint chunk (with or without printable content) MUST NOT update `lastOutputAt`: quiet is
measured from the last **real output** only. (This is what keeps regression (b) closed and is
non-negotiable per intake/concept.)
**Acceptance:** a unit test emits real output at `t0` (busy), a repaint-with-prompt chunk at
`t0 + quietMs − ε`, then `tick(t0 + quietMs)` → `'needs-input'` fires timed from `t0` — i.e. a
tick less than `quietMs` after the repaint but ≥ `quietMs` after the real output still fires,
proving the repaint did not restart the quiet window. A symmetric vector shows
`computeIdleFallback` timing is likewise unaffected (repaint at `t0 + heuristicIdleHardMs − ε`
does not delay the sustained-silence idle flip).

### REQ-003 — Repaint chunks never directly change tracker state
A repaint chunk MUST NOT itself cause any state transition:
(a) it MUST NOT mark a marker-less pane busy (locked decision, preserved verbatim), and
(b) it MUST NOT reset an existing `'needs-input'` state back to `'busy'` (that reset stays
exclusive to real output — concept D1/OQ7), and
(c) a pane that is `'idle'` stays `'idle'` even when the repaint's painted last line is
prompt-shaped (`tick()` computes needs-input only from `'busy'`; the state machine is unchanged).
Sole pre-existing exception, unchanged: the AI working-indicator scan (`AGENT_WORKING_RE` over
`scanBuf`) already reads ALL output including repaints and may flip an `aiActive` pane busy.
**Acceptance:** (a) the existing pins in `tests/main/status-tracker.test.ts` ("a screen repaint
does NOT resurrect busy on a marker-less pane", "ignores screen-redraw chunks: they do not reset
the quiet timer or clear needs-input") pass with **assertion bodies unmodified** — their
explanatory comments carry the comment-only vocabulary amendments recorded by ESC-001
(2026-07-09; `isPureControl` → `isRepaintChunk` phrasing, behavior-identical, `git diff` shows
comment hunks only) — PLUS a new vector: an idle marker-less
tracker fed `'\x1b[Hfresh TUI frame content'` (NEW printable non-prompt text) stays `'idle'` on
that call and on the next `tick()`. (b) a tracker in `'needs-input'` fed a repaint chunk carrying
*different* printable text than before remains `'needs-input'`. (c) an idle marker-less tracker
fed `'\x1b[HDelete file? '` stays `'idle'` across subsequent ticks. The AI exception is pinned by
the existing "keeps an AI session BUSY while it shows esc to interrupt" test passing with its
assertion body unmodified (same ESC-001 comment-only amendment).

### REQ-004 — Real-output semantics are byte-for-byte unchanged
For real output, `onOutput` MUST continue to: update `lastOutputAt`, append to the tail, reset
`'needs-input'` → `'busy'`, and mark a marker-less pane busy. Marker (`onMarker`) semantics and
`tick()` decision logic (`computeIdleFallback`, `computeNeedsInput`) are out of scope and MUST
not change.
**Acceptance:** every non-repaint case in `tests/main/status-tracker.test.ts`, CHAR-002, CHAR-003,
and CHAR-004 (`tests/characterization-status.test.ts`) pass **unmodified**. If the chosen code
shape unexpectedly perturbs CHAR-004, that is a spec violation of this REQ, not a test to amend.

### REQ-005 — Chunks without printable content stay fully inert (unchanged behavior)
A chunk with no printable content — ANSI-only (`'\x1b[2J'`), whitespace-only (`'   \r\n'`), and a
repaint chunk whose stripped content is only whitespace/control (`'\x1b[H\x1b[K\r\n'`) — MUST
leave the tail, the quiet timer, and the state untouched, exactly as today ("nothing to admit").
No silent divergence between the home-prefixed and non-home-prefixed no-printable cases (CONV-003:
the 400-char tail cap is the only truncation, stated here and asserted by REQ-007's test).
**Acceptance:** a unit test seeds a busy tracker with a pattern-matching prompt via real output,
feeds each of the three no-printable chunks, and asserts `'needs-input'` still fires on the
original schedule with the original prompt (i.e. `lastLine` unchanged — trailing whitespace
admission did not occur).

### REQ-006 — Regression (a) re-verified: ConPTY repaint prompt-eviction stays closed
A full-screen ConPTY-style repaint whose repainted content ends at the prompt (the mainline case:
the cursor sits at the prompt, so the prompt is the last non-blank painted line) followed by
trailing erase-line/newline/cursor bytes MUST NOT evict the prompt from the tail's `lastLine`
NOR wedge the pane busy: `'needs-input'` MUST still fire (if pending) or hold (if already set).
Both home forms (`\x1b[H`, `\x1b[1;1H`) and the optional `\x1b[?25l`/`\x1b[?25h` prefixes MUST be
covered.
**Acceptance:** unit simulation per concept D3: (1) busy tracker with a pattern-matching prompt
already in the tail via real output; feed
`'\x1b[?25l\x1b[1;1H' + <several screen lines> + 'Overwrite? [y/N] ' + '\x1b[K\r\n\x1b[K\x1b[?25h'`
(prompt as last non-blank painted line, erase trailers after it); `tick()` after quiet →
`'needs-input'`; (2) same chunk delivered while already `'needs-input'` → state holds; (3) a
variant using `'\x1b[H'` with no prefix passes identically. No vector may ever observe `'busy'`
persisting past the quiet threshold with a prompt-terminal tail.

### REQ-007 — Below-prompt displacement is characterized as chosen behavior
With full admission (concept D2, human-resolved OQ2), a repaint that paints content **below** the
prompt line makes the painted last non-blank line the new `lastLine`; when that line is not
prompt-shaped, `'needs-input'` does not fire from that tail, and a large repaint can displace an
earlier prompt out of the 400-char window. This is CHOSEN behavior, and it MUST be pinned by a
characterization-style test whose header names it as the concept-D2 residual risk and the revisit
trigger for the rejected prompt-gated alternative.
**Acceptance:** a unit test: busy tracker, prompt entered via real output, then a repaint chunk
that paints the prompt mid-screen followed by further non-prompt lines (total printable content
> 400 chars in one variant, asserting the cap applies to repaint-admitted text — CONV-003) →
`tick()` after quiet stays `'busy'` (no needs-input from the displaced prompt); the test comment
cites concept D2 and this REQ.

### REQ-008 — Regression (b) net: oscillation pins stay green unchanged, witnessed end-to-end
The existing scenario-(b) nets MUST pass with **assertion bodies unmodified**: the two repaint
pins in `tests/main/status-tracker.test.ts` (part of REQ-003's acceptance; their explanatory
comments carry the ESC-001-recorded comment-only vocabulary amendments — assertions byte-identical)
and e2e
`tests/e2e/marker-less-pane.spec.ts` (TEST-QA11) with its `tests/fixtures/fake-remote-shell.mjs`
fixture, both byte-unchanged, which MUST NOT need behavioral changes. Because e2e is outside the gate profile
(`npm run build` + `npm test`), the e2e net MUST be witnessed green at least once against the
built implementation before the review gate closes (CONV-052).
**Acceptance:** `npm run build` then a recorded green run of
`npx playwright test tests/e2e/marker-less-pane.spec.ts` (workers: 1) on the implemented feature,
with the spec file and fixture byte-unchanged; `tests/e2e/status.spec.ts` real-box measurement and
`tests/renderer/pane-status-css.test.ts` also unchanged and green (no chrome/CSS change —
intake non-goal).

### REQ-009 — Classifier contract is total and edge-complete (CONV-002)
The pure classification seam exported from `src/main/status/needs-input.ts` MUST be a total
function (never throws on any string) that distinguishes the three observable classes of the
Vocabulary section, and its documented + tested inputs MUST include: empty string; ANSI-only;
whitespace-only; home-mid-chunk (`'cleared \x1b[Hmid'` → real output — anchoring preserved);
home-prefixed without printable content (class i); home-prefixed with printable content
(class ii); plain text (class iii). Whether this is a new three-way classifier or an amended
`isPureControl` plus a tracker-side `CURSOR_HOME_RE` special-case is a plan decision (concept
OQ6 — single production consumer, `status-tracker.ts:54`); either shape MUST satisfy this REQ's
observable contract.
**Acceptance:** unit tests enumerate exactly the vectors above against the exported seam;
`''` classifies as "no printable content" and no vector throws.

### REQ-010 — CHAR-001 amended as a recorded, deliberate change; RED set enumerated
The CHAR-001 pin `isPureControl('\x1b[Hreal text') === true`
(`tests/characterization-status.test.ts`) MUST be amended **at the tests phase** — never silently
during implementation — to assert the NEW classification of a home-prefixed chunk carrying
printable text (per whichever REQ-009 shape the plan selects), with a comment citing this feature
and baseline REQ-007. The tests-phase RED verification MUST enumerate the failing files and assert
the set is exactly this feature's new suites plus the amended CHAR-001 block — any OTHER
pre-existing suite newly failing is a collision to resolve before the freeze (CONV-059).
**Acceptance:** the recorded RED run lists exactly {the feature's new unit test file(s),
`tests/characterization-status.test.ts` (CHAR-001 block only)}; post-implementation `npm test` is
green with CHAR-002/003/004 byte-unchanged.

### REQ-011 — Documented claims retired repo-wide (CONV-008, doc-sync)
Every documented claim that "a chunk beginning with a cursor-home sequence is excluded from the
status tail" MUST be retired or amended to the new behavior ("excluded from the quiet timer and
all state effects; its printable text IS admitted to the tail"), across the WHOLE docs tree plus
`CLAUDE.md` and `.orky/baseline/` — specifically at least: CLAUDE.md's two status gotcha bullets
("Status tail must be ANSI-stripped", "A marker-less pane treats output as the only busy
signal…"), `docs/decisions.md` (surrounding prose only — the locked decision text itself stays
verbatim), `.orky/baseline/architecture.md` bug #4 (mark FIXED, pattern of bugs #1–#3),
`docs/deferred.md` (strike the entry), `docs/features/status-engine.md`, and `CHANGELOG.md`
`[Unreleased]`. Per CONV-023, the enumeration claim is grounded in an exact search: pattern
`(?i)cursor-home|cursor home|\x1b\[H|1;1H` (ripgrep, fixed at doc-sync time) over scope `docs/`,
`CLAUDE.md`, `.orky/baseline/`, run repo-wide before closing.
**Acceptance:** after doc-sync, running that grep over that scope yields NO remaining statement
asserting tail-exclusion of repaint chunks as *current* behavior (historical/changelog mentions
describing the old behavior as past are allowed); `.orky/baseline/architecture.md` bug #4 reads
FIXED with this feature's id; the frozen doc-drift guards (`tests/docs-feature-*.test.ts`) stay
green.

## Public interface

No app-level public interface changes: **no IPC contract change, no renderer change, no
`SCHEMA_VERSION` bump, no persistence change, no chrome/CSS change.** The only public seam is the
module-internal one consumed by tests and `StatusTracker`:

- `src/main/status/needs-input.ts` — the exported pure classification function(s). Current export
  `isPureControl(s: string): boolean` either gains an amended contract or is joined/replaced by a
  three-way classifier (plan decision, REQ-009). `stripAnsi`, `tailMatchesInputPrompt`,
  `computeNeedsInput`, `computeIdleFallback`, `looksLikePrompt`, `DEFAULT_NEEDS_INPUT_PATTERNS`,
  `AGENT_WORKING_RE`, `AGENT_WORKING_GRACE_MS` are unchanged.
- `src/main/status/status-tracker.ts` — `StatusTracker`'s public methods (`onMarker`, `onOutput`,
  `tick`, `status`, `setAiActive`) keep their exact signatures; only `onOutput`'s internal
  handling of class-(ii) chunks changes per REQ-001–REQ-003.

## Design notes (non-normative)

- **Performance:** no new per-chunk cost class is permitted in spirit — `stripAnsi` already runs
  on **every** chunk for `scanBuf` (`status-tracker.ts:47`), which is also the shipped precedent
  for "read a repaint's text without treating it as activity". The rejected content-delta scheme
  (concept OQ4, deferred) would add per-chunk comparison state; reviewers should flag any new
  per-chunk buffers beyond the existing `tail`/`scanBuf`.
- The theoretical false positive — an actively-working TUI whose painted last line happens to be
  prompt-shaped (e.g. ends in `?`) flipping `'needs-input'` after real-output quiet — is accepted
  per concept D1 as needs-input-pattern territory (same risk class as the existing `?` catch-all,
  baseline bug #2's fix).
- A marker-less pane running a continuously-repainting full-screen TUI (`top`, `vim`) continues
  to read **idle** — deliberate, documented intended behavior (concept D1); REQ-011 carries this
  into the docs.

## Open questions

None blocking. Deferred out of scope (recorded in the concept, not spec questions):
OQ4 (busy-on-changing-repaints / content-delta) — candidate follow-up ledger entry;
OQ5 (in-app Orky mirror learning the root-`features/` layout) — separate candidate feature;
OQ6 (exact classifier code shape) — delegated to the plan phase within REQ-009's contract.
