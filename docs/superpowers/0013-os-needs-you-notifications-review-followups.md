# OS-level needs-you notifications (Orky 0013) — Review Follow-ups (deferred)

Feature `0013-os-needs-you-notifications` — the read-side completion of the cross-project registry
tier (T4): a main-process observer over the F5 aggregate raises an OS notification whenever an
Orky-adopted project transitions into needs-you, including projects with **no open pane**. The
cycle: a coordinator-amended brainstorm decision (D3, mid-cycle), a spec revised once against four
spec-gate findings, a seven-lens review that filed 16 findings — the standout a
**FIVE-LENS-CONFIRMED** digest-flush-timer contract violation (FINDING-005) — a tests+implement fix
cycle, and a consolidated re-verify that resolved all six blockers/mediums and filed one new LOW.
All gates through review are green; 16-finding ledger, all resolved/merged except two accepted-
residual LOWs. See the per-finding records in
`.orky/features/0013-os-needs-you-notifications/findings.json` and the full narrative in
`.orky/features/0013-os-needs-you-notifications/04-tests.md`.

## Review timeline

1. **Brainstorm amendment (D3).** The coordinator superseded the original brainstorm decision
   post-gate (delegated human authority): D3's premise — reuse 0004's per-terminal-pane tab-badge
   opt-in as the notification mute — does not exist as a single app-wide switch in shipped code (the
   opt-in is strictly per-pane and renderer-owned, invisible to a main-process observer). The
   amendment replaced it with a single new **app-wide** opt-in preference
   (`orkyNeedsYouNotifications` on `QuickStore`, additive-optional, no schema bump). The spec's
   REQ-005 and its resolved `ESC-001` note carry the amendment; this is a good example of a
   brainstorm decision needing correction against **shipped source**, not assumption, before it ever
   reaches the spec gate.
2. **Spec-gate devils-advocate pass (revision 1).** Filed FINDING-001…004, all repaired in the same
   revision: FINDING-001 (REQ-013's frozen-guard inventory omitted `TEST-358`, which a main-side
   import of the shared `buildDecisionQueue` selector would trip — resolved by scheduling `TEST-358`'s
   `CONV-019` supersession, regex narrowed to `DecisionQueuePanel`/`queueOpen`), FINDING-002 (the
   synchronous `shouldNotify` gate had no specified live-refresh path — resolved by an in-memory
   mirror refreshed off the existing `quickSave` handler), FINDING-003 (REQ-004's digest count and
   window model were internally contradictory — resolved by pinning ONE tumbling-window model and ONE
   digest-count definition), FINDING-004 (the `SCHEMA_VERSION.toBe(8)` inventory omitted `TEST-001`
   — completed to all seven pins).
3. **Seven-lens review of the implementation** (devils-advocate ×4, quality ×2, determinism ×2,
   ux ×2, security, codex-cross-check) against a green build: **16 findings**, six independently
   filed against the SAME underlying defect.
   - **FINDING-005 (codex-cross-check, HIGH, contract violation, FIVE-LENS-CONFIRMED)** — the
     standout of this feature. REQ-004 requires a pending digest to be flushed exactly at
     `windowOpenedAt + COALESCE_WINDOW_MS`, "so a trailing burst is never silently dropped." The
     shipped `OrkyNeedsYouNotifier` armed no timer of any kind — window close was checked only
     lazily, inside `manageWindow()`, which runs only when a NEW candidate arrives via `onSnapshot`.
     REQ-001's flagship case — a pane-less, quiet-session project — is exactly the class least
     likely to trigger another recompute before the boundary passes, so a real burst-then-quiet
     digest could be stranded indefinitely, flushed only by an unrelated later transition or by
     `dispose()` at app-quit (when `Notification.show()` races shutdown). All 51 frozen tests
     exercised window close via a subsequent `admit()`/`flush()`/`dispose()` call, never a real
     elapsed-time close, so the gap shipped green. **Independently confirmed by quality (007),
     determinism (008), ux (009), and devils-advocate (013)** — a five-lens convergence on one root
     cause, merged into FINDING-005 as the canonical entry. This is a strong signal that **pure
     modules which schedule work need an injected timer, not a lazy re-check on the next event** —
     promoted as CONV-036 (below).
   - **FINDING-006 (quality, MEDIUM, contract violation)** — `pane-reveal.ts` duplicated rather than
     reused `DecisionQueuePanel.tsx`'s MRU-pick + focus-dispatch tail (`selectMruPane` +
     `setActive`/`setFocusedPane`/`requestPaneFocus`); both files independently walked panes and
     called the shared low-level matcher, but the orchestration layer had no single source of truth.
     03-plan.md had explicitly flagged this risk and called a fork "out of bounds."
   - **FINDING-010 (ux, MEDIUM)** — `revealQueueGroup`'s single `requestAnimationFrame` after the
     drawer's closed→open conditional mount could fire before the target group committed to the DOM,
     silently no-oping the scroll-to-project on first open.
   - **FINDING-012 (security, LOW)** — notification title/body interpolated on-disk project
     basename and feature slug unescaped; a crafted directory/slug name could inject Linux/Pango
     markup or mangle the rendered body.
   - **FINDING-014 (determinism, LOW)** — `keyOf`'s dedupe identity joined `[projectRoot,
     featureSlug, reason]` with a newline separator and claimed collision-safety, but a POSIX path
     segment may legally contain a newline byte, so two distinct tuples could theoretically collapse
     to one dedupe key, silently suppressing a genuine transition.
   - **FINDING-015 (devils-advocate, LOW)** — the digest path consulted the opt-in gate only when a
     root was buffered, not again at digest-emit time; a mute landing between buffering and window
     close was ignored for that digest — an inertness leak, widened by FINDING-005/013's lazy-close
     gap.
   - **FINDING-011 (ux, LOW, accepted residual)** — 0004's per-pane "waiting for you" toast and
     F13's app-wide "needs you" toast can both fire for one attention moment with no coordination —
     see residuals below.
   - **FINDING-001…004, 009, 013** (devils-advocate/ux/determinism) independently re-derived the
     same FINDING-005 root cause or its spec-origin variant; all merged.
4. **Tests+implement fix cycle (ESC-001, delegated human decision on the loopback).** Loop back to
   tests: inject a fakeable timer scheduler (`setTimer`/`clearTimer` deps) onto
   `OrkyNeedsYouNotifier`; schedule the window-close flush at `windowOpenedAt + COALESCE_WINDOW_MS`
   on window open, clear on `flush()`/`dispose()`; `register.ts` supplies real timers
   (`setTimeout`/`clearTimeout`). New vectors: `TEST-575` (burst → advance fake clock past window
   with no further transition → digest fires exactly once), `TEST-576` (dispose before fire clears
   the timer, no double-fire), `TEST-577` (structural pin on the real-timer wiring in `register.ts`).
   Also fixed in the same loopback: FINDING-006 (`focusMruPaneMatch` extracted as one exported
   helper in `pane-reveal.ts`, called by both `DecisionQueuePanel.focusProject` and
   `pane-reveal.focusProjectPane` — `TEST-582`; the per-pane/per-workspace WALK stays duplicated by
   design, since frozen `TEST-370` pins `selectPaneCandidates(` living inside
   `DecisionQueuePanel.tsx` for its own `hasPane` render check), FINDING-010 (retry-across-frames
   reveal, bounded at `REVEAL_MAX_FRAMES=30` — `TEST-583`), FINDING-012 (`escapeMarkup` entity-encodes
   `&`/`<`/`>`, ampersand first to avoid double-encoding — `TEST-581`), FINDING-014 (`keyOf` now
   `JSON.stringify([root, slug, reason])`, structurally collision-free — `TEST-579`/`TEST-580`),
   FINDING-015 (`closeWindow` re-filters `bufferedRoots` by `shouldNotify` at emit time —
   `TEST-578`). FINDING-011 was explicitly accepted as a residual per the same ESC-001 decision (not
   fixed).
5. **Consolidated re-verify.** All six blockers/mediums (005/006/007/008/009/010/012/013/015 —
   FINDING-005 the canonical entry for the five merged duplicates) confirmed RESOLVED against
   current code, each re-derived independently against the shipped source rather than trusted from
   the fix description. Filed **one new LOW**: FINDING-016 (the `setTimer?`/`clearTimer?` pair on
   `NeedsYouDeps` are two INDEPENDENTLY-optional fields; a half-configuration — `setTimer` supplied,
   `clearTimer` omitted — silently leaks a stale timer on window roll. Not a shipped-runtime defect
   (production always supplies both), but the type shape permits a dangerous half-configuration the
   frozen mirror test's timer-less seam doesn't need to allow).
6. **Doc-sync (this pass, 2026-07-02).** `traceability.json` was already reconciled through the
   loopback (all 55 `TEST-NNN` references, including `TEST-358` and `TEST-575…583`, verified present
   as real test markers in `tests/main/orky-needs-you-notifier.test.ts`,
   `tests/main/orky-needs-you-loopback.test.ts`, `tests/renderer/orky-notify-reveal-loopback.test.ts`,
   and `tests/renderer/app-queue-wiring.test.ts`); regenerated `traceability.md` in full (was a
   phase-3 planning stub with an empty tests column) to include the tests column and a note on the
   loopback amendment. Updated `docs/features/os-needs-you-notifications.md` to name the
   timer-armed flush mechanism explicitly, the digest-emit gate re-consultation, the Pango-markup
   escaping, and the shared `focusMruPaneMatch` helper (previously described only generically as
   "reuses the shared matcher"). `CHANGELOG.md`'s `[Unreleased]` entry was already accurate (added
   at implement time) — no change needed. Promoted five general lessons to `.orky/conventions.md` as
   CONV-036…CONV-040 (see below).

## Current open-findings residual (non-blocking)

Two residuals stay open (not re-litigated by doc-sync); both were reviewed and explicitly accepted
as deferred, each with a documented rationale.

- **FINDING-011 (ux, LOW)** — 0004's per-pane "X is waiting for you" toast and F13's app-wide "<proj>
  needs you" toast can both fire for one attention moment (an unfocused window with an open Claude
  pane on an Orky project) with no cross-coordination. **CONFIRMED accepted residual**
  (re-verification 2026-07-02): per ESC-001 (human, delegated) this is a deliberate, documented
  residual — the two systems convey distinct facts and are deliberately left uncoordinated pending a
  future cross-notification-coordination feature. Documented in `04-tests.md:234-241`
  ("FINDING-011 — ACCEPTED residual (NOT pinned)"); intentionally carries no `TEST-NNN` id so a
  premature dedupe doesn't over-constrain the future design.
- **FINDING-016 (determinism, LOW)** — `NeedsYouDeps.setTimer?`/`clearTimer?` are two
  independently-optional fields; a half-configuration (one supplied, the other omitted) would
  silently leak a stale timer on window roll instead of type-erroring. Not a shipped-runtime defect
  — `register.ts:138-139` always supplies both — but the type shape permits the dangerous half-state.
  Left open as a paired-timer-deps footgun; the proposed convention (CONV-040, below) makes the
  general rule explicit so a future paired-lifecycle-dependency design doesn't reintroduce the same
  shape.

## Promoted to conventions

Five general lessons from this feature's `propose CONV:` findings were promoted to
`.orky/conventions.md` as **CONV-036 through CONV-040** (continuing from 0012's CONV-035, the
current max before this feature):

- **CONV-036** (from FINDING-005, independently proposed by the merged FINDING-008/FINDING-013) — a
  coalescing/debounce buffer whose spec promises a wall-clock-deadline flush must be driven by an
  actually-scheduled timer, never only a lazy re-check on the next inbound event.
- **CONV-037** (from FINDING-001) — a directory-scoped absence/scope-guard regex must key on the
  feature-specific surface (component/handler/exported symbol), never on a shared module name or
  import path.
- **CONV-038** (from FINDING-011) — two independent notification paths that can fire for the same
  user-attention event must have a stated coexistence/dedupe policy.
- **CONV-039** (from FINDING-014) — a composite dedup/identity key must use a separator or structural
  encoding provably free of in-field collisions, never a printable/whitespace character an OS
  permits inside a path or name.
- **CONV-040** (from FINDING-016) — a paired arm/cancel lifecycle dependency must be injected as one
  all-or-nothing unit, never two independently-optional fields.

## ~~Standing repo-hygiene backlog item (outside this feature's scope)~~ — RESOLVED (verified 2026-07-07: `NUL` no longer tracked nor on disk)

A tracked `NUL` file at the repo root (0 bytes, pre-existing, introduced by feature 0009,
`FINDING-023` in 0012's ledger, and re-surfaced again in this feature's review sweep) is a
Windows-reserved device name that Win32 file APIs intercept, breaking `git stash`/`checkout` and
some tooling on Windows. This is the SECOND consecutive feature (0012, now 0013) whose review
independently noticed it while grepping the repo root — it keeps recurring precisely because it sits
outside every individual feature's diff scope and so never gets swept up in a normal fix cycle.
**Recommendation: a dedicated cleanup commit** — `git rm NUL` plus a lightweight CI guard rejecting
Windows-reserved path components (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) — filed as
standing repo-hygiene debt, not assigned to any feature.

## Resolved in-feature (not deferred)

FINDING-001…004 (spec gate, all four, including the `TEST-358` guard-inventory gap and the
digest/window-model contradiction), FINDING-005 (the canonical digest-flush-timer fix — merged
duplicates FINDING-007/008/009/013), FINDING-006 (the shared `focusMruPaneMatch` helper),
FINDING-010 (retry-across-frames drawer reveal), FINDING-012 (Pango-markup escaping), FINDING-014
(the structural `keyOf` collision-safety fix), FINDING-015 (digest-emit gate re-consultation) — see
`findings.json` for each `resolution` field and exact fix evidence.
