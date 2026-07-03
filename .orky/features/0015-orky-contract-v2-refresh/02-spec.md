# Spec — 0015-orky-contract-v2-refresh

**Phase:** 2 (spec). **Inputs:** `00-intake.md`, `01-concept.md` (human-confirmed decisions are
BINDING), `.orky/conventions.md`, `.orky/baseline/` (adopted brownfield repo).

## Concerns

`["determinism", "doc-drift", "ux", "data-provenance"]`

(`data-provenance` added over the concept's proposed set: the committed golden fixtures under
`tests/fixtures/orky-contract/`, the `EXPECTED_CONTRACT_VERSION` constant, and the quoted
`PHASE_ORDER` provenance comments are all data *claimed to match an external source* — the installed
Orky plugin 0.30.0. Orky's tests verify the code agrees with that committed data; only TEST-691 and
the human regeneration step verify the data against reality. Always-on lenses per config: security,
quality, devils-advocate.)

## Scope summary

Re-sync Termhalla's Orky contract mirror from v1 to v2 (plugin 0.30.0): bump the strict handshake
pin, regenerate the golden fixtures from the live producer, invert the version-mismatch unit cases,
reconcile the `phase_order` provenance *text* (no code constant mirrors it — `ORKY_PHASES` is
untouched), and adopt the new `finding_resolution` fields for read-only display in the Orky pane.
`producer_tiers` is explicitly not adopted. No new IPC channels, no `SCHEMA_VERSION` bump, no
`.orky/` writes; the handshake stays log-only, never a gate.

Verified v1→v2 diff (ground truth, live plugin): `contract_version` 1→2; `phases` (the 8-entry list
`ORKY_PHASES` mirrors) **unchanged**; `phase_order` last entry `'human'`→`'human-review'`; new
top-level `finding_resolution` and `producer_tiers` blocks; `state.gate_fields` gained `firstAt`.

Baseline note: this feature intentionally changes the behavior pinned by the 0007-era handshake unit
suite (`tests/main/orky-cli-contract-handshake.test.ts`) — the "healthy" version flips from 1 to 2
and the version-mismatch polarity inverts (REQ-101/REQ-102). Those test updates go through the tests
phase (frozen-test discipline), never ad-hoc edits during implementation. No baseline `REQ-` in
`.orky/baseline/inferred-spec.md` is superseded; TEST-691's assertions are NOT changed (REQ-108).

---

## REQ-101 — Version pin bumped to 2; a v2 plugin handshakes clean

`EXPECTED_CONTRACT_VERSION` in `src/main/orky/orky-contract-handshake.ts` MUST be `2`, and the
comparison MUST remain strict equality (`!==`) — no range or minimum-version tolerance (binding
decision 1). A plugin whose `contract` output reports `contract_version: 2` together with a `phases`
list deep-equal to `ORKY_PHASES` MUST yield `{ ok: true, contractVersion: 2, mismatches: [] }` with
zero `warn` invocations.

**Acceptance:** the handshake unit suite's healthy-path case (updated through the tests phase to a
`goodContract` baseline of `contract_version: 2`) asserts `verifyOrkyContract` with a fake runner
emitting version 2 + `[...ORKY_PHASES]` returns exactly `{ ok: true, contractVersion: 2,
mismatches: [] }` and the injected `warn` spy was never called; the invocation pins (`['contract']`
args, `CONTRACT_HANDSHAKE_TIMEOUT_MS`) still hold. `EXPECTED_CONTRACT_VERSION === 2` is directly
assertable via the exported constant.

## REQ-102 — An older v1 plugin is now the proven mismatch (mixed-fleet case)

A plugin reporting `contract_version: 1` (with matching `phases`) MUST yield `ok: false`,
`contractVersion: 1`, and exactly one mismatch string naming BOTH sides (containing
`contract_version`, `plugin=1`, and `expected=2`), with exactly one detailed `warn` line carrying the
same both-sides text. This MUST remain log-only observability: no caller consults the result to
block dispatch or any other behavior (the module's existing invariant).

**Acceptance:** the unit suite's former "contract_version 2 → mismatch" case is inverted (tests
phase) to feed `contract_version: 1` and asserts `ok:false`, `contractVersion === 1`,
`mismatches.length === 1`, the mismatch string contains `contract_version`, `plugin=1`, and
`expected=${EXPECTED_CONTRACT_VERSION}`, and the `warn` spy fired exactly once with a line containing
`plugin=1` and `expected=2`. A repo-wide grep confirms no production code path branches on
`verifyOrkyContract(...).ok` to gate behavior (unchanged from today).

## REQ-103 — A future version (3) is still a mismatch

Strict pin means newer-than-expected is also drift: a plugin reporting `contract_version: 3` MUST
yield `ok: false` with a both-sides mismatch, identically to REQ-102's shape.

**Acceptance:** the unit suite retains a future-version case (the existing cached-mismatch test at
`contract_version: 3` satisfies this) asserting `ok === false` for version 3 against the v2 pin.

## REQ-104 — Every other handshake invariant is byte-for-byte preserved

Beyond the constant's value, `verifyOrkyContract`'s observable contract MUST NOT change: never
throws / never rejects; absent CLI → `ok:true` + note, runner never invoked, not cached;
pre-`contract` plugin (non-zero exit, timeout, non-JSON, or JSON without a numeric
`contract_version`) → `ok:true` + note + softer "skew undetectable" warn; a rejecting runner is
swallowed; results (including mismatches) are cached per located path for the process lifetime with
one warn per path and concurrent calls sharing one in-flight promise; phase-list drift detection
against `ORKY_PHASES` is unchanged.

**Acceptance:** the unit suite's graceful-degradation and cache describe-blocks pass with NO
assertion changes other than version literals inside `goodContract` overrides; the phases-drift
cases (inserted phase; same-length rename `[...ORKY_PHASES.slice(0, -1), 'human']`) pass unchanged —
the rename case stays valid because v2 did not change `phases`.

## REQ-105 — Golden fixtures regenerated from the live plugin, never hand-edited

All four fixtures in `tests/fixtures/orky-contract/` (`contract.json`, `state.json`, `active.json`,
`osc-heartbeat.bin`) MUST be regenerated in one run of the existing
`tools/generate-orky-contract-fixtures.mjs` against the installed plugin 0.30.0, and committed
verbatim (binding decision 3: fixtures remain real producer output; hand-editing any fixture is a
violation). The regenerated `contract.json` MUST show: `contract_version === 2`; `phases`
deep-equal to the current 8-entry list; `phase_order` ending in `'human-review'`; top-level
`finding_resolution` and `producer_tiers` keys present; `state.gate_fields` containing `firstAt`.

**Acceptance:** (a) the committed `contract.json` satisfies every field assertion above (directly
checkable by a test or review read); (b) `tests/shared/orky-contract-golden.test.ts` passes
unmodified against the regenerated fixtures (its `phases`/OSC/state/active assertions are all
version-agnostic); (c) provenance is auditable — the regeneration command and plugin version
(0.30.0) are recorded in the commit/changelog, and when the plugin is present,
`node <plugin>/gatekeeper/cli.js contract` output deep-equals the committed `contract.json`
(TEST-691's live handshake covers the version+phases subset on every plugin-present run).

## REQ-106 — `ORKY_PHASES` MUST NOT change

The v2 `phases` list is unchanged, so `ORKY_PHASES` (and `ORKY_AUTONOMOUS_PHASES`, `gateN`, and
every consumer of the gate-key vocabulary) MUST NOT be edited. The CLAUDE.md provenance caveat holds:
`ORKY_PHASES` mirrors recorded gate keys / `DRIVER_WORK_PHASES`, NOT Orky's 9-entry `PHASE_ORDER`;
v2 makes the two vocabularies agree on the last entry — it does not merge them.

**Acceptance:** the golden test "`contract.phases` deep-equals `ORKY_PHASES`" passes against the
regenerated fixture with the `ORKY_PHASES` literal in `src/shared/orky-status.ts` textually
unchanged (git diff shows no change to the exported constant); all existing `orky-status` unit and
characterization tests pass unmodified.

## REQ-107 — `phase_order` provenance text reconciled everywhere (CONV-008 / CONV-023)

Every prose mirror of the old v1 `phase_order` (the quoted 9-entry list ending `'human'`) and every
stale "expected `1`" contract-version claim MUST be updated to v2 reality, with the whole-tree grep
discipline of CONV-008. Known sites (not an exhaustive claim — the greps below are the authority):
the provenance comment in `src/shared/orky-status.ts` (~lines 14–20, the quoted `PHASE_ORDER`
literal and the "trailing `human`" bullet), the matching caveat in `docs/features/orky-status.md`
(§ provenance, ~lines 174–189), and `docs/features/orky-action-dispatch.md` line ~179 ("expected
`1`"). The rewritten provenance note MUST preserve both intentional-difference warnings in
version-aware form: `intake` remains excluded (still a live difference), and the historical
`human`→`human-review` rename MUST be recorded as resolved-at-contract-v2 rather than deleted — the
"do not re-sync `ORKY_PHASES` against `PHASE_ORDER`" instruction stays load-bearing.

**Acceptance:** per CONV-023, the exact scans: (1)
`rg "'doc-sync','human'\]" src docs CLAUDE.md .orky/baseline` and
`rg "'doc-sync', ?'human'\]" src docs CLAUDE.md .orky/baseline` return zero hits; (2)
`rg -i "expected .?1.?" docs/features/orky-action-dispatch.md` returns zero hits describing the
contract version; (3) `rg "trailing .?human.?" src docs CLAUDE.md .orky/baseline` hits only text
that names the rename as historical/pre-v2. Historical artifacts (`CHANGELOG.md` past entries,
`.orky/features/*` archives, `docs/superpowers/*`) are exempt. Both intentional-difference warnings
still appear in `src/shared/orky-status.ts` and `docs/features/orky-status.md`.

## REQ-108 — TEST-691 green on a pristine tree; startup handshake silent against 0.30.0

With plugin 0.30.0 installed at `ORKY_PLUGIN_DIR`, `tests/integration/orky-act-loop.test.ts`
TEST-691 MUST pass with its assertion body UNCHANGED (`ok === true`,
`contractVersion === EXPECTED_CONTRACT_VERSION`, `mismatches === []`, `note` undefined,
`warns === []`) — the headline success criterion. Consequently the real startup handshake logs no
warn line against 0.30.0. The full node-app gate (`npm run build` + `npm test`) MUST be green.

**Acceptance:** `npm test` on a pristine tree with the plugin installed shows TEST-691 passing and
zero failures suite-wide; `git diff` shows no edit to TEST-691's assertions. (Without the plugin the
suite self-skips, per its existing header — the plugin-present run is the acceptance run.)

## REQ-109 — `OrkyFindingDetail` carries the v2 `finding_resolution` fields

`OrkyFindingDetail` in `src/shared/types.ts` MUST gain three fields mapped in
`orky-root-detail.ts#mapFinding` with the module's existing total-mapping discipline (CONV-002 —
never a throw, mistyped/absent → the pinned null default, values verbatim):

- `resolution: string | null` — `f.resolution` when a string, else `null` (verbatim, no trimming).
- `resolvedBy: string | null` — `f.resolvedBy` when a string, else `null` (verbatim).
- `resolvedAt: number | null` — epoch ms via the same tz-safe timestamp parse
  `OrkyEscalationDetail.resolvedAt` uses (`parseOrkyTimestamp`/`epochOrNull`), else `null`.

The extended shape rides the EXISTING `registry:detail` payload: no new IPC channel, no channel
rename, no `SCHEMA_VERSION` bump (derived, runtime-only display data — nothing persisted).

**Acceptance:** unit tests on the detail builder (or `mapFinding` via its module seam) assert: a
finding entry carrying `{ resolution: 'fixed X', resolvedBy: 'kevin', resolvedAt: '<ISO ts>' }` maps
to the verbatim strings + a non-null epoch-ms number; entries with the fields absent, `null`, or
mistyped (number resolution, object resolvedBy, junk resolvedAt) map all three to `null` with no
throw; every pre-existing `OrkyFindingDetail` field maps exactly as before. `git diff` shows no
change to `src/shared/ipc-contract.ts` channel names and no change to the `SCHEMA_VERSION` value.

## REQ-110 — Orky pane displays resolution details on resolved findings only

In the Orky pane's finding rows (`OrkyPane.tsx`), a finding whose `status` is `resolved` —
compared case-insensitively, matching the producer's `finding_normalization` contract and the
existing `isBlockingFinding` discipline, NOT the escalation row's strict `===` — and whose
`resolution` is non-null MUST render its resolution text appended to the row following the
resolved-escalation precedent (`— decision: …` at OrkyPane.tsx ~243–245), i.e. a dim-styled
`— resolution: <resolution>` affix. When `resolvedBy` and/or `resolvedAt` are non-null they MUST be
surfaced on the same row (inline in the affix or via the row's `title` tooltip — implementation's
choice, but observable). A resolved finding with `resolution === null` and every non-resolved
finding MUST render its row exactly as today (no affix, no `— resolution: null`, no layout change).
Open findings render unchanged (success criterion).

**Acceptance:** renderer/e2e tests assert: (a) a detail payload with a finding
`{ status: 'resolved', resolution: 'rewrote the guard', resolvedBy: 'kevin', resolvedAt: <ts> }`
renders an `orky-pane-finding` row containing `— resolution: rewrote the guard`, and `resolvedBy`
plus a formatted `resolvedAt` are present in the row's text or `title`; (b) the same with
`status: 'Resolved'` (mixed case) also shows the affix; (c) a finding with `status: 'open'` and a
resolved finding with `resolution: null` render row text containing NO `resolution:` substring and
identical in content to the pre-change rendering. Locators per CONV-056 (testid/exact-regex, no
substring `hasText`); any structural source pin anchored per CONV-032.

## REQ-111 — Blocking predicates untouched

`isBlockingFinding` and `openBlockingCount` in `src/shared/orky-status.ts` MUST NOT be modified
(binding decision 5: resolved findings already stop counting via the existing case-insensitive
`status !== 'open'` check — a v2 resolved finding is not blocking today and stays not blocking).

**Acceptance:** `git diff` shows no change to either function; the existing shared unit tests and
`tests/characterization-shared.test.ts` pass unmodified; a test vector proves a v2-shaped resolved
finding (`{ status: 'resolved', severity: 'CRITICAL', resolution: '…' }`) yields
`isBlockingFinding(...) === false` (may reuse/extend an existing case — the predicate itself is
unchanged).

## REQ-112 — Scope guards: no `producer_tiers` surface, no writes, no new channels

Termhalla MUST mirror nothing of `producer_tiers` — no type, no constant, no rendering (binding
decision 6; dead type surface invites doc-drift). No action beyond the fixture refresh for the
additive `state.gate_fields` `firstAt` (extra-field tolerance is the existing consumer contract).
The feature MUST introduce no `.orky/` write path, no new IPC channel, and no pipeline-driving
behavior.

**Acceptance:** at review, `rg "producer_tiers|producerTier" src` returns zero hits (fixtures and
`.orky/` feature docs exempt; this is a review-time scope check, not a new frozen absence-guard —
avoiding CONV-019/CONV-037 machinery for a non-adoption); `git diff` confined to the files this
spec names plus tests/docs — no changes under `src/main/ipc/` channel registration, no
`SCHEMA_VERSION` change; the existing read-only-invariant integration coverage (TEST-702) passes
unmodified.

---

## Public interface

- `EXPECTED_CONTRACT_VERSION` (exported, `src/main/orky/orky-contract-handshake.ts`): `1` → `2`.
  Semantics of `verifyOrkyContract(deps?) => Promise<OrkyContractCheck>` otherwise unchanged
  (REQ-104).
- `OrkyFindingDetail` (`src/shared/types.ts`, rides `registry:detail`): gains
  `resolution: string | null`, `resolvedBy: string | null`, `resolvedAt: number | null` (REQ-109).
  Additive; no channel or schema change.
- Committed test data contract: `tests/fixtures/orky-contract/*` is the v2 producer snapshot
  (REQ-105) consumed by `tests/shared/orky-contract-golden.test.ts`.

## Open questions

None. The concept's two open questions were resolved by the human (strict pin at 2, warn-only;
adopt `finding_resolution` display / skip `producer_tiers`); decision-queue resolution display is
explicitly deferred out of scope.
