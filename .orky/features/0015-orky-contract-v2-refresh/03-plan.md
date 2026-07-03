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

> **AMENDED #2 (ESC-001 descent, 2026-07-03 — spec loopback after human-resolved escalation).** The
> spec was amended (REQ-105/107/108/110 amended, REQ-113 added — see the `02-spec.md` banner). This
> descent is a **DELTA on top of the already-gated implementation in the working tree, not a redo**:
> TASK-101..TASK-114 are complete and STABLE — do not re-execute them except where a descent task
> below explicitly re-runs a verification. New work is **TASK-115..TASK-122** (Group F). It closes
> FINDING-001, -003, -005, -006, -008, -011, -012, -013 directly, and FINDING-004/-010 via the
> TEST-719 provenance fix. FINDING-002 is satisfied as a MAY (amended REQ-110). FINDING-009 is an
> `04-tests.md` artifact-consistency note handled by the tests-phase re-entry record; FINDING-014/
> -015/-016 are OUT OF SCOPE here — they go to the followups doc at doc-sync, per the spec banner.
> The freeze boundary stands: everything under `tests/` (TASK-115..117) belongs to the tests phase;
> the implement phase (TASK-118..122) MUST NOT touch `tests/`.

This is a re-sync, not new architecture: no new files (the descent adds one new **doc section**, no
new modules), no new IPC channels, no `SCHEMA_VERSION` bump. Tasks are grouped by the four
independent surfaces the spec touches (handshake constant + its frozen tests, golden fixtures,
provenance-text doc-drift cleanup, `finding_resolution` display), each independently
buildable/testable, then a final full-gate task. Group F holds the ESC-001 descent delta.

## Phase ownership & the freeze boundary

- **TESTS phase (test-designer):** TASK-102 (handshake test updates — already authored in the first
  pass), **TASK-103** (fixture regeneration — the first amendment), TASK-105's fixture-side
  verification, and — **ESC-001 descent** — TASK-115 (TEST-719 provenance re-pin), TASK-116
  (REQ-110 title-mirror + empty-string cases), TASK-117 (REQ-107 prose-phrasing scan encoded as a
  docs-test assertion). All of these live under `tests/` and MUST land before the tests-gate freeze
  snapshot is (re-)captured.
- **IMPLEMENT phase:** MUST NOT touch anything under `tests/` — that is the freeze boundary. Its
  original surface: `src/` constants (TASK-101), provenance comments/docs (TASK-106..TASK-108 +
  TASK-109 verification), the `OrkyFindingDetail`/`mapFinding`/`OrkyPane` changes
  (TASK-110..TASK-112), CHANGELOG (TASK-104), scope guards (TASK-113), terminal gate (TASK-114).
  **ESC-001 descent addition:** CLAUDE.md:179 (TASK-118), CHANGELOG rewording (TASK-119), OrkyPane
  affix guard + title mirror (TASK-120), the new `docs/features/orky-pane.md` section (TASK-121),
  descent terminal gate (TASK-122).
- **Tests-phase re-entry scope (ESC-001 descent):** targeted amendment of exactly three files —
  `tests/docs-feature-0015.test.ts` (TASK-115 + TASK-117), and the frozen REQ-110 pair
  `tests/renderer/orky-pane-resolution-structure.test.ts` / `tests/e2e/orky-pane-resolution.spec.ts`
  (TASK-116). NO other test is redesigned; TASK-102/103/105 artifacts stand as landed. The amended
  suite MUST run RED against the current working tree: the title-mirror and non-empty-resolution
  guard are not yet implemented (TASK-120 pending), CLAUDE.md:179 is unfixed (TASK-118 pending), and
  the CHANGELOG provenance wording is unfixed (TASK-119 pending). Record the RED evidence and
  re-capture the freeze snapshot after these edits.

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
  installed plugin whose `contract` output reports `contract_version: 2` (per amended REQ-105 the
  producer is identified by observable contract, its version **read at generation time** and
  recorded as fact — the executed run recorded plugin 0.32.0, commit `1c59d74`), regenerating all
  four fixtures under `tests/fixtures/orky-contract/` (`contract.json`, `state.json`, `active.json`,
  `osc-heartbeat.bin`) in that single run. Never hand-edit any fixture. Verify by inspection that the
  regenerated `contract.json` shows `contract_version: 2`, `phases` deep-equal to the current 8-entry
  `ORKY_PHASES` list, `phase_order` ending in `'human-review'`, top-level `finding_resolution` and
  `producer_tiers` keys present, and `state.gate_fields` containing `firstAt`. Commit the fixtures
  verbatim, BEFORE the tests-gate freeze snapshot is captured. Expected effect on RED/GREEN:
  TEST-711's fixture assertions flip green immediately — acceptable; the suite remains RED overall.
  **Status: EXECUTED in the first tests pass (recorded in 04-tests.md) — not re-run by the descent.**
  - Files: `tests/fixtures/orky-contract/contract.json`, `.../state.json`, `.../active.json`,
    `.../osc-heartbeat.bin`
  - Phase: tests (test-designer)
  - Depends on: none (independent of Group A)
  - Satisfies: REQ-105, REQ-106

- **TASK-104** — Record regeneration provenance (producer version + commit as read at generation
  time, plus the exact command run) in `CHANGELOG.md` under `[Unreleased]`, per REQ-105(c)'s
  auditability acceptance criterion. **Executed in the first pass; its wording is corrected by the
  descent's TASK-119 (generation-time producer must lead; no spec-time literal as the MUST).**
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
  TASK-106/107/108 missed, in which case fix them in place before closing this task. **Descent note:
  the amended REQ-107 adds scan (4), the prose-phrasing scan `rg "intake.{1,5}human" src docs
  CLAUDE.md .orky/baseline` — re-run as part of TASK-122 after TASK-118 lands.**
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
  case-insensitive discipline, NOT the escalation row's strict `===`) AND the resolution guard holds,
  append a dim-styled `— resolution: <resolution>` affix; when `resolvedBy`/`resolvedAt` are non-null,
  surface them on the same row. Every other finding row renders byte-identical to today — no affix,
  no `— resolution: null`, no layout change. **Executed in the first pass; superseded in part by the
  descent's TASK-120, which tightens the guard to non-empty resolution and adds the row-title
  full-text mirror per amended REQ-110.**
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
  proceeding. **Descent note: re-run these checks over the descent delta as part of TASK-122.**
  - Files: none (verification across `src/shared/orky-status.ts`, `src/`, `src/shared/ipc-contract.ts`,
    `src/shared/types.ts`, plus the implement-phase `git diff` vs `tests/`)
  - Phase: implement
  - Depends on: TASK-110, TASK-111, TASK-112
  - Satisfies: REQ-111, REQ-112

### Group E — Full-suite gate (REQ-108)

- **TASK-114** — With a plugin whose `contract` output reports `contract_version: 2` installed at
  `ORKY_PLUGIN_DIR` (the producer actually present at run time — a recorded fact, never a spec-time
  version numeral, per amended REQ-108), run the node-app gate profile (`npm run build && npm test`)
  on the pristine tree and confirm: `tests/integration/orky-act-loop.test.ts` TEST-691 passes with
  its assertion body byte-for-byte unchanged (`git diff` shows no edit to that test file); the full
  suite is green with zero failures; the real startup handshake logs no warn line against the
  installed v2 producer; and (per amended TASK-105) the golden suite passes unmodified against the
  regenerated fixtures. **Executed in the first pass; re-run for the descent as TASK-122.**
  - Files: none (verification run only)
  - Phase: implement
  - Depends on: TASK-101, TASK-102, TASK-103, TASK-105, TASK-109, TASK-110, TASK-111, TASK-112,
    TASK-113
  - Satisfies: REQ-108

### Group F — ESC-001 descent delta (amended REQ-105/107/108/110, new REQ-113)

#### F.1 — Tests-phase re-entry (test-designer; land BEFORE the freeze snapshot is re-captured)

- **TASK-115** — Amend TEST-719 in `tests/docs-feature-0015.test.ts` per amended REQ-105: **drop the
  `toContain('0.30.0')` pin** (and fix the it-description so 0.30.0 is not labeled the regeneration
  version). Encode exactly the amended acceptance: the CHANGELOG `[Unreleased]` provenance record
  MUST name the **generation-time recorded producer** — assert the recorded fact from the 04-tests.md
  TASK-103 execution record (0.32.0 / commit `1c59d74`) or, preferably, a **version-agnostic shape**
  (e.g. a regex for `regenerated against plugin <semver> (commit <sha>)`). Per the spec's new
  wording, NO assertion for REQ-105 may require a hardcoded spec-time version numeral; `0.30.0` may
  survive in the CHANGELOG only as a historical spec-time mention, and no test may require it.
  Closes FINDING-004/-006/-010/-013 (test side) and the TEST-719 half of FINDING-008.
  - Files: `tests/docs-feature-0015.test.ts`
  - Phase: tests (test-designer) — ESC-001 descent re-entry
  - Depends on: none (amends an existing frozen test through the sanctioned path)
  - Satisfies: REQ-105
  - RED expectation: RED against the working tree until TASK-119 rewords the CHANGELOG lead.

- **TASK-116** — Extend the frozen REQ-110 tests for the two new MUSTs, in
  `tests/renderer/orky-pane-resolution-structure.test.ts` and/or
  `tests/e2e/orky-pane-resolution.spec.ts` (test-designer picks the layer per each assertion's
  existing home; both files are in scope): (a) **title mirror** — whenever the affix renders, the
  row's `title` attribute contains the resolution details (resolution text + resolvedBy/resolvedAt)
  *alongside the claim*, i.e. mirrors the full rendered row text (amended acceptance (a));
  (b) **non-empty guard** — a resolved finding with `resolution: ''` (even with non-null
  `resolvedBy`/`resolvedAt`) renders NO `resolution:` substring, identical to the null-resolution
  no-affix rendering (new acceptance case (d)). Existing cases (a)–(c) from the first pass stand;
  do not weaken them. Locators per CONV-056; structural pins per CONV-032. Closes the test side of
  FINDING-001/-011/-003. (The resolvedBy `by <…>` label is a MAY — do NOT pin it; FINDING-002.)
  - Files: `tests/renderer/orky-pane-resolution-structure.test.ts`,
    `tests/e2e/orky-pane-resolution.spec.ts`
  - Phase: tests (test-designer) — ESC-001 descent re-entry
  - Depends on: none
  - Satisfies: REQ-110
  - RED expectation: RED against the working tree — the current OrkyPane keeps `title={fd.claim}`
    and guards only on `resolution !== null`.

- **TASK-117** — Encode amended REQ-107's **prose-phrasing scan (4)** as a docs-test assertion in
  `tests/docs-feature-0015.test.ts` (decision: it should be a frozen test, not only a review-time
  grep — it is the descent's RED signal for the CLAUDE.md fix and a durable drift guard): scan
  `CLAUDE.md` (and, matching the REQ's scope, `src/shared/orky-status.ts` +
  `docs/features/orky-status.md`) for the pattern `intake.{1,5}human` and assert every hit either
  continues with `-review` or is explicitly labeled historical/pre-v2 — in particular that
  CLAUDE.md's line ~179 no longer reads "(intake…human)". Scans (1)–(3) remain review-time greps
  owned by TASK-109/TASK-122 (unchanged). Optionally (test-designer's discretion — REQ-113's
  acceptance allows a review read instead) add a REQ-113 docs assertion checking
  `docs/features/orky-pane.md` names `resolution`, `resolvedBy`, `resolvedAt` and both display
  guards. Closes the guard side of FINDING-005/-012.
  - Files: `tests/docs-feature-0015.test.ts`
  - Phase: tests (test-designer) — ESC-001 descent re-entry
  - Depends on: none
  - Satisfies: REQ-107 (optionally REQ-113)
  - RED expectation: RED against the working tree — CLAUDE.md:179 still reads "(intake…human)".

#### F.2 — Implement-phase delta (MUST NOT touch `tests/`)

- **TASK-118** — Fix `CLAUDE.md:179`: the "(intake…human)" parenthetical MUST read
  "(intake…human-review)" (or equivalent version-aware phrasing consistent with the reconciled
  provenance notes in `src/shared/orky-status.ts` / `docs/features/orky-status.md`). Single-site
  prose fix; touch nothing else on that line's semantics. Closes FINDING-005/-012.
  - Files: `CLAUDE.md`
  - Phase: implement — ESC-001 descent
  - Depends on: TASK-117 (RED test landed first, per TDD)
  - Satisfies: REQ-107

- **TASK-119** — Reword the `CHANGELOG.md` `[Unreleased]` fixture-provenance entry so the
  **generation-time recorded producer leads as fact**: "regenerated against plugin 0.32.0 (commit
  `1c59d74`)" (the values recorded in the 04-tests.md TASK-103 execution record) with 0.30.0 demoted
  to a spec-time historical mention (e.g. "the concept-phase target 0.30.0; the two builds'
  `gatekeeper/` trees are byte-identical"). Keep the exact regeneration command. Do not touch other
  CHANGELOG entries. Closes FINDING-006/-013 (doc side) and the CHANGELOG half of FINDING-004/-008.
  - Files: `CHANGELOG.md`
  - Phase: implement — ESC-001 descent
  - Depends on: TASK-115 (RED test landed first)
  - Satisfies: REQ-105

- **TASK-120** — Amend the resolution affix in `src/renderer/components/OrkyPane.tsx` (the TASK-112
  code, ~lines 230–247) per amended REQ-110: (a) tighten the display guard to **non-empty**
  resolution (`fd.resolution !== null && fd.resolution !== ''`; the REQ-109 mapper stays verbatim —
  no trimming there); (b) **compose the affix string once** and, whenever the affix renders, set the
  row's `title` to the full rendered row text (claim + affix) so clipped rows stay reachable —
  following the row's existing `title` idiom (FINDING-001's fix shape); non-affixed rows keep
  `title={fd.claim}` exactly as today. MAY (optional polish, not pinned by tests): label the
  attribution `by <resolvedBy>` mirroring the labeled `at <ts>` pattern (FINDING-002). A dangling
  `— resolution:` label MUST never render. Open and resolved-with-null-or-empty-resolution rows
  render byte-identical to the pre-descent rendering. Closes FINDING-001/-003/-011 (and optionally
  -002).
  - Files: `src/renderer/components/OrkyPane.tsx`
  - Phase: implement — ESC-001 descent
  - Depends on: TASK-116 (RED tests landed first); builds on TASK-112's landed code
  - Satisfies: REQ-110

- **TASK-121** — Write the new resolution-display section in `docs/features/orky-pane.md` (new
  REQ-113): (a) the three additive `OrkyFindingDetail` fields (`resolution`, `resolvedBy`,
  `resolvedAt`) riding the `registry:detail` payload, including their null-default total mapping
  (REQ-109); (b) the finding-row `— resolution:` affix and its guards — case-insensitive `resolved`
  status check, non-empty-resolution display guard, resolvedBy/resolvedAt surfacing (resolvedAt via
  the existing instant formatting), and the row-`title` full-text mirror for clipped rows. Add the
  doc to this feature's traceability files (done in this amendment). Closes FINDING-007.
  - Files: `docs/features/orky-pane.md`
  - Phase: implement — ESC-001 descent
  - Depends on: TASK-120 (document the as-built guards)
  - Satisfies: REQ-113

- **TASK-122** — Descent terminal gate. Re-run: (a) the CONV-023 greps of TASK-109 **plus** amended
  scan (4) `rg "intake.{1,5}human" src docs CLAUDE.md .orky/baseline` (every hit continues with
  `-review` or is labeled historical; exemptions per spec: `CHANGELOG.md` past entries,
  `.orky/features/*`, `docs/superpowers/*`); (b) TASK-113's scope guards over the descent delta
  (predicates untouched, no `producer_tiers` in `src`, no channel/`SCHEMA_VERSION` change, descent
  implement diff touches NOTHING under `tests/`); (c) TASK-114's full gate — `npm run build && npm
  test` on the pristine tree with the installed v2-contract producer: TEST-691 assertions unchanged
  and passing, the amended TEST-719 + REQ-110 cases now GREEN, zero failures suite-wide, no startup
  handshake warn. This is the descent's terminal acceptance gate.
  - Files: none (verification run only)
  - Phase: implement — ESC-001 descent
  - Depends on: TASK-115, TASK-116, TASK-117, TASK-118, TASK-119, TASK-120, TASK-121
  - Satisfies: REQ-105, REQ-107, REQ-108, REQ-110, REQ-111, REQ-112

## Target file/module layout (all pre-existing — no new files/modules; descent adds one doc section)

```
src/main/orky/orky-contract-handshake.ts     (TASK-101: version literal)
src/main/orky/orky-root-detail.ts            (TASK-111: mapFinding extension)
src/shared/types.ts                          (TASK-110: OrkyFindingDetail fields)
src/shared/orky-status.ts                    (TASK-106: provenance comment only; predicates untouched)
src/renderer/components/OrkyPane.tsx         (TASK-112 + TASK-120: finding-row affix, non-empty guard, title mirror)
tests/main/orky-cli-contract-handshake.test.ts   (TASK-102: phase-4 authored, phase-5 unchanged)
tests/shared/orky-contract-golden.test.ts        (TASK-105: verified unmodified)
tests/integration/orky-act-loop.test.ts          (TASK-114/122: verified unmodified, TEST-691)
tests/fixtures/orky-contract/*                   (TASK-103: regenerated via tool — TESTS phase, pre-freeze)
tests/docs-feature-0015.test.ts                  (TASK-115 + TASK-117: TEST-719 re-pin + prose-phrasing scan — TESTS phase)
tests/renderer/orky-pane-resolution-structure.test.ts  (TASK-116: title-mirror + empty-string cases — TESTS phase)
tests/e2e/orky-pane-resolution.spec.ts           (TASK-116: ditto, e2e layer — TESTS phase)
docs/features/orky-status.md                     (TASK-107)
docs/features/orky-action-dispatch.md            (TASK-108)
docs/features/orky-pane.md                       (TASK-121: NEW resolution-display section, REQ-113)
CLAUDE.md                                        (TASK-118: line 179 prose fix)
CHANGELOG.md                                     (TASK-104 + TASK-119: provenance record, generation-time producer leads)
```

## Sequencing summary

1. **Tests-phase re-entry (first amendment):** TASK-103 fixture regeneration — DONE in the first pass.
2. First-pass implement: Groups A, C, D landed; TASK-114 gate passed. All stable.
3. **ESC-001 descent, tests-phase re-entry:** TASK-115, TASK-116, TASK-117 land together (three test
   files, no redesign of anything else), suite verified RED overall against the working tree, freeze
   snapshot re-captured.
4. **ESC-001 descent, implement:** TASK-118, TASK-119, TASK-120 in parallel (independent files);
   TASK-121 after TASK-120 (documents the as-built guards).
5. TASK-122 is the descent's terminal gate and depends on all of Group F.

## Risks / rationale notes

- **Why fixture regeneration lives in the TESTS phase (do not move it back):**
  `tests/fixtures/orky-contract/*` sits inside the test-freeze snapshot (`test-freeze.json`,
  `testRoots=["tests"]`) captured at the tests gate. If the implement phase regenerated them, the
  freeze guard would flag the changed fixture files as a CRITICAL integrity finding — correctly, since
  fixtures are test assets and post-freeze test-asset changes are indistinguishable from an
  implementer bending tests to pass. Regenerating in the tests phase (test-designer actor, one tool
  run against the installed v2-contract plugin, never hand-edited) puts the v2 fixtures INSIDE the
  frozen snapshot, so the implement phase can verify against them without touching `tests/` at all.
- The generator tool (`tools/generate-orky-contract-fixtures.mjs`) lives under `tools/`, outside the
  freeze roots — if it ever needed a fix, that fix is not freeze-guarded, but the *output* commit
  must still happen in the tests phase.
- **Descent risk — TEST-719 shape choice (TASK-115):** the version-agnostic regex shape is preferred
  over `toContain('0.32.0')` because the amended REQ-105 forbids requiring a hardcoded version
  numeral; if the test-designer pins `0.32.0` anyway it is still a *recorded fact*, not a spec-time
  literal, so both encodings satisfy the amended acceptance — but the regex shape survives the next
  re-mirror without a test edit. (The broader re-mirror playbook, FINDING-014, is deliberately out of
  scope — followups doc at doc-sync.)
- **Descent scope discipline:** FINDING-015 (extract `isResolvedFinding` predicate) and FINDING-016
  (cache-lifetime doc qualifier) are LOW and out of the amendment's scope — do NOT fold them into
  TASK-120/TASK-118; they go to the followups doc.

## Open issues

None — every REQ-101..REQ-113 maps to at least one task (see `traceability.md`). Uncovered REQs: none.
