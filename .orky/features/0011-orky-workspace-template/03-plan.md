# 0011 — Per-project Orky workspace template — Plan (Phase 3)

**Status:** plan drafted from the FROZEN `02-spec.md` (REQ-001…REQ-007, 7 REQs). TASK-IDs below are
stable — never renumber. TASK numbering restarts at TASK-001 per feature (0005/0006/0007/0009
precedent). This is the FINAL roadmap feature (F11): pure composition of shipped machinery
(`workspaceFromTemplate`, the `orky`/`terminal` pane kinds, the shared `OrkyRootPicker`, the
template menu, the decision queue) plus ONE sanctioned shared-seam repair (`reportAssignment`
threaded into `SliceDeps`, FINDING-001/decision 9). No new pane kind, no `SCHEMA_VERSION` change
(stays 8), no new IPC surface, no new write path.

## The core shape

Three layers, built bottom-up, matching the coordinator's requested sequencing:

1. **The pure generator** (TASK-001) — `orkyCockpitTemplate`/`orkyCockpitName` in a new,
   renderer-safe shared module. No dependents needed until it lands; everything downstream builds
   a `WorkspaceTemplate` value through it, never by hand.
2. **The shared `reportAssignment` repair** (TASK-002) — lands independently of TASK-001, in
   parallel, because it repairs the EXISTING `newWorkspaceFromTemplate` seam (menu-instantiated
   templates, pre-F11 included) and is the load-bearing durability fix REQ-006 depends on. Landing
   it early and independently keeps it visibly separate from F11's own new code, per the spec's
   "one surgical repair" framing.
3. **`newOrkyWorkspace` + affordance wiring** (TASK-003…008) — the store action (no-arg picker path,
   then the pre-selected-root validation path), the F11-owned picker mount/relabel, and the three
   single-gesture entry points (palette, templates-menu row, decision-queue button).

Verification passes (TASK-009, TASK-010) close out REQ-005 and REQ-007 without adding new shipped
behavior — the 0009 TASK-018 precedent (a reviewed pass, not new code).

## Baseline / architecture fit

- Rides the shipped template mechanism (`workspaceFromTemplate`/`templateFromWorkspace`/
  `saveTemplate`/`newWorkspaceFromTemplate`) and F9's `orky` pane kind + `OrkyRootPicker` — both
  consumed, neither forked nor edited beyond the one sanctioned `SliceDeps` addition.
- `newWorkspace` (`store.ts:274-280`) is the registration precedent `newOrkyWorkspace` matches in
  full (order append, `activeId`, `scheduleAutosave`, `reportAssignment`).
- `TemplatesMenu`/`CommandPalette`/`DecisionQueuePanel` are extended additively at their existing,
  open-form registration points (frozen-guard inventory confirms no closed-form enumeration
  collides — see spec §"Frozen-guard inventory").
- The five F9 files (`orky-pane.ts`, `OrkyPane.tsx`, `OrkyRootPicker.tsx`, `orky-pane-slice.ts`,
  `orky-root-detail.ts`) stay byte-unchanged for the whole plan (REQ-007).

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| Pure cockpit generator | `src/shared/orky-cockpit.ts` | new |
| `SliceDeps.reportAssignment` repair | `src/renderer/store/types.ts` (interface), `src/renderer/store.ts` (deps object, ~`:91`), `src/renderer/store/quick-slice.ts` (destructure + call, ~`:15`, `:36`) | edit |
| `newOrkyWorkspace` store action (both paths) + F11 picker request state | `src/renderer/store.ts` (beside `newWorkspace`, `:274-280`) | edit |
| F11 picker mount (one-shot request flag, relabelled) | `src/renderer/App.tsx` | edit |
| Palette entry | `src/shared/quick.ts` (`PaletteAction`, `buildCommandItems()`), `src/renderer/components/CommandPalette.tsx` (activate switch) | edit |
| Templates-menu built-in row | `src/renderer/components/TemplatesMenu.tsx` | edit |
| Decision-queue "Open project cockpit" button | `src/renderer/components/DecisionQueuePanel.tsx` | edit |
| Scope-guard + fetch-discipline verification | none (review-only) | — |

No new IPC channel, no new `PaneKind`/`PaneConfig` member, no `child_process`/registry-mutation
reference anywhere in this plan's file set (REQ-007).

---

## Tasks

### TASK-001 — Pure cockpit generator (`orkyCockpitTemplate`/`orkyCockpitName`)
**Satisfies:** REQ-001 · **Files:** `src/shared/orky-cockpit.ts` (new)
**Depends on:** — · **Order:** 1 · **Constraints:** pure, renderer-safe (no DOM/Electron/node
  builtins/ambient platform read); no clock/randomness/`localeCompare`/id generation
- `ORKY_COCKPIT_TEMPLATE_ID` fixed sentinel id for the ephemeral blueprint.
- `orkyCockpitTemplate({ root, shellId }): WorkspaceTemplate` — exactly two panes: `{ kind: 'orky',
  root }` (verbatim) and `{ kind: 'terminal', shellId, cwd: root }` (verbatim, `Object.keys` exactly
  `['kind','shellId','cwd']`); layout `{ direction: 'row', first: <orky leaf>, second: <terminal
  leaf> }`, no `splitPercentage`; `name = orkyCockpitName(root)`.
- `orkyCockpitName(root: string): string` — `'Orky: <last non-empty path segment>'`, splitting on
  both separators; total over any string input, falling back to the verbatim root when segmentless.
- No id generation here — fresh pane ids are the `workspaceFromTemplate` seam's job (TASK-003).

### TASK-002 — `SliceDeps.reportAssignment` repair (the shared seam fix)
**Satisfies:** REQ-006, REQ-007 · **Files:** `src/renderer/store/types.ts`, `src/renderer/store.ts`,
  `src/renderer/store/quick-slice.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** additive only; `reportAssignment` stays OFF
  public `State`; `quick-slice.ts` diff touches ONLY `newWorkspaceFromTemplate` (destructure + one
  call); no new IPC/write path — rides the EXISTING `winReport` channel
- Add `reportAssignment: () => void` to the `SliceDeps` interface (`types.ts`, ~`:215-222`).
- Include the existing store-root `reportAssignment` closure (already defined ~`store.ts:85-89`) in
  the deps object literal (~`store.ts:91`) — no new closure, no signature change to the existing
  function.
- In `createQuickSlice` (`quick-slice.ts`, ~`:15`), destructure `reportAssignment` from deps and call
  it at the end of `newWorkspaceFromTemplate`'s success path, after `scheduleAutosave()` and before
  `return ws.id` (~`:36-37`). The `!tpl` fallback (~`:33`) needs no change — it already routes to
  `newWorkspace`, which reports.
- Verify post-edit: TEST-619 (`tests/renderer/orky-entry-actions-loopback.test.ts:149-163`) still
  requires `commitPane` present in the `SliceDeps` region and absent from the `State` region — the
  additive member breaks neither clause.

### TASK-003 — `newOrkyWorkspace` store action: no-arg picker path, instantiation, registration
**Satisfies:** REQ-002 · **Files:** `src/renderer/store.ts` (beside `newWorkspace`, `:274-280`)
**Depends on:** TASK-001, TASK-002 · **Order:** 2 · **Constraints:** instantiates ONLY through
  `workspaceFromTemplate`; never hand-assembles (`createWorkspace`/`addFirstPane`/`splitPane`); no
  local clone/normalize of pane configs; `reportAssignment` called only on the success path, never
  on refusal/cancel
- `newOrkyWorkspace(root?: string): Promise<string | null>`. With no argument: opens the F11-labelled
  picker request (TASK-005); cancel resolves `null`, creates nothing.
- On a resolved root (from either path — this task lands the plumbing both TASK-003 and TASK-004
  share): build `orkyCockpitTemplate({ root, shellId })` (shell from the shipped `defaultShellId`
  chain, `pane-ops.ts:17-19`) and instantiate via `workspaceFromTemplate` — the seam that remaps
  fresh pane ids and applies `normalizeOrkyBindings`.
- Registration matches `newWorkspace` IN FULL: append to `order`, set `activeId`, call
  `scheduleAutosave()`, then call `reportAssignment()` (TASK-002's now-in-scope closure — direct
  call, no `SliceDeps` needed since this action lives at store root).
- Two cockpit opens must produce disjoint pane id sets (a natural consequence of riding the seam,
  verified not re-implemented).

### TASK-004 — `newOrkyWorkspace` pre-selected-root path: membership validation, four-state honesty
**Satisfies:** REQ-004 · **Files:** `src/renderer/store.ts` (same action body as TASK-003)
**Depends on:** TASK-003 · **Order:** 3 · **Constraints:** fold mode derived once via
  `caseFoldFromPlatform(navigator.platform)` at the composition layer, no `process` read; equality
  via `sameProjectRoot` (EQUALITY, not prefix/containment)
- With `root` given: skip the picker entirely. Validate against the HELD `registrySnapshot` member
  roots via `sameProjectRoot(root, member, { caseFold })`.
- On a match: build the cockpit from the AGGREGATE MEMBER's spelling (not the caller's variant) —
  case/slash-variant callers converge deterministically.
- Total over the four registry states the shared picker already renders:
  1. **Members held, no match** — create nothing, resolve `null`, actionable toast naming the root.
  2. **Loading** (`registrySnapshot === null && registryError === null`) — refuse with loading-honest
     copy.
  3. **Failed** (`registrySnapshot === null && registryError !== null`) — refuse, resolve `null`,
     toast surfaces the held `registryError` verbatim — never the not-tracked copy.
  4. **Held empty snapshot** — falls into branch 1's copy.
  All three refusal copies (not-tracked / loading / failed) are pairwise distinct strings.
- No workspace/pane/template mutation on any refusal path.

### TASK-005 — F11 picker mount: one-shot request flag, cockpit-specific relabel
**Satisfies:** REQ-003 · **Files:** `src/renderer/store.ts` (request-flag state, beside the
  `pickOrkyRoot`/`resolveOrkyRootPick` precedent, NOT reusing it), `src/renderer/App.tsx` (mounts
  the picker instance)
**Depends on:** TASK-003 · **Order:** 3 · **Constraints:** `OrkyRootPicker.tsx` byte-unchanged — F11
  passes only its EXISTING additive `ariaLabel?`/`heading?`/`z?` props; no fork, no widening of the
  shared `pickOrkyRoot` request (which stays default-labelled for its three existing callers)
- New F11-owned one-shot request state (the `OrkyCaptureModal` pattern, `App.tsx:209`): opening the
  no-arg `newOrkyWorkspace()` path sets it; `App.tsx` mounts a dedicated `OrkyRootPicker` instance
  driven by that flag, passing a coherent cockpit-specific `ariaLabel`/`heading` pair (both matching
  `/cockpit|workspace/i`, neither matching `/bind/i`).
- Selecting a member root resolves the pending `newOrkyWorkspace()` promise with that root (feeding
  TASK-003's instantiation path with NO further prompt); cancel resolves `null`.

### TASK-006 — Command-palette entry
**Satisfies:** REQ-003 · **Files:** `src/shared/quick.ts` (`PaletteAction`, `buildCommandItems()`),
  `src/renderer/components/CommandPalette.tsx` (activate switch)
**Depends on:** TASK-003, TASK-005 · **Order:** 4
- `PaletteAction` gains `'new-orky-workspace'`; `buildCommandItems()` appends an entry ("New Orky
  project workspace…", search terms covering orky/project/workspace/cockpit).
- `CommandPalette.tsx`'s activate switch handles it BELOW the `activeId` guard (the `new-workspace`
  precedent, `:76-81`): dispatches `newOrkyWorkspace()`; with no active workspace, no-ops silently
  exactly like `new-workspace` does.

### TASK-007 — Templates-menu built-in row
**Satisfies:** REQ-003 · **Files:** `src/renderer/components/TemplatesMenu.tsx`
**Depends on:** TASK-003, TASK-005 · **Order:** 4 · **Constraints:** never deletable; rendered in
  every templates state; the "No templates yet." saved-templates copy is unchanged and may
  co-render; CONV-041/CONV-030 (activation never co-fires a container gesture; menu closes on pick
  exactly as shipped rows do)
- Built-in first row, testid `tpl-orky-cockpit`, label "Orky project cockpit…", calling
  `newOrkyWorkspace()` (TASK-003/005's no-arg path) — never touches `quick.templates`.

### TASK-008 — Decision-queue "Open project cockpit" button
**Satisfies:** REQ-004 · **Files:** `src/renderer/components/DecisionQueuePanel.tsx`
**Depends on:** TASK-004 · **Order:** 4 · **Constraints:** target-guarded/propagation-stopped
  (CONV-030/CONV-041) so no container gesture co-fires; visible focus styling (CONV-007)
- Per-root group header (`decision-queue-group-<root>`, `:132-133`) gains
  `decision-queue-open-cockpit` — `data-project-root`, an accessible name, calling
  `newOrkyWorkspace(g.projectRoot)` (TASK-004's pre-selected-root path). No picker opens on this
  gesture; Enter on the focused button activates only it.

### TASK-009 — Composition scope-guard verification pass
**Satisfies:** REQ-007 · **Files:** verification only — reviews the diff from TASK-001…TASK-008
**Depends on:** TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008 ·
  **Order:** 5
- Confirm: no `PaneKind`/`PaneConfig` member added; `SCHEMA_VERSION` byte-unchanged at 8; no `CH.*`
  channel/preload method/`ipcMain` registration added; no F11 file references `orkyAction`,
  `registryAddRoot`, `registryRemoveRoot`, `registryRoots(`, `RegistryMutationResult`,
  `child_process`, `execFile`, `orkyWatch`, or `orkyUnwatch` (the TEST-433 ban list, swept over the
  F11 file set including `quick-slice.ts` and `store/types.ts`).
- Confirm the `State` interface region of `store/types.ts` contains no `reportAssignment` (it lives
  only in `SliceDeps`); confirm the five F9 files are byte-unchanged (`git diff --name-only`
  excludes them); confirm every new frozen guard phase 4 proposes keys on an F11-specific symbol
  (`orkyCockpitTemplate`, `newOrkyWorkspace`, `new-orky-workspace`, `tpl-orky-cockpit`,
  `decision-queue-open-cockpit`) per CONV-037, and asserts no unnamed future consumer (CONV-019).
- Produces no new shipped file — a pass/fail confirmation feeding the implementation gate (the 0009
  TASK-018 precedent).

### TASK-010 — Fetch-discipline / no-new-trigger verification pass
**Satisfies:** REQ-005 · **Files:** verification only — reviews TASK-001 and TASK-003's diff
**Depends on:** TASK-001, TASK-003 · **Order:** 5
- Anchored scans (CONV-032) of `src/shared/orky-cockpit.ts` and the `newOrkyWorkspace` action body
  confirm NO `fetchOrkyDetail`/`registryDetail`/`notifyOrkyRootChanged` reference — the cockpit path
  adds no new fetch trigger; the shipped OrkyPane one-detail-fetch-per-bind discipline (frozen
  TEST-420) is relied on unchanged, not re-implemented.
- Confirm the generator output and the cockpit call path contain no `launch`, `resumeAi`,
  `encodeBroadcast`, or PTY-write call; confirm the terminal config carries no key beyond
  `kind`/`shellId`/`cwd` (re-confirms TASK-001's own acceptance from the call-path side).
- Confirm opening the cockpit moves activation to the new workspace via the shipped registration
  path only (CONV-046) — no additional focus-on-mount surface introduced by TASK-003/005's wiring.

---

## Sequencing summary

```
TASK-001 (orky-cockpit.ts generator)         [independent]
TASK-002 (SliceDeps.reportAssignment repair) [independent]
      └─ TASK-003 (newOrkyWorkspace: no-arg path, instantiation, registration)  [needs 001, 002]
            ├─ TASK-004 (pre-selected-root path: validation, 4-state honesty)   [needs 003]
            │      └─ TASK-008 (decision-queue button)                          [needs 004]
            └─ TASK-005 (F11 picker mount + relabel)                            [needs 003]
                   ├─ TASK-006 (palette entry)                                  [needs 003, 005]
                   └─ TASK-007 (templates-menu row)                             [needs 003, 005]
TASK-009 (scope-guard verification)   [needs 001..008]
TASK-010 (fetch-discipline verification) [needs 001, 003]
```

## Complexity flags (REQs spanning >3 tasks)

- **REQ-003** (single-gesture picker flow) spans 4 tasks (TASK-003, TASK-005, TASK-006, TASK-007) —
  the action's picker-driven no-arg path, the F11-owned picker mount/relabel, and the two independent
  UI entry points that must each route through the same mount are natively separable: one action, one
  relabelled mount, two consumers.
- **REQ-004** (pre-selected-root path) spans 2 tasks (TASK-004, TASK-008) — the validation/four-state
  logic and its one shipped caller — under the >3 threshold but flagged because TASK-004's four-state
  honesty is the plan's most acceptance-dense single task (four mutually-exclusive refusal branches).
- **REQ-006** (durable, saveable/reusable, no-silent-template-write) spans 2 tasks (TASK-002, TASK-003)
  — the shared seam repair (durability for the menu path) and the cockpit action itself (fresh
  instantiation, no `scheduleQuickSave` call) — both required for the requirement's full acceptance
  surface, verified together at TASK-009.
- **REQ-007** (composition-only scope guard) spans 2 tasks directly (TASK-002, TASK-009) but is a
  cross-cutting constraint on every other task's file set — TASK-009 is the single point where its
  full acceptance (banned strings, byte-unchanged F9 files, no new IPC/schema) is checked across the
  whole diff.

## Risk notes

1. **Picker-mount duplication risk (TASK-005)** — F11 deliberately does NOT widen the shared
   `pickOrkyRoot` request (`store.ts:495-506`, shared by three existing creation affordances) and
   instead mounts its own instance. This is spec-mandated (resolved decision 7), not an
   implementation shortcut — flagged so no reviewer "simplifies" it back into the shared request and
   accidentally relabels F9's default picker for all three of its existing callers.
2. **`newOrkyWorkspace`'s two paths share one function body** (TASK-003/TASK-004) — implementers must
   not split them into two differently-named actions; the spec's public interface pins ONE action,
   one optional argument (CONV-006).
3. **TASK-002 lands independently of TASK-001** — it repairs an EXISTING shipped seam
   (`newWorkspaceFromTemplate`) unrelated to the new generator; landing/reviewing it separately keeps
   the "one surgical repair" framing legible in the diff and lets REQ-006's durability round-trip be
   exercised against pre-F11 templates too, not just cockpits.
4. **No test-designer-delegated task in this plan** — unlike 0009's TASK-019, F11 introduces no
   frozen-guard supersession (the frozen-guard inventory in `02-spec.md` confirms zero collisions);
   phase 4 needs no boundary-marker task to anchor a REQ.

## Open issues (under-specified REQs)

None. Every REQ-001…REQ-007 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). The spec
is frozen at 7 REQs.
