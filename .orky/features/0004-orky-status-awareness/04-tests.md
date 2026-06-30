# 0004 — Orky status awareness — Test design (Phase 4)

**Status:** tests authored, suite verified RED. The spec [`02-spec.md`](02-spec.md) is FROZEN (22 REQs);
the plan [`03-plan.md`](03-plan.md) defines 19 TASKs. These tests are written BEFORE any implementation
exists and are **FROZEN once the tests gate passes (ADR-009)** — the implementer makes them pass without
editing them.

The test designer is a different actor from the implementer (the integrity boundary). Every mapper is
total (never throws) and pure: `now` and `thresholdMs` are ALWAYS injected, so there is **zero
wall-clock dependence** in any time-dependent test.

## RED verification

```
npx vitest run          # → 7 failed test files | 105 passed (112); 6 failed tests | 692 passed (698)
```

The 7 failing files are exactly the new feature files; **all 105 pre-existing files still pass** (no
unrelated breakage). Failure causes are the want-of-implementation signal, not test typos:

- `tests/shared/orky-status.test.ts`, `tests/main/find-orky-root.test.ts`, `tests/main/orky-tracker.test.ts`
  fail at **collection** with `Cannot find module '@shared/orky-status'` / `Failed to load url
  …/find-orky-root` / `…/orky-tracker` — the modules do not exist yet.
- `tests/shared/orky-chip-status.test.ts` → `orkyChipStatus is not a function`.
- `tests/shared/orky-ipc-contract.test.ts` → `CH.orkyStatus` is `undefined`.
- `tests/renderer/orky-tab-badge.test.ts` → `workspaceBadgeState` ignores the new 4th arg (`needs` is 0).
- `tests/docs-feature-0004.test.ts` → the feature doc / CLAUDE.md / CHANGELOG entries are absent.

**e2e (`tests/e2e/orky-status.spec.ts`) was NOT executed** — Playwright-for-Electron runs against `out/`
and needs `npm run build` first; with no implementation the `orky-chip-*` / `orky-menu` test-ids and the
Orky-derived border do not exist, so every assertion times out (RED by construction). It is frozen
alongside the unit suite and runs at the implement gate after a build.

## Chosen signatures where the spec/plan were ambiguous

The spec's "Public interface" is authoritative for `ORKY_PHASES`, `openBlockingCount`, `isStalled`,
`orkyFeatureStatus`, `orkyPaneStatus`, `selectChipFeature`. Where it was silent, these tests freeze the
simplest viable contract — the implementer MUST match it:

1. **`gateN(gates)`** — exported helper; `gateN(undefined)` → 0. `gateM` is asserted via `ORKY_PHASES.length` (=8).
2. **`OrkyFeatureStatus.reason: 'escalation' | 'stalled' | 'human-review' | null`** — a structured needs-you
   discriminator ADDED to the wire type. REQ-007's "reason order escalation > stalled > human-review" is
   only deterministically rankable from a structured field (the spec's listed fields carry no escalation/
   stalled marker). `reason` is `null` when `needsHuman` is false; `orkyFeatureStatus` sets it from the
   REQ-005 triggers (priority escalation > stalled > human-review when several apply).
3. **Gate-failure representation (REQ-006):** a halted failure is the current `phase` having an explicit
   `gates[phase].passed === false`. An *executing* phase has **no** gate entry for the current phase yet.
   This is the on-normalized-raw contract the pure mapper tests construct; the tracker's normalizer maps
   real on-disk shapes onto it.
4. **`normalizeFindings` / `normalizeFeatureRaw`** (TASK-002) — `normalizeFindings(undefined|'garbage')` → `[]`;
   `normalizeFeatureRaw(undefined).gates` → `{}`, `.escalations` → `[]`.
5. **`orkyChipStatus(orky)`** — a **sibling export** in `chip-status.ts` (so existing `chipStatus` is
   untouched): `orkyChipStatus({kind,needsHuman,failed}) → {kind, needsInput, failed}` with `needsInput === needsHuman`.
6. **`workspaceBadgeState(ws, statuses, aiSessions, orky?)`** — an optional 4th arg `Record<paneId, OrkyPaneStatus>`;
   an Orky pane with any `needsHuman` feature folds into `needs` under the same `resolveAlerts(...).tabBadge` opt-in.
7. **`OrkyTracker`** constructor: `new OrkyTracker(emit, { now?: () => number; thresholdMs?; debounceMs? })`,
   with `watch(paneId, cwd): Promise<void>`, `unwatch(paneId)`, `dispose()`. Emit is `(paneId, OrkyPaneStatus | null)`.
8. **`findOrkyRoot(cwd, { maxDepth? }): string | null`** — returns the first dir (cwd or ancestor) containing `.orky/`.
9. **IPC channels:** `CH.orkyStatus='orky:status'`, `CH.orkyWatch='orky:watch'`, `CH.orkyUnwatch='orky:unwatch'`.

## Test catalogue

| TEST | REQ(s) | File | Assertion |
|---|---|---|---|
| TEST-001 | REQ-001 | shared/orky-status | `ORKY_PHASES` is the canonical 8-phase order; `human-review` is last; length 8 (= gateM). |
| TEST-002 | REQ-001 | shared/orky-status | `gateN` counts only passed canonical phases; unknown keys ignored; `{}`/`undefined`→0; all-passed→8. |
| TEST-003 | REQ-002 | shared/orky-status | `openBlockingCount` of the spec example === 2 (open ∧ CRITICAL/HIGH ∨ contract_violation). |
| TEST-004 | REQ-002, REQ-019 | shared/orky-status | Totality: `[]`/`undefined`/`null`/`'x'`/`[{}]`→0; MEDIUM+contract_violation counts; resolved/deferred excluded; no capping (5→5). |
| TEST-005 | REQ-003 | shared/orky-status | `isStalled` boundary: 121s→true, 119s→false, exactly 120s→false (strict `>`); injected `now`. |
| TEST-006 | REQ-003 | shared/orky-status | Finished-wins (human-review passed→false at any tick age); non-active→false; `lastTickAt=null`→false. |
| TEST-007 | REQ-004 | shared/orky-status | Mid-execution + recent tick → `kind:'busy'`, `needsHuman:false`, `gateN/gateM` correct. |
| TEST-008 | REQ-004, REQ-005 | shared/orky-status | `human-review` phase → `needs-input`/`needsHuman`/`reason:'human-review'`; detail names slug + "human-review". |
| TEST-009 | REQ-004 | shared/orky-status | `human-review` gate passed → `kind:'done'`, `needsHuman:false`. |
| TEST-010 | REQ-005 | shared/orky-status | `needsHuman` triggers: open escalation (reason escalation), stalled (reason stalled), quiet idle→false, resolved escalation→false. |
| TEST-011 | REQ-006 | shared/orky-status | Gate failure → `failed:true`, `needsHuman:false` (independent flags); clean feature → `failed:false`. |
| TEST-012 | REQ-004 | shared/orky-status | `detail` is actionable (CONV-001): names feature + escalation id; never bare "needs input". |
| TEST-013 | REQ-007 | shared/orky-status | `selectChipFeature`: escalation outranks human-review; winner identical across all 6 input permutations. |
| TEST-014 | REQ-007 | shared/orky-status | Tiebreaks: needsHuman-first; then newer activity; then feature-id ascending (final, stable). |
| TEST-015 | REQ-007 | shared/orky-status | `selectChipFeature([])` === null. |
| TEST-016 | REQ-008 | shared/orky-status | Chip label `feature · phase · gate N/M · ●k open`; `●k` omitted only at k=0; never a wrong number. |
| TEST-017 | REQ-021 | shared/orky-status | `orkyPaneStatus` pure + order-independent; defined empty shape; total on `undefined`. |
| TEST-018 | REQ-020 | shared/orky-status | Roll-up `features[]` = only non-Idle, ranked by the selector order; `chipFeature` = top. |
| TEST-019 | REQ-019 | shared/orky-status | Mappers + `normalizeFindings`/`normalizeFeatureRaw` total over empty/malformed input. |
| TEST-020 | REQ-018 | shared/orky-status | `SCHEMA_VERSION` is NOT bumped by this feature (stays 7). |
| TEST-021 | REQ-010 | shared/orky-chip-status | `orkyChipStatus` surfaces the Orky kind, maps needsHuman→needsInput; existing `chipStatus` unchanged. |
| TEST-022 | REQ-009 | renderer/orky-tab-badge | Orky `needsHuman` pane folds into `needs` (opt-in on); idle/busy/done → no contribution. |
| TEST-023 | REQ-009, REQ-016 | renderer/orky-tab-badge | The Orky needs contribution respects the `tabBadge` opt-in (off → needs 0). |
| TEST-024 | REQ-013 | shared/orky-ipc-contract | `CH.orkyStatus`/`orkyWatch`/`orkyUnwatch` declared with `domain:verb` names. |
| TEST-025 | REQ-012 | main/find-orky-root | `findOrkyRoot` finds `.orky/` in cwd + ancestors; null when absent; respects the bounded depth cap. |
| TEST-026 | REQ-011, REQ-019 | main/orky-tracker | `watch` emits a populated roll-up; a malformed feature is safe-defaulted (others report); `console.warn` called. |
| TEST-027 | REQ-011 | main/orky-tracker | `unwatch` emits cleared `null`; a watch-then-immediate-unwatch leaves no resurrected populated status (race-safe). |
| TEST-028 | REQ-011 | main/orky-tracker | `dispose()` closes all watchers — later file changes emit nothing (no orphaned watcher / kept-alive timer). |
| TEST-029 | REQ-017 | main/orky-tracker | A watch session leaves the `.orky/` tree byte-identical (content + mtime) — strictly read-only. |
| TEST-030 | REQ-015 | main/orky-tracker | Tracker source contains no `child_process`/`execFile`/`spawn` (file reads only, no per-poll node spawn). |
| TEST-031 | REQ-012 | main/orky-tracker | Watching a cwd with no `.orky/` ancestor emits a cleared `null` (never a populated status). |
| TEST-032 | REQ-022 | docs-feature-0004 | `docs/features/orky-status.md` (+ `orky:status` + provenance note), CLAUDE.md ref, CHANGELOG `[Unreleased]` entry. |
| TEST-033 | REQ-012 | e2e/orky-status | Pane cwd at a fixtured `.orky/` project → the toolbar Orky chip appears. |
| TEST-034 | REQ-008 | e2e/orky-status | The chip renders the `feature · phase · gate N/M` label (demo-feature · human-review · 7/8). |
| TEST-035 | REQ-014, REQ-016 | e2e/orky-status | Orky needsHuman drives a `needs-input` border (byte-status idle → border proves precedence); chip coexists. |
| TEST-036 | REQ-009 | e2e/orky-status | The workspace tab lights its 🔔 needs-you badge. |
| TEST-037 | REQ-012 | e2e/orky-status | cwd leaving the `.orky/` project clears the chip and reverts the border to byte-status. |
| TEST-038 | REQ-020 | e2e/orky-status | The chip opens a body-portalled popover (`orky-menu`) listing the non-Idle feature(s). |

## Coverage (every REQ → ≥1 TEST)

| REQ | TESTs | REQ | TESTs |
|---|---|---|---|
| REQ-001 | 001, 002 | REQ-012 | 025, 031, 033, 037 |
| REQ-002 | 003, 004 | REQ-013 | 024 |
| REQ-003 | 005, 006 | REQ-014 | 035 |
| REQ-004 | 007, 008, 009, 012 | REQ-015 | 030 |
| REQ-005 | 008, 010 | REQ-016 | 023, 035 |
| REQ-006 | 011 | REQ-017 | 029 |
| REQ-007 | 013, 014, 015 | REQ-018 | 020 |
| REQ-008 | 016, 034 | REQ-019 | 004, 019, 026 |
| REQ-009 | 022, 023, 036 | REQ-020 | 018, 038 |
| REQ-010 | 021 | REQ-021 | 017 |
| REQ-011 | 026, 027, 028 | REQ-022 | 032 |

22 / 22 REQs covered. 38 TEST-IDs (TEST-001…TEST-038); 32 run under vitest (`npm test`), 6 e2e
(TEST-033…TEST-038) run under Playwright after `npm run build`.

## Test files

- `tests/shared/orky-status.test.ts` (TEST-001…020)
- `tests/shared/orky-chip-status.test.ts` (TEST-021)
- `tests/shared/orky-ipc-contract.test.ts` (TEST-024)
- `tests/renderer/orky-tab-badge.test.ts` (TEST-022, 023)
- `tests/main/find-orky-root.test.ts` (TEST-025)
- `tests/main/orky-tracker.test.ts` (TEST-026…031)
- `tests/docs-feature-0004.test.ts` (TEST-032)
- `tests/e2e/orky-status.spec.ts` (TEST-033…038)
