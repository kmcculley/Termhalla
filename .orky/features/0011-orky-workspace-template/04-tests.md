# 0011 — Per-project Orky workspace template — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (REQ-001…REQ-007) and `03-plan.md`
(TASK-001…TASK-010). All test files below are **FROZEN once the tests gate passes (ADR-009)** —
the implementer makes them pass without editing them. Test IDs continue the project-wide TEST-NNN
sequence from the repo maximum **TEST-648** (verified by repo-wide grep, 2026-07-02) at
**TEST-649**, running through **TEST-678** (30 ids: 24 vitest + 6 Playwright e2e).
**LOOPBACK 2026-07-03 (ESC-001, review → tests):** the sequence now extends through **TEST-683**
(+4 vitest, +1 e2e) and two frozen e2e tests were amended in place under the sanctioned CONV-019
discipline — see "Review → tests loopback" at the end of this document.

The test designer is a different actor from the implementer (the integrity boundary). No
production code (`src/`) was written by this phase — only test files under `tests/`, this
document, and the `traceability.json` update. **No frozen guard needed touching** (the spec's
frozen-guard inventory claim held — see "Frozen-guard compatibility" below).

## Harness constraints honored

- `vitest.config.ts` is `environment: 'node'`, `include: tests/**/*.test.ts` — no jsdom; the
  Playwright `*.spec.ts` files are NOT in the `npm test` gate and must be witnessed green against
  the built implementation before the review gate closes (CONV-052).
- **The FINDING-001 loss class is pinned at the level where it is real** (the work order's
  load-bearing pin): `tests/renderer/orky-cockpit-action.test.ts` drives the REAL renderer store
  (`src/renderer/store.ts`) with the preload bridge mocked — instantiate → the stubbed
  `api.winReport` sees the new wsId → drive `applyAssignment` with that reported arrangement →
  the workspace SURVIVES the drop loop. Explicitly NOT a loader-only round-trip. Verified live:
  TEST-661 runs RED against the shipped store today for exactly the defect (winReport: 0 calls
  after `newWorkspaceFromTemplate`).
- The fold mode is exercised through the ONE sanctioned platform signal: each store test imports
  a FRESH store module under a stubbed `navigator.platform` (Win32 → fold, Linux → no fold), so
  `caseFoldFromPlatform(navigator.platform)` at the composition layer is what the tests actually
  run through (the TEST-432 discipline — no `process` read).
- REQ-005 rides the CONV-033-sanctioned split: the count half is frozen TEST-420 byte-unchanged;
  the structural half is anchored scans SCOPED to the F11-new module + the `newOrkyWorkspace`
  body (never a whole-file `registryDetail` grep — `store.ts` legitimately composes
  `registryDetail` into the orky-pane slice at line ~168); the rendered half is e2e TEST-678.
- FINDING-017 (0010): node-pty's native binding is not built in this checkout, so the e2e suite
  pins the LAYOUT/ARGV halves (the terminal tile commits; the SAVED workspace file carries
  exactly `{ kind, shellId, cwd }` with `cwd` byte-verbatim) — never a live-PTY transcript.

## Chosen contracts (prose-only in spec/plan — FROZEN here, the TEST-420 precedent)

- `src/shared/orky-cockpit.ts` exports `ORKY_COCKPIT_TEMPLATE_ID: string`,
  `orkyCockpitTemplate({ root, shellId }): WorkspaceTemplate`, `orkyCockpitName(root): string`
  (the spec's "Public interface", names now pinned).
- The F11-owned one-shot picker request (spec decision 7 / TASK-005), mirroring the shipped
  `pickOrkyRoot`/`resolveOrkyRootPick` naming: **`State.orkyCockpitPickOpen: boolean`** (the
  App-level mount flag) and **`State.resolveOrkyCockpitPick(root: string | null): void`**
  (settles the pending `newOrkyWorkspace()`; null = cancel).
- `SliceDeps.reportAssignment: () => void` (decision 9), kept OFF public `State`.

## COMPOSITION discipline — frozen pins REUSED as REQ halves (byte-unchanged is a REQUIREMENT)

| Frozen pin | Where | Load-bearing for |
|---|---|---|
| TEST-461 | `tests/shared/orky-pane-template-coercion.test.ts:39` | REQ-002's coercion half (FINDING-004 pair: TEST-664's only-instantiation-is-the-seam pin + this seam pin) |
| TEST-420 | `tests/renderer/orky-pane-slice.test.ts:67` | REQ-005's count half (exactly one detail request per bind, at the slice seam) |
| TEST-619 | F8's entry-actions loopback suite, lines 149-163 | REQ-007: `commitPane` in SliceDeps / not in State — the additive `reportAssignment` member must keep BOTH clauses green (verified green in this change's full run) |
| TEST-486/487, TEST-433, TEST-432, TEST-434 | picker/F9 structural suites | REQ-003/REQ-007: the F9 files stay byte-unchanged; the F11 relabel rides the EXISTING additive props |
| TEST-443 | `tests/e2e/orky-pane.spec.ts` | REQ-002/REQ-006's structure half of the restart round-trip (the shipped loader path, exercised not re-pinned) |

## Suite map

| File | TEST ids | REQs | What it pins |
|---|---|---|---|
| `tests/shared/orky-cockpit.test.ts` (new) | TEST-649…652 | REQ-001 | 649: exactly two panes (orky `root` + terminal `{kind,shellId,cwd}` — keys EXACTLY those three), both byte-verbatim across the four spelled vectors (mixed-case Windows / POSIX / UNC / trailing-separator), row layout orky-first terminal-second with NO `splitPercentage`, `name = orkyCockpitName(root)`, `id = ORKY_COCKPIT_TEMPLATE_ID`. 650: two identical calls → deep-equal (determinism); fixed non-empty sentinel id. 651: `orkyCockpitName` totality — the spec's literal vectors (`C:\dev\Proj\` → `Orky: Proj`, `/a/b` → `Orky: b`), separator-only inputs never throw, verbatim-root fallback. 652: source purity grep — no `Date.now`/`Math.random`/`localeCompare`/`process`/`navigator`/uuid/node-builtin/path-module/Electron/DOM |
| `tests/renderer/orky-cockpit-action.test.ts` (new; REAL store + mocked api) | TEST-653…662 | REQ-002, REQ-003, REQ-004, REQ-006 | 653: pre-selected open → cockpit shape + full registration (order/activeId) + **winReport with the new wsId + applyAssignment echo RETAINS it** (the FINDING-001 round-trip, cockpit path). 654: two opens → distinct wsIds, disjoint pane ids, first ws deep-equal before/after. 655: autosave reaches `api.saveWorkspace` with the cockpit ws; `api.saveQuick` ZERO calls (CONV-051-scoped). 656: no-arg → `orkyCockpitPickOpen` (never the F9 `orkyRootPickOpen`); resolve → one-gesture cockpit; cancel → null, NOTHING created, no report, templates deep-equal. 657: fold-on case/slash/trailing variant converges to the MEMBER's spelling byte-equal. 658: fold-off refuses the case variant, exact spelling still opens. 659: equality-not-prefix (`ProjX`, `Proj\sub`) refused; non-member mutates NOTHING, resolves null, toast names root + how-to-track. 660: four states — loading-honest copy, FAILED surfaces `registryError` VERBATIM (never not-tracked), held-empty rides the not-tracked branch, three copies PAIRWISE distinct, zero creation/reports. 661: **`newWorkspaceFromTemplate` reports (RED on the live defect) + echo retention — the shared-seam repair, menu path**. 662: cockpit → `saveTemplate` → menu re-instantiation: two cockpits (root/cwd R), disjoint ids; `quick.templates` deep-equal across opens/cancels |
| `tests/renderer/quick-slice-report-assignment.test.ts` (new; slice harness) | TEST-663 | REQ-006, REQ-007 | the decision-9 wiring at the seam: the SliceDeps-injected `reportAssignment` called EXACTLY once on the success path, AFTER `scheduleAutosave` (invocationCallOrder); the `!tpl` fallback routes to `newWorkspace` with NO second slice report; `saveTemplate`/`deleteTemplate` never report; no quick-save rides the instantiation |
| `tests/renderer/orky-cockpit-structure.test.ts` (new; anchored source scans, CONV-032/CONV-037) | TEST-664…671 | REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007 | 664: the `newOrkyWorkspace` body (brace-balanced extraction) contains `workspaceFromTemplate`/`orkyCockpitTemplate`/`reportAssignment()`/`scheduleAutosave()`/`sameProjectRoot`/`defaultShellId` and NONE of createWorkspace/addFirstPane/splitPane/commitPane/fetchOrkyDetail/registryDetail/notifyOrkyRootChanged/scheduleQuickSave/resumeAi/encodeBroadcast/pty-write/`launch:`/process-read. 665: the generator module owns no fetch trigger/api/store/write surface, no /launch/i at all. 666: `buildCommandItems()` behavioral — the `new-orky-workspace` entry, label + all four search terms, filterable; CommandPalette handler BELOW the `activeId` guard, dispatching `newOrkyWorkspace(`. 667: `tpl-orky-cockpit` native button above/outside `templates.map`, label, `onClose`, no delete affordance, "No templates yet." byte-present. 668: the F11 App mount (`orkyCockpitPickOpen && (`) passes `ariaLabel`+`heading` matching /cockpit\|workspace/i never /bind/i through the SHARED `OrkyRootPicker`; the F9 default mount survives; no F11 symbol enters `OrkyRootPicker.tsx`. 669: `decision-queue-open-cockpit` native button, `data-project-root`, accessible name, `newOrkyWorkspace(`, `stopPropagation`; the panel's `:focus-visible` allow-list rule survives. 670: `SliceDeps.reportAssignment: () => void`; State region has NO `reportAssignment` (TEST-619-compatible) and gains `newOrkyWorkspace`/`orkyCockpitPickOpen`/`resolveOrkyCockpitPick`; deps object threads the closure; quick-slice destructures it; EXACTLY one call, `scheduleAutosave()` < `reportAssignment()` < `return ws.id`; no quick-save in the body. 671: `SCHEMA_VERSION = 8` + the `PaneKind` union line byte-unchanged (CONV-022 note names the sanctioned amendment path); the TEST-433 ban list over the F11 file set + F11 regions; no F11 symbol in `ipc-contract.ts`/`src/preload/**`/the five F9 files |
| `tests/docs-feature-0011.test.ts` (new) | TEST-672 | REQ-003, REQ-006 (doc consequences) | `docs/features/orky-workspace-template.md` covers the cockpit, all three entry points, no-auto-run, the seam ride, AND the FINDING-001 repair by name; `workspace-templates.md` stops being silent about the built-in row (CONV-008); CLAUDE.md reference; CHANGELOG `[Unreleased]` names the gesture and the durability FIX (all anchors verified absent today — genuinely RED) |
| `tests/e2e/orky-cockpit.spec.ts` (new; NOT in the `npm test` gate; **amended at the ESC-001 loopback — see below**) | TEST-673…678 | REQ-001…REQ-006 | 673: palette → RELABELLED picker (aria-label + rendered text /cockpit\|workspace/i, never /bind/i) → one-gesture cockpit; Escape first creates nothing + persists no template; the saved file pins schema 8 / exact terminal keys / byte-verbatim root+cwd / row layout (the FINDING-017-aware argv-layout pin). 674: `tpl-orky-cockpit` co-renders with "No templates yet.", no delete control, KEYBOARD Enter activation → picker → cockpit, no template persisted. 675: `decision-queue-open-cockpit` — NO picker ever, keyboard Enter, cockpit at the group root, exactly one new workspace. 676: gesture-opened cockpit SURVIVES `win.reload()` (the did-finish-load re-push) with both panes. 677: **a MENU-instantiated plain-terminal template survives reload — runnable against the SHIPPED build and RED on the live FINDING-001 defect (no F11 UI involved)** — the proof the repair fixes ALL templates, pre-F11 included. 678: the cockpit orky-pane RENDERS the fixture's detail rows (REQ-005's rendered half); save-as-template → menu re-instantiation reproduces the cockpit; the re-instantiated workspace survives reload |
| `tests/renderer/orky-cockpit-loopback.test.ts` (**loopback, new 2026-07-03**) | TEST-679…682 | REQ-003, REQ-005 | 679: **FINDING-007 pin (RED)** — a picker-mediated cockpit open must land a pane-focus request (registry seam) on a pane of the NEW workspace; 680/681/682: **FINDING-010 pins** — cancel from the LOADING / FAILED / HELD-EMPTY picker states commits nothing (deep-equal invariants, no report), completing REQ-003's four-state cancel clause beyond TEST-656's member-list leg |
| `tests/e2e/orky-cockpit-loopback.spec.ts` (**loopback, new 2026-07-03; NOT in the `npm test` gate**) | TEST-683 | REQ-003, REQ-005 | **FINDING-007 rendered half (RED)** — after BOTH picker-mediated gestures (palette → pick; tpl-orky-cockpit row → pick) `document.activeElement` is a real app element, never `<body>`/`<html>`/null (polled through the focus-retry window) |

## Frozen-guard compatibility (the spec inventory, executed)

- **No frozen guard was amended.** The spec's inventory claim ("no collisions") held with ONE
  discovered wrinkle, resolved WITHOUT touching the frozen file: F10's TEST-645
  (`tests/docs-feature-0010-loopback.test.ts`) mechanically pins the exact file SET matching
  /orky-pane-row-actions|OrkyEntryActions|openOrkyCapture|orky-entry-actions|F10/i over
  `tests/**`. An early draft of `orky-cockpit-structure.test.ts` cited TEST-619 by file path
  (which contains the `orky-entry-actions` token) and tripped it; the citation now names TEST-619
  by id + line range only (a comment in the file explains why), and TEST-645 passes byte-unchanged.
  F11's suite files deliberately contain NO F10 pattern token. (Re-verified at the ESC-001
  loopback: the two new loopback files also contain no pattern token; TEST-645 green in the
  2026-07-03 full run.)
- Frozen TEST-420, TEST-461, TEST-619 (and their whole suites, plus `quick-slice.test.ts`,
  `quick-commands.test.ts`, the decision-queue structural suite, the workspace-template suites)
  verified GREEN and byte-unchanged in the full gate run below.
- Every NEW absence/scope guard keys on an F11-specific symbol (`orkyCockpit`, `newOrkyWorkspace`,
  `new-orky-workspace`, `tpl-orky-cockpit`, `decision-queue-open-cockpit`) per CONV-037, and none
  asserts an unnamed future consumer (CONV-019 — F11 is the final roadmap feature; the two
  shared-global literal pins in TEST-671 carry a CONV-022 header naming the sanctioned amendment
  path).

## Coverage (REQ → tests; **bold** = new, plain = frozen-reused byte-unchanged)

| REQ | Tests |
|---|---|
| REQ-001 | **TEST-649**, **TEST-650**, **TEST-651**, **TEST-652**, **TEST-665**; e2e **TEST-673** |
| REQ-002 | **TEST-653**, **TEST-654**, **TEST-655**, **TEST-656**, **TEST-664**; e2e **TEST-673**, **TEST-676**; TEST-461 (coercion half, byte-unchanged), TEST-443 (restart structure half) |
| REQ-003 | **TEST-656**, **TEST-666**, **TEST-667**, **TEST-668**, **TEST-672**, **TEST-679**, **TEST-680**, **TEST-681**, **TEST-682**; e2e **TEST-673**, **TEST-674**, **TEST-683**; TEST-486/487 (picker defaults untouched) |
| REQ-004 | **TEST-657**, **TEST-658**, **TEST-659**, **TEST-660**, **TEST-669**; e2e **TEST-675**; TEST-432 (fold-derivation discipline) |
| REQ-005 | **TEST-664**, **TEST-665**, **TEST-679**; e2e **TEST-673** (argv/layout half), **TEST-678** (rendered half), **TEST-683** (focus half); TEST-420 (count half, byte-unchanged) |
| REQ-006 | **TEST-654**, **TEST-655**, **TEST-661**, **TEST-662**, **TEST-663**, **TEST-670**, **TEST-672**; e2e **TEST-677**, **TEST-678** |
| REQ-007 | **TEST-663**, **TEST-670**, **TEST-671**; TEST-619 (byte-unchanged, verified green), TEST-433 (ban-list provenance) |

## RED-state verification (tests gate evidence, 2026-07-02)

Full `npm test` (207 files): **5 failed | 202 passed; 23 failed | 1416 passed** — the failures
are EXACTLY the new F11 pins, each failing on its F11 anchor:

- `tests/shared/orky-cockpit.test.ts` — module-not-found (`@shared/orky-cockpit` does not exist);
  TEST-649…652 uncollectable until TASK-001 (the 0009 orky-pane-slice precedent).
- `tests/renderer/orky-cockpit-action.test.ts` — 10 failed: TEST-653…660 and TEST-662 on
  `newOrkyWorkspace is not a function` (the action does not exist); **TEST-661 on the LIVE
  FINDING-001 defect** — the real store's `newWorkspaceFromTemplate` ran end-to-end and
  `api.winReport` saw 0 calls ("expected 0 to be greater than 0"). The real-store harness itself
  is proven sound by that test reaching its assertion.
- `tests/renderer/quick-slice-report-assignment.test.ts` — 1 failed: TEST-663, the injected
  `reportAssignment` spy saw 0 calls (quick-slice ignores the dep today).
- `tests/renderer/orky-cockpit-structure.test.ts` — 8 failed: TEST-664 (no `newOrkyWorkspace` in
  store.ts), TEST-665/671 (orky-cockpit.ts ENOENT), TEST-666 (no `new-orky-workspace` palette
  entry), TEST-667 (no `tpl-orky-cockpit`), TEST-668 (no `orkyCockpitPickOpen` mount), TEST-669
  (no `decision-queue-open-cockpit`), TEST-670 (SliceDeps has no `reportAssignment`).
- `tests/docs-feature-0011.test.ts` — 4 failed: TEST-672's anchors all verified absent (no
  feature doc, no /orky/i in workspace-templates.md, no 'cockpit' in CHANGELOG `[Unreleased]` or
  CLAUDE.md).

Deliberately GREEN new pins: none — every new vitest pin is RED (nothing is green-by-absence).

Every frozen suite passes byte-unchanged in the same run, including the three load-bearing pins:
`orky-pane-slice.test.ts` (TEST-420), `orky-pane-template-coercion.test.ts` (TEST-461), the F8
entry-actions loopback suite (TEST-619), plus `quick-slice.test.ts`, `quick-commands.test.ts`,
`orky-pane-structure.test.ts`, `orky-capture-structure.test.ts`, `workspace-template.test.ts`,
`orky-pane-migration.test.ts`, and `docs-feature-0010-loopback.test.ts` (TEST-645's mechanical
inventory — confirmed unaffected by the F11 suite files).

e2e (`orky-cockpit.spec.ts`, excluded from the vitest gate by design): RED by construction —
TEST-673…676 and 678 fail at the first F11 gesture (no palette entry / menu row / queue button
exists in the shipped build); **TEST-677 is runnable against the shipped build TODAY and RED for
exactly the FINDING-001 reason** (the menu-instantiated workspace tab is dropped by the reload
re-push). Its assertion message names the defect. New-file `npm run typecheck` diagnostics: only
the expected TS2307 for the not-yet-existing `@shared/orky-cockpit` module (the 0009
module-not-found precedent) — no new error class; the e2e file adds no diagnostics beyond the
pre-existing repo-wide e2e DOM-lib class.

---

## Review → tests loopback (ESC-001, 2026-07-03) — FINDING-008 / 007 / 010 / 006 / 009

Executed by the tests actor per the resolved ESC-001 decision (`state.json`) after the 5-lens
review. Scope: two frozen e2e tests amended in place (CONV-019 supersession discipline —
sanctioned, scheduled, never an implementer edit), five new tests (TEST-679…683), this document,
and `traceability.json`. No `src/` file was touched; no frozen vitest test was edited.

### FINDING-008 (HIGH, the blocker) — frozen e2e amendments, then the CONV-052 witness

`tests/e2e/orky-cockpit.spec.ts` carried test-authoring defects (implementation verified faithful
— TEST-673…676 passed live pre-amendment):

1. **TEST-677** — counted tabs via `locator('[data-tab-id]')` while the menu pick's inline rename
   was open: `TemplatesMenu` `onPicked` → `startRename` renders the NEW workspace's tab as a
   `ws-rename-<id>` INPUT with no `data-tab-id` (`WorkspaceTabs.tsx:61-69`), so the count never
   reached 2 regardless of the durability under test. **Fix:** the new `commitMenuPickRename`
   helper — wait for the rename input, commit with Enter (keeps the pre-filled name), wait for it
   to unmount — then count. Intent untouched: the menu-instantiated workspace SURVIVES the
   did-finish-load re-push. **This test needs no live pty.**
2. **TEST-678 (locator)** — `hasText: 'CK'` is case-insensitive SUBSTRING matching and also
   resolves the always-rendered built-in row (its own label "Orky project co**ck**pit…") — a
   Playwright strict-mode two-element violation. **Fix:** exact-text regex `hasText: /^CK$/` on
   the `[data-testid^="tpl-"]` locator (the saved row's exact label), plus the same rename commit
   before its tab count.
3. **TEST-678 (unmasked third defect)** — past the old failure point, the post-reload
   `.first()` on the unscoped orky-pane locator resolved to the FIRST cockpit's pane inside a
   non-active (visibility-hidden) workspace host. **Fix:** scope to
   `[data-testid="workspace-host"][data-active="true"]` (the suite's own `expectCockpit`
   discipline) — the survival claim is that the re-instantiated workspace (the last-reported
   activeId) comes back rendering its cockpit. Intent unchanged; tab-count-3 already passed.

**Witnessed run (CONV-052), 2026-07-03, `npx playwright test tests/e2e/orky-cockpit.spec.ts`
against `out/` (built 2026-07-03 04:20):** **6 passed / 0 failed, 26.1s, no retries** —
TEST-673, 674, 675, 676, 677, 678 all green on the first attempt. No test in the suite needs a
live pty: the terminal-cwd claim is pinned on the SAVED workspace file (argv/layout), per design.

**Proposed CONV (from FINDING-008):** an e2e locator that must resolve exactly ONE element MUST
NOT rely on a string `hasText` filter (case-insensitive substring matching) that can occur inside
a sibling row's label — use an exact-text regex or a unique testid. (Recorded in the TEST-678
amendment comment; adoption is the doc-sync/convention keeper's call.)

### FINDING-007 (MEDIUM, focus) — new pins, verified RED

A picker-mediated cockpit gesture (palette / tpl-orky-cockpit row → `OrkyRootPicker` → pick)
strands keyboard focus on `<body>`: the invoking chrome unmounts in the same batched commit that
mounts the picker, so the CONV-020 `useOpenFocusRestore` captures `<body>` as the opener and the
close-restore lands there. Pinned at both reachable levels (CONV-046 sanctions gesture-mounted
focus — the open IS the explicit gesture; the queue-button path is unaffected and not pinned):

- **TEST-679** (`tests/renderer/orky-cockpit-loopback.test.ts`, real store + spied
  `requestPaneFocus` registry seam): after `resolveOrkyCockpitPick(member)` settles a no-arg
  `newOrkyWorkspace()`, a pane-focus request was made for a pane of the NEW workspace
  (mechanism-tolerant: `refocusActivePane()` and a direct `requestPaneFocus(<pane>)` both route
  through the spied seam; the choice of pane is the implementation's). **Verified RED:**
  "Pane-focus requests actually seen: [none]".
- **TEST-683** (`tests/e2e/orky-cockpit-loopback.spec.ts`): after BOTH picker-mediated gestures,
  `document.activeElement` is a real app element — never `<body>`/`<html>`/null — polled 5s to
  cover the registry's focus-retry window. **Verified RED against `out/`** (`--retries=0`):
  stranded at the palette gesture, exactly the finding. No live pty needed.

The spec's REQ-005 focus clause ("NOTHING else may move keyboard focus, CONV-046") reads as
banning this fix; per FINDING-007 that reading inverts CONV-046 (which bans focus-on-mount only
for DATA-DRIVEN remounts). **CONV-018 propagation pending:** the REQ-005 focus-clause amendment
sanctioned by ESC-001 must reach `02-spec.md` in this loopback's spec-amendment half (owned by
the spec actor, not this phase) so the frozen spec and these frozen tests agree.

### FINDING-010 (LOW) — cancel-from-state coverage, deliberately green

REQ-003's acceptance requires cancel from EACH of the four picker states to commit nothing; the
frozen suite exercised only the member-list state (TEST-656 + e2e TEST-673). **TEST-680/681/682**
(same loopback file) pin cancel from LOADING / FAILED (`registryError` held) / HELD-EMPTY: the
one-shot request opens, `resolveOrkyCockpitPick(null)` resolves null, workspaces/order/activeId/
`quick.templates` deep-equal, zero `winReport` calls. These are GREEN against the current
implementation by construction (every close path routes through the single
`resolveOrkyCockpitPick(null)`) — frozen as regression pins so the acceptance clause is
exercised, not merely inherited. This is the loopback's only deliberate green-by-current-behavior
addition; TEST-679/683 are RED as required.

### FINDING-006 / FINDING-009 (residual — recorded, no pin added)

**REQ-005's live-PTY acceptance PROSE is superseded by the honest saved-file argv/layout pins.**
The frozen spec's e2e clause names a live-terminal vehicle (reported cwd via the status-bar
chain; transcript with no auto-typed command) that 0010 FINDING-017 already determined unrunnable
in this checkout: node-pty's native binding is not built, and its winpty build script is broken
here — a separate HUMAN toolchain fix, deliberately not chased by this loopback (per ESC-001: do
NOT chase the native rebuild). The frozen tests correctly pin what green can honestly mean:

- the SAVED workspace file carries exactly `{ kind, shellId, cwd }` with `cwd` byte-verbatim to
  the tracked root (TEST-673; TEST-649/653 at unit level) — the argv half;
- the structural bans (TEST-664/665): no `launch:` override, no pty-write/spawn call site, no
  auto-run key on the cockpit path — composed with the shipped `config.cwd → pty.spawn` chain
  (`pty-manager.ts:19-28`), source-cited behavior;
- the rendered orky-pane half (TEST-678).

**The live-terminal-cwd sub-assertion is an env-gated residual:** no runnable test in this
environment witnesses the spawned shell actually sitting at the project root with nothing
auto-typed. NO live-pty pin was added (it would freeze a test that cannot run — the CONV-052
class). When the toolchain is repaired, the residual vector is: open a cockpit for a fixture
root, assert the status-bar/cwd chain reports the root and the transcript shows no injected
input after the prompt. The CONV-018 spec propagation (REQ-005 naming the substitute vehicle and
marking the live vector environment-blocked) rides the same pending spec amendment as
FINDING-007's clause.

### Loopback verification runs (2026-07-03)

- `npx vitest run tests/renderer/orky-cockpit-loopback.test.ts` — **1 failed (TEST-679, the
  FINDING-007 RED pin, failing on its exact anchor) | 3 passed (TEST-680/681/682)**.
- `npx playwright test tests/e2e/orky-cockpit.spec.ts` — **6 passed / 0 failed** (the CONV-052
  witness above).
- `npx playwright test tests/e2e/orky-cockpit-loopback.spec.ts --retries=0` — **1 failed
  (TEST-683 RED at the palette gesture: activeElement stranded)** — the finding, witnessed live.
- Full `npm test` — **207 files passed | 1 failed (only the loopback file's TEST-679); 1446
  tests passed | 1 failed.** Every frozen suite green byte-unchanged, including TEST-645's
  mechanical tests/** inventory (the two new loopback files trip no pattern), TEST-420, TEST-461,
  TEST-619.
