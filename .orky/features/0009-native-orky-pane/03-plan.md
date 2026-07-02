# 0009 — Native OrkyPane pane type — Plan (Phase 3)

**Status:** plan drafted from the FROZEN `02-spec.md` (REQ-001…REQ-022, 22 REQs). TASK-IDs below are
stable — never renumber. TASK numbering restarts at TASK-001 per feature (0005/0006/0007 precedent).
This is the broadest-blast-radius feature to date: a `SCHEMA_VERSION` 7→8 migration, a new persisted
pane kind touching the full kind-generic pane machinery, two new IPC surfaces in the `registry:*` read
domain (one pull, one push), and one sanctioned shared refactor (`isBlockingFinding`). It is strictly
READ-only (D4/REQ-013): no writes under any `.orky/` tree, no CLI, no `orkyAction:*` call, no registry
mutation.

## The core shape

Three layers, built bottom-up:

1. **Foundational shared edits** (no dependents until they land) — the `isBlockingFinding` extraction
   (`src/shared/orky-status.ts`), the persisted-model types + `SCHEMA_VERSION` bump
   (`src/shared/types.ts`), and the pure `sameProjectRoot` binding-equality module. Everything else in
   this plan depends transitively on one or more of these three.
2. **Main-side read surface** — the `registry:detail` pull (engine-parity bounds, sort-before-cap,
   torn-write retry, sender/membership gating) and the `registry:rootChanged` push (rides `OrkyRegistry`'s
   existing engine subscription, no new consumer). Both land in `register-registry.ts` + `ipc-contract.ts`
   + preload, sequenced strictly BEFORE any renderer code that calls them.
3. **Renderer wiring** — store runtime state (fetch/coalesce/discard-stale, per-root notification fan-out,
   `clearPaneRuntime` pruning), the four pane-creation affordances (palette, add-pane select, split
   compass, root picker), the `OrkyPane` component itself (states, triggers, row identity, ordering,
   reuse, render isolation, a11y, theming), and the kind-generic render-switch wiring
   (`PaneTile`/`MinimizedPaneHost`).

## Testability constraint (read before TASK-009/010/012…017)

Per the repo's standing `vitest.config.ts` (`environment: 'node'`, `tests/**/*.test.ts` only — no jsdom;
0006's precedent, unchanged by this feature): pure modules (types/migration/`isBlockingFinding`/
`sameProjectRoot`/main-side payload assembler) are directly unit-testable; main-process IPC handlers are
directly unit-testable (Electron mocked at the module boundary, existing pattern); component/store tasks
are exercised via plain-object store/selector tests plus **source-scan** tests grepping pinned literal
testids/aria strings/import sites (0006's pattern) — not real DOM rendering. Every literal this spec pins
(`orky-pane`, `orky-pane-unbound`, `orky-pane-rebind`, `orky-root-picker-*`, `split-kind-orky-<paneId>`,
`orky-pane-feature-unreadable`, `orky-pane-row-actions`, `data-project-root`/`data-feature`/
`data-escalation-id`, and the `isBlockingFinding`/`compareOrkyFeatures`/`orkyFeatureStatus`/
`sameProjectRoot` import sites) MUST be written as literal, greppable source text — no dynamically
assembled testid/aria string for anything the spec pins verbatim. E2E (Playwright-for-Electron) is
reserved for behavior the node harness cannot reach: real fixture round-trips, live-edit → notification →
refresh, undock/redock, restart round-trip, and the packaged-renderer `process`-undefined guard (REQ-005).
This is a planning constraint on HOW code is written, not a new task; no jsdom/vitest infra change is in
scope (speculative scope).

## Baseline / architecture fit

- `SCHEMA_VERSION` rides the shipped v6→v7 migration precedent (`workspace-model.ts:193`) — REQ-024
  (baseline versioned persistence) is honored by USING it, not superseded.
- F5's read surface (`registry:status`/`registry:current`) is extended, not changed: one new pull + one
  new push join the SAME registrar (`register-registry.ts:41-70`) with the same sender/disposer discipline.
- F6/0004/0005 shared modules are consumed, never forked: `orky-status.ts` mappers + `compareOrkyFeatures`,
  the registry slice's snapshot state (0006), `caseFoldFromPlatform` (0006's `decision-queue.ts`),
  `commitPane`/`dispatchAddPane`, `clearPaneRuntime`.
- The SIX frozen `SCHEMA_VERSION`-pinning guards (TEST-344, TEST-001, TEST-020, TEST-087, TEST-038,
  TEST-008 — the definitive Verified-contract inventory) are superseded/amended at the TESTS phase by the
  test-designer, never during implementation — REQ-003, anchored here as TASK-019 (the 0006 TASK-013
  precedent: a delegated, non-implementation boundary marker).

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| Shared refactor: `isBlockingFinding` extraction | `src/shared/orky-status.ts` | edit |
| Persisted model + detail wire types, `SCHEMA_VERSION` | `src/shared/types.ts` | edit |
| Workspace migration (v<8 identity step) + malformed-root load tolerance | `src/shared/workspace-model.ts` | edit |
| Pane↔binding equality (`sameProjectRoot`) | `src/shared/orky-pane.ts` (new; reuses `caseFoldFromPlatform` from `src/shared/decision-queue.ts`) | new |
| IPC channel constants + `TermhallaApi` typing | `src/shared/ipc-contract.ts` | edit |
| Main-side detail payload assembler + `registry:detail` handler + `registry:rootChanged` wiring | `src/main/orky/orky-registry.ts`, `src/main/ipc/register-registry.ts` (or sibling `orky-detail.ts` assembler module) | edit/new |
| Preload bridge (`registryDetail`, `onRegistryRootChanged`) | `src/preload/index.ts` | edit |
| Renderer store: pane detail runtime, notification fan-out, rebind | `src/renderer/store.ts`, `src/renderer/store/types.ts`, `src/renderer/store/internals.ts` | edit |
| Pane-kind machinery: `PaneKind`, `dispatchAddPane` `'orky'` branch | `src/renderer/store/pane-ops.ts` | edit |
| Creation affordances | `src/shared/quick.ts`, `src/renderer/components/CommandPalette.tsx`, `src/renderer/components/WorkspaceTabs.tsx`, `src/renderer/components/SplitMenu.tsx` | edit |
| Root picker chrome | `src/renderer/components/OrkyRootPicker.tsx` | new |
| Pane component | `src/renderer/components/OrkyPane.tsx` | new |
| Kind-generic render switches | `src/renderer/components/PaneTile.tsx`, `src/renderer/components/MinimizedPaneHost.tsx` | edit |
| App-level notification routing | `src/renderer/App.tsx` | edit |
| Frozen-suite supersession (6 guards) | `tests/renderer/decision-queue-panel-structure.test.ts`, `tests/shared/minimize-persistence.test.ts`, `tests/shared/orky-status.test.ts`, `tests/main/orky-registry-store.test.ts`, `tests/main/orky-osc-structural.test.ts`, `tests/main/quick-store-toasts.test.ts` | **owned by the test-designer at phase 4 — see TASK-019** |
| Docs / changelog | `docs/features/orky-pane.md` (new), `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md`, `src/shared/ipc-contract.ts` comments | new/edit |

## No new IPC beyond the two pinned surfaces (REQ-006/REQ-013)

This plan adds exactly two `CH.*` constants (`registryDetail`, `registryRootChanged`), no
`registry:addRoot`/`removeRoot` call, no `orkyAction:*` call, no new engine consumer/watcher, and no CLI
or `child_process` invocation anywhere.

---

## Tasks

### TASK-001 — `isBlockingFinding` extraction (sanctioned shared refactor)
**Satisfies:** REQ-007, REQ-013, REQ-015 · **Files:** `src/shared/orky-status.ts`
**Depends on:** — · **Order:** 1
- Extract `openBlockingCount`'s inline per-entry predicate (`orky-status.ts:134-143`) verbatim into an
  exported `isBlockingFinding(f: unknown): boolean` — same `isObject` guard, case-insensitive
  status/severity, `contract_violation` OR-branch. `openBlockingCount` delegates to it; no behavior
  change. Equivalence is proven at the tests phase (`openBlockingCount(v) === v.filter(isBlockingFinding).length`
  over a generated vector set) — this task only performs the extraction and delegation.
- No whole-file content-freeze test is proposed for `orky-status.ts` (CONV-012) — this feature's OWN
  addition (the export) is what phase 4 pins structurally.

### TASK-002 — `sameProjectRoot` binding-equality module
**Satisfies:** REQ-005 · **Files:** `src/shared/orky-pane.ts` (new)
**Depends on:** — · **Order:** 1 · **Constraints:** pure; no `process` read; reuses (never re-derives)
  `caseFoldFromPlatform` from `src/shared/decision-queue.ts`
- `sameProjectRoot(a: string, b: string, opts: { caseFold: boolean }): boolean` — resolve-style separator
  normalization always, case-fold iff `opts.caseFold`; EQUALITY (not containment/prefix) —
  `C:\dev\Termhalla` must not match `C:\dev\TermhallaX`.
- Import `caseFoldFromPlatform` from `decision-queue.ts` rather than redefining it (single definition,
  REQ-015's reuse discipline); the sole renderer call site derives the fold mode once via
  `caseFoldFromPlatform(navigator.platform)` and injects it (TASK-010/016) — this module itself reads no
  ambient platform state.

### TASK-003 — Persisted model types, detail wire types, `SCHEMA_VERSION` bump
**Satisfies:** REQ-001, REQ-002 · **Files:** `src/shared/types.ts`
**Depends on:** — · **Order:** 1
- `OrkyConfig { kind: 'orky'; root: string; name?: string; theme?: Partial<Theme> }` joins
  `PaneConfig = TerminalConfig | EditorConfig | ExplorerConfig | OrkyConfig`; `PaneKind` gains `'orky'`
  (`src/renderer/store/pane-ops.ts`'s `PaneKind` union — cross-referenced, edited here or there per
  whichever file currently owns the union; keep to ONE definition).
- `SCHEMA_VERSION` 7 → 8.
- Detail wire types exactly per the spec's Public interface: `OrkyGateDetail`, `OrkyFindingDetail`,
  `OrkyEscalationDetail`, `OrkyFeatureDetail`, `OrkyRootDetailResult` (discriminated `ok:true`/`ok:false`
  union, `errorKind: 'root-not-tracked' | 'orky-missing' | 'unknown-sender'`).
- No behavior anywhere yet — this is the type-only foundation every other task imports against.

### TASK-004 — `SCHEMA_VERSION` v<8 migration step + malformed-`root` load tolerance
**Satisfies:** REQ-002, REQ-020 · **Files:** `src/shared/workspace-model.ts`
**Depends on:** TASK-003 · **Order:** 2 · **Constraints:** deterministic, idempotent; byte-for-byte
  preservation of existing migration behavior (v<7 view-state init, dangling-ref pruning, malformed
  view-state tolerance, future-version rejection); isolated and independently testable in the node-env
  harness with zero renderer/main dependency
- Add an explicit v<8 step to `migrate()`: a DOCUMENTED identity (a pre-v8 record cannot contain an
  `orky` pane, so nothing is rewritten) — the step exists solely so the existing "newer than supported"
  guard rejects a v8 file under an older build.
- At the SAME load-normalization seam `normalizeViewState` uses: coerce a missing/non-string `orky`
  pane `root` to `''` (never throw, never drop the pane) so it renders REQ-011's unbound state downstream.
  Well-formed sibling panes and non-`orky` kinds are unaffected.
- `app-state-model.ts` needs no content edit (its migration keys only on the version bound — Verified
  contract); confirm this during implementation rather than editing it speculatively.

### TASK-005 — IPC channel constants + `TermhallaApi` typing
**Satisfies:** REQ-006, REQ-022 · **Files:** `src/shared/ipc-contract.ts`
**Depends on:** TASK-003 · **Order:** 2
- Add exactly two constants to `CH`: `registryDetail = 'registry:detail'`,
  `registryRootChanged = 'registry:rootChanged'` — both in the `registry:*` read domain, grep-distinct
  from `orkyAction:*` and from the four forbidden mutation-surface patterns
  (`RegistryMutationResult|registryRoots\s*\(|registryAddRoot\s*\(|registryRemoveRoot\s*\(`).
- Extend `TermhallaApi` with `registryDetail(root: string): Promise<OrkyRootDetailResult>` and
  `onRegistryRootChanged(cb: (root: string) => void): () => void`.
- No other `CH.*` addition; no change to any existing `registry:*` constant's value.

### TASK-006 — Main-side detail payload assembler + `registry:detail` handler
**Satisfies:** REQ-006, REQ-007, REQ-008, REQ-013 · **Files:** `src/main/orky/orky-registry.ts` and/or a
  sibling assembler module (e.g. `src/main/orky/orky-root-detail.ts`), `src/main/ipc/register-registry.ts`
**Depends on:** TASK-001, TASK-003, TASK-005 · **Order:** 3 · **Constraints:** one-shot (no watcher/engine
  consumer/timer left behind); never throws/rejects (CONV-002); imports the shared mapper pipeline, never
  forks it
- The assembler imports `orkyFeatureStatus`/`normalizeFeatureRaw`/`normalizeFindings`/`parseOrkyTimestamp`/
  `isBlockingFinding` (TASK-001) — same pipeline the engine/aggregate use, plus the detail layers the
  aggregate drops (per-gate records, findings, escalations).
- Engine-parity bounds (`MAX_FEATURE_DIRS`, `MAX_FILE_BYTES`, symlink skip) with the three pinned
  divergences: (a) sort feature slugs by codepoint BEFORE applying the cap (deterministic survivor set,
  never copying the engine's raw-`readdir`-order cap); (b) a torn `state.json`/`findings.json` (exists but
  unparseable) retries once after 150 ms, else surfaces via `skippedFeatures`/`findingsUnreadable` —
  never a silent drop; (c) absent/oversized files retry nothing (engine parity, with the engine's warn).
- `ipcMain.handle(CH.registryDetail, ...)` registered in `register-registry.ts`'s existing registrar,
  disposed by its disposer: gate on `isKnownWindowSender` (`ok:false, errorKind:'unknown-sender'`, no fs
  read, no throw); accept only a `root` that is a current aggregate member (normalized-key comparison) —
  anything else → `ok:false, errorKind:'root-not-tracked'` naming the input; a missing `orkyDir` →
  `ok:false, errorKind:'orky-missing'` naming the path; `computedAt` is the ONE injected clock instant
  used for every time-derived datum in the payload.
- No chokidar watcher, no `OrkyRegistry` consumer registration, no write of any kind on this path.

### TASK-007 — `registry:rootChanged` emission wiring
**Satisfies:** REQ-022 · **Files:** `src/main/orky/orky-registry.ts`, `src/main/ipc/register-registry.ts`
**Depends on:** TASK-005 · **Order:** 3 · **Constraints:** no engine change; rides the EXISTING
  `engine.onStatus` subscription; payload is a bare root string, never a status/snapshot
- `OrkyRegistry` gains `onRootChanged(cb): unsubscribe`, fired from its existing `engine.onStatus`
  subscription (`orky-registry.ts:42-45`) with `dirname(orkyDir)` — the same case-preserved spelling the
  snapshot/`statusByRoot` key on — including the `null`-status (vanished `orkyDir`) emit.
- `register-registry.ts` subscribes it to `send(CH.registryRootChanged, root)` exactly as its existing
  `registry.onSnapshot` line does, unsubscribed in the SAME disposer.
- No delta gating: fires on every completed re-read, regardless of whether the roll-up value changed
  (the deliberate design — decision #7).

### TASK-008 — Preload bridge for the two new channels
**Satisfies:** REQ-006, REQ-022 · **Files:** `src/preload/index.ts`
**Depends on:** TASK-005, TASK-006, TASK-007 · **Order:** 4
- `registryDetail(root)` bridged as an `invoke` call to `CH.registryDetail`.
- `onRegistryRootChanged(cb)` bridged via the existing `pushChannel` helper (`preload/index.ts:77`
  template, same pattern as `onRegistryStatus`) against `CH.registryRootChanged`.
- No other preload surface change.

### TASK-009 — `OrkyRootPicker` component (creation + re-bind chrome)
**Satisfies:** REQ-004, REQ-011, REQ-018 · **Files:** `src/renderer/components/OrkyRootPicker.tsx` (new)
**Depends on:** — · **Order:** 2 (independent of the main-side tasks; consumes the ALREADY-shipped F5/0006
  registry-slice snapshot/error state, no new subscription)
- FOUR mutually-distinct states (testids `orky-root-picker`, `orky-root-picker-loading`,
  `orky-root-picker-error`, `orky-root-picker-empty`): loading while
  `registrySnapshot === null && registryError === null` (the slice's derived-loading rule); error
  surfacing the held `registryError` text verbatim with no snapshot; empty (actionable copy) only for a
  genuinely-held `[]` snapshot; else the member list.
- Body-portalled chrome: CONV-020 focus discipline (receives focus on open, restores it to the opener
  ONLY if still inside the picker on close), CONV-007 focus-visible styling, arrow/Enter select,
  Escape/cancel commits nothing.
- Takes a generic `onSelect(root: string) => void` / `onCancel() => void` callback pair — the SAME
  component instance serves creation (TASK-012/014/015) and the unbound-state re-bind affordance
  (TASK-016), no forked copy.

### TASK-010 — Renderer store: pane detail runtime, fetch/coalesce, per-root notification fan-out, rebind
**Satisfies:** REQ-005, REQ-010, REQ-016, REQ-017, REQ-022 · **Files:** `src/renderer/store.ts`,
  `src/renderer/store/types.ts`, `src/renderer/store/internals.ts`
**Depends on:** TASK-002, TASK-003, TASK-008 · **Order:** 5 · **Constraints:** no polling/timer; issue-time
  generation guard on every settling response; at most one coalesced follow-up per pane
- State: `orkyPaneDetail: Record<paneId, { root, detail: OrkyRootDetailResult | null, inFlight, pendingRefetch, stale }>`.
- `fetchOrkyDetail(paneId, root)`: issues `registryDetail(root)`; if already in-flight for that pane, sets
  `pendingRefetch` (coalesced, latest-root-wins) instead of a second concurrent call; a settling response
  is DISCARDED unless it matches the pane's current binding AND fetch generation.
- `notifyOrkyRootChanged(root)`: PER-ROOT TARGETED fan-out (REQ-016) — for each pane bound to a
  `sameProjectRoot`-matching root (TASK-002's fold-injected equality, mode derived once via
  `caseFoldFromPlatform(navigator.platform)`): if displayed, fetch; if hidden (`MinimizedPaneHost`), mark
  `stale: true` and fetch nothing. A hidden→displayed transition with `stale: true` fetches exactly once,
  then clears `stale`. Zero re-renders/fetches for panes bound to a non-matching root.
- `rebindOrkyPane(wsId, paneId, root)`: `updatePaneConfig` (persisted via the existing autosave path) +
  fresh fetch.
- Bind-event triggers (T1 — mount with a bound member root; re-bind; re-entering membership after an
  unbound spell) are the OTHER fetch trigger alongside the notification (T2/T3) — wired here as the
  callable surface; the component (TASK-016) calls them at the pinned trigger points.
- `orkyPaneDetail` entries are pruned through the SAME `clearPaneRuntime` seam as every other per-pane
  runtime map — on close, workspace close, AND the move-away/redock path (CONV-011).

### TASK-011 — App-level notification routing
**Satisfies:** REQ-022 · **Files:** `src/renderer/App.tsx`
**Depends on:** TASK-008, TASK-010 · **Order:** 6
- In the existing push-subscription block, add
  `onRegistryRootChanged(root => notifyOrkyRootChanged(root))` (TASK-010). One line, mirroring the
  `onRegistryStatus`/`onCloudStatus` pattern already there. No new snapshot subscription, no
  `registryRoots()` call.

### TASK-012 — `PaneKind`/`dispatchAddPane` `'orky'` branch
**Satisfies:** REQ-001, REQ-004 · **Files:** `src/renderer/store/pane-ops.ts`
**Depends on:** TASK-003, TASK-009 · **Order:** 6
- `dispatchAddPane` gains an `'orky'` branch taking an injected, api-free root-picker callback (the
  explorer/`openFolder` pattern — CONV-006, one callback, no primary+override pair) that opens
  `OrkyRootPicker` (TASK-009); selection commits an `orky` pane whose `config.root` is the picked entry's
  `root` string VERBATIM via `commitPane`; cancel commits nothing.
- `addPaneOfKind`/`commitPane` need no kind-specific change beyond accepting `'orky'` (kind-generic
  machinery already treats configs as opaque per the Verified contract).

### TASK-013 — Command-palette creation affordance
**Satisfies:** REQ-004 · **Files:** `src/shared/quick.ts`, `src/renderer/components/CommandPalette.tsx`
**Depends on:** TASK-012 · **Order:** 7
- `buildCommandItems()` gains `'new-orky'` ("New Orky pane…"); `CommandPalette.tsx`'s action switch
  dispatches it through `dispatchAddPane('orky', ...)` (TASK-012). No new rebindable `CommandId`.

### TASK-014 — Add-pane select creation affordance
**Satisfies:** REQ-004 · **Files:** `src/renderer/components/WorkspaceTabs.tsx`
**Depends on:** TASK-012 · **Order:** 7
- `<option value="orky">Orky</option>` added to the existing `add-pane` select, routed through the same
  `dispatchAddPane('orky', ...)` call.

### TASK-015 — Split-compass creation affordance
**Satisfies:** REQ-004 · **Files:** `src/renderer/components/SplitMenu.tsx`
**Depends on:** TASK-009, TASK-012 · **Order:** 7 · **Constraints:** the compass e2e suite is open-form
  about the kind set (Verified contract) — a fourth kind button breaks none of it
- `SplitMenu`'s `Kind` union gains `'orky'`; a `split-kind-orky-<paneId>` button in the "Split kind" group
  with `aria-pressed` parity, disabled with an explanatory accessible name when the held snapshot has no
  member (the explorer/cwd disabled precedent, `SplitMenu.tsx:120`).
- With `orky` selected, activating a direction closes the compass and opens `OrkyRootPicker` (TASK-009);
  selection commits the directional split via the existing split-commit path; cancel commits nothing.

### TASK-016 — `OrkyPane` component (states, triggers, rows, ordering, reuse, a11y, theming)
**Satisfies:** REQ-005, REQ-009, REQ-010, REQ-011, REQ-012, REQ-014, REQ-015, REQ-016, REQ-018, REQ-019
**Files:** `src/renderer/components/OrkyPane.tsx` (new)
**Depends on:** TASK-001, TASK-002, TASK-003, TASK-008, TASK-009, TASK-010 · **Order:** 7 · **Constraints:**
  literal testids/aria strings (Testability constraint above); no local re-derivation of gate/stall/
  blocking/needs-human logic (renders carried fields verbatim); no `role="button"` container wrapping
  other controls; theme-var-only styling
- **States (mutually exclusive testids):** `orky-pane-loading` (before first settle),
  `orky-pane-unbound` (config.root not a member, or `''` — resolved copy naming the persisted root
  verbatim, `orky-pane-rebind` opening `OrkyRootPicker`), `orky-pane-unreadable` (member but
  `orky-missing`/null-status-with-failed-fetch, distinct wording from unbound), `orky-pane-error`
  (any other fetch failure — specific text, CONV-001; stale-but-valid detail keeps rendering underneath).
- **Bound rendering:** header (name, root with `title`, `source`, roll-up accents) and rows derive from
  ONE held detail payload and its `computedAt` — never the aggregate entry's own (older) status; the
  aggregate entry supplies ONLY membership/`source`/the unbound transition (REQ-009's single-source
  arbitration). Every feature from the payload renders (including `idle`/clean-`done`, which the
  aggregate's popover set excludes) — never just the aggregate's subset.
- **Rows:** `orky-pane-feature` rows carrying `data-project-root` + `data-feature`; a `skippedFeatures`
  slug renders `orky-pane-feature-unreadable` (never vanishes); an empty, reserved
  `orky-pane-row-actions` trailing slot per row (F10 hook, F9-empty); `orky-pane-gates` (all 8,
  canonical order), `orky-pane-finding` rows (`data-finding-id`), `orky-pane-escalation` rows
  (`data-escalation-id`, resolved `decision` shown).
- **Ordering:** display order via the shared, single-definition `compareOrkyFeatures` import (never
  redefined); payload fields render verbatim (no `Date.now()`/local clock read in this component).
- **Triggers (REQ-010, calling TASK-010's store actions at exactly these points, no others):** mount with
  a bound member root → `fetchOrkyDetail`; re-bind → `rebindOrkyPane`; re-entering membership after an
  unbound spell → resumes automatically (snapshot-derived, no manual action); an own-root
  `registry:rootChanged` notification while displayed → fetch (routed via TASK-010/011's
  `notifyOrkyRootChanged`, this component supplies no separate subscription); hidden → marks stale, no
  fetch; hidden→displayed with suppressed staleness → fetch exactly once.
- **Render isolation (REQ-016):** subscribes narrowly to its own aggregate entry + its own
  `orkyPaneDetail[paneId]` slice via memoized/equality-guarded selectors — no broad snapshot subscription
  that would re-render on other-root churn.
- **A11y/theming:** labeled region (`role`/`aria-label` naming the bound project), keyboard-scrollable
  container, native-button disclosures with `aria-expanded` for gates/findings/escalations, no
  `role="button"` wrapper, target-guarded row key handling, `:focus-visible` styling on every focusable
  surface; all colors via the `var(--panel)`/`var(--fg)`/`var(--fg-dim)`/`var(--border)` family plus
  status-accent colors, so app/workspace/per-pane theme overrides all apply.

### TASK-017 — Kind-generic render-switch wiring
**Satisfies:** REQ-001, REQ-010, REQ-017 · **Files:** `src/renderer/components/PaneTile.tsx`,
  `src/renderer/components/MinimizedPaneHost.tsx`
**Depends on:** TASK-016 · **Order:** 8
- Add the `'orky'` case to both kind switches (`PaneTile.tsx:144-147`, `MinimizedPaneHost.tsx:40-42`),
  rendering `OrkyPane` with `themeCssVarsPartial(pane.config.theme)` applied exactly as the other kinds.
- `MinimizedPaneHost` keeps the pane MOUNTED but hidden (`visibility: hidden`, `aria-hidden`,
  `pointer-events: none`) — the concrete displayed/hidden boundary TASK-010/016's triggers key on. No
  other kind-generic path (`movePane`/undock/redock/minimize/`templateFromWorkspace`) needs any change —
  all treat `PaneConfig` as opaque deep-cloned data (Verified contract); this task is where that claim is
  exercised, not re-implemented.

### TASK-018 — Scope-guard verification pass (read-only, no new consumer, no mutation surface)
**Satisfies:** REQ-013 · **Files:** verification only — reviews the diff from TASK-001…TASK-017
**Depends on:** TASK-006, TASK-007, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015,
  TASK-016, TASK-017 · **Order:** 9
- Confirm: no `.orky/` write anywhere in the diff; no CLI/`child_process` reference; no `orkyAction:*`
  call; no `registryRoots(`/`registryAddRoot(`/`registryRemoveRoot(`/`RegistryMutationResult` reference in
  any renderer file (`tests/shared/registry-no-renderer-ui.test.ts` stays green byte-unchanged); no new
  `OrkyRegistry` consumer/watcher registration beyond the existing `engine.onStatus` subscription
  TASK-007 rides; exactly two new `CH.*` constants; the only persisted-format change is `PaneConfig` +
  `SCHEMA_VERSION`; no whole-file content-freeze test proposed for any shared multi-owner file touched
  (`types.ts`, `workspace-model.ts`, `quick.ts`, `pane-ops.ts`, `PaneTile.tsx`, `SplitMenu.tsx`,
  `register-registry.ts`, `ipc-contract.ts`, preload, store composition, `orky-status.ts` — CONV-012).
- Produces no new shipped file — a pass/fail confirmation feeding the implementation gate (0006 TASK-012
  precedent).

### TASK-019 — Frozen point-in-time-guard supersession boundary (delegated to the test-designer, phase 4)
**Satisfies:** REQ-003 · **Files:** `tests/renderer/decision-queue-panel-structure.test.ts`,
  `tests/shared/minimize-persistence.test.ts`, `tests/shared/orky-status.test.ts`,
  `tests/main/orky-registry-store.test.ts`, `tests/main/orky-osc-structural.test.ts`,
  `tests/main/quick-store-toasts.test.ts`
**Depends on:** — · **Order:** N/A — **explicitly NOT an implementation-phase task**
- This task exists ONLY to give REQ-003 a traceability anchor at the plan level; no implementer touches
  any of these six frozen files during TASK-001…TASK-018.
- **Owner and timing:** the test-designer, at phase 4 (`04-tests.md`), in the SAME change that introduces
  F9's own suite — never during implementation (CONV-019's protocol).
- **Required outcome (recorded here so the gatekeeper can check it lands):** `04-tests.md` names all SIX
  guards (TEST-344, TEST-001, TEST-020, TEST-087, TEST-038, TEST-008) and this REQ; TEST-344's closed
  `PaneConfig`-union pin is re-expressed open-form ("no `orky`-shaped pane kind exists and `PaneConfig`
  still contains the three original members") rather than dropped; the five bare `toBe(7)` pins are
  re-pinned to `8` with a supersession note naming REQ-003; a repo-wide `toBe\(7\)` grep over `tests/**`
  at the tests-phase gate finds no remaining `SCHEMA_VERSION` value pin beyond the two documented unrelated
  hits (`pane-focus-seq.test.ts:30`, `orky-status.test.ts:99`).
- If TASK-001…TASK-018 land before this retirement, the six guards will fail RED (by design, since they
  still pin `7`) until the test-designer's phase-4 change amends them in the same commit as the new suite
  — expected sequencing, not a defect.

### TASK-020 — Documentation reconciliation
**Satisfies:** REQ-021 · **Files:** `docs/features/orky-pane.md` (new), `CLAUDE.md`, `CHANGELOG.md`,
  `.orky/baseline/architecture.md`, `src/shared/ipc-contract.ts` comments
**Depends on:** TASK-001…TASK-018 (all functional tasks) · **Order:** last
- New `docs/features/orky-pane.md`: the pane kind, the binding model (verbatim persistence + fold-injected
  matching), the three degraded states + re-bind, the `registry:detail` contract (bounds/retry/skipped-
  feature semantics), and `registry:rootChanged`'s role as the detail view's currency mechanism. Link it
  from the CLAUDE.md "Where things live" table.
- `CHANGELOG.md [Unreleased]`: record the new pane kind AND the `SCHEMA_VERSION` v7→v8 bump (with the
  older-build rejection implication).
- Repo-wide grep (CONV-008) of `docs/` + `CLAUDE.md` + `.orky/baseline/` for: any "pane kinds are exactly
  terminal/editor/explorer" claim, any "`SCHEMA_VERSION` is 7" / "last bumped by 0003" claim, and stale
  registry-channel-family notes — reconcile to name `registry:detail`/`registry:rootChanged` and their F9
  consumer.

---

## Sequencing summary

```
TASK-001 (isBlockingFinding)         [independent]
TASK-002 (sameProjectRoot)           [independent]
TASK-003 (types + SCHEMA_VERSION=8)  [independent]
  ├─ TASK-004 (migration + malformed-root tolerance)   [needs 003]
  └─ TASK-005 (ipc-contract constants + typing)         [needs 003]
        ├─ TASK-006 (main detail assembler + handler)   [needs 001, 003, 005]
        └─ TASK-007 (rootChanged emission)               [needs 005]
              └─ TASK-008 (preload bridge)               [needs 005, 006, 007]
                    └─ TASK-010 (store: fetch/coalesce/notify/rebind)  [needs 002, 003, 008]
                          └─ TASK-011 (App.tsx notification routing)   [needs 008, 010]
TASK-009 (OrkyRootPicker)            [independent]
  ├─ TASK-012 (dispatchAddPane 'orky' branch)  [needs 003, 009]
  │     ├─ TASK-013 (palette entry)             [needs 012]
  │     ├─ TASK-014 (add-pane select)           [needs 012]
  │     └─ TASK-015 (split compass)             [needs 009, 012]
  └─ TASK-016 (OrkyPane component)   [needs 001, 002, 003, 008, 009, 010]
        └─ TASK-017 (PaneTile/MinimizedPaneHost render switches)  [needs 016]
TASK-018 (scope-guard verification)  [needs 006, 007, 009, 010, 011, 012, 013, 014, 015, 016, 017]
TASK-019 (frozen-guard supersession) [phase 4, test-designer — not sequenced with the above]
TASK-020 (docs)                      [after all functional tasks]
```

## Complexity flags (REQs spanning >3 tasks)

- **REQ-001** (first-class persisted pane kind) spans 4 tasks (TASK-003, TASK-012, TASK-016, TASK-017) —
  the type, the creation path, the rendering component, and the kind-generic render switch are natively
  separable; no single task could own all four without conflating the type layer with two different
  renderer surfaces.
- **REQ-004** (three creation affordances + the shared picker) spans 5 tasks (TASK-009, TASK-012,
  TASK-013, TASK-014, TASK-015) — one picker component, one centralized dispatch branch, and three
  independent UI call sites that must each route through it; the fan-out is consumption of one picker/one
  dispatch path, not re-implementation.
- **REQ-010** (pinned refresh triggers) spans 4 tasks (TASK-010, TASK-011, TASK-016, TASK-017) — the
  store's fetch/coalesce/discard machinery, the App-level notification routing that feeds it, the
  component's trigger call sites, and the hidden/displayed boundary the mosaic host itself defines are
  each a distinct, independently testable seam.
- **REQ-022** (`registry:rootChanged`) spans 5 tasks (TASK-005, TASK-007, TASK-008, TASK-010, TASK-011) —
  the channel constant, the main-side emission wiring, the preload bridge, the renderer's per-root fan-out,
  and the one-line App-level subscription are the minimal main→renderer plumbing chain for a new push
  channel; none of the five could be collapsed into another without crossing the main/preload/renderer
  process boundary.

## Risk notes

1. **`PaneKind`'s exact home** (TASK-003 vs `pane-ops.ts`) — the repo has it declared adjacent to
   `dispatchAddPane` (`pane-ops.ts:3` per the Verified contract) while `PaneConfig` lives in `types.ts`;
   TASK-003 adds `'orky'` to whichever ONE file currently owns `PaneKind` — confirmed, not duplicated,
   during implementation.
2. **Main-side assembler file placement** (TASK-006) — this plan allows either extending
   `orky-registry.ts` directly or adding a sibling `orky-root-detail.ts` module; the choice is an
   implementation detail, not a REQ, and must not fork the shared mapper imports either way.
3. **TASK-019 is a boundary marker, not deliverable code** — no implementer may "helpfully" amend any of
   the six frozen guards during TASK-001…TASK-018; REQ-003 is explicit that this happens at phase 4, in
   the test-designer's own change, or not at all during implementation.
4. **No-jsdom testability gap** (Testability constraint above) — if phase 4 determines source-scan tests
   cannot adequately pin REQ-010's coalescing/discard probes or REQ-016's render-isolation counts, that is
   a phase-4 finding to raise to the coordinator, not a silent scope change here.

## Open issues (under-specified REQs)

None. Every REQ-001…REQ-022 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). REQ-003 maps to
TASK-019, a deliberately delegated, non-implementation task boundary — not an uncovered requirement. The
spec is frozen at 22 REQs.
