# 0003 — Minimize / restore panes — Specification (Phase 2)

**Status:** spec drafted — derived from the agreed [`01-concept.md`](01-concept.md) (decisions D1–D6,
defaults DF1–DF4) and [`00-intake.md`](00-intake.md). Decisions are settled; this document makes each
testable. REQ ids are feature-scoped (this file's namespace) and do **not** reuse the baseline
`REQ-001..024` semantics in `.orky/baseline/`.

## Overview

Add the ability to **minimize** a pane out of the visible tiled layout while keeping it fully alive in
the background, with a per-workspace **tray** of chips to **restore** it. Minimize is the inverse of the
existing maximize: maximize hides *all but one* by painting over siblings (`visibility: hidden`, kept
mounted); minimize hides *one* and the visible mosaic tree **reflows** so the remaining panes fill the
freed space — which requires the minimized leaf to leave the *visible* layout tree while its React
subtree (xterm/Monaco/PTY) stays mounted off-layout, reusing the snapshot/stash + idempotent
`pty:spawn` re-adoption machinery (the same path as a same-window cross-workspace pane move). Both
minimize and maximize view-state become **persisted** (a `SCHEMA_VERSION` bump + explicit migration).

## Committed concern tags

`ux` (primary), `state-management`, `persistence/migration`, `accessibility`, `qol`, `doc-drift`,
and always-on `security`, `quality`, `devils-advocate`.

(No `data-provenance`: this feature bundles no factual/reference dataset.)

## Load-bearing constraints (MUST hold across every REQ below)

- **C1 — Keep-mounted invariant.** A minimized pane MUST NOT be unmounted and MUST NOT be hidden with
  `display: none` (which zeros size → FitAddon/PTY-grid thrash and disposes xterm scrollback / Monaco
  models). It stays mounted off-layout (e.g. `visibility: hidden` / detached but rendered), exactly as
  inactive workspaces and maximized siblings already are. *(CLAUDE.md keep-mounted gotcha.)*
- **C2 — Reflow needs the leaf out of the *visible* tree, subtree stays mounted.** The visible
  react-mosaic tree fed to the layout MUST have the minimized leaf pruned so siblings reflow; the live
  subtree MUST be preserved (re-adopted via idempotent `pty:spawn`, scrollback via the
  `stashSnapshot`/`consumeSnapshot` registry). The PTY MUST NOT be torn down (`api.ptyKill` MUST NOT be
  called on minimize). Reuse, do not reinvent, the same-window cross-workspace move path
  (`terminal-registry.ts`, `pane-transit.ts`).
- **C3 — Editor drafts flushed-not-deleted off-layout** (`pane-transit.ts`); a minimized Editor pane
  MUST NOT lose unsaved edits.
- **C4 — Mosaic-tile overlays portal to `<body>`.** Any tray/menu/popover that is a positioned child of
  a mosaic tile MUST `createPortal` to `<body>` (like `PaneContextMenu`/`Modal`/`SplitMenu`); inline
  it mis-positions/clips/under-stacks.
- **C5 — Layout ownership.** Main owns `windows[]` (`win:report`); the renderer MUST NOT write
  app-state directly, and a minimized pane crossing windows/workspaces MUST NOT double-mount its PTY.

---

## REQ-001 — Minimize action with three entry points

A pane MUST be minimizable from (a) a new pane-toolbar button alongside the maximize toggle in
`PaneToolbar.tsx`, (b) a new item in `PaneContextMenu.tsx`, and (c) a rebindable keybinding registered
in `src/shared/keybindings.ts`. Invoking any of the three on a non-minimized pane minimizes it; the
keybinding acts on the focused pane in the active workspace.

**Acceptance:** a toolbar button `data-testid="min-${paneId}"` exists; a context-menu item
`data-testid="pane-menu-minimize"` exists; `COMMANDS`/`CommandId` includes a `toggle-minimize-pane`
command with a default chord and the App keydown dispatcher minimizes `focusedPaneId` in `activeId`
(guarded by `s.workspaces[activeId]?.panes[pane]`, mirroring `toggle-maximize-pane`). An e2e clicking
`min-${paneId}` removes the pane's tile from the visible mosaic and adds its tray chip.

**Concerns:** ux, accessibility, doc-drift

## REQ-002 — Minimizing reflows siblings to fill 100% of the freed space

When a pane is minimized, the visible mosaic MUST drop that leaf and the remaining panes MUST expand to
occupy the full vacated area — true reflow, **not** a 0%/sliver collapse (which risks FitAddon/PTY-grid
thrash) and **not** a blank region where the pane used to be.

**Acceptance:** after minimizing one of two side-by-side panes, the surviving pane's tile occupies the
full workspace body (no `mosaic-split` and no empty gap remain for the minimized leaf); the freed
region contains no minimized-pane tile. (e2e geometry assertion: surviving tile width ≈ workspace body
width.)

**Concerns:** ux, state-management, qol

## REQ-003 — A minimized pane stays alive in the background

A minimized pane's PTY MUST keep running, its xterm scrollback / Monaco model MUST NOT be disposed,
live TUIs MUST keep ticking, and terminal output MUST keep accumulating while minimized. On restore the
content MUST be intact (no remount, no lost scrollback). Implementation MUST satisfy C1–C3.

**Acceptance:** e2e: a command emitting timed output (e.g. a counter) is started, the pane is minimized,
and after a wait + restore the post-minimize output is present in scrollback (output accumulated while
off-layout) and the PTY pid is unchanged (no kill/respawn). No `api.ptyKill` is called on the minimize
path (asserted via the IPC/spy or by pid stability). An Editor pane with an unsaved draft restores with
the draft intact (C3).

**Concerns:** state-management, ux, quality, devils-advocate

## REQ-004 — Per-workspace minimized tray with restore-on-click

Each workspace MUST render a tray showing exactly one chip per currently-minimized pane in that
workspace; the tray is shown only when ≥1 pane is minimized. Clicking a chip restores that pane to the
visible layout and removes its chip. The tray is the canonical home for minimized panes so none becomes
unreachable. If the tray (or any restore popover) is a positioned child of a mosaic tile it MUST portal
to `<body>` (C4).

**Acceptance:** minimizing two panes yields two chips `data-testid="min-chip-${paneId}"`; the tray
container `data-testid="min-tray-${wsId}"` is absent when none are minimized and present otherwise;
clicking a chip restores that pane (REQ-006) and drops the chip; chips are scoped to their workspace
(another workspace's minimized panes do not appear).

**Concerns:** ux, accessibility, qol

## REQ-005 — Tray chips surface live background status

Each tray chip MUST reflect the minimized pane's live runtime state — running/idle, **needs-input**,
recording, and AI-session active — using the same status signals the pane chip/toolbar already consume
(`statuses`, `recording`, `aiSessions` keyed by paneId). A backgrounded pane blocking on input MUST be
visibly distinguishable so it is not a silent footgun.

**Acceptance:** with a minimized pane whose store `statuses[paneId] === 'needs-input'`, its chip carries
a distinguishing marker (e.g. `data-needs-input="1"` / status testid) that a non-blocked chip does not;
toggling `recording[paneId]` / `aiSessions[paneId]` changes the chip's rendered indicator. Pure status →
indicator mapping is unit-tested over `idle | busy | needs-input`, recording on/off, and AI on/off.

**Concerns:** ux, accessibility, quality

## REQ-006 — Restore returns the pane intact to a deterministic slot (resolves OQ5)

Restoring a minimized pane MUST re-insert it into the visible mosaic, intact and visible. **Placement
policy (concrete default chosen for OQ5):** the restored pane is split to the **right** (`{ direction:
'row', ... }`, inserted as the new `second`) of the workspace's current visible layout — mirroring the
existing `movePane` re-insertion — or becomes the sole layout leaf when the visible layout is currently
empty (all panes were minimized). The pane id is unchanged so its running PTY is re-adopted by the
idempotent `pty:spawn`.

**Acceptance:** restoring into a non-empty layout yields a `{ direction:'row', first:<prev layout>,
second:<paneId> }` parent with the restored leaf present and visible; restoring into an empty layout
yields `layout === paneId`; in both cases the pane's pre-minimize scrollback/draft is intact (REQ-003).
The pure reducer is unit-tested for both the non-empty and empty-layout branches.

**Concerns:** ux, state-management, quality

## REQ-007 — Minimize state is persisted across reload

Per-workspace minimize state MUST survive an app reload: a pane minimized before reload MUST be
minimized (in the tray, absent from the visible layout) after reload, with its pane config preserved.
The view-state is persisted as part of the workspace/app-state record, never written to app-state from
the renderer (C5).

**Acceptance:** unit: serializing then deserializing a workspace that has pane P minimized round-trips
P's minimized flag. e2e (in-place reload, the binding scope per OQ6): minimize P, reload the window, P
is in the tray and not in the visible mosaic.

**Concerns:** persistence/migration, state-management

## REQ-008 — Maximize state is converted from transient to persisted (scope expansion D5)

The existing `maximized` view-state — today transient (`store/types.ts`, non-persisted) — MUST become
persisted with the same lifecycle as minimize state, so both pane view-states behave consistently across
reload.

**Acceptance:** unit: a workspace with pane P maximized round-trips P's maximized flag through
serialize→deserialize. e2e: maximize P, reload, P is still maximized. The change is recorded as a
deliberate behavior change in the doc-drift REQ (the maximize gotcha note moves from "transient" to
"persisted").

**Concerns:** persistence/migration, state-management, doc-drift

## REQ-009 — Explicit, tested schema migration with no silent data loss (CONV-003)

Persisting the new view-state MUST bump `SCHEMA_VERSION` (currently `6` in `src/shared/types.ts`) and
add an explicit migration. A workspace/app-state file written at the prior version (no view-state) MUST
load without error and yield zero minimized and zero maximized panes — no throw, no silent drop of pane
data. A view-state entry that references a paneId not present in `panes` MUST be dropped on load (a
dangling reference is pruned, not retained or silently truncating the rest), and this pruning MUST be
asserted by a test. There MUST be no silent capping/truncation of the minimized list (CONV-003): if any
limit on simultaneously-minimized panes is enforced it MUST be stated here and tested — **no such limit
is imposed** (DF2 allows minimizing every pane).

**Acceptance:** `SCHEMA_VERSION` is incremented and the migration is a named case (not identity).
Loading a v6 fixture yields a valid workspace with empty view-state. Loading a record whose
minimized/maximized references a missing paneId drops only that reference and keeps the rest. Malformed
view-state (wrong type) deserializes to empty view-state, not a throw (CONV-002). No code path truncates
the minimized array to a fixed size.

**Concerns:** persistence/migration, quality, devils-advocate

## REQ-010 — Minimize vs maximize precedence and mutual exclusion (DF1)

For the **same** pane, maximize and minimize MUST be mutually exclusive: minimizing a currently-maximized
pane first clears its maximize, then minimizes it. A minimized pane and a *different* maximized pane MAY
coexist (maximize fills the visible tree, which already excludes minimized panes). Restoring a minimized
pane while another pane is maximized returns it to the (currently hidden) visible layout; it becomes
visible when maximize is later cleared.

**Acceptance:** unit/e2e: maximize P then minimize P → P is minimized and not maximized
(`maximized[ws]` no longer P). With P minimized and Q maximized: Q fills the visible body, P is in the
tray; restoring P leaves Q maximized and P present in the (hidden) layout; clearing Q's maximize reveals
both. The precedence reducer is unit-tested.

**Concerns:** state-management, ux, devils-advocate

## REQ-011 — Minimize down to the last pane; all-minimized empty state (DF2)

Minimizing MUST NOT be blocked by "it is the only pane." When every pane in a workspace is minimized,
the workspace body MUST render an empty-state hint plus the tray (the restore home); the workspace MUST
remain recoverable (every minimized pane reachable from a chip).

**Acceptance:** e2e: minimize the sole pane → the visible mosaic is empty, an empty-state element
`data-testid="ws-empty-${wsId}"` is shown, and the pane's chip is present; clicking the chip restores
the pane as the sole layout leaf (REQ-006 empty branch). Minimizing every pane in a multi-pane workspace
shows one chip per pane and the empty state.

**Concerns:** ux, qol, devils-advocate

## REQ-012 — Minimize applies uniformly to Terminal / Editor / Explorer (DF3)

Minimize/restore MUST behave identically for Terminal, Editor, and Explorer panes. Editor drafts MUST
be flushed-not-deleted while off-layout (C3); Explorer/editor state MUST be preserved like any
kept-mounted pane.

**Acceptance:** e2e: an Editor pane with unsaved content and an Explorer pane each minimize and restore
with state intact (draft preserved, explorer root/selection preserved); the minimize affordance is
present on all three pane kinds (not terminal-gated).

**Concerns:** ux, state-management, quality

## REQ-013 — Keybinding ↔ accelerator/tooltip kept in sync (CONV-005)

The minimize command's display in the toolbar/context-menu tooltip and any native-menu accelerator MUST
derive from the keybinding registry (`formatChord` over the resolved `toggle-minimize-pane` binding),
never a hard-coded duplicate. Rebinding the command MUST update the surfaced accelerator/tooltip.

**Acceptance:** the toolbar/menu affordance's tooltip/label reflects the current resolved chord (via
`formatChord`), not a literal string; if a native menu accelerator is added it is sourced from the
binding registry. Unit/e2e: changing the binding changes the surfaced accelerator.

**Concerns:** ux, accessibility, doc-drift

## REQ-014 — Accessibility: keyboard-operable and visibly focusable (CONV-007)

Minimize and restore MUST be operable by keyboard, and the tray chips MUST be focusable, activatable by
keyboard (Enter/Space), and labelled (the pane title + status). Any tray/menu chrome portalled to
`<body>` MUST carry visible paint-only focus and hover styling (or be added to the focus-visible/hover
allow-lists) so focus/hover are visible outside the `.mosaic` subtree (C4).

**Acceptance:** tray chips are real focusable controls (button/`tabIndex`) with an accessible name
including the pane title; keyboard activation restores the pane; the portalled tray chrome matches the
focus-visible/hover style allow-list (asserted like the existing portalled-chrome focus test).

**Concerns:** accessibility, ux

## REQ-015 — Cross-workspace move / multi-window undock do not corrupt view-state (resolves OQ6)

**Binding scope (OQ6 default):** the persisted view-state's hard requirement is **in-place reload**
round-trip (REQ-007/008). Beyond that: because view-state is stored per-workspace and rides the
workspace record, it MUST travel with the workspace through multi-window undock without double-mounting
the PTY or writing app-state from the renderer (C5). When a *minimized* pane is moved to another
workspace via `movePaneToWorkspace`, its minimized flag MUST be cleared so it appears in the
destination's visible layout (avoids an unreachable pane mid-move); the source workspace's remaining
view-state MUST stay valid.

**Acceptance:** unit: moving a minimized pane between workspaces drops that pane's minimized flag in the
result and leaves other entries intact. e2e: undocking a workspace that has a minimized pane preserves
the minimized state in the new window with the PTY adopted exactly once (no double echo / no second
xterm). The move path does not call `api.ptyKill` (C2) and does not write app-state from the renderer
(C5).

**Concerns:** state-management, persistence/migration, devils-advocate, quality

## REQ-016 — No pane content is persisted by the view-state (security)

The persisted minimize/maximize view-state MUST store only pane *identifiers* (and the per-workspace
flags), never terminal output, scrollback, transcript content, or secrets. This preserves the existing
"no secrets persisted" posture.

**Acceptance:** the serialized workspace view-state contains only paneId references / boolean-equivalent
flags; a test asserts no scrollback/output/secret fields are written. (Folds into the existing
no-secrets persistence guarantee.)

**Concerns:** security, persistence/migration

## REQ-017 — Idempotent / total minimize & restore operations (CONV-002)

Minimize and restore MUST be total over ordinary input: minimizing an already-minimized pane is a no-op
(idempotent, no duplicate chip); restoring a pane that is not minimized is a no-op; minimizing/restoring
an unknown paneId is a no-op (no throw); closing a minimized pane removes its chip and view-state entry
(no orphan chip). Any user-facing error MUST be specific and actionable (CONV-001) — though these
operations are expected to be silent no-ops, not errors.

**Acceptance:** unit: `minimize` twice yields a single entry; `restore` on a non-minimized pane returns
state unchanged; both on an unknown paneId return state unchanged; closing a minimized pane
(`closePane`) removes it from view-state and the tray (no dangling chip). Boundary cases (empty
workspace, single pane) covered by REQ-011.

**Concerns:** quality, state-management, devils-advocate

## REQ-018 — Test-id contract and e2e proof

The feature MUST expose a stable test-id contract and an e2e proving the live-while-minimized and
reflow guarantees. Contract: `min-${paneId}` (toolbar), `pane-menu-minimize` (context menu),
`min-tray-${wsId}` (tray container), `min-chip-${paneId}` (chip), `ws-empty-${wsId}` (all-minimized
empty state). Affected existing e2e specs (pane-actions, maximize/split) MUST be updated to the new
contract and keep their portal/keep-mounted guarantees.

**Acceptance:** the listed test-ids exist and are referenced by an e2e that: minimizes a pane, asserts
reflow (REQ-002) + chip presence, asserts output accumulated while minimized (REQ-003), restores, and
asserts intact content. Existing maximize/pane-action e2es still pass.

**Concerns:** quality, doc-drift, ux

## REQ-019 — Documentation updated (doc-drift)

The documentation that this feature drifts MUST be updated: `docs/features/workspaces.md` (minimize/
restore + tray), the maximize gotcha in `CLAUDE.md` (now **persisted**, and the new minimize keep-mounted
/ reflow note), `CHANGELOG.md`, and the keybindings doc/registry entry. The baseline note that maximize
is transient MUST be reconciled (it is now persisted) so the inferred baseline is not silently
contradicted.

**Acceptance:** the feature docs describe minimize/restore, the tray, persistence, and precedence; the
maximize gotcha reflects persisted view-state; CHANGELOG has an entry; no doc still claims maximize is
transient/non-persisted.

**Concerns:** doc-drift

---

## Public interface

Renderer store (`src/renderer/store.ts` / `store/types.ts`) additions (observable contract; exact shape
is an implementation detail of the store, but the behavior is fixed by the REQs above):

- `minimized: Record<string, string[]>` — wsId → minimized paneIds for that workspace (mirrors
  `maximized: Record<string, string>`), persisted.
- `toggleMinimize(wsId, paneId)` — minimize if not minimized, restore if minimized (REQ-001/006/010/017).
- `restorePane(wsId, paneId)` — explicit restore used by tray chips (REQ-006).
- `maximized` becomes persisted (REQ-008).

Persistence/schema (`src/shared/types.ts`, `src/shared/workspace-model.ts`):

- `SCHEMA_VERSION` bumped from `6` → `7` (REQ-009).
- Per-workspace view-state persisted with the workspace record; explicit migration from v6 (REQ-009).

Keybindings (`src/shared/keybindings.ts`): new `toggle-minimize-pane` `CommandId` + `COMMANDS` entry
with a default chord; surfaced via `formatChord` (REQ-013).

Test-id contract: `min-${paneId}`, `pane-menu-minimize`, `min-tray-${wsId}`, `min-chip-${paneId}`,
`ws-empty-${wsId}` (REQ-018).

## Persistence / migration detail

- **Home of the state.** Per-workspace view-state (minimized list + maximized id) is serialized inside
  each workspace record (`workspaces/<id>.json`), so it rides the existing workspace serialization,
  cross-workspace move, undock, and migration paths — and is never written to `app-state.json` from the
  renderer (C5). The renderer store derives its `minimized`/`maximized` maps from the loaded workspaces.
- **Version bump.** `SCHEMA_VERSION 6 → 7`. `migrate()` in `workspace-model.ts` (and the app-state
  migrator if view-state touches it) gains an explicit v6→v7 case; v6 files load with empty view-state
  (REQ-009). Files newer than supported still throw the existing "newer than supported" guard.
- **Pruning, not capping.** Dangling paneId references in view-state are dropped on load; the rest is
  preserved; no fixed cap on the minimized count (CONV-003, REQ-009/DF2).
- **No content/secrets.** Only paneIds + flags persisted (REQ-016).

## Non-goals

- Reordering or drag-and-drop of tray chips, or a global (cross-workspace) minimized list — the tray is
  per-workspace only (D3).
- A "minimize all" / "restore all" bulk action (could be a follow-up; not specified here).
- Animated minimize/restore transitions beyond what existing reduced-motion-respecting styles provide.
- Changing maximize's *visual* behavior (it still paints over siblings); only its persistence changes
  (REQ-008).
- Fixing any of the four known baseline bugs; none are in this feature's path.

## Open questions

None blocking. OQ1–OQ4 were resolved in the concept; OQ5 (restore placement + tray visuals) is resolved
by REQ-006 + REQ-004's test-id/visual contract; OQ6 (round-trip scope) is resolved by REQ-015 (binding
scope = in-place reload; undock/move = preserve-without-corruption, with cross-workspace move clearing
the moved pane's minimized flag).

## Residual risks

- **Reflow + keep-mounted reconciliation (C2)** is the hardest mechanic; reusing the same-window
  cross-workspace move/stash path is mandated but the off-layout mount strategy (detached portal vs.
  hidden subtree) is left to the plan and must be proven by REQ-003's e2e.
- **Persisted maximize is a behavior change** to characterized baseline behavior (maximize was
  transient). REQ-008/REQ-019 make it deliberate; any baseline characterization touching maximize
  persistence must be updated through the tests phase, not silently.
