# Plan — 0015-orky-contract-v2-refresh

**Phase:** 3 (plan). **Input:** `02-spec.md` (REQ-101..REQ-112, binding decisions from
`01-concept.md`). Repo is `.orky`-adopted (baseline exists) — no baseline `REQ-` is superseded; this
plan reuses existing modules/tests exactly, per CLAUDE.md's per-file conventions.

> **AMENDED (judgment loopback, 2026-07-03):** TASK-103 (golden-fixture regeneration) originally sat
> in the IMPLEMENT phase, but `tests/fixtures/orky-contract/*` is inside the test-freeze snapshot
> (`test-freeze.json`, `testRoots=["tests"]`, captured at the tests gate). An implementer touching
> those files would trip the freeze guard as a CRITICAL integrity finding. Fixtures are test assets:
> TASK-103 now belongs to the **TESTS phase (test-designer actor)**, executed BEFORE the freeze
> snapshot is captured. TASK-105's verification point moved accordingly. TASK-IDs are unchanged; no
> other task moved. See "Phase ownership & the freeze boundary" and the risk note below.

This is a re-sync, not new architecture: no new files, no new IPC channels, no `SCHEMA_VERSION` bump.
Tasks are grouped by the four independent surfaces the spec touches (handshake constant + its frozen
tests, golden fixtures, provenance-text doc-drift cleanup, `finding_resolution` display), each
independently buildable/testable, then a final full-gate task.

## Phase ownership & the freeze boundary

- **TESTS phase (test-designer):** TASK-102 (handshake test updates — already authored in the first
  pass), **TASK-103** (fixture regeneration — the amendment), TASK-105's fixture-side verification
  (golden suite unmodified against the new fixtures). All of these live under `tests/` and MUST land
  before the tests-gate freeze snapshot is captured, so the frozen snapshot contains the v2 fixtures.
- **IMPLEMENT phase:** MUST NOT touch anything under `tests/` — that is the freeze boundary. Its
  entire surface is: `src/` constants (TASK-101), provenance comments/docs (TASK-106..TASK-108 +
  TASK-109 verification), the `OrkyFindingDetail`/`mapFinding`/`OrkyPane` changes
  (TASK-110..TASK-112), CHANGELOG (TASK-104), scope guards (TASK-113), terminal gate (TASK-114).
- **Tests-phase re-entry scope:** `04-tests.md` and the six test files already exist from the first
  pass. The re-entry only needs to (a) ADD the TASK-103 fixture regeneration and (b) re-verify the
  suite is RED overall — it must NOT redesign any test. Note: with the v2 fixtures in place, the
  golden-suite fixture assertions (TEST-711) flip GREEN *during the tests phase* — that's expected
  and fine; the suite stays RED overall via the handshake (TEST-707..710), `mapFinding`
  (TEST-713/714), pane (TEST-715..717), and docs (TEST-719) tests, which still await the implement
  phase's `src/`/docs changes.

## Task list

### Group A — Handshake version pin (REQ-101, REQ-102, REQ-103, REQ-104)

- **TASK-101** — Bump `EXPECTED_CONTRACT_VERSION` from `1` to `2` in
  `src/main/orky/orky-contract-handshake.ts` (single-line literal + its adjoining comment, which
  already says "bump only together with a deliberate re-mirror" — no rewording needed). No other code
  in this file changes (REQ-104 pins every other invariant byte-for-byte).
  - Files: `src/main/orky/orky-contract-handshake.ts`
  - Phase: implement
  - Depends on: none
  - Satisfies: REQ-101, REQ-104

- **TASK-102** — (Tests-phase artifact, planned here for sequencing only — actual edits happen in
  phase 4/5 per frozen-test discipline) Update `tests/main/orky-cli-contract-handshake.test.ts`:
  flip the `goodContract` baseline to `contract_version: 2`; invert the existing "v2 → mismatch" case
  to "v1 → mismatch" (asserting `ok:false`, `contractVersion===1`, one mismatch string containing
  `contract_version`, `plugin=1`, `expected=2`, one `warn` call with the same both-sides text); keep
  the version-3 future-mismatch case (REQ-103) with only its version literal touched if needed; leave
  every graceful-degradation/cache describe-block assertion unchanged except in-place version literals
  inside `goodContract` overrides.
  - Files: `tests/main/orky-cli-contract-handshake.test.ts`
  - Phase: tests (test-designer) — done in the first pass
  - Depends on: TASK-101 (implementation) — but per TDD this test is authored/updated in phase 4
    *before* TASK-101 lands in phase 5; recorded here so the plan's dependency graph is correct for
    the tests→implement handoff.
  - Satisfies: REQ-101, REQ-102, REQ-103, REQ-104

### Group B — Golden fixture regeneration (REQ-105, REQ-106)

- **TASK-103** — **(TESTS phase, test-designer actor — moved here by the loopback amendment; do not
  move back to implement: these files are inside the test-freeze snapshot.)** Run
  `node tools/generate-orky-contract-fixtures.mjs` ONE time with `ORKY_PLUGIN_DIR` pointed at the
  installed 0.30.0 checkout, regenerating all four fixtures under `tests/fixtures/orky-contract/`
  (`contract.json`, `state.json`, `active.json`, `osc-heartbeat.bin`) in that single run. Never
  hand-edit any fixture. Verify by inspection that the regenerated `contract.json` shows
  `contract_version: 2`, `phases` deep-equal to the current 8-entry `ORKY_PHASES` list, `phase_order`
  ending in `'human-review'`, top-level `finding_resolution` and `producer_tiers` keys present, and
  `state.gate_fields` containing `firstAt`. Commit the fixtures verbatim, BEFORE the tests-gate
  freeze snapshot is captured, so the frozen snapshot contains the v2 fixtures. Expected effect on
  RED/GREEN: TEST-711's fixture assertions flip green immediately — acceptable; the suite remains
  RED overall via the handshake/mapFinding/pane/docs tests.
  - Files: `tests/fixtures/orky-contract/contract.json`, `.../state.json`, `.../active.json`,
    `.../osc-heartbeat.bin`
  - Phase: tests (test-designer)
  - Depends on: none (independent of Group A)
  - Satisfies: REQ-105, REQ-106

- **TASK-104** — Record regeneration provenance (plugin version 0.30.0 + the exact command run) in
  `CHANGELOG.md` under `[Unreleased]`, per REQ-105(c)'s auditability acceptance criterion.
  - Files: `CHANGELOG.md` (not under `tests/` — implement phase is fine)
  - Phase: implement
  - Depends on: TASK-103 (already landed in the tests phase by then)
  - Satisfies: REQ-105

- **TASK-105** — Confirm (no code change expected) that `tests/shared/orky-contract-golden.test.ts`
  passes unmodified against the regenerated fixtures — its assertions are version-agnostic per the
  spec. If any assertion turns out to be version-specific, treat that as a spec deviation and stop for
  a spec amendment rather than silently loosening the test (none anticipated per current read).
  **Verification point (amended):** first checked during the tests-phase re-run immediately after
  TASK-103 (test-designer confirms the golden suite is green against the new fixtures while the
  overall suite stays RED), then re-confirmed at the terminal gate (TASK-114) on the pristine tree.
  - Files: `tests/shared/orky-contract-golden.test.ts` (read-only verification, no planned edit)
  - Phase: tests (initial verification) + implement (TASK-114 terminal re-verification)
  - Depends on: TASK-103
  - Satisfies: REQ-105, REQ-106

### Group C — Provenance-text doc-drift reconciliation (REQ-107)

- **TASK-106** — Rewrite the provenance comment block in `src/shared/orky-status.ts` (~lines 14–20):
  update the quoted 9-entry `PHASE_ORDER` literal so its trailing entry reads `'human-review'` (not
  `'human'`), and rephrase the "trailing `human`" bullet to record the `human`→`human-review` rename as
  **resolved as of contract v2** (historical, not a live difference) while preserving the still-live
  `intake`-excluded warning verbatim in spirit. `ORKY_PHASES` the exported constant itself is NOT
  touched (REQ-106) — only the comment above it.
  - Files: `src/shared/orky-status.ts` (comment only)
  - Phase: implement
  - Depends on: none
  - Satisfies: REQ-107

- **TASK-107** — Update the matching caveat in `docs/features/orky-status.md` (§ provenance,
  ~lines 174–189) to the same v2-reconciled text: `phase_order` last entry now `'human-review'` in the
  live producer, contract version now 2, `intake`-excluded warning kept live, `human`→`human-review`
  recorded as historical/resolved.
  - Files: `docs/features/orky-status.md`
  - Phase: implement
  - Depends on: none
  - Satisfies: REQ-107

- **TASK-108** — Fix the stale "expected `1`" contract-version claim in
  `docs/features/orky-action-dispatch.md` (~line 179) to read "expected `2`" (or otherwise stop
  asserting version 1).
  - Files: `docs/features/orky-action-dispatch.md`
  - Phase: implement
  - Depends on: none
  - Satisfies: REQ-107

- **TASK-109** — Run the CONV-023 verification greps from REQ-107's acceptance criteria (against
  `src docs CLAUDE.md .orky/baseline`, excluding `CHANGELOG.md`, `.orky/features/*` archives,
  `docs/superpowers/*`) and confirm zero disqualifying hits:
  `rg "'doc-sync','human'\]"`, `rg "'doc-sync', ?'human'\]"`, `rg -i "expected .?1.?"` scoped to
  `docs/features/orky-action-dispatch.md`, `rg "trailing .?human.?"` (only historical-labeled hits
  allowed). This is a verification task, not a code-editing one — it may surface additional sites
  TASK-106/107/108 missed, in which case fix them in place before closing this task.
  - Files: none (verification across `src/`, `docs/`, `CLAUDE.md`, `.orky/baseline/`)
  - Phase: implement
  - Depends on: TASK-106, TASK-107, TASK-108
  - Satisfies: REQ-107

### Group D — `finding_resolution` adoption for display (REQ-109, REQ-110, REQ-111, REQ-112)

- **TASK-110** — Extend `OrkyFindingDetail` in `src/shared/types.ts` with three new nullable fields:
  `resolution: string | null`, `resolvedBy: string | null`, `resolvedAt: number | null`. Additive
  only — no existing field touched, no `SCHEMA_VERSION` bump (this type is derived runtime display
  data riding `registry:detail`, nothing persisted).
  - Files: `src/shared/types.ts`
  - Phase: implement
  - Depends on: none
  - Satisfies: REQ-109

- **TASK-111** — Extend `mapFinding` in `src/main/orky/orky-root-detail.ts` to map the three new
  fields with the module's existing total-mapping discipline (CONV-002): `resolution`/`resolvedBy`
  verbatim when `typeof === 'string'` else `null`; `resolvedAt` via the same tz-safe
  `epochOrNull`/`parseOrkyTimestamp` helper already used for `OrkyEscalationDetail.resolvedAt`
  (reuse, do not duplicate). No existing `mapFinding` field's mapping changes.
  - Files: `src/main/orky/orky-root-detail.ts`
  - Phase: implement
  - Depends on: TASK-110
  - Satisfies: REQ-109

- **TASK-112** — Render resolution details in `src/renderer/components/OrkyPane.tsx`'s
  `orky-pane-finding` row, following the resolved-escalation precedent at ~lines 243–245: when
  `fd.status` case-insensitively equals `'resolved'` (matching `isBlockingFinding`'s existing
  case-insensitive discipline, NOT the escalation row's strict `===`) AND `fd.resolution !== null`,
  append a dim-styled `— resolution: <resolution>` affix; when `resolvedBy`/`resolvedAt` are non-null,
  surface them on the same row (inline in the affix text or the row's `title` — implementer's choice).
  Every other finding row (open, or resolved-with-null-resolution) renders byte-identical to today —
  no affix, no `— resolution: null`, no layout change.
  - Files: `src/renderer/components/OrkyPane.tsx`
  - Phase: implement
  - Depends on: TASK-110, TASK-111
  - Satisfies: REQ-110

- **TASK-113** — Scope-guard verification: confirm `isBlockingFinding` and `openBlockingCount` in
  `src/shared/orky-status.ts` are untouched by `git diff` (REQ-111); confirm
  `rg "producer_tiers|producerTier" src` returns zero hits outside fixtures/`.orky/` (REQ-112);
  confirm no new/renamed IPC channel in `src/shared/ipc-contract.ts` or `src/main/ipc/`, and no
  `SCHEMA_VERSION` change in `src/shared/types.ts` (REQ-109, REQ-112). **Amendment addition:** also
  confirm the implement-phase diff touches NOTHING under `tests/` (the freeze boundary) — any
  `tests/` hunk in the implement diff is a task mis-assignment, not something to wave through. Pure
  verification, no edits expected; if any check fails, the offending task must be reworked before
  proceeding.
  - Files: none (verification across `src/shared/orky-status.ts`, `src/`, `src/shared/ipc-contract.ts`,
    `src/shared/types.ts`, plus the implement-phase `git diff` vs `tests/`)
  - Phase: implement
  - Depends on: TASK-110, TASK-111, TASK-112
  - Satisfies: REQ-111, REQ-112

### Group E — Full-suite gate (REQ-108)

- **TASK-114** — With plugin 0.30.0 installed at `ORKY_PLUGIN_DIR`, run the node-app gate profile
  (`npm run build && npm test`) on the pristine tree and confirm: `tests/integration/orky-act-loop.test.ts`
  TEST-691 passes with its assertion body byte-for-byte unchanged (`git diff` shows no edit to that
  test file); the full suite is green with zero failures; the real startup handshake logs no warn line
  against 0.30.0; and (per amended TASK-105) the golden suite passes unmodified against the
  regenerated fixtures. This is the feature's terminal acceptance gate — it depends on every prior
  task.
  - Files: none (verification run only)
  - Phase: implement
  - Depends on: TASK-101, TASK-102, TASK-103, TASK-105, TASK-109, TASK-110, TASK-111, TASK-112,
    TASK-113
  - Satisfies: REQ-108

## Target file/module layout (all pre-existing — no new files/modules)

```
src/main/orky/orky-contract-handshake.ts     (TASK-101: version literal)
src/main/orky/orky-root-detail.ts            (TASK-111: mapFinding extension)
src/shared/types.ts                          (TASK-110: OrkyFindingDetail fields)
src/shared/orky-status.ts                    (TASK-106: provenance comment only; predicates untouched)
src/renderer/components/OrkyPane.tsx         (TASK-112: finding-row affix)
tests/main/orky-cli-contract-handshake.test.ts   (TASK-102: phase-4 authored, phase-5 unchanged)
tests/shared/orky-contract-golden.test.ts        (TASK-105: verified unmodified)
tests/integration/orky-act-loop.test.ts          (TASK-114: verified unmodified, TEST-691)
tests/fixtures/orky-contract/*                   (TASK-103: regenerated via tool — TESTS phase, pre-freeze)
docs/features/orky-status.md                     (TASK-107)
docs/features/orky-action-dispatch.md            (TASK-108)
CHANGELOG.md                                     (TASK-104)
```

## Sequencing summary

1. **Tests-phase re-entry (amendment):** TASK-103 (single tool-run fixture regeneration) lands first,
   before the freeze snapshot is re-captured; TASK-105's initial verification and a RED re-check of
   the overall suite follow immediately. No test redesign.
2. Implement phase then proceeds: Groups A, C, and the type/mapper half of D can proceed in parallel
   (independent files); TASK-104 (CHANGELOG provenance) can land any time after entry.
3. TASK-112 (renderer) depends on TASK-110/111 landing first.
4. TASK-109 and TASK-113 are cross-cutting verification tasks that gate their groups' completion.
5. TASK-114 is the terminal full-suite gate and depends on everything.

## Risks / rationale notes

- **Why fixture regeneration lives in the TESTS phase (do not move it back):**
  `tests/fixtures/orky-contract/*` sits inside the test-freeze snapshot (`test-freeze.json`,
  `testRoots=["tests"]`) captured at the tests gate. If the implement phase regenerated them, the
  freeze guard would flag the changed fixture files as a CRITICAL integrity finding — correctly, since
  fixtures are test assets and post-freeze test-asset changes are indistinguishable from an
  implementer bending tests to pass. Regenerating in the tests phase (test-designer actor, one tool
  run against installed plugin 0.30.0, never hand-edited) puts the v2 fixtures INSIDE the frozen
  snapshot, so the implement phase can verify against them without touching `tests/` at all. The
  side effect — TEST-711's fixture assertions going green during the tests phase — is acceptable
  because the RED gate is judged on the suite overall, which stays red via the
  handshake/mapFinding/pane/docs tests until the implement phase delivers.
- The generator tool (`tools/generate-orky-contract-fixtures.mjs`) lives under `tools/`, outside the
  freeze roots — if it ever needed a fix, that fix is not freeze-guarded, but the *output* commit
  must still happen in the tests phase.

## Open issues

None — every REQ-101..REQ-112 maps to at least one task below (see `traceability.md`).
