# 0004 — Orky status awareness — Test design (Phase 4, iteration 2 / LOOP-BACK)

**Status:** tests RE-DESIGNED at the review loop-back and verified RED. The spec [`02-spec.md`](02-spec.md)
is now FROZEN at **29 REQs** (gate-based full-roll-up detection model, ESC-001); the plan
[`03-plan.md`](03-plan.md) defines 25 TASKs. The previously-frozen phase-4 suite asserted the OLD
`state.json.phase` model and was CORRECTED here; new tests were added for REQ-023..REQ-029. These tests
are written against the corrected (target) behavior and are **FROZEN once the tests gate passes
(ADR-009)** — the implementer makes them pass without editing them.

The test designer is a different actor from the implementer (the integrity boundary). Every mapper is
total (never throws) and pure: `now`, `thresholdMs`, and `activePhase` are ALWAYS injected, so there is
**zero wall-clock and zero timezone dependence** in any time-dependent test (REQ-028 is pinned against
`Date.UTC`, which is absolute).

## What changed vs. iteration 1 (the loop-back corrections)

The current implementation ON DISK is the PRIOR pass (old `state.json.phase` model), so the updated/new
tests run **RED against it** — that is correct and expected (the implementer fixes the code next).

- **TEST-005/006/007** now pass `activePhase` (the new 6-arg `isStalled` / 7-arg `orkyFeatureStatus`
  positional contracts) and add the **live-phase divergence** fixture (`state.json.phase` lags
  `active.json.phase`): stall and busy/phase key on the LIVE phase (REQ-003/REQ-004/REQ-023).
- **TEST-008** was rewritten to the REAL on-disk shape — `state.json.phase==='doc-sync'` with the
  `human-review` gate ABSENT → `needsHuman:true, reason:'human-review'` (gate-based, REQ-005). The old
  `phase==='human-review'` trigger is gone (the real pipeline never sets it). TEST-009 → `done` keys on
  the `human-review` gate having passed.
- **TEST-018** now asserts a CLEAN `done` feature (`done` ∧ `openBlocking===0`) is **EXCLUDED** from the
  popover list, `idle` is excluded, and a **failed-but-idle** feature is **INCLUDED** (REQ-020).
- **TEST-011** keeps the pure-mapper `failed:true` assertion; the **RENDER** assertion REQ-006 now needs
  is added as **TEST-051** (a CSS source-precedence test, since the unit harness has no jsdom/CSS engine)
  plus the **TEST-055** e2e computed-`background-color` assertion.
- New mapper exports: `gateFrontier`, `ORKY_AUTONOMOUS_PHASES`, `parseOrkyTimestamp`.

## RED verification

```
npx vitest run   # → 7 failed files | 108 passed (115); 23 failed tests | 726 passed (749)
```

The **7 failed files are exactly the updated/added feature files**; the unchanged feature files
(`orky-chip-status`, `orky-ipc-contract`, `orky-tab-badge`) stay GREEN, and all pre-existing
non-feature suites pass (no unrelated breakage). The 23 failures are want-of-correction signals, not
typos — representative messages:

- TEST-040: live phase reported as `'implement'` (lagging `state.json.phase`) instead of the gate
  frontier `'review'`. TEST-007/TEST-053: same divergence (active feature reads idle/`'implement'`
  instead of busy/`'review'`).
- TEST-008: the real awaiting-human shape reads `needsHuman:false` (old phase-string trigger).
- TEST-018: the old `kind!=='idle'` filter keeps the clean-`done` feature `d` and drops the failed
  feature `f` — exactly the FINDING-DA-003 contract violation.
- TEST-039/TEST-042/TEST-043: `gateFrontier` / `parseOrkyTimestamp` / `ORKY_AUTONOMOUS_PHASES` not
  exported yet (new). TEST-044: `findOrkyRoot(123)` THROWS instead of returning `null`.
- TEST-054: a non-string `cwd` reaches `tracker.watch`, and a watch from a non-owning window is acted on
  (no validation / no sender scoping). TEST-045/046: no readdir/size cap. TEST-048/049: a `.md` change
  triggers a re-read and two same-root panes spin two watchers. TEST-051: the failure background is not
  `!important` and the idle rule does not exclude `.term-failure`; no CSS targets `[data-failed]`.

**e2e (`tests/e2e/orky-status.spec.ts`, TEST-033..038 + TEST-055) was NOT executed** — Playwright runs
against `out/` and needs `npm run build`; it is frozen alongside the unit suite and runs at the implement
gate after a build.

## Chosen signatures where the spec/plan were ambiguous

The spec's "Public interface" is authoritative. Where it was silent, these tests freeze the simplest
viable contract — the implementer MUST match it:

1. **`isStalled(activeFeatureSlug, feature, activePhase, lastTickAt, now, thresholdMs)`** — `activePhase`
   is the active feature's `active.json.phase` (`null` for a non-active feature). Executing-ness is read
   from `activePhase`, NOT the lagging `state.json.phase`.
2. **`orkyFeatureStatus(raw, findings, isActive, activePhase, lastTickAt, now, thresholdMs)`** — the
   output `phase` is the LIVE phase: `activePhase` for the active feature, `gateFrontier(raw.gates)` for
   a non-active feature. `lastActivityAt` is the max of the feature's own `gates[*].at` (tz-safe),
   falling back to `lastTickAt` for the active feature.
3. **`gateFrontier(gates): OrkyPhase | null`** — phase immediately AFTER the highest-index canonical gate
   with `passed===true`; `{}`/malformed → `'brainstorm'`; all 8 passed → `null`. (The "highest" tiebreak
   for non-contiguous gates is the simplest total interpretation; pinned by TEST-039.)
4. **`ORKY_AUTONOMOUS_PHASES`** — the 7 gates through `doc-sync` (`ORKY_PHASES` minus `human-review`).
5. **`parseOrkyTimestamp(s): number | null`** — a tz-less ISO string is interpreted as **UTC** (not
   local); `Z`/offset honored; non-parseable → `null`. Pinned against `Date.UTC` so it is TZ-independent.
6. **`OrkyFeatureStatus.reason: 'escalation'|'stalled'|'human-review'|null`** — the structured needs-you
   discriminator the REQ-007 selector ranks on; `null` when `needsHuman===false`.
7. **`registerOrky(send, win): Disposer`** — gains the owning `BrowserWindow`; each handler validates
   `typeof id/cwd === 'string'` and acts only when `BrowserWindow.fromWebContents(e.sender) === win`.
8. **Read-path caps (REQ-025):** feature-dir count cap = **200** (`slice(0,200)`), file-size cap = **1
   MiB**, each a STATED limit with a `console.warn` (no silent capping). Pinned by TEST-045/046.
9. **Gate-failure representation (REQ-006):** the current phase has an explicit `gates[phase].passed ===
   false`. An *executing* phase has NO gate entry yet for the current phase; a failed feature maps to
   `kind:'idle'` + `failed:true`.
10. **REQ-006 render / REQ-026 escape:** the unit vitest harness is `environment: 'node'` (no jsdom, no
    `@testing-library/react`, no DOM `CSS.escape`). REQ-026 is therefore pinned as a **source assertion**
    (`OrkyPopover` interpolates `CSS.escape(paneId)`), and REQ-006's render precedence as a **CSS
    source-precedence test** (`src/renderer/index.css`), with the full computed-style assertion deferred
    to the e2e (TEST-055). This is the harness limitation, not a coverage gap.
11. **`OrkyTracker` constructor:** `new OrkyTracker(emit, { now?; thresholdMs?; debounceMs? })`,
    `watch(paneId, cwd): Promise<void>`, `unwatch(paneId)`, `dispose()`.
12. **`findOrkyRoot(cwd, { maxDepth? }): string | null`** — non-string `cwd` → `null` (no throw).

## Test catalogue

| TEST | REQ(s) | File | Assertion |
|---|---|---|---|
| TEST-001 | REQ-001 | shared/orky-status | `ORKY_PHASES` is the canonical 8-phase order; `human-review` is last; length 8 (= gateM). |
| TEST-002 | REQ-001 | shared/orky-status | `gateN` counts only passed canonical phases; unknown keys ignored; `{}`/`undefined`→0; all-passed→8. |
| TEST-043 | REQ-001, REQ-005 | shared/orky-status | `ORKY_AUTONOMOUS_PHASES` = the 7 gates through doc-sync; excludes `human-review`. |
| TEST-039 | REQ-023 | shared/orky-status | `gateFrontier`: through-implement→`review`; `{}`→`brainstorm`; all-8→`null`; non-contiguous→highest wins; total. |
| TEST-042 | REQ-028 | shared/orky-status | `parseOrkyTimestamp`: tz-less→UTC (=== `Date.UTC`), `Z`/offset honored, garbage→`null`. |
| TEST-003 | REQ-002 | shared/orky-status | `openBlockingCount` of the spec example === 2 (open ∧ CRITICAL/HIGH ∨ contract_violation). |
| TEST-004 | REQ-002, REQ-019 | shared/orky-status | Totality: `[]`/`undefined`/`null`/`'x'`/`[{}]`→0; MEDIUM+contract_violation counts; resolved excluded; no capping. |
| TEST-005 | REQ-003, REQ-023 | shared/orky-status | `isStalled` boundary (121→true, 119/120→false) off the LIVE phase; divergence: state lags `implement`, live `review`→stall. |
| TEST-006 | REQ-003 | shared/orky-status | Finished-wins (human-review gate passed→false at any tick age); non-active→false; `lastTickAt=null`→false. |
| TEST-007 | REQ-004, REQ-023 | shared/orky-status | Active mid-execution→busy; divergence: `state.phase='implement'`, `activePhase='review'`→phase `review`, busy. |
| TEST-008 | REQ-004, REQ-005 | shared/orky-status | REAL awaiting-human shape (gates through doc-sync, NO human-review gate)→`needs-input`/`needsHuman`/`reason:'human-review'`. |
| TEST-009 | REQ-004 | shared/orky-status | `human-review` gate passed (state.phase still `doc-sync`)→`kind:'done'`, `needsHuman:false`. |
| TEST-010 | REQ-005 | shared/orky-status | needsHuman triggers: open escalation, stalled, quiet idle→false, resolved escalation→false. |
| TEST-011 | REQ-006 | shared/orky-status | Gate failure→`failed:true`, `needsHuman:false` (independent flags); clean feature→`failed:false`. |
| TEST-040 | REQ-023, REQ-004 | shared/orky-status | NON-active live phase = `gateFrontier` (not lagging `state.json.phase`); non-active is `idle` not busy. |
| TEST-041 | REQ-004 | shared/orky-status | NON-active never busy (FINDING-DA-005); `lastActivityAt` = max `gates[*].at` (tz-safe, FINDING-DA-004). |
| TEST-012 | REQ-004 | shared/orky-status | `detail` is actionable (CONV-001): names feature + escalation id; never bare "needs input". |
| TEST-013 | REQ-007 | shared/orky-status | `selectChipFeature`: escalation outranks human-review; winner identical across all 6 input permutations. |
| TEST-014 | REQ-007 | shared/orky-status | Tiebreaks: needsHuman-first; then newer activity; then feature-id ascending (final, stable). |
| TEST-015 | REQ-007 | shared/orky-status | `selectChipFeature([])` === null. |
| TEST-016 | REQ-008 | shared/orky-status | Chip label `feature · phase · gate N/M · ●k open`; `●k` omitted only at k=0; never a wrong number. |
| TEST-017 | REQ-021 | shared/orky-status | `orkyPaneStatus` pure + order-independent; defined empty shape; total on `undefined`. |
| TEST-018 | REQ-020 | shared/orky-status | Popover lists busy/needs-input/failed/done-WITH-open; clean-`done` AND idle EXCLUDED; ranked; `chipFeature`=top. |
| TEST-019 | REQ-019 | shared/orky-status | Mappers + `normalizeFindings`/`normalizeFeatureRaw` total over empty/malformed input. |
| TEST-020 | REQ-018 | shared/orky-status | `SCHEMA_VERSION` is NOT bumped by this feature (stays 7). |
| TEST-021 | REQ-010 | shared/orky-chip-status | `orkyChipStatus` surfaces the Orky kind, maps needsHuman→needsInput; existing `chipStatus` unchanged. |
| TEST-022 | REQ-009 | renderer/orky-tab-badge | Orky `needsHuman` pane folds into `needs` (opt-in on); idle/busy/done → no contribution. |
| TEST-023 | REQ-009, REQ-016 | renderer/orky-tab-badge | The Orky needs contribution respects the `tabBadge` opt-in (off → needs 0). |
| TEST-024 | REQ-013 | shared/orky-ipc-contract | `CH.orkyStatus`/`orkyWatch`/`orkyUnwatch` declared with `domain:verb` names. |
| TEST-025 | REQ-012 | main/find-orky-root | `findOrkyRoot` finds `.orky/` in cwd + ancestors; null when absent; respects the bounded depth cap. |
| TEST-044 | REQ-024 | main/find-orky-root | A non-string `cwd` (number/undefined/null/object) → `null`, never throws (no unhandled rejection). |
| TEST-026 | REQ-011, REQ-019 | main/orky-tracker | `watch` emits a populated roll-up; a malformed feature is safe-defaulted (others report); `console.warn` called. |
| TEST-027 | REQ-011 | main/orky-tracker | `unwatch` emits cleared `null`; a watch-then-immediate-unwatch leaves no resurrected status (race-safe). |
| TEST-028 | REQ-011 | main/orky-tracker | `dispose()` closes all watchers — later file changes emit nothing (no orphaned watcher / kept-alive timer). |
| TEST-029 | REQ-017 | main/orky-tracker | A watch session leaves the `.orky/` tree byte-identical (content + mtime) — strictly read-only. |
| TEST-030 | REQ-015 | main/orky-tracker | Tracker source contains no `child_process`/`execFile`/`spawn` (file reads only, no per-poll node spawn). |
| TEST-031 | REQ-012 | main/orky-tracker | Watching a cwd with no `.orky/` ancestor emits a cleared `null` (never a populated status). |
| TEST-053 | REQ-023 | main/orky-tracker | The active feature reports `active.json.phase` as its live phase even when `state.json.phase` lags (passthrough). |
| TEST-045 | REQ-025 | main/orky-tracker | Feature-dir count cap (stated 200): 205 features → exactly 200 processed + a warning; no throw. |
| TEST-046 | REQ-025 | main/orky-tracker | File-size cap (>1 MiB, valid JSON): the oversized feature is skipped + warned; other features still report. |
| TEST-047 | REQ-025 | main/orky-tracker | A `features/<slug>` symlink pointing OUTSIDE the root is skipped (env-gated: self-skips where symlinks are not permitted). |
| TEST-048 | REQ-027 | main/orky-tracker | A `.md` change under the tree does NOT trigger a re-read/emit; a `state.json` change does (`.json` event filter). |
| TEST-049 | REQ-027 | main/orky-tracker | Two panes resolving to the same `.orky/` root share ONE chokidar watcher, yet both still receive their emit. |
| TEST-054 | REQ-024 | main/orky-ipc-validation | `registerOrky` rejects non-string args (no tracker call); per-window sender ownership ignores a foreign window. |
| TEST-050 | REQ-026 | renderer/orky-popover-escape | `OrkyPopover` interpolates the pane id via `CSS.escape(paneId)`, never the raw id (no UUID invariant). |
| TEST-051 | REQ-006 | renderer/orky-failure-style | The `.term-failure` toolbar background wins over the idle `!important` rule; CSS targets `[data-failed]` (non-color). |
| TEST-052 | REQ-029 | docs-feature-0004 | The `ORKY_PHASES` provenance caveat (cites `DRIVER_WORK_PHASES`/gate keys; `intake`/`human` excluded) is in the doc + source; not mislabelled "canonical phase order". |
| TEST-032 | REQ-022 | docs-feature-0004 | `docs/features/orky-status.md` (+ `orky:status` + `orky_phases`), CLAUDE.md ref, CHANGELOG `[Unreleased]` entry. |
| TEST-033 | REQ-012 | e2e/orky-status | Pane cwd at a fixtured `.orky/` project → the toolbar Orky chip appears. |
| TEST-034 | REQ-008 | e2e/orky-status | The chip renders the `feature · phase · gate N/M` label (demo-feature · human-review · 7/8). |
| TEST-035 | REQ-014, REQ-016 | e2e/orky-status | Orky needsHuman drives a `needs-input` border (byte-status idle → border proves precedence); chip coexists. |
| TEST-036 | REQ-009 | e2e/orky-status | The workspace tab lights its 🔔 needs-you badge. |
| TEST-037 | REQ-012 | e2e/orky-status | cwd leaving the `.orky/` project clears the chip and reverts the border to byte-status. |
| TEST-038 | REQ-020 | e2e/orky-status | The chip opens a body-portalled popover (`orky-menu`) listing the non-Idle feature(s). |
| TEST-055 | REQ-006 | e2e/orky-status | A failed-AND-idle Orky pane's computed toolbar `background-color` === `var(--status-failure)` (not `var(--panel)`); `data-failed` present. |

## Coverage (every REQ → ≥1 TEST)

| REQ | TESTs | REQ | TESTs |
|---|---|---|---|
| REQ-001 | 001, 002, 043 | REQ-016 | 023, 035 |
| REQ-002 | 003, 004 | REQ-017 | 029 |
| REQ-003 | 005, 006 | REQ-018 | 020 |
| REQ-004 | 007, 008, 009, 012, 040, 041 | REQ-019 | 004, 019, 026 |
| REQ-005 | 008, 010, 043 | REQ-020 | 018, 038 |
| REQ-006 | 011, 051, 055 | REQ-021 | 017 |
| REQ-007 | 013, 014, 015 | REQ-022 | 032 |
| REQ-008 | 016, 034 | REQ-023 | 039, 040, 053 |
| REQ-009 | 022, 023, 036 | REQ-024 | 044, 054 |
| REQ-010 | 021 | REQ-025 | 045, 046, 047 |
| REQ-011 | 026, 027, 028 | REQ-026 | 050 |
| REQ-012 | 025, 031, 033, 037 | REQ-027 | 048, 049 |
| REQ-013 | 024 | REQ-028 | 042 |
| REQ-014 | 035 | REQ-029 | 052 |
| REQ-015 | 030 | | |

**29 / 29 REQs covered.** 53 distinct TEST-IDs (TEST-001…TEST-055; TEST-039..055 added/renumbered this
iteration). 48 run under vitest (`npm test`), 7 e2e (TEST-033…038, TEST-055) run under Playwright after
`npm run build`.

## Test files

- `tests/shared/orky-status.test.ts` (TEST-001…020, 039–043) — UPDATED to the gate-based model
- `tests/shared/orky-chip-status.test.ts` (TEST-021) — unchanged
- `tests/shared/orky-ipc-contract.test.ts` (TEST-024) — unchanged
- `tests/renderer/orky-tab-badge.test.ts` (TEST-022, 023) — unchanged
- `tests/renderer/orky-popover-escape.test.ts` (TEST-050) — NEW (REQ-026)
- `tests/renderer/orky-failure-style.test.ts` (TEST-051) — NEW (REQ-006 render precedence)
- `tests/main/find-orky-root.test.ts` (TEST-025, 044) — UPDATED (REQ-024 non-string-safety)
- `tests/main/orky-tracker.test.ts` (TEST-026…031, 045–049, 053) — UPDATED (REQ-023/025/027)
- `tests/main/orky-ipc-validation.test.ts` (TEST-054) — NEW (REQ-024)
- `tests/docs-feature-0004.test.ts` (TEST-032, 052) — UPDATED (REQ-029)
- `tests/e2e/orky-status.spec.ts` (TEST-033…038, 055) — UPDATED (REQ-006 e2e render)

## Notes / known limitations

- **No jsdom in the unit harness** (`vitest.config.ts` is `environment: 'node'`, and neither `jsdom` nor
  `@testing-library/react` is a dependency). REQ-026 (`CSS.escape`) and REQ-006's render precedence are
  therefore pinned as **source/CSS assertions** at the unit layer, with the live computed-style
  assertion deferred to the e2e (TEST-055). Adding a jsdom dep was deliberately avoided (would touch
  non-test config / dependencies, outside the test-design boundary).
- **TEST-047 (symlink guard) is environment-gated:** directory symlinks require Developer Mode/admin on
  Windows. The test self-skips where `symlinkSync` is not permitted; REQ-025's RED coverage is carried
  by TEST-045/046 regardless.
- **TEST-051 enforces the `[data-failed]` CSS route** for the non-color affordance (FINDING-UX-002),
  matching the plan's offered "styled visible treatment for `data-failed`" option.
