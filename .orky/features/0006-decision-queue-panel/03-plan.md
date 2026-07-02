# 0006 — Decision-queue panel — Plan (Phase 3)

**Status:** plan drafted from the FROZEN `02-spec.md` (REQ-001…REQ-019, 19 REQs). TASK-IDs below are
stable — never renumber. TASK numbering restarts at TASK-001 per feature (the repo convention:
0005 and 0007 both restart their own TASK-001, so 0006 does too). This is a renderer/shared-only
feature (D2): no new IPC channel, no main-process/preload edit, no Orky CLI invocation, no write
under any `.orky/` tree (REQ-003, REQ-017).

## The core shape

Two independent surfaces sit on top of the F5 `registry:status` aggregate, already bridged but
consumed by nothing today (Verified contract):

1. **Pure shared logic** (`src/shared/decision-queue.ts`) — `buildDecisionQueue`, `decisionQueueCount`,
   `matchPaneRoot`, `caseFoldFromPlatform` — zero DOM, zero Electron, zero `../api`, and (per REQ-009's
   FINDING-003 trap) zero `process` reads, so it is directly unit-testable in the existing node-env
   vitest harness with no environment change.
2. **Renderer wiring** — a new store slice (raw snapshot + generation-guarded arbitration + memoized
   derived selectors + `paneFocusSeq`), a new `DecisionQueuePanel` component family mirroring
   `NotesPanel`'s drawer pattern, a `StatusBar` toggle + badge, a palette entry, and one new rebindable
   keybinding — all consuming the pure module above, never re-deriving its logic.

## Testability constraint — no jsdom (read before TASK-008/009/010/011)

`vitest.config.ts` is `environment: 'node'` and `include: ['tests/**/*.test.ts']` — `.tsx` files are
not run under any DOM environment today; this feature does not add one. Consequently:

- **Pure-logic tasks (TASK-001/002/003)** are fully unit-testable as-is — no constraint.
- **Component/store tasks (TASK-005/006/007/008/009/010/011)** cannot be exercised via real DOM
  rendering in this harness. Per the repo's own precedent for exactly this gap (0004's
  `pane-status.ts`-adjacent renderer logic), the test-designer's phase-4 suite will drive these through
  (a) plain-object store/selector tests with no DOM dependency, and (b) **source-scan** tests that grep
  the component's own `.tsx` source text for the pinned literal contract (testids, `aria-*` attributes,
  the exact selector/hook calls used) rather than an actual render pass. Implementers MUST therefore
  keep every pinned literal (`data-testid` values, `aria-expanded`/`aria-label`/`role` strings, the
  `buildDecisionQueue`/`decisionQueueCount`/`matchPaneRoot`/`compareOrkyFeatures` import/call sites)
  written as **literal, greppable source text** — no dynamically assembled testid/aria string for any
  attribute the spec pins verbatim (the one deliberately dynamic testid, `decision-queue-group-<root>`,
  is a template the test-designer already expects to grep structurally, not byte-for-byte). This is a
  planning constraint on HOW the components are written, not a new task; no vitest/jsdom infrastructure
  change is in scope for this feature (adding jsdom is not required by any REQ and would be speculative
  scope).

## Architecture fit (brownfield — `.orky/baseline/` present)

Reuses, does not reinvent:

- `src/shared/orky-status.ts`'s private `compareFeatures` — exported verbatim as `compareOrkyFeatures`
  (TASK-001), never copied (REQ-005).
- `src/preload/index.ts`'s already-bridged `onRegistryStatus`/`registryCurrent` (F5, unconsumed today)
  — the feature's ONLY data path (REQ-003); no preload/main edit.
- `NotesPanel`'s drawer pattern (window-chrome sibling in `App.tsx`'s main flex row, session-scoped
  `notesOpen`/`setNotesOpen` with no `scheduleQuickSave`) — mirrored exactly for `queueOpen`/
  `setQueueOpen` (REQ-001).
- The existing `search-toggle`/`notes-toggle` `StatusBar` affordance family — `orky-queue-toggle` is a
  third sibling, same `aria-expanded`-carrying `button` pattern (REQ-002/REQ-014).
- `resolveBindings`/`COMMANDS`/`DEFAULT_BINDINGS`/`findConflict` (`src/shared/keybindings.ts`,
  CHAR-013) — one new `COMMANDS` entry, `resolveBindings` (not a hard-coded chord string) drives any
  displayed tooltip text (REQ-002/CONV-005).
- `revealPaneFromSearch`'s `setActive` + `setFocusedPane` pattern — reused verbatim for click-to-focus
  (REQ-009); the existing `launchDir`-style `commitPane` terminal-pane-spawn path — reused verbatim for
  the pane-less fallback (REQ-010). Neither gains a new main-process capability.
- `resolveProjectKey` (`src/shared/project-key.ts`, CHAR-019) is deliberately NOT reused for pane↔root
  matching (its git-root-first order contradicts the aggregate's own `findOrkyRoot(cwd)` binding) — a
  recorded, scoped divergence (REQ-009); `resolveProjectKey` itself is untouched.
- CONV-011's "prune stale keys when membership leaves" discipline — applied to the new `paneFocusSeq`
  map exactly as `OrkyActionQueue` (0007) applies it to its own per-key chain map.

## No new IPC / no main-process or preload edit (D2/REQ-003)

This plan touches only `src/shared/`, `src/renderer/`. It adds no `CH.*` constant, no
`ipcMain.handle`, no `preload/index.ts` line, no `registry:addRoot`/`removeRoot` call, no
`orkyAction:*` call, and no Orky CLI invocation anywhere.

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| Comparator export (no behavior change) | `src/shared/orky-status.ts` | edit |
| Pure queue build/count + pane-root matcher + fold-mode derivation | `src/shared/decision-queue.ts` | new |
| Keybinding registration | `src/shared/keybindings.ts` | edit |
| Registry store slice (snapshot, error, `queueOpen`, generation-guarded setter, memoized selectors) | `src/renderer/store/registry-slice.ts` | new |
| Store composition + state typing | `src/renderer/store.ts`, `src/renderer/store/types.ts` | edit |
| `paneFocusSeq` (recency map, pruned on pane removal) | `src/renderer/store.ts` (`setFocusedPane`), `src/renderer/store/types.ts`, `src/renderer/store/internals.ts` (pane-removal cleanup site) | edit |
| App-level subscription + recovery pull + drawer mount + shortcut dispatch | `src/renderer/App.tsx` | edit |
| Drawer component family (shell, loading/empty/error, groups/items, fallback affordance) | `src/renderer/components/DecisionQueuePanel.tsx` | new |
| `StatusBar` toggle + badge | `src/renderer/components/StatusBar.tsx` | edit |
| Command-palette entry | `src/renderer/components/CommandPalette.tsx` (or the repo's existing palette component) | edit |
| Docs / changelog / baseline reconcile | `docs/features/decision-queue.md` (new), `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md`, wherever keybindings are documented | new/edit |
| Frozen-suite supersession (TEST-070) | `tests/shared/registry-no-renderer-ui.test.ts` (or its replacement) | **owned by the test-designer at phase 4 — see TASK-013** |

## Determinism / injection contract

- `matchPaneRoot`'s fold mode is an EXPLICIT `opts.caseFold` argument, never a `process` read; the sole
  renderer call site derives it once via `caseFoldFromPlatform(navigator.platform)` (REQ-009).
- The registry-slice setter short-circuits on deep-equality (REQ-008) and tracks a monotonic
  `snapshotGeneration` so the `registryCurrent()` recovery pull can be discarded if superseded by any
  push/pull applied after it was issued (REQ-003's race arbitration — first valid snapshot wins).
- `buildDecisionQueue`/`decisionQueueCount` are memoized on snapshot reference identity inside the
  store slice (single call site) so REQ-007's "one selector, one number" and REQ-008's "at most one
  `buildDecisionQueue` call per distinct snapshot reference" both fall out of one memo, not two.

---

## Tasks

### TASK-001 — Export the existing feature comparator
**Satisfies:** REQ-005 · **Files:** `src/shared/orky-status.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** no behavior change; `compareFeatures`'s existing
  callers (`selectChipFeature`) are untouched
- Change `compareFeatures` from module-private to `export`, re-exported (or aliased) as
  `compareOrkyFeatures` — a single definition, no copy. `selectChipFeature`'s own behavior and every
  0004 CHAR-test outcome must stay byte-identical (this is a visibility change only).

### TASK-002 — Pure decision-queue build + count
**Satisfies:** REQ-004, REQ-005, REQ-006, REQ-007 · **Files:** `src/shared/decision-queue.ts` (new)
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** pure (no DOM/Electron/`../api`/`process`);
  total over `null`/malformed input; no `localeCompare`; per-entry tolerance (CONV-002)
- `buildDecisionQueue(snapshot)`: for each entry with non-null `status`, take the `needsHuman` prefix of
  `status.features` verbatim (no re-sort, no gate/escalation/stall recomputation) as that project's
  items; skip entries/features that are missing/mistyped the consumed fields without throwing
  (CONV-002); group by `root` (label = `basename(root)`, full root on `title`); order groups by their
  top item's rank via `compareOrkyFeatures` (TASK-001), ties by `root` codepoint comparison; `null`/
  non-array/malformed snapshot → `[]`.
- `decisionQueueCount(groups)`: sum of `items.length` across groups — the SOLE count source (REQ-007);
  no independent counting logic anywhere else in the feature.
- No `Date.now()`, no randomness, no `Map`-iteration-order dependence beyond the snapshot's own already-
  sorted order (REQ-006).

### TASK-003 — Pane↔root matcher + fold-mode derivation
**Satisfies:** REQ-009 · **Files:** `src/shared/decision-queue.ts`
**Depends on:** TASK-002 · **Order:** 3 · **Constraints:** pure; fold mode injected, never read from
  `process`; boundary-safe; longest-root-wins
- `matchPaneRoot(panePath, roots, opts)`: try candidates in order (live cwd → persisted `config.cwd` →
  `gitStatus.root` — candidate SELECTION itself is the caller's job per REQ-009's order; this function
  matches ONE candidate string against the root set); resolve-style separator normalization always,
  case-fold iff `opts.caseFold`; a candidate matches root R iff equal to R or beneath R at a path-
  segment boundary; among matching member roots the LONGEST wins; return `null` if none match.
- `caseFoldFromPlatform(platform: string): boolean` — true iff `platform` names Windows (e.g. `'Win32'`
  or any string containing `'Win'`), false otherwise (pure string test, no `navigator`/`process` read
  inside this function itself — the renderer caller supplies the string).
- No `process` reference anywhere in this file (REQ-009 acceptance: code-assertable via a source grep in
  phase 4).

### TASK-004 — Keybinding registration
**Satisfies:** REQ-002 · **Files:** `src/shared/keybindings.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** `findConflict(DEFAULT_BINDINGS, mod+shift+o,
  'toggle-orky-queue') === null`; `resolveBindings`/`matchShortcut` semantics untouched (baseline
  REQ-017/CHAR-013 extended, not changed)
- Add `CommandId` member `'toggle-orky-queue'` and the corresponding `Shortcut` variant
  `{ type: 'toggle-orky-queue' }`.
- Add to `COMMANDS`: `{ id: 'toggle-orky-queue', label: 'Toggle Orky decision queue', category:
  'General', defaultChord: 'mod+shift+o', tip: 'open the Orky decision queue' }` — verified non-
  conflicting against every existing default (k, `,`, tab/shift+tab, shift+t/m/h/enter/w/n/f/l, and the
  reserved `Ctrl+1..9` digits).
- No change to `resolveBindings`, `matchShortcut`, `isValidRebind`, or any existing `COMMANDS` entry —
  purely additive (CHAR-013 stays green).

### TASK-005 — Registry store slice (snapshot, error, drawer state, generation-guarded arbitration, memoized selectors)
**Satisfies:** REQ-001, REQ-003, REQ-007, REQ-008, REQ-011, REQ-013, REQ-017 · **Files:**
  `src/renderer/store/registry-slice.ts` (new), `src/renderer/store.ts`, `src/renderer/store/types.ts`
**Depends on:** TASK-002 · **Order:** 3 · **Constraints:** no persistence (session-scoped only, REQ-017);
  no throw on malformed input (REQ-013/CONV-002); deep-equal short-circuit (REQ-008)
- State: `registrySnapshot: OrkyRegistrySnapshot | null` (last VALID snapshot; `null` until first
  receipt), `registryError: string | null`, `queueOpen: boolean` (default `false`, NOT persisted — no
  `scheduleQuickSave` call anywhere in this slice), `snapshotGeneration: number` (monotonic, starts 0).
- `setQueueOpen(open: boolean): void` — mirrors `setNotesOpen` exactly (no persistence side effect).
- `setRegistrySnapshot(input: unknown): void` — the ONE ingestion chokepoint for both the push and the
  recovery pull:
  - non-array `input` → if `registrySnapshot` already holds a valid snapshot, no-op (stale data is kept
    rendering, REQ-013); if none is held, set `registryError` to a specific message naming "malformed
    registry payload" (never a bare "error").
  - array `input` deep-equal to the current `registrySnapshot` → keep the EXISTING state reference (no
    new object), so no subscribed component re-renders (REQ-008); still increments
    `snapshotGeneration` (the guard cares about ORDER of application, not value change).
  - array `input` not deep-equal → replace `registrySnapshot`, clear `registryError`, increment
    `snapshotGeneration`.
- Recovery-pull arbitration helper `applyRecoveryPull(input: unknown, issuedAtGeneration: number): void`
  — discards `input` if `snapshotGeneration !== issuedAtGeneration` at call time (a push or an earlier-
  issued pull already applied something); otherwise routes through the same `setRegistrySnapshot` path.
  On a `registryCurrent()` promise rejection with no valid snapshot held, set `registryError` naming the
  pull failure specifically (REQ-013); a rejection after a valid snapshot exists is a no-op.
- Memoized selectors (single definition, reused by both the badge and the list — REQ-007): a
  `queueGroups` selector calling `buildDecisionQueue(registrySnapshot)` and a `queueCount` selector
  calling `decisionQueueCount(queueGroups)`, both memoized on `registrySnapshot` reference identity so
  an unchanged snapshot re-derives nothing (REQ-008's "`buildDecisionQueue` invoked at most once per
  distinct snapshot reference").
- `Loading` is DERIVED, not stored: `registrySnapshot === null && registryError === null` (REQ-011) —
  no separate boolean to keep in sync.

### TASK-006 — `paneFocusSeq` recency tracking (store)
**Satisfies:** REQ-009 · **Files:** `src/renderer/store.ts` (`setFocusedPane`), `src/renderer/store/types.ts`,
  `src/renderer/store/internals.ts` (or wherever pane-removal/`clearPaneRuntime` already lives)
**Depends on:** — · **Order:** 2 · **Constraints:** monotonic; pruned on pane removal (CONV-011); no
  persistence
- State: `paneFocusSeq: Record<paneId, number>`, plus an internal monotonic counter.
- `setFocusedPane` (existing action) additionally stamps `paneFocusSeq[paneId] = ++counter` on every
  call — no change to its existing return/side effects otherwise.
- Hook into the SAME pane-removal cleanup site `clearPaneRuntime`/pane-close already uses, so a closed
  pane's key is deleted from `paneFocusSeq` in the identical call that clears its other per-pane runtime
  maps (`statuses`, `cwds`, `procs`, …) — no second, independent cleanup path.
- Panes never focused this session are simply absent from the map (rank-last is a comparison-time
  concern for TASK-009, not a stored default).

### TASK-007 — App-level wiring: subscription, recovery pull, drawer mount, shortcut dispatch
**Satisfies:** REQ-001, REQ-002, REQ-003, REQ-011 · **Files:** `src/renderer/App.tsx`
**Depends on:** TASK-004, TASK-005 · **Order:** 4 · **Constraints:** one-shot subscription block
  mirroring the existing `cloudCurrent()` pattern; app-level (not drawer-mounted) so the badge stays
  live while closed; no new `PaneKind`/mosaic participation
- In the existing push-subscription block (alongside `onCloudStatus`), add
  `onRegistryStatus(snapshot => setRegistrySnapshot(snapshot))`. Immediately after subscribing, issue
  ONE `registryCurrent()` recovery pull: capture `snapshotGeneration` at issue time, then on resolve/
  reject call `applyRecoveryPull`/the error path (TASK-005) with that captured generation.
- Render `<DecisionQueuePanel/>` (TASK-008) as a sibling of `<NotesPanel/>` in the main flex row, gated
  on `queueOpen`, mounted ONLY while open, OUTSIDE every `.mosaic`/workspace-host subtree (REQ-001) — no
  `PaneKind`/`PaneConfig` addition, no `SCHEMA_VERSION` bump.
- Extend the existing keybinding `switch` with a `'toggle-orky-queue'` case calling
  `setQueueOpen(!queueOpen)` (REQ-002c).

### TASK-008 — `DecisionQueuePanel` component family (shell, states, groups/items, a11y, theming)
**Satisfies:** REQ-001, REQ-005, REQ-006, REQ-007, REQ-008, REQ-011, REQ-012, REQ-013, REQ-014,
  REQ-015, REQ-016 · **Files:** `src/renderer/components/DecisionQueuePanel.tsx` (new)
**Depends on:** TASK-002, TASK-003, TASK-005 · **Order:** 5 · **Constraints:** literal testids/aria
  strings (see "Testability constraint" above); theme-var-only styling; no completeness-word invention
  (CONV-009)
- Shell: `data-testid="decision-queue-panel"`, `role="complementary"`, `aria-label` naming the Orky
  decision queue, a keyboard-operable close button calling `setQueueOpen(false)`.
- Reads `queueGroups`/`queueCount`/`registryError`/loading-derived-state from the store slice (TASK-005)
  — never recomputes them locally.
- Three mutually exclusive states: `decision-queue-loading` (loading derived state true),
  `decision-queue-error` (error set, no valid snapshot), `decision-queue-empty` (`queueCount === 0` with
  a valid snapshot) — else the group/item list.
- Per group: `decision-queue-group-<root>` wrapper carrying `data-project-root`; per item:
  `decision-queue-item` row carrying `data-project-root` + `data-feature`, rendering feature slug,
  `reason`, live `phase`/`gateN`/`gateM` fraction, and `detail` VERBATIM from the carried
  `OrkyFeatureStatus` (no recomputation, no rendering the literal string `"null"` for a `null` phase —
  REQ-015).
- All surfaces (drawer chrome, states, badge-adjacent text) styled via the existing `var(--panel)`/
  `var(--fg)`/`var(--border)`/`var(--fg-dim)` family with standard fallbacks (REQ-016) — no hard-coded
  hex bypassing the variable system.
- Focus-visible styling for rows/close-button/fallback affordance per CONV-007's standing allow-list
  rule (window chrome outside `.mosaic` carries visible focus) — extend the existing allow-list rather
  than inventing a second convention (REQ-014).
- Coexistence: this component's mount/unmount touches ONLY `queueOpen`; it MUST NOT read or write
  `notesOpen` (REQ-014's "toggling either MUST NOT change the other's open state" is satisfied by
  construction — no cross-slice write).

### TASK-009 — Click-to-focus + pane-less fallback wiring
**Satisfies:** REQ-009, REQ-010, REQ-017 · **Files:** `src/renderer/components/DecisionQueuePanel.tsx`
**Depends on:** TASK-003, TASK-006, TASK-008 · **Order:** 6 · **Constraints:** window-local only (no
  cross-window IPC); never a throw; fallback is read-only w.r.t. `.orky/` (no CLI, no deep-link)
- Per group, build the candidate-path list per pane (per REQ-009's fixed order: live cwd → persisted
  `config.cwd` → `gitStatus.root`) from the store's existing per-pane runtime maps, and call
  `matchPaneRoot` (TASK-003, with `caseFoldFromPlatform(navigator.platform)`) against the group's root.
- Among panes matching a group's root, pick the highest `paneFocusSeq` entry (TASK-006); ties broken by
  workspace order then pane-id codepoint; panes absent from `paneFocusSeq` rank last.
- On item click with a match: `setActive(workspaceId)` + `setFocusedPane(paneId)` (the
  `revealPaneFromSearch` pattern) — no new store action needed beyond what those two already provide.
- On item click / affordance activation with NO match: render `decision-queue-open-terminal`
  (`data-project-root`); activating it creates a workspace if none exists, then commits a `kind:
  'terminal'` pane with `cwd === projectRoot` via the existing `launchDir`-equivalent `commitPane` path
  — never a throw, never a silent no-op, and never a `.orky/` write, CLI invocation, or file open
  (REQ-010/REQ-017).

### TASK-010 — `StatusBar` toggle + live badge
**Satisfies:** REQ-002, REQ-007, REQ-014 · **Files:** `src/renderer/components/StatusBar.tsx`
**Depends on:** TASK-004, TASK-005 · **Order:** 5 · **Constraints:** real `button` with accessible name
  + `aria-expanded`; tooltip chord derived from `resolveBindings`, never hard-coded; badge = the SAME
  `queueCount` selector the list uses
- Add `orky-queue-toggle` alongside the existing `search-toggle`/`notes-toggle` buttons: `onClick`
  toggles `queueOpen` (TASK-005); `aria-expanded={queueOpen}`; tooltip/title text built from
  `resolveBindings(...)` for `'toggle-orky-queue'`, never a literal `"Ctrl+Shift+O"` string anywhere in
  this component (CONV-005).
- Badge: render `queueCount` (TASK-005's memoized selector) as text ONLY when `> 0`; no numeric badge at
  0 or while loading/errored (REQ-007/REQ-011). This subscription is live at the `App`/store level
  (TASK-007), so the badge updates while the drawer is closed.

### TASK-011 — Command-palette entry
**Satisfies:** REQ-002 · **Files:** `src/renderer/components/CommandPalette.tsx` (the repo's existing
  Ctrl+K palette component — exact filename per the palette's current implementation)
**Depends on:** TASK-004 · **Order:** 2 · **Constraints:** entry label/id sourced from `COMMANDS`
  (TASK-004), never duplicated inline
- Add the `'toggle-orky-queue'` command to whatever list/registry the palette already iterates over
  `COMMANDS` from (if the palette already derives its full list from `COMMANDS` automatically, this
  task is a no-diff verification step — confirm and record which is true during implementation).

### TASK-012 — Scope-guard verification pass (read-only, chrome-only, nothing persisted)
**Satisfies:** REQ-017 · **Files:** (verification only — no new source file; reviews the diff produced
  by TASK-001…TASK-011)
**Depends on:** TASK-005, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011 · **Order:** 7 ·
  **Constraints:** structural/grep verification, not a new test file (that is phase 4's job)
- Confirm: no file under `src/main/` or `src/preload/` is touched by this feature's diff; no `CH.*`
  constant added; no `registryAddRoot`/`registryRemoveRoot`/`orkyAction:*`/CLI/`child_process` reference
  anywhere in the feature's new/edited files; `SCHEMA_VERSION` unchanged; the drawer starts closed on
  every fresh mount (no persisted `queueOpen`).
- Confirm no whole-file content-freeze test is proposed for any shared multi-owner file this feature
  touches (`keybindings.ts`, `orky-status.ts`, `store.ts`/`store/types.ts`, `App.tsx`) — CONV-012; the
  feature's OWN additions are what phase 4 pins structurally, not the shared file wholesale.
- This is a review checklist executed once the functional tasks land — it produces no new shipped file,
  only a pass/fail confirmation feeding the implementation gate.

### TASK-013 — TEST-070 supersession boundary (delegated to the test-designer, phase 4)
**Satisfies:** REQ-019 · **Files:** `tests/shared/registry-no-renderer-ui.test.ts` (or its replacement)
**Depends on:** — · **Order:** N/A — **explicitly NOT an implementation-phase task.**
- This task exists ONLY to give REQ-019 a traceability anchor at the plan level; it is not implemented
  during the build phase and no implementer should touch the frozen `TEST-070` file.
- **Owner and timing:** the test-designer, at phase 4 (`04-tests.md`), in the SAME change that
  introduces this feature's own test suite — never during implementation (the spec's own normative
  requirement, REQ-019).
- **Required outcome (recorded here so the gatekeeper can check it lands):** `04-tests.md` records a
  supersession note naming `TEST-070`, F5's REQ-021, and this REQ-019; the replacement guard narrows its
  grep to the MUTATION surface only (`RegistryMutationResult`, `registryRoots(`, `registryAddRoot(`,
  `registryRemoveRoot(` — still forbidden per REQ-017) while permitting the READ surface this feature's
  TASK-005/007 introduce (`OrkyRegistrySnapshot`, `OrkyRegistryEntry`, `onRegistryStatus`,
  `registryCurrent(`); the replacement's own header names ITS designated retiring feature (the future
  "track this project" mutation consumer), per the Baseline-fit proposal.
- If the implementer's diff (TASK-001…TASK-012) lands before this retirement, the OLD `TEST-070` will
  fail (by design — it is still frozen and still greps the read-surface symbols this feature adds) until
  the test-designer's phase-4 change retires it in the same commit as the new suite. This is expected
  sequencing, not a defect in the plan.

### TASK-014 — Documentation reconciliation
**Satisfies:** REQ-018 · **Files:** `docs/features/decision-queue.md` (new), `CLAUDE.md`,
  `CHANGELOG.md`, wherever keybindings are documented, `.orky/baseline/architecture.md`
**Depends on:** TASK-001…TASK-012 (all functional tasks) · **Order:** last · **Constraints:** grep
  `docs/` + `CLAUDE.md` + `.orky/baseline/` for stale phrasing (CONV-008)
- New `docs/features/decision-queue.md`: document the drawer, its three toggle surfaces, the renderer-
  only data path (subscribe + one recovery pull, generation-guarded arbitration), membership/ordering
  rules (reused `needsHuman`/`compareOrkyFeatures`), click-to-focus's cwd-first matcher + fallback
  affordance, and the explicit read-only/no-persistence scope guard.
- Link the doc from the CLAUDE.md "Where things live" table.
- `CHANGELOG.md [Unreleased]`: record the decision-queue drawer.
- Document the new `toggle-orky-queue` command wherever keybindings are documented (Settings ▸
  Keybindings help text / docs, if such a doc exists alongside the in-app list).
- `.orky/baseline/architecture.md`: reconcile F5's "this feature ships no renderer UI" line (and any
  echo of it, e.g. in `ipc-contract.ts`'s own comment or other docs) to note `registry:status` now HAS a
  renderer consumer (this feature) — grep the WHOLE `docs/` tree, not just the one known line, per
  CONV-008.

---

## Sequencing summary

```
TASK-001 (export compareOrkyFeatures)
  └─ TASK-002 (buildDecisionQueue/decisionQueueCount)   [needs 001]
        └─ TASK-003 (matchPaneRoot/caseFoldFromPlatform) [needs 002, same file]
              └─ TASK-005 (registry store slice)         [needs 002]
                    └─ TASK-007 (App.tsx wiring)          [needs 004, 005]
                          └─ TASK-008 (DecisionQueuePanel)      [needs 002, 003, 005]
                                └─ TASK-009 (click-to-focus + fallback) [needs 003, 006, 008]
TASK-004 (keybinding registration)        [independent]
  ├─ TASK-007 (needs 004, 005)
  ├─ TASK-010 (StatusBar toggle + badge)   [needs 004, 005]
  └─ TASK-011 (palette entry)              [needs 004]
TASK-006 (paneFocusSeq)                    [independent — store.ts/internals.ts]
TASK-012 (scope-guard verification)        [needs 005, 007, 008, 009, 010, 011]
TASK-013 (TEST-070 supersession)           [phase 4, test-designer — not sequenced with the above]
TASK-014 (docs)                            [after all functional tasks]
```

## Complexity flags

- **REQ-002** (three toggle surfaces + rebindable keybinding) spans 4 tasks (TASK-004, TASK-007,
  TASK-010, TASK-011) — inherent to "three independent surfaces must all read one command registry
  entry"; no single task could own all three UI call sites without conflating unrelated components.
- **REQ-007** (badge = list, one selector) spans 4 tasks (TASK-002, TASK-005, TASK-008, TASK-010) —
  the selector is defined once (TASK-002), memoized once (TASK-005), and CONSUMED twice (TASK-008's
  list, TASK-010's badge); the fan-out is consumption, not re-implementation, so REQ-007's "one
  selector, one number" invariant is still upheld by construction.
- **REQ-009** (click-to-focus matcher) spans 3 tasks (TASK-003, TASK-006, TASK-009) — pure matcher,
  store recency tracking, and component wiring are natively separable and independently testable;
  kept as 3 rather than folded into 1 to preserve the pure/impure boundary the Testability constraint
  above depends on.

## Risk notes

1. **No-jsdom testability gap (see "Testability constraint" section above).** This plan does not
   propose adding jsdom — doing so would be speculative scope beyond what any REQ requires. If the
   test-designer (phase 4) determines source-scan tests cannot adequately pin REQ-008's render-count
   probes or REQ-014's keyboard-navigation acceptance, that is a phase-4 finding to raise to the
   coordinator, not a silent scope change here.
2. **Palette wiring (TASK-011) may be a no-diff task.** If the palette component already derives its
   full command list from `COMMANDS` automatically (as several sibling features' plans note for their
   own palette entries), TASK-011 becomes a verification step rather than an edit — confirmed during
   implementation, not assumed here.
3. **`paneFocusSeq` cleanup site (TASK-006) must reuse, not duplicate, `clearPaneRuntime`.** A second,
   independent pane-removal listener would risk the map outliving the open-pane set on a code path the
   existing cleanup doesn't cover — the task is written to hook the SAME site deliberately.
4. **TASK-013 is a boundary marker, not deliverable code.** Do not let an implementer "helpfully" edit
   the frozen `tests/shared/registry-no-renderer-ui.test.ts` during TASK-001…TASK-012 — REQ-019 is
   explicit that this must happen at phase 4, in the test-designer's own change, or not at all during
   implementation.

## Open issues (under-specified REQs)

None. Every REQ-001…REQ-019 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). REQ-019 maps
to TASK-013, which is a deliberately delegated, non-implementation task boundary — not an uncovered
requirement. The spec is frozen at 19 REQs.
