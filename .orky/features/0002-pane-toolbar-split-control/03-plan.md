# 0002 — Pane toolbar cleanup: Record → context menu, unified split-direction control — Implementation Plan

**Status:** plan written (phase 3). Derived from the FROZEN `02-spec.md` (REQ-001..REQ-015) and the
agreed `01-concept.md`. Brownfield: planned against `.orky/baseline/architecture.md` — extends the
existing renderer store spine (`placePane` → `commitPane` → `addTerminal`/`addEditor`/`addExplorer`)
and the pure layout model (`src/shared/workspace-model.ts`, which underpins baseline REQ-024's
persisted layout). No new module boundary, no IPC channel, no persisted-schema / `SCHEMA_VERSION`
change is introduced (REQ-008). Existing components are reused/restructured in place; nothing is
re-created.

This plan does **not** write code or tests. It specifies structure and sequence only. Tests (vitest
unit + Playwright e2e) are authored in phase 4; the traceability `tests` arrays are left empty for the
Gatekeeper to fill then.

## Ordering principle (TDD-friendly)

The pure, headlessly-unit-testable layer lands **before** the UI that depends on it:

1. `splitPane` before/after + the `splitDirToLayout` mapping (pure, `tests/shared/`) — TASK-001.
2. Store plumbing that threads the new position/direction through to `splitPane` without breaking
   legacy call sites (pure-ish, `tests/renderer/`) — TASK-002.
3. The combined compass popover component + its keyboard/a11y behavior — TASK-003/004/005.
4. The toolbar/tile entry-point and context-menu Record item — TASK-006/007.
5. e2e-spec reconciliation to the new contract and docs — TASK-008/009.

So a failing unit test (default-after regression pin, before-insertion, mapping) is written first,
then the UI e2e that drives the new control is updated after the surface exists.

## Target file / module layout

No new directories. Changes land in existing files; `SplitMenu.tsx` is restructured (not replaced
with a new path) so the `split-menu` testid and its import in `PaneTile` stay stable.

| Layer | File | Change |
|---|---|---|
| shared (model) | `src/shared/workspace-model.ts` | `splitPane(...id, position?: 'before'\|'after' = 'after')`; new pure `splitDirToLayout(dir: SplitDir4)` → `{ direction, position }`. `'after'` byte-for-byte today's output; `'before'` swaps which child is new. |
| shared (types) | `src/shared/types.ts` | `export type SplitDir4 = 'up' \| 'down' \| 'left' \| 'right'` (no schema change; `MosaicNode`/`MosaicParent` shape unchanged). |
| renderer (store helper) | `src/renderer/store/internals.ts` | `placePane(ws, cfg, target, dir, position?)` forwards `position` to `splitPane` (default `'after'`). |
| renderer (store root) | `src/renderer/store.ts` | `commitPane(...dir, position?, markEditor?)` forwards `position`; `addTerminal`/`addEditor`/`addExplorer` accept an optional `SplitDir4` (or position) and translate via `splitDirToLayout` before calling `commitPane`. Legacy callers (move-to-workspace, `launchDir`, ssh launch, relaunch, `dispatchAddPane`, first-pane) omit it ⇒ `'after'`/`'row'`. |
| renderer (store types) | `src/renderer/store/types.ts` | Extend `SliceDeps.commitPane` and the `addTerminal`/`addEditor`/`addExplorer` `State` signatures with the optional trailing param. |
| renderer (pane-ops types) | `src/renderer/store/pane-ops.ts` | Widen the `PaneActions` interface signatures to match (optional trailing param) so `dispatchAddPane` still type-checks; its calls stay `'row'`/default. |
| renderer (component) | `src/renderer/components/SplitMenu.tsx` | Restructured into the combined compass+kind popover: 4 direction targets (`split-dir-{up,left,right,down}-${paneId}`) + 3 kind options (`split-kind-{terminal,editor,explorer}-${paneId}`), portalled to `<body>`, Terminal default, Explorer gated on `paneCwd`, commit on direction-activation, full keyboard + ARIA. Loses the `dir` prop. |
| renderer (toolbar) | `src/renderer/components/PaneToolbar.tsx` | Remove `rec-${paneId}` button; replace the two split buttons (`split-${paneId}` ⬌ + `split-col-${paneId}` ⬍) with one `split-${paneId}` that toggles the combined popover (open does NOT commit). |
| renderer (tile) | `src/renderer/components/PaneTile.tsx` | `PaneMenu` `'split-row'\|'split-col'` → single `'split'`; render `<SplitMenu wsId paneId onClose=… />` (no `dir`) under `menu === 'split'`. |
| renderer (context menu) | `src/renderer/components/PaneContextMenu.tsx` | Add a terminal-only `pane-menu-record` start/stop item in the root view, wired to `api.recStart`/`api.recStop` reflecting `recording[paneId]`. |
| tests (e2e) | `tests/e2e/split-menu.spec.ts`, `tests/e2e/pane-actions.spec.ts` | Drive split via select-kind → activate-direction; drop `split-col-`/`rec-`/kind-click-commits; retain portal assertion. (Authored in phase 4 — flagged by TASK-008.) |
| docs | `CHANGELOG.md`, `docs/features/workspaces.md`, `CLAUDE.md` | Record-moves-to-menu, single split button + compass, before/after `splitPane`; reconcile the `rec-`/`split-`/`split-col-` testid references. |

### Load-bearing constraints carried into the tasks
- **Portal-to-`<body>`** (REQ-004, TASK-003): the popover is a `position`-ed child of a react-mosaic
  tile whose transform is a containing block — it MUST `createPortal(..., document.body)` like
  `PaneContextMenu`/`Modal`, or it clips/mis-stacks. Guarded by `tests/e2e/pane-actions.spec.ts`.
- **Paint-only chrome scoped to chrome testids** (REQ-012, TASK-003/006/007): new CSS touches only
  `background`/`color`/`border-radius`; it MUST NOT add `border`/`padding`/`font`/`height` rules that
  reach `[data-testid="editor-tabs"]` children or any Monaco/xterm host (the sibling-box gotcha).
  Collapsing two toolbar buttons into one MUST leave the toolbar's height/box unperturbed.
- **Keep-mounted** (general gotcha): the split commit re-uses `splitPane`/`commitPane`, which only
  rewrite `ws.layout` by replacing one leaf with a parent — no pane is unmounted; do not introduce a
  layout swap that disposes siblings.
- **Persisted-shape invariance** (REQ-008): `'before'` only changes *which child* is the new pane; the
  node stays `{ direction, first, second }`, so existing `workspaces/*.json` deserialize unchanged and
  `SCHEMA_VERSION` is not bumped.

## Tasks

### TASK-001 — `splitPane` before/after insertion + pure direction→layout mapping
- **Files:** `src/shared/workspace-model.ts`, `src/shared/types.ts`
- **What:** Add a trailing `position: 'before' | 'after'` param to `splitPane`, defaulted to `'after'`.
  `'after'` keeps today's `{ direction, first: targetPaneId, second: newPaneId }` byte-for-byte;
  `'before'` produces `{ direction, first: newPaneId, second: targetPaneId }` (only the new child's
  slot changes — `MosaicParent` shape, deep-leaf insertion, and serialize/deserialize round-trip all
  hold; no `SCHEMA_VERSION` bump). Add a separate pure helper
  `splitDirToLayout(dir: SplitDir4): { direction: MosaicDirection; position: 'before' | 'after' }`
  (`right→{row,after}`, `down→{column,after}`, `left→{row,before}`, `up→{column,before}`) and the
  `SplitDir4` type in `types.ts`.
- **Depends on:** —
- **Satisfies:** REQ-008 (+ the geometry half of REQ-007)

### TASK-002 — Thread position/direction through the pane-open plumbing
- **Files:** `src/renderer/store/internals.ts` (`placePane`), `src/renderer/store.ts` (`commitPane`,
  `addTerminal`/`addEditor`/`addExplorer`), `src/renderer/store/types.ts`
  (`SliceDeps.commitPane` + the three `State` action signatures),
  `src/renderer/store/pane-ops.ts` (`PaneActions`)
- **What:** Give `placePane` and `commitPane` an optional trailing `position` (default `'after'`)
  forwarded into `splitPane`. Give `addTerminal`/`addEditor`/`addExplorer` an optional trailing
  `SplitDir4` (or `position`); when present, derive `{ direction, position }` via `splitDirToLayout`
  and pass both to `commitPane`. The param MUST be **optional/defaulted** and appended **after** the
  existing args so every legacy call site (`dispatchAddPane`'s `'row'`, move-to-workspace, `launchDir`,
  ssh launch, relaunch-from-search, first-pane/drag) keeps its current behavior and the existing
  `pane-ops.test.ts` `['terminal','w','p1','row']`-shaped assertions stay green. A `left`/`up` split
  reaches `splitPane` with `position: 'before'`; `right`/`down` and all legacy sites with `'after'`.
- **Depends on:** TASK-001
- **Satisfies:** REQ-009 (+ the plumbing half of REQ-007)

### TASK-003 — Restructure `SplitMenu` into the combined compass + kind popover (portalled)
- **Files:** `src/renderer/components/SplitMenu.tsx`
- **What:** Replace the `dir`-prop two-step menu with one surface (`data-testid="split-menu"`)
  rendered via `createPortal(..., document.body)`. It contains:
  - a **compass** (spatial arrows around a center, not a vertical list) with four always-enabled
    targets `split-dir-{up,left,right,down}-${paneId}` (REQ-005);
  - a **kind selector** `split-kind-{terminal,editor,explorer}-${paneId}` with **Terminal** initially
    selected, the selection exposed for assertion (e.g. `data-selected`/`aria-checked`), and Explorer
    **disabled when `paneCwd(s, paneId)` is empty** (REQ-006).
  Activating a direction (click) commits via the selected kind's store action with the
  `splitDirToLayout(dir)` direction/position (terminals via `addTerminal`, explorers rooted at the
  source cwd, editors no cwd), then calls `onClose()`. Opening commits nothing. Style is paint-only
  (background/color/border-radius), scoped to these chrome testids (REQ-012).
- **Depends on:** TASK-002 (the actions must accept the direction first)
- **Satisfies:** REQ-004, REQ-005, REQ-006, REQ-007 (UI commit path), REQ-013 (popover/dir/kind
  testids), REQ-012

### TASK-004 — Make the compass fully keyboard-operable; default highlight = right
- **Files:** `src/renderer/components/SplitMenu.tsx`
- **What:** On open, move focus into the compass with the **right ▶** target initially highlighted.
  Arrow keys move the highlight among the four directions; **Enter**/**Space** commits the highlighted
  direction with the current kind (reusing TASK-003's commit path); **Esc** dismisses without
  splitting. The kind selector is reachable/changeable by keyboard. The highlight is exposed so the
  e2e can assert which target is active.
- **Depends on:** TASK-003
- **Satisfies:** REQ-010

### TASK-005 — ARIA roles/labels for directions and kinds
- **Files:** `src/renderer/components/SplitMenu.tsx`
- **What:** Each direction target gets an accessible name ("Split up/left/right/down"); the compass is
  a named group (`role="group"`/`radiogroup`, `aria-label="Split direction"`); each kind option
  exposes its name and selected state (`role="radio"`+`aria-checked`, or button + `aria-pressed`). No
  direction/kind control is an unlabeled icon-only element.
- **Depends on:** TASK-003
- **Satisfies:** REQ-011

### TASK-006 — Toolbar: remove Record, collapse two split buttons into one; tile wiring
- **Files:** `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneTile.tsx`
- **What:** In `PaneToolbar` delete the `rec-${paneId}` ⏺ button (REQ-001) and the `split-col-${paneId}`
  ⬍ button; keep exactly one `split-${paneId}` button whose click **toggles** the combined popover and
  performs no split on open (REQ-003). In `PaneTile`, collapse `PaneMenu` `'split-row'|'split-col'`
  into a single `'split'` and render `<SplitMenu wsId paneId onClose={close} />` (no `dir`) under it.
  The toolbar's height/layout box MUST be unperturbed by dropping two buttons (REQ-012); chrome stays
  paint-only and scoped. The `recording` prop may become unused in `PaneToolbar` once Record moves.
- **Depends on:** TASK-003 (popover must exist to be toggled)
- **Satisfies:** REQ-001, REQ-003, REQ-004 (entry point), REQ-012, REQ-013 (removed testids)

### TASK-007 — Move Record start/stop into the pane context menu (terminal-only)
- **Files:** `src/renderer/components/PaneContextMenu.tsx`
- **What:** In the root view, for **terminal** panes only (`kind === 'terminal'`), render one item
  `data-testid="pane-menu-record"` labelled **"Stop recording"** when `recording[paneId]` is truthy
  else **"Start recording"**; clicking it calls `api.recStop(paneId)` when recording else
  `api.recStart(paneId)`, then `onClose()`. Group it with the per-pane action items, separated from
  the move/close group per the menu's existing grouping; do not alter existing items' testids/behavior.
  The item MUST NOT render for editor/explorer panes. Read `recording` from the store
  (`s.recording[paneId]`).
- **Depends on:** TASK-006 (Record leaves the toolbar in the same change-set so it is never duplicated
  or missing)
- **Satisfies:** REQ-002, REQ-013 (record testid)

### TASK-008 — Reconcile affected e2e specs to the new contract (phase-4 flag)
- **Files:** (phase-4 test surface) `tests/e2e/split-menu.spec.ts`, `tests/e2e/pane-actions.spec.ts`
- **What:** The current specs assume "click a kind button commits" and reference removed testids. The
  tests phase MUST update them to the new control: select a kind (`split-kind-*`) **then** activate a
  direction (`split-dir-*`) to commit; remove every reference to `split-col-`, `rec-`, and the
  kind-click-immediately-commits flow. The `pane-actions.spec.ts` maximize test (lines ~105-106, which
  does `split-${a}` then `split-terminal-${a}`) MUST activate a direction after selecting Terminal. The
  **portal assertion intent** (`split-menu` is a child of `document.body`, not nested in the source
  `.mosaic-tile`) MUST continue to hold for the compass popover. No production code beyond TASK-001..007
  is needed; this task only flags the reconciliation so phase 4 owns it (the new e2e in phase 4 also
  cover REQ-005's all-four-enabled, REQ-006's Explorer-cwd-gate, REQ-010's keyboard commit, and
  REQ-011's accessible names). `pane-ops.test.ts` needs no change — the threaded param is defaulted
  (REQ-009).
- **Depends on:** TASK-003, TASK-004, TASK-005, TASK-006, TASK-007
- **Satisfies:** REQ-014

### TASK-009 — Documentation (doc-drift)
- **Files:** `CHANGELOG.md`, `docs/features/workspaces.md`, `CLAUDE.md`
- **What:** Changelog entry naming (a) Record moved to the pane context menu, (b) the unified split
  button + four-direction compass (up/left/right/down), and (c) before/after insertion in `splitPane`.
  Update `docs/features/workspaces.md` and any `CLAUDE.md` "where things live" / load-bearing
  references to the old `rec-`/`split-`/`split-col-` buttons so a reviewer can trace the removed/renamed
  testids to a doc mention.
- **Depends on:** TASK-006, TASK-007 (user-visible surface settled)
- **Satisfies:** REQ-015

## Sequencing summary

1. **Pure layout foundation:** TASK-001 (`splitPane` before/after + mapping).
2. **Store plumbing:** TASK-002 threads position/direction through (default-after; legacy sites green).
3. **Popover component:** TASK-003 (combined compass+kind, portal) → TASK-004 (keyboard) → TASK-005
   (ARIA) — same file, sequential.
4. **Entry points:** TASK-006 (toolbar single button + tile wiring) → TASK-007 (Record into context
   menu) — Record leaves the toolbar and lands in the menu in adjacent steps so it is never lost.
5. **Reconciliation:** TASK-008 (e2e specs, phase 4) → TASK-009 (docs).

## Risks / notes
- **Behavior change to a shared helper (REQ-008/CONV-003):** `splitPane` gains `position`; it is
  defaulted to `'after'` and pinned by a default-after regression test so no characterization test is
  intentionally changed and persisted layouts are byte-stable.
- **Legacy call sites (REQ-009):** the new param is appended optional/defaulted — the existing
  `pane-ops.test.ts` positional assertions (`['terminal','w','p1','row']`) must stay green; a
  positional insertion before existing args would break them and is forbidden.
- **Portal + paint-only chrome (REQ-004/REQ-012):** getting either wrong silently breaks the
  `pane-actions.spec.ts` portal guarantee or wedges Monaco model-switch via the editor-tabs sibling-box
  gotcha. Both are called out at task level (TASK-003/006/007).
- **Record never duplicated/missing (REQ-001/REQ-002):** TASK-006 removes it from the toolbar and
  TASK-007 adds it to the menu in adjacent steps; reviewing the diff together confirms a single
  terminal-only Record control.

## Open issues
_None._ All fifteen REQs (REQ-001..REQ-015) map to ≥1 task; see `traceability.md` / `traceability.json`.
`uncovered_reqs` is empty.
