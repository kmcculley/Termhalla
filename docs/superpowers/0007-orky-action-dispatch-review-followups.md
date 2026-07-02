# Orky action-dispatch (Orky 0007) — Review Follow-ups (deferred)

Feature `0007-orky-action-dispatch` shipped READY after a review cycle that included two
implement-phase loopbacks, a HIGH contract-violation fix landed via A-B implement, and a
human-approved spec loop-back that amended two REQs in place. See the per-finding records in
`.orky/features/0007-orky-action-dispatch/findings.json` and the full narrative in
`.orky/features/0007-orky-action-dispatch/04-tests.md` ("Loopback (ESC-003)", "Loopback
(ESC-004)", "Loopback (ESC-006)" sections).

## Review timeline

1. **First reviewer pass (security lens):** filed FINDING-SEC-001 (HIGH) — human-authored
   `decision`/`evidence` text reached Orky's gatekeeper CLI as a raw, unguarded argv value,
   letting a value starting with `--` be reinterpreted as a CLI flag by the CLI's own naive
   `parseArgs` (argument injection, CWE-88). Escalated per the standing HIGH-finding rule; fan-out
   stopped before quality/devils-advocate/networking/enterprise-arch/codex-cross-check ran.
2. **Loopback (ESC-003) to implement:** fixed via a shared `rejectFlagLike(field, value)` guard
   wired into every raw-argv validator (`validateFeatureSlug`, `validateResolveEscalationRequest`,
   `validateRecordHumanGateRequest`). TEST-283..TEST-290 added and pinned RED→GREEN. Re-verified
   independently by the security lens; no gaps found.
3. **Second reviewer pass (devils-advocate lens):** filed FINDING-DA-001 (HIGH,
   `contract_violation:true`) — the REQ-015 per-featureDir serialization queue was keyed on the
   RAW `featureDir`/`projectRoot` string while REQ-004's root-allowlist check normalizes
   case/slash spelling, so two concurrent mutations on the same physical feature submitted with a
   REQ-004-accepted divergent spelling would not serialize against each other (CONV-010
   violation). Escalated; fan-out stopped after devils-advocate (quality's own pass had already
   completed, filing FINDING-QUAL-001..005).
4. **Loopback (ESC-004) to implement:** all three mutating `queue.run(...)` call sites re-keyed on
   `normalizeProjectRoot(featureDir)`, the same normalizer `checkRoot()` already uses; CLI argv
   values themselves left untouched. TEST-291..TEST-294 added and pinned RED→GREEN. Verified: 46/46
   dispatcher tests green, full suite 140 files / 1037 tests green, no regression.
5. **Full six-lens review resumed:** networking (FINDING-NET-001/002/003), enterprise-arch
   (FINDING-ARCH-001/002/003), and codex-cross-check all ran. **codex-cross-check filed
   FINDING-CODEX-001 (HIGH, `contract_violation:true`)** after the review gate had already been
   cached PASS (a stale-cache condition the coordinator caught and re-derived as failed before
   proceeding): `mapCliRunToResult` mapped every feedback-emit exit-0 to `ok:true` from the exit
   code alone, never inspecting the CLI's own parsed `{ok:false, mode:'noop', error}`
   internal-error shape — so a genuine feedback-CLI failure (e.g. disk full) was silently
   misdiagnosed as "feedback disabled," with `resolveEscalation` falling back to gatekeeper
   (masking the real error) and `submitWork` reporting the misleading `feedback-disabled` outcome.
6. **Loopback (ESC-006) to implement, via A-B implement (winner: `orky:implementer`):** a
   single-file fix in `src/shared/orky-action-result.ts` — the feedback exit-0 mapper now inspects
   the parsed `ok` field before any `mode` branching; `parsed.ok === false` returns
   `{ok:false, exitCode:0, errorKind:'cli-error', error:<the CLI's own message>}` before the
   gatekeeper fallback or the `feedback-disabled` branch is ever reached. TEST-295/297/298 went
   RED→GREEN; TEST-296/299/300 (regression guards for the untouched success/disabled paths) stayed
   GREEN throughout. Full suite 1067/1067 green.
7. **Six-lens focused re-review of the CODEX-001 fix:** security, quality, networking,
   enterprise-arch, and codex-cross-check each re-examined the fix in isolation — all clean, the
   resolution independently verified against `mapCliRunToResult`'s new `ok`-first branch and the
   unchanged `mode`-branching fallback. **devils-advocate** filed two findings on the fix itself:
   - **FINDING-DA-004 (MEDIUM):** the fix's layer and scope were correct (verified against Orky's
     actual `feedback/cli.js` and `gatekeeper/cli.js` producers — no latent gatekeeper-side sibling
     bug, the feedback-only scope was right), but the ESC-006 arbitration (parsed `ok:false` takes
     precedence over `mode`) had been recorded only in `state.json`/`findings.json`/test comments,
     never propagated into `02-spec.md`'s REQ-006/REQ-007 normative text — leaving the frozen spec
     in unresolved tension with the frozen regression tests.
   - **FINDING-DA-005 (LOW):** `04-tests.md`'s ESC-006 loopback section misstated the RED baseline
     as "4 of 6" when the correct split (matching FINDING-CODEX-001's own resolution text) is 3 RED
     (TEST-295/297/298) / 3 GREEN by construction (TEST-296/299/300).
8. **Spec loopback (iteration spec:2), human-approved:** REQ-006 and REQ-007's normative text and
   Acceptance blocks amended IN PLACE to state the ESC-006 ok-precedence rule, citing
   TEST-295/297/298/299/300. `+12` lines, no REQ renumbering. All gates spec→review re-derived
   green against the amended spec. **Resolves FINDING-DA-004.**
9. **Doc-sync (this pass):** corrected `04-tests.md`'s RED-count erratum (3 of 6, not 4 of 6) and
   marked **FINDING-DA-005 resolved**; reconciled `traceability.json`/`traceability.md` so
   REQ-006/REQ-007 also cite TEST-295/297/299 and TEST-298/300 respectively, matching the amended
   spec's Acceptance blocks; corrected a stale exit-2-only comment on `OrkyActionErrorKind`'s
   `'cli-error'` member in `src/shared/types.ts` (comment-only — `02-spec.md` is frozen and was not
   touched); promoted six general lessons from this feature's `propose CONV:` findings to
   `.orky/conventions.md` (CONV-013..CONV-018).

## Current open-findings residual (non-blocking)

None of the following is a contract violation; all were reviewed and accepted as deferred at
ship time. Severities are as filed.

### MEDIUM

- **`OrkyActionAuditRecord.action`/`.errorKind` typed as bare `string`** (FINDING-QUAL-002,
  `src/main/orky/orky-action-audit.ts:21,28`), diverging from 03-plan.md TASK-005's own
  `errorKind?: OrkyActionErrorKind` type spec. **Recommended fix:** import and use
  `DispatchAction`/`OrkyActionErrorKind` for both fields.
- **17 near-identical dispatcher-level rejection literals** (FINDING-QUAL-003,
  `src/main/orky/orky-action-dispatcher.ts`, 17 occurrences across the four `do*` methods) — the
  uniform `{ok:false, path:null, dispatched:false, errorKind, error}` shape is hand-written 17
  times. **Recommended fix:** a small `private reject(errorKind, error)` helper.
- **10 `as OrkyActionResult` casts compensate for missing callback return-type annotations**
  (FINDING-QUAL-004, `src/main/orky/orky-action-dispatcher.ts`) — the `queue.run(async () =>
  {...})` callbacks have no contextual `OrkyActionResult` typing, so TypeScript isn't actually
  verifying these 10 literals' shapes at compile time. **Recommended fix:** annotate the callbacks
  `async (): Promise<OrkyActionResult> =>` and drop the casts.
- **`dispatched:true` over-promises on the feedback path** (FINDING-DA-002,
  `src/main/orky/orky-action-dispatcher.ts:158-159,211-212`) — a feedback emit only durably queues
  an event; actual application (resolving the escalation / triaging the work item) happens later,
  asynchronously, in a separate orchestrator run, and can never happen at all in file mode with no
  bridging server. No result field distinguishes "queued, effect pending" from a synchronous
  gatekeeper mutation that already landed. **Why deferred:** narrowing/documenting this contract
  is a design decision for F8/F10/F12 (the eventual UI consumers) to make jointly, not a
  dispatcher-only fix; the spec's Open Question #2 (a live emit→apply round-trip test) also
  remains open. **Recommended fix:** either narrow `dispatched` semantics or document the deferred-
  effect caveat in this doc and add the round-trip test.
- **Hard-abort on dispose() can tear a non-atomic mutating write** (FINDING-NET-001,
  `src/main/orky/orky-action-dispatcher.ts:129-132`) — the abort pattern was copied from a
  read-only probe; applied to a mutating CLI it can `TerminateProcess` mid-`writeFileSync`,
  corrupting `state.json`. Low probability (must land inside a sub-millisecond write window at the
  dispose instant), high impact. **Recommended fix:** don't hard-abort in-flight mutating children
  (they're already `unref()`'d and timeout-bounded); reserve the abort for the read-only `drive`
  child.
- **Timeout/abort on a mutating action reports a definite `dispatched:false` when the true
  outcome may be indeterminate** (FINDING-NET-002, `src/shared/orky-action-result.ts:29-36`) — a
  timeout landing just after a completed write is reported identically to one that never started,
  and feedback emit is non-idempotent (fresh event id per call), so a blind retry after a
  false-negative timeout can duplicate a work item or decision. **Recommended fix:** a dedicated
  indeterminate signal for a mutating-action timeout/abort, distinct from a proven non-mutation.
- **Audit record captures no correlation id to the artifact it produced** (FINDING-ARCH-001,
  `src/main/orky/orky-action-audit.ts`) — the feedback `event` id and the gatekeeper recorded-gate
  `at` instant are both available on `result.data` but never copied into the audit record, so an
  audit line cannot be tied back to the concrete effect in the target project. **Recommended
  fix:** capture a redaction-safe correlation id (event id / timestamp) plus `result.feedback`.

### LOW

- **`isPlainObject` duplicated three times** (FINDING-QUAL-001, across `orky-action-result.ts`,
  `orky-action-validate.ts`, `orky-action-dispatcher.ts`). **Recommended fix:** extract once, two
  of the three copies are already in `src/shared/`.
- **A fifth `orky-cli-not-found` return site diverges in shape** (FINDING-QUAL-005,
  `src/main/orky/orky-action-dispatcher.ts:164`, doResolveEscalation's gatekeeper-fallback branch
  returns `path:'feedback'` instead of the spec's literal `path:null`) — untested, undecided
  whether intentional. **Recommended fix:** either align to `path:null` or comment the deliberate
  divergence, and add a regression test.
- **`resolveFeatureDir` accepts an existing-but-empty directory as a valid feature** (FINDING-DA-003,
  `src/main/orky/orky-action-dispatcher.ts:307-316`) — diverges from 03-plan.md TASK-008's
  "plausible feature marker" spec; a stray empty dir under `.orky/features/` can become a phantom
  feature once a mutating CLI writes into it. **Recommended fix:** require a marker file (e.g.
  `state.json`) before accepting.
- **`dispose()` is not sticky** (FINDING-NET-003, `src/main/orky/orky-action-dispatcher.ts:129-132`)
  — an action queued behind an in-flight one on the same featureDir can still spawn a new mutating
  child after `dispose()` returns. **Recommended fix:** a `disposed` flag short-circuiting
  `runWithAbort`/the queue callbacks.
- **Audit-write failures are console-only, with no operator-visible signal in a packaged app**
  (FINDING-ARCH-002, `src/main/orky/orky-action-audit.ts:44-51`). **Recommended fix:** surface via
  a diagnostics counter or a one-time notification, in addition to `console.error`.
- **`ORKY_PLUGIN_DIR` has no default and no in-app diagnostic surface** (FINDING-ARCH-003,
  `src/main/orky/orky-cli-locate.ts:15-24`) — a GUI launch (Start menu / shortcut) may not inherit
  a shell-set env var, so the write surface can be inoperable out-of-the-box with no self-diagnosis
  until F13 (Settings) ships. **Recommended fix:** confirm the config-surface split with F13 and
  add a lightweight in-app diagnostic.

## Promoted to conventions

Six general lessons from this feature's `propose CONV:` findings were promoted to
`.orky/conventions.md` as **CONV-013 through CONV-018**:

- **CONV-013** (from FINDING-DA-002) — a completed-effect result flag must not be set true for a
  durably-queued-but-not-yet-applied mutation.
- **CONV-014** (from FINDING-NET-001) — an abort pattern proven safe for a read-only subprocess
  must not be reused unchanged for one that performs a non-atomic durable write.
- **CONV-015** (from FINDING-NET-002) — a timeout/abort result for a non-idempotent mutating
  operation must surface as indeterminate, not a definite non-dispatch.
- **CONV-016** (from FINDING-ARCH-001) — a durable-mutation audit record must capture a
  redaction-safe correlation id for the artifact it produced.
- **CONV-017** (from FINDING-ARCH-002) — a best-effort audit/integrity log's write failures must
  be surfaced through an operator-observable signal, never console-only.
- **CONV-018** (from FINDING-DA-004) — an escalation decision that changes or disambiguates a
  REQ's required behavior must be propagated into the spec artifact in the same loopback that
  implements it.

## Resolved in-feature (not deferred)

- FINDING-SEC-001 (HIGH — CLI-argument-injection via unguarded `--`-prefixed
  `feature`/`decision`/`escalationId`/`evidence` values) — a shared `rejectFlagLike` guard now
  rejects any such value before it reaches a raw argv position; TEST-283..TEST-290.
- FINDING-DA-001 (HIGH, contract — `OrkyActionQueue` keyed on a raw, case/slash-divergent
  `featureDir` string while REQ-004 accepts divergent spellings of the same physical root,
  breaking REQ-015's serialization guarantee) — all three mutating `queue.run(...)` call sites now
  key on `normalizeProjectRoot(featureDir)`; TEST-291..TEST-294.
- FINDING-CODEX-001 (HIGH, contract — a feedback-emit exit-0 whose own parsed stdout reports
  `{ok:false, mode:'noop'}` was silently misdiagnosed as a disabled channel) — `mapCliRunToResult`
  now inspects the parsed `ok` field before any `mode` branching; TEST-295/297/298 (RED→GREEN),
  TEST-296/299/300 (regression guards).
- FINDING-DA-004 (MEDIUM — the ESC-006 ok-precedence arbitration was never propagated into
  `02-spec.md`) — REQ-006/REQ-007 amended in place with the precedence rule and citing
  TEST-295/297/298/299/300.
- FINDING-DA-005 (LOW — `04-tests.md`'s ESC-006 section misstated the RED baseline as "4 of 6")
  — corrected to "3 of 6: TEST-295/297/298" in doc-sync.
