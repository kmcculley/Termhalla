# Queue answer + resume actions (Orky F8) — Review Follow-ups (deferred)

Feature `0008-queue-answer-resume-actions` — the first WRITE-capable actions on F6's decision-queue
entries: inline **answer** (escalation decision text / human-review verdict) and **resume**
(read-only next-action preview + resume-in-terminal), riding EXCLUSIVELY F7's existing
`orkyAction:*` dispatch surface (zero new IPC/preload/main/CLI path). The cycle: a spec revised
twice pre-gate — a coordinator Q1 resolution fixing resume semantics (read-only preview + a
user-gestured terminal launch, never a headless drive, per the TOS posture) plus seven
devils-advocate findings — a seven-lens review that filed 22 findings including a
**two-lens-confirmed** detached-SUCCESS-silently-dropped contract violation the 45-green suite
missed, a tests+implement fix cycle, and a consolidated re-verify resolving all nine
blockers/mediums and filing two new LOWs. All gates through review are green; 22-finding ledger, all
resolved/merged except two accepted-residual LOWs. Codex's additive cross-check was wedged in queue
by an API error and cancelled — additive lenses never block. See the per-finding records in
`.orky/features/0008-queue-answer-resume-actions/findings.json` and the full narrative in
`.orky/features/0008-queue-answer-resume-actions/04-tests.md`.

## Review timeline

1. **Brainstorm (delegated human).** D1 answer/resume on F6 queue entries via F7 dispatch only (no
   new write code), D2 context-driven answer (escalation resolve / human-review verdict), D3
   resume = drive (later superseded — see Q1 below), D4 per-entry pending/result/disabled honest
   states (CONV-013/034), D5 factor the action layer for F10 reuse.
2. **Spec-gate devils-advocate pass, revision 1 (FINDING-001…007, all repaired pre-freeze).**
   - **FINDING-001 (HIGH)** — the spec mounted `OrkyEntryActions` inside each queue row, but the
     row's `onClick={() => focusProject(...)}` was unguarded for pointer events (only `onKeyDown`
     target-guarded per CONV-030); every click on an action control would bubble and steal focus
     into the matching pane. Resolved by new **REQ-015** (pointer isolation — the click twin of
     CONV-030) plus **proposed CONV-041**.
   - **FINDING-002 (MEDIUM)** — REQ-013's frozen-guard inventory wrongly claimed no frozen test
     pinned the `ipc-contract.ts` consumer comment; `TEST-503` actually pins it. Resolved by naming
     `TEST-503` as a byte-relevant constraint and widening the inventory's grep patterns.
   - **FINDING-003 (MEDIUM)** — the answer flow's "first open escalation" selection was positional,
     not identity-bound: a race between display-time read and submit-time dispatch could land a
     decision on a DIFFERENT escalation than the one the user read, with no honest-failure branch
     for "changed target." Resolved by amending **REQ-003** to bind an identity at open, show it,
     and re-verify against a fresh pull at submit (identity beats position).
   - **FINDING-004 (MEDIUM)** — REQ-007's per-hook-instance single-flight ref could not actually
     prevent duplicate dispatch across multiple mounted instances of the same target (the exact
     shape F10 was designed to introduce). Resolved by moving the gate to a shared, store/module-
     level registry keyed on `(projectRoot, featureSlug, action)`.
   - **FINDING-005 (MEDIUM)** — REQ-014's claim that `claude` with `/orky:resume` as an initial
     prompt "executes the plugin command" rested on an unverified external Claude Code contract
     stated as verified-from-source. Resolved by rewording the Verified contract to state the
     external dependency honestly and adding a two-level honest-outcome note (auto-run where
     supported; otherwise a visible session the user completes — never a silent failure).
   - **FINDING-006/007 (LOW)** — `cli-unparseable` on a mutating answer was mis-classified as a
     DEFINITE failure; both a completed-but-unreadable child AND a spawn-class never-ran failure
     fold into that kind, so it joined the INDETERMINATE class in REQ-009 (FINDING-007 then
     corrected the repair's own over-claiming grounding prose).
3. **Seven-lens review of the implementation** (devils-advocate, quality, ux, security, networking,
   + others) against a green, 45-passing build: **15 more findings** (008…022), including the
   headline contract violation.
   - **FINDING-012 / FINDING-015 (HIGH, contract violation, TWO-LENS-CONFIRMED — the standout).**
     REQ-010 MUST: a detached settle (drawer closed / entry left the queue mid-flight) must never be
     silently dropped. The shipped `deliver()` routed only a detached FAILURE through the
     never-suppressed error-kind toast; a detached SUCCESS was swallowed outright — nothing rendered,
     nothing toasted. Every one of the 45 green tests passed because none of them asserted on the
     detached-success path; independently filed by **devils-advocate (012)** and **networking
     (015)**, merged with 012 canonical. This is the class this repo names test-green/runtime-gap,
     and the exact contract class CONV-034 exists to prevent — the fix mirrors F12's
     `OrkyCaptureModal` precedent (a detached success rides the same `pushToast` chokepoint on the
     default suppressible kind; suppression is the STORE's mechanism, never a call-site drop).
   - **FINDING-009 (MEDIUM)** — the hook's own `if (isInFlight(key)) return` pre-checks defeated the
     core's `withSingleFlight` fan-out design: a caller arriving mid-flight never attached its own
     `.then()`, so a SECOND mounted instance of the same target (an F8 row and F10's future
     `OrkyPane` row for the identical escalation) would render `pending` correctly but then go
     silent forever on settle — receiving no result at all. This would have broken F10's reuse of
     the shared action layer the day it landed, discovered only because a reviewer traced the core's
     actual fan-out contract against every call site rather than trusting the passing acceptance
     vectors (which asserted only on the FIRST caller). Fixed by removing the pre-checks; every
     caller now routes unconditionally through `withSingleFlight(...).then(deliver)`.
   - **FINDING-008 / FINDING-010 (LOW/MEDIUM, merged)** — `commitPane` (previously a
     store-internal-only primitive reached only through narrow named actions like `launchCommand`/
     `launchDir`) was promoted to the public `State` interface so `orky-entry-actions.tsx` could
     compose it directly — widening the callable surface to ANY renderer code with an arbitrary
     `PaneConfig` (including `envId`, a real capability). Fixed by a new narrow
     `launchTerminalAt(cwd, launch)` store action that fixes `kind:'terminal'`, the default shell,
     and placement internally, composing `commitPane` INSIDE the store; `commitPane` itself came
     back off the public `State` surface.
   - **FINDING-013 / FINDING-018 (MEDIUM, merged) — the preview-fidelity gap.** The next-action
     preview rendered only `result.data.next`, dropping `phase`/`reason` — against the REAL
     `gk.drive()` shapes (`{next:'run-phase', phase}`, `{next:'await-human', reason}`, etc.), so
     every escalation/human-review row (precisely the rows a human needs the most context on)
     previewed as the information-free `next: await-human`. The frozen `TEST-593`/`TEST-608`
     fixtures had used an UNREAL flattened shape (`data:{next:'run-phase spec'}`) that masked the
     gap — a preview-fidelity gap the tests phase introduced by fixturing an upstream contract from
     an unverified shape rather than the real CLI output. Fixed by composing the message from
     `next` + `phase` + `reason` as carried, and re-fixturing both harnesses to the real shape.
   - **FINDING-016 / FINDING-017 (MEDIUM)** — opening the answer form never moved keyboard focus
     into the inline input (no open-focus), and Enter in the single decision input dispatched
     nothing (no submit path) — both UX contract gaps despite green tests, since the harness
     asserted on state/props, not on focus or key-driven submission. Fixed via the shared
     `useOpenFocusRestore` substrate on form mount and an `onKeyDown` Enter handler scoped to the
     input (CONV-030-guarded), respecting the same refusal gates as the submit button.
   - **FINDING-020 (MEDIUM) — disarm-on-success.** After a successful answer, the form stayed fully
     armed (open, decision text retained) — a stray re-click of submit (or an accidental second
     Enter) would re-fire the SAME decision text against an escalation that may have already
     resolved. Fixed by closing the form and clearing the input on a settled success; re-arming
     requires an explicit re-open gesture that re-binds fresh.
   - **FINDING-011 / FINDING-014 (LOW, merged)** — a stale settled `phase` (from a previous, unrelated
     action) could mask the fresh `escalation-unbound` binding message when the answer form
     re-opened. Fixed by resetting `phase` to idle on the open gesture.
   - **FINDING-019 (LOW)** — `dq-action-error` carried `role="alert"` but `dq-action-result`/
     `dq-action-pending` carried no ARIA live-region role at all — asymmetric for assistive
     technology. Fixed with `role="status"` on the pending/result surfaces.
4. **Tests+implement fix cycle (ESC-001, delegated human decision on the loopback).** All nine
   blockers/mediums fixed in one loopback: FINDING-012 (detached-success toast route, amended
   `TEST-605`), FINDING-009 (unconditional `withSingleFlight` routing, new `TEST-615`), FINDING-013
   (real-shape preview + re-fixtured `TEST-593`/`TEST-608`), FINDING-016/017 (open-focus +
   Enter-submit, new `TEST-620`), FINDING-020 (disarm-on-success, new `TEST-621`), FINDING-008/010
   (`launchTerminalAt`, amended `TEST-604`, new `TEST-619`), FINDING-011 (phase reset on open, new
   `TEST-622`), FINDING-019 (`role="status"`). FINDING-021 (LOW, spec-origin verify→write TOCTOU) was
   explicitly **accepted as a documented residual** per the same ESC-001 decision, not fixed.
5. **Consolidated re-verify.** All nine blockers/mediums confirmed RESOLVED against current shipped
   source (re-derived independently, not trusted from the fix description). Filed **two new LOWs**:
   FINDING-021 (the disclosed verify→write TOCTOU residual, formally filed at this pass) and
   FINDING-022 (the FINDING-016 open-focus fix mounts on form-mount, keyed on `answerOpen && mode`;
   a background aggregate refresh flipping the row's `reason` while the form is open silently swaps
   which form is mounted under the focus substrate instead of closing the stale one).
6. **Doc-sync (this pass).** `traceability.json` verified complete and accurate across both
   loopbacks: every `REQ-001`…`REQ-015` maps to real `TASK-NNN`/`TEST-NNN` ids, including the
   `TEST-584…623` range and the amended frozen pins `TEST-353` (`decision-queue-panel-structure.test.ts`),
   `TEST-366` (`decision-queue.spec.ts`), and `TEST-593`/`TEST-604`/`TEST-605`/`TEST-608` (amended
   in-place per `CONV-019`'s named-retirer discipline) — every referenced id confirmed present as a
   real test-title marker in its named file. `traceability.md` was a phase-3 planning stub (tests
   columns intentionally empty); regenerated in full with the tests column populated.
   `docs/features/queue-answer-resume-actions.md` updated: the detached-outcome section now
   documents BOTH honesty classes (success routes through the default suppressible toast, failure
   through the never-suppressed error-kind toast — previously described as failure-only, which
   would have left the doc contradicting the FINDING-012 fix and the amended `TEST-605`), and a new
   "Known residual limitations" section names FINDING-021/022 for readers. `CHANGELOG.md`'s
   `[Unreleased]` entry corrected the same failure-only detached-outcome claim and added the
   `launchTerminalAt` narrow-action note. Promoted six general lessons to `.orky/conventions.md` as
   CONV-041…CONV-046 (see below).

## The shared seams F10 will reuse

- **`useOrkyEntryActions` / `OrkyEntryActions`** (`src/renderer/components/orky-entry-actions.tsx`)
  — the pane-agnostic hook + presentational region, keyed on `OrkyEntryTarget`
  `{projectRoot, featureSlug, reason, escalationId?}`. F10's `OrkyPane` is designed to mount the
  SAME `OrkyEntryActions` for a detail feature row unchanged, passing the display-time escalation id
  it already holds (no `registryDetail` pull needed on that path). FINDING-009's fix is what makes
  this reuse SAFE: without it, a second mounted instance of the same target would silently never see
  a settled result.
- **`orky-entry-actions-core.ts`** — the pure, api-free single-flight gate, identity-binding, request
  builders, and result-honesty classifier F10 inherits for free.
- **`launchTerminalAt(cwd, launch)`** (`src/renderer/store.ts`) — the new narrow store action born
  from FINDING-008/010's fix; any future feature needing a plain terminal pane at a given cwd should
  reach for this, not the raw `commitPane` primitive (which is deliberately off the public `State`
  surface again).

## Current open-findings residual (non-blocking)

One residual stays open (not re-litigated by doc-sync); it was reviewed and explicitly accepted as
deferred with a documented rationale — see the "Known residual limitations" section of
`docs/features/queue-answer-resume-actions.md` for the user-facing summary.

- ~~**FINDING-021 (review, LOW, verify→write TOCTOU).**~~ — **RESOLVED upstream 2026-07-12** (Orky
  v0.44.0, commit `9443bee`): `resolveEscalation` now REFUSES a non-open escalation without
  `--force` (error code `ESCALATION_NOT_OPEN`, CLI exit 2 — parity with the supervisor kernel's
  revision-CAS, closing the solo/local path Termhalla's feedback-apply dispatch rides), and
  `feedback apply` consumes a stale decision instead of retrying forever. An escalation resolved
  elsewhere inside the verify→write window is therefore no longer silently overwritten — the
  compare-and-set this ledger said was "outside this repo" now exists at the authority, where it
  belongs (CONV-045's first arm). The contract pins the refusal behavior
  (`escalations.escalation_resolution`). No Termhalla-side change: the renderer's submit-time
  re-verification remains a UX courtesy in front of a now-guarded write. `findings.json` closed via
  `resolve-finding`.
- **FINDING-022 (review, LOW, mode-flip focus jump).** A queue row's stable `featureSlug` key keeps
  its `OrkyEntryActions` instance mounted across aggregate refreshes; if a background refresh flips
  the row's `reason` (e.g. `escalation` → `human-review`) while its answer form is open, the stale
  `EscalationAnswerForm` silently swaps for `HumanReviewForm` under the open-focus substrate rather
  than closing. Accepted as a residual — the proposed CONV (below) makes the general rule explicit
  so a future focus-on-mount design doesn't reintroduce the same class of surprise.

## Promoted to conventions

Six general lessons from this feature's `propose CONV:` findings were promoted to
`.orky/conventions.md` as **CONV-041 through CONV-046** (continuing from 0013's CONV-040, the
current max before this feature):

- **CONV-041** (from FINDING-001) — the pointer twin of CONV-030: a container-level pointer-
  activation (click) handler must be target-guarded, or nested interactive controls must stop
  propagation, so a nested control's activation never also fires the container's own gesture.
- **CONV-042** (from FINDING-016) — the inline-form twin of CONV-020: an inline form region revealed
  by an explicit open gesture must move keyboard focus into its first interactive field on open.
- **CONV-043** (from FINDING-017) — a single-line inline text input paired with exactly one submit
  control must dispatch that submit on Enter (respecting the submit's disabled conditions), never
  requiring pointer or Tab traversal to complete the flow.
- **CONV-044** (from FINDING-020) — after a non-idempotent submit succeeds, the submitting affordance
  must be disarmed (input cleared, form closed, or submit disabled) until the user re-arms it.
- **CONV-045** (from FINDING-021) — a client-side pre-write verification guarding a write with no
  server-side compare-and-set must either be enforced inside the write's own serialized critical
  section, or the spec must explicitly disclose the residual verify-to-write race window.
- **CONV-046** (from FINDING-022) — a focus-on-mount substrate may only be mounted by an explicit
  user open gesture; a data-driven remount or surface swap must never move keyboard focus.

The Q1 coordinator resolution (resume = read-only preview + user-gestured terminal launch, never a
headless drive) was considered for promotion but is a feature-specific design resolution answering
"what does resume mean for F8," not a general implementation rule with a `propose CONV:` — it is
recorded here and in `02-spec.md`'s Resolved questions as the durable rationale (TOS posture:
Termhalla must never silently drive an Orky pipeline) future features touching Orky write paths
should read, rather than promoted as a numbered convention.

## ~~Standing repo-hygiene backlog item (outside this feature's scope)~~ — RESOLVED (verified 2026-07-07: `NUL` no longer tracked nor on disk)

A tracked `NUL` file at the repo root (0 bytes, pre-existing, introduced by feature 0009) is a
Windows-reserved device name that Win32 file APIs intercept, breaking `git stash`/`checkout` and
some tooling on Windows. This is now the THIRD consecutive feature (0012, 0013, now 0008) whose
review independently noticed it while grepping the repo root — it keeps recurring precisely because
it sits outside every individual feature's diff scope and so never gets swept up in a normal fix
cycle. **Recommendation unchanged: a dedicated cleanup commit** — `git rm NUL` plus a lightweight CI
guard rejecting Windows-reserved path components (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) —
filed as standing repo-hygiene debt, not assigned to any feature.

## Retroactive corrections landed by feature 0010

Two things about THIS feature's shipped artifacts were corrected after the fact by feature
`0010-orky-pane-inline-actions` (F10), F8's designed reuse consumer, per `CONV-012` co-ownership.
Recorded here so a reader of this doc sees the full picture without cross-referencing F10's own
follow-ups doc:

- **`FINDING-022` (this feature's own residual, above) is now RESOLVED, fixed by F10.** F10's
  REQ-006/TASK-001 landed the mode-keyed disarm fix directly in the SHARED
  `orky-entry-actions.tsx` component (both this feature's queue mount and F10's pane mount get
  it) — see `findings.json`'s `FINDING-022` entry for the resolution detail and F10's `TEST-630`/
  `TEST-637` for the pins. The `resolvedAt` stamp on that entry was itself corrected at F10's
  doc-sync pass (2026-07-03) from a hand-synthesized round instant to a real clock reading — an
  instance of the CONV-049 lesson F10 promoted.
- **This feature's frozen e2e (`tests/e2e/orky-queue-actions.spec.ts` and its loopback) was
  latently broken since a v0.28.0 startup-handshake change, and F10 fixed the read sites.** F10's
  review (FINDING-016) discovered — by actually RUNNING this feature's frozen e2e against the
  built app for the first time since v0.28.0 shipped `verifyOrkyContract` — that every raw
  `expect(readLog(gatekeeperLog)).toEqual([])` assertion in this suite (TEST-608/609/611/612) had
  been unsatisfiable by construction against a behaviorally correct implementation: the startup
  contract handshake unconditionally invokes the stub gatekeeper before any test gesture fires.
  F10's tests-phase loopback amended the READ SITES in `orky-queue-actions.spec.ts` and
  `orky-queue-actions-loopback.spec.ts` to a handshake-aware `readActionLog` helper (filtering out
  only an exactly-`['contract']` entry; any other unexpected entry still fails loudly) — the
  assertion INTENT (zero dispatch until a gesture) is unchanged, byte-identical otherwise. Run
  evidence (2026-07-03): TEST-608/612 witnessed green for the first time; TEST-609/610 remain red
  on an unrelated build-environment gap (F10's `FINDING-017` — node-pty's native binding absent on
  the verifying checkout), not the handshake.

## Resolved in-feature (not deferred)

FINDING-001…007 (spec gate, all seven, including the pointer-isolation gap, the identity-binding
race, the cross-instance single-flight gap, the unverified external-contract pin, and the
cli-unparseable mis-classification), FINDING-008/010 (the `launchTerminalAt` narrow-action fix,
merged), FINDING-009 (the unconditional single-flight fan-out fix), FINDING-011/014 (phase-reset-on-
open, merged), FINDING-012/015 (the canonical detached-SUCCESS-drop fix, merged, the contract
blocker), FINDING-013/018 (the real-shape preview fix, merged), FINDING-016/017 (open-focus +
Enter-submit), FINDING-019 (`role="status"`), FINDING-020 (disarm-on-success) — see `findings.json`
for each `resolution` field and exact fix evidence.
