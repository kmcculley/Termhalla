# Pane title-bar actions: context menu, move-to-workspace, rename, maximize

**Date:** 2026-06-17
**Status:** Approved design, ready for planning

## Summary

Add a right-click context menu to each pane's title bar and a maximize control,
while slimming the title bar itself. Concretely:

1. **Right-click pane title bar → context menu** with: *Rename*, *Move to
   workspace ▸* (existing workspaces + *New Workspace*), *Settings*, *Close*.
2. **Remove** the env (🔑), settings gear (⚙), and style (🎨) buttons from the
   title bar; their functionality is reached via the menu's *Settings* item.
3. **Add a Maximize/Restore toggle button** to the title bar (plus a keyboard
   shortcut) that fills the workspace with the current pane and hides siblings
   until restored.

The hard parts are (a) moving a pane to another workspace **without killing the
running PTY or losing scrollback**, and (b) maximizing **without unmounting
sibling panes** (which would dispose their xterm/Monaco state).

## Context: current state

- The pane title bar is react-mosaic's `MosaicWindow`, fed `title` +
  `toolbarControls`. `toolbarControls` is `PaneToolbar.tsx`, which renders:
  proc-chip, schedule, record, env (🔑→environment settings), folder/cwd, gear
  (⚙→terminal settings), theme (🎨→appearance settings), split-right,
  split-down, close (✕). Source: `src/renderer/components/PaneTile.tsx`,
  `src/renderer/components/PaneToolbar.tsx`.
- The title (`termCfg?.name ?? pane.config.kind ?? 'Pane'`) is **not** editable
  today; `name` exists only on `TerminalConfig`.
- A house context-menu pattern already exists: positioned `div` + backdrop,
  `Z.menu` z-index, `SURFACE` styling — see `WorkspaceTabs.tsx` (lines ~77,
  106–123) and `ExplorerPane.tsx`. No Electron Menu API is used.
- Workspace model (`src/shared/types.ts`): `Workspace { id, name, layout:
  MosaicNode | null, panes: Record<id, PaneNode>, theme?: Partial<Theme> }`.
  Theme resolves app < workspace < pane (`src/shared/theme.ts`,
  `resolvedPaneTheme` in `store/internals.ts`). A new workspace
  (`workspace-model.ts createWorkspace`) gets no `theme` (inherits app).
- Each workspace renders its **own** `<Mosaic>` (`WorkspaceView.tsx`); all
  workspaces stay mounted, inactive ones hidden with `visibility: hidden`
  (`App.tsx`). Moving a `paneId` from workspace A's layout tree to B's therefore
  unmounts the `PaneTile` in A and mounts a fresh one in B.
- There is **no** existing cross-workspace pane move and **no** maximize/zoom
  feature.
- The multi-window undock move already implements serialize→transit→adopt:
  `readPaneSnapshot` via `@xterm/addon-serialize` (`TerminalPane.tsx`,
  `terminal-registry.ts`), a main-side `transit` buffer of pane-scoped events
  (`window-manager.ts`, replayed by `replayInto`), and an **idempotent**
  `pty:spawn` that adopts an already-running PTY when `pty.has(id)`
  (`register-pty.ts`).

## Design

### 1. Title-bar changes

In `PaneToolbar.tsx`, **remove** the env (🔑), gear (⚙), and theme (🎨) buttons.
**Add** a Maximize/Restore toggle button (square glyph; "restore" variant when
maximized). Final left→right order: proc-chip, schedule, record, folder/cwd,
split-right, split-down, **maximize**, close (✕ stays).

In `PaneTile.tsx`, switch from MosaicWindow's `title` + `toolbarControls` props
to its `renderToolbar` prop, so we own the entire toolbar DOM. This lets us
attach `onContextMenu` to the whole title bar and host the inline-rename input.
`PaneToolbar`'s existing buttons and `data-testid`s are preserved so
`tests/e2e/editor.spec.ts` (which guards the tab-strip box) stays green. The
rendered toolbar must keep the same box/height it has today — paint-only theming,
no layout-affecting chrome changes (see CLAUDE.md Monaco gotcha).

### 2. Right-click context menu — `PaneContextMenu.tsx` (new)

Reuse the house pattern (positioned `div` + backdrop click-to-close, `Z.menu`,
`SURFACE`). Opened by `onContextMenu` on the title bar; stores `{ paneId, x, y }`.
Present on **all** pane kinds. Items:

- **Rename** — replaces the title with an inline `<input>` (autofocus, select
  all). Commit on Enter/blur → `updatePaneConfig(wsId, paneId, { name })`; Esc
  cancels. Add an optional `name?: string` to `EditorConfig` and `ExplorerConfig`
  (today only `TerminalConfig` has it) and make the title prefer `config.name`
  uniformly across kinds.
- **Move to workspace ▸** — clicking swaps the menu body to a second list: every
  *other* workspace in tab order (`order` minus current), each calling
  `movePaneToWorkspace(paneId, wsId, targetId)`, followed by a **New Workspace ＋**
  entry that creates a new workspace and moves the pane into it. (Two-step
  in-place swap rather than a hover fly-out — simpler and robust in the existing
  pattern.)
- **Settings** — `openSettings({ section: 'terminal', paneId })`, opening the
  single settings panel; the user switches to Environment/Appearance sections
  inside. (For non-terminal panes the section is the appropriate non-env one.)
  This replaces the three removed buttons.
- **Close** — `closePane(wsId, paneId)`.

### 3. Move-to-workspace with live process + scrollback

New store action `movePaneToWorkspace(paneId, fromWsId, toWsId)`. Pure layout
helpers in `src/shared/workspace-model.ts`: `removePaneFrom` (exists as
`removePane`) and a new `addPaneInto(ws, paneId, node)` that inserts the pane as
a leaf (sole pane if the target layout is `null`, otherwise split against the
target's existing layout). Covered by vitest.

Runtime mechanism (reuses the existing serialize/transit/adopt infra so the PTY
in main never dies):

1. **Serialize** the source xterm synchronously via `readPaneSnapshot(paneId)`
   and stash the ANSI string in a renderer `pendingRestore: Map<paneId, string>`
   added to `terminal-registry.ts`.
2. **Begin transit buffering** for this pane in main — a thin reuse of the
   existing `transit` / `routeToPane` / `replayInto` machinery (with its GC
   timer) via a small same-window entry point — so pane-scoped PTY events emitted
   during the unmount→remount gap are buffered, not dropped.
3. **Mutate state**: move the `PaneNode` between `workspaces[from].panes` and
   `workspaces[to].panes`, update both layout trees (`removePaneFrom` /
   `addPaneInto`), set `activeId = toWsId` (follow the pane), schedule autosave.
4. **Remount + adopt**: the new `TerminalPane` mounts in the target Mosaic,
   consumes `pendingRestore[paneId]` and writes the stashed scrollback, then calls
   the idempotent `pty:spawn` → main sees `pty.has(id)` → `replayInto` flushes the
   transit gap-bytes. Resulting write order at the destination xterm is
   **scrollback → gap-bytes → live**.

**New Workspace** variant: create the workspace (`newWorkspace`/`createWorkspace`),
then carry the theme over by cloning the source workspace's `theme` override onto
the new workspace. The moved pane keeps its own `config.theme` regardless, so it
renders identically; cloning the workspace-level override keeps the surrounding
chrome consistent too.

**Non-terminal panes** (editor/explorer) have no PTY/xterm: the move is just the
`panes`/layout mutation. On remount they reload from draft/disk. Editor panes with
unsaved Monaco edits rely on the drafts system flushing before unmount — verify
during implementation that this is the case (hot-exit/drafts already persists
editor state).

### 4. Maximize (button + keyboard shortcut)

**Does not touch the layout tree.** Removing siblings from the tree would unmount
them and dispose their xterm scrollback / live TUIs / Monaco models — the cardinal
"never unmount" gotcha. Instead:

- Transient (non-persisted) UI state: `maximized: Record<wsId, paneId | null>` in
  the store. Toggled by the title-bar button and a keybinding.
  > **Superseded [2026-06, feature 0003-pane-minimize-restore]:** this `maximized`
  > view-state is **no longer transient** — it is now persisted per-workspace
  > (schema `v6→v7`, alongside the new `minimized` list). This dated design doc records
  > the original decision as made; see `docs/decisions.md` and
  > `docs/features/workspaces.md` for the current behavior.
- When set, `WorkspaceView` marks its host with `data-maximized="<paneId>"`. CSS
  makes the maximized `.mosaic-tile` fill the container (`inset: 0; width: 100%;
  height: 100%` with the necessary `!important` to override react-mosaic's inline
  geometry) and gives sibling tiles `visibility: hidden; pointer-events: none`.
  Siblings stay **mounted and sized** (same pattern as inactive workspaces), so no
  xterm/FitAddon thrash and scrollback survives restore. The maximized pane gets
  one legitimate resize (→ FitAddon + a single `ptyResize`).
- The keyboard shortcut toggles maximize for the **focused pane**. Planning step:
  confirm the store already tracks a focused/active pane; if not, add
  `lastFocusedPane` per workspace and set it on pane focus.
- Clear rules: any structural op (close/split/move) on a workspace clears that
  workspace's `maximized` entry; closing or moving the maximized pane clears it.

### 5. IPC / contract touch points

- `src/shared/ipc-contract.ts`: add the same-window "begin transit for pane"
  signal used by the move (channel `domain:verb`, e.g. `pty:hold` /
  `pty:beginTransit`), if it can't be expressed through an existing channel.
- `src/main/ipc/register-pty.ts` + the pane router: expose the thin same-window
  transit entry point reusing `transit`/`replayInto`.
- No new persisted schema fields except the optional `name?` on
  `EditorConfig`/`ExplorerConfig` (additive; bump `SCHEMA_VERSION` only if
  required by the persistence conventions).

## Testing (TDD)

**vitest (pure logic):**
- `movePaneToWorkspace` layout correctness: pane removed from A's tree, inserted
  into B's tree (null-layout target, single-pane target, multi-pane split target).
- Theme carry-over: moving to a new workspace clones the source workspace's
  `theme` override.
- Maximize-state reducer: set/toggle; cleared by close/split/move and by
  closing/moving the maximized pane.

**Playwright e2e (launch the real app):**
- Right-click title bar opens the menu with Rename / Move to workspace / Settings
  / Close.
- Rename updates the displayed title.
- Move to an existing workspace: pane appears in the target, the terminal is still
  alive (running process continues) and scrollback is preserved.
- Move to New Workspace: a new workspace is created and activated, theme carried,
  pane present.
- env/gear/theme buttons are gone from the title bar; Settings menu item opens the
  panel.
- Maximize hides siblings; Restore brings them back with scrollback intact; the
  keyboard shortcut toggles maximize.

Match the nearest existing test's style. Per CLAUDE.md, `npm run build` before
`npm run e2e`; e2e stays `workers: 1`.

## Risks / open items (resolve in planning)

- **Focused-pane signal** for the maximize shortcut — confirm or add.
- **Editor unsaved-edit flush** on cross-workspace move — confirm drafts flush
  before unmount.
- **`renderToolbar` swap** must not change the toolbar's box/height (Monaco layout
  gotcha) — guarded by `editor.spec.ts`.
- **CSS `!important` over react-mosaic geometry** for maximize — verify it doesn't
  perturb Monaco/xterm beyond the intended single resize; add an e2e guard.
