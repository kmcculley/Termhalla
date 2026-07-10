# Cursor-home output suppression (Orky 0025) — Review Follow-ups (deferred)

Feature `0025-cursor-home-output-suppression` (baseline KNOWN BUG #4: a home-prefixed chunk
carrying printable text was fully suppressed from the needs-input tail) ran an A/B implement
(determinism concern; both candidates produced byte-identical code) and a 12-finding review. The
one HIGH (FINDING-004 — `.orky/baseline/inferred-spec.md` REQ-007 still asserting the retired
tail-exclusion as current behavior) escalated as **ESC-001** and was **fixed in-feature** at the
human's election via a tests→implement loopback (TEST-2532 banned-list extension + baseline
supersession note), together with the LOW doc-drift batch (FINDING-005/006/008/009). See the
per-finding records in `features/0025-cursor-home-output-suppression/findings.json`.

The items below were **deferred, not fixed** — FINDING-011/012 by explicit human decision
(2026-07-09: "defer + disclose"; disclosed in `docs/features/status-engine.md` → Behaviors).
None is release-blocking; none is a contract violation.

## Deferred follow-ups

### MEDIUM

- **Idle-side leak through the shared tail** (FINDING-011, devils-advocate; recovery severity
  corrected by FINDING-017). The tail feeds not
  only `computeNeedsInput` but also `computeIdleFallback` (`looksLikePrompt` +
  `tailMatchesInputPrompt`). With 0025's full admission, a busy *marker-driven* pane fed a
  home-prefixed repaint whose painted bottom line ends prompt-shaped (`>`, `%` — e.g. a progress
  footer) can flip busy→idle at `heuristicIdleHardMs` of real-output silence while the command
  still runs; pre-0025 the repaint was fully inert and the pane stayed busy. **Recovery
  (FINDING-017, verified against the state machine): command-lifetime on a marker-driven pane** —
  the busy rule is gated on `!hasMarkers` and `tick()` transitions only *from* busy, so the
  spuriously-idled pane stays idle until the next command-start marker (B/C); only a marker-less
  pane re-busies on the next real output. **Why deferred:** human decision 2026-07-09, REAFFIRMED
  2026-07-09 after FINDING-017 corrected the understated disclosure — same accepted-risk family as
  the needs-input `?` catch-all (a pattern-shaped painted line is rare and the flip needs 5 s of
  true real-output silence), and the failure mode is a wrong chip, not a wedge. Disclosed in
  status-engine.md → Behaviors; the decisions.md 0025 update block's "only needs-input
  reachability changed" overclaim was corrected in the same pass (FINDING-016). **If it bites:**
  gate the idle-fallback's `looksLikePrompt` on the tail's last contributor being real output, or
  narrow admission to prompt-shaped last lines (the rejected concept-D2 alternative).

- **Repaint-delivered needs-input has no exit path for raw-mode TUIs** (FINDING-012,
  devils-advocate). The motivating program class (full-screen TUI, every frame home-prefixed)
  runs raw-mode/no-echo: the user's answer keystroke produces no real output, and resumed work
  arrives only as repaints, which deliberately never reset needs-input (concept OQ7). After the
  repaint-delivered prompt fires needs-input, the chip/badge can assert "waiting for you" while
  the program demonstrably works, self-healing only on the first non-home-prefixed chunk or exit.
  Pre-0025 the state was simply unreachable (the bug being fixed). **Why deferred:** human
  decision 2026-07-09 — the false "needs you" is strictly better than the old false "busy
  forever" (it at least points at a pane that DID ask a question), and the clean fix is OQ4's
  content-delta classification (a changing repaint = evidence of work), a candidate follow-up
  feature of its own. Disclosed in status-engine.md.

### LOW

- **Triple-pinned classification vector** (FINDING-001, quality). The single fact
  `isPureControl('\x1b[Hreal text') === false` / `isRepaintChunk(...) === true` is pinned with
  near-duplicate vectors in `tests/main/needs-input.test.ts` (TEST-2527),
  `tests/main/needs-input-classifier.test.ts` (TEST-2524), and
  `tests/characterization-status.test.ts` (TEST-2526). A future change to this classification
  must touch three files. **Why deferred:** all three are frozen; consolidation is a tests-phase
  refactor for whichever feature next touches the classifier (keep CHAR-001's change-detector
  role; fold TEST-2527's overlap into the classifier suite).

- **Prose-coupled regression-net guard** (FINDING-002, quality). `tests/regression-net-0025.test.ts`
  (TEST-2541) asserts REQ-008's nets survive by grep-matching literal `it(...)` description
  strings in `tests/main/status-tracker.test.ts` / `tests/e2e/marker-less-pane.spec.ts`; a purely
  cosmetic rewording of a pinned description breaks the guard, while a weakened assertion body
  passes it. **Why deferred:** the guard still catches deletion (its purpose); anchoring on
  stable TEST-ids in both directions is a tests-phase cleanup for the next status feature.

- **Chunk-framing sensitivity of repaint classification** (FINDING-003, determinism —
  pre-existing baseline property). Classification is per-chunk: a repaint whose `CURSOR_HOME_RE`
  prefix is split across pty-read/TCP boundaries has its continuation fragment classified as real
  output (quiet-timer restart, marker-less busy). 0025 *narrows* the divergence (whole-chunk
  delivery went from wedged-busy to needs-input) but the vectors all assume whole-chunk delivery.
  **Why deferred:** pre-existing behavior, unchanged by this feature; a cross-chunk escape
  reassembler is its own bounded feature if split-frame misclassification is ever observed in
  practice (the OSC-133 parser already handles split markers — precedent exists).
