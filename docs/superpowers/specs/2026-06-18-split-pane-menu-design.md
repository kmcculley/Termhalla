# Split-pane menu (Terminal / Editor / Explorer)

**Status:** Draft for review · 2026-06-18

## Problem

The two split buttons on the pane toolbar (`⬌` split-right, `⬍` split-down) immediately
open a **terminal**. The user wants the split buttons to instead offer a choice of pane
kind — **Terminal**, **Editor**, or **Explorer** — and the new pane should inherit the
current working directory of the pane it was split from.

## Current behavior (grounding)

- `src/renderer/components/PaneToolbar.tsx:61-62` — `split-${paneId}` → `addTerminal(wsId, paneId, 'row')`,
  `split-col-${paneId}` → `addTerminal(wsId, paneId, 'column')`.
- CWD inheritance for terminals already works: `addTerminal` sets `cwd = paneCwd(get(), targetPaneId)`
  (`store.ts:271-275`, `internals.ts:60-70`).
- Store already has the create actions:
  - `addTerminal(wsId, target, dir)` — inherits cwd. ✔
  - `addEditor(wsId, target, dir)` — `store.ts:290`. Editors open files, no cwd concept.
  - `addExplorer(wsId, target, dir, root)` — `store.ts:292`. Needs a `root`.
  - `openExplorerHere(wsId, paneId)` shows the pattern: `addExplorer(wsId, paneId, 'row', paneCwd(...))`.
- In-tile popover menus follow the `PaneMenu` union + `toggle()` pattern in `PaneTile.tsx:17,42,108-114`,
  rendered absolutely inside the (relatively-positioned) tile. `CwdMenu.tsx` is the template:
  a small `SURFACE` popover at `right:4, top:28, zIndex: Z.popover`.

## Design

### Interaction
Each split button becomes a menu trigger. Clicking `⬌`/`⬍` opens a small popover (modeled on
`CwdMenu`) with three buttons: **Terminal**, **Editor**, **Explorer**. Selecting one splits the
source pane in that button's direction and closes the menu.

### Wiring
- Extend `PaneMenu` in `PaneTile.tsx` with `'split-row' | 'split-col'`.
- `PaneToolbar` split buttons call `toggle('split-row')` / `toggle('split-col')` instead of `addTerminal`.
- New `SplitMenu.tsx` (template: `CwdMenu`), props `{ wsId, paneId, dir, onClose }`:
  - **Terminal** → `addTerminal(wsId, paneId, dir)` (inherits cwd, unchanged).
  - **Editor** → `addEditor(wsId, paneId, dir)`.
  - **Explorer** → `addExplorer(wsId, paneId, dir, paneCwd(get(), paneId))`.
- `PaneTile` renders `{menu === 'split-row' && <SplitMenu dir="row" .../>}` and the column variant,
  inside the tile like the other menus. Positioned right-anchored like `CwdMenu` (acceptable; the
  cwd menu is not pixel-aligned under its button either).

### CWD inheritance
- Terminal & Explorer inherit the source pane's `paneCwd` (Explorer's `root`, Terminal's `cwd`).
- Editor has no cwd; "inherit CWD" is a no-op for it (opens an untitled scratch buffer as today).
  Out of scope: opening the editor's file dialog rooted at the source cwd.

### Keyboard
`new-terminal` (Ctrl+Shift+T) stays terminal-direct — it's the fast path for the common case and
isn't a split button. No change.

### Focus
New panes already auto-focus (the focus-registry work): `commitPane` → `requestPaneFocus`. So an
editor/terminal opened from the menu is focused and ready. (Explorer has no text focus target.)

## Testing
- **e2e** (`tests/e2e/pane-actions.spec.ts` style): open a terminal; click `split-${paneId}`;
  assert the `split-row` menu shows Terminal/Editor/Explorer; click **Editor**; assert a new
  `editor-*` pane mounted. Repeat for **Explorer** via `split-col` and assert `explorer-*` mounts.
- **e2e**: a terminal split from a known-cwd pane keeps the cwd (extends existing `cwd.spec.ts`
  pattern) — confirms Terminal inheritance survived the menu refactor.
- No new pure logic (store actions already exist & are tested); the change is wiring + a presentational menu.

## Out of scope / YAGNI
- Direction sub-menus, drag-to-split, or a unified `+` button (rejected in favor of the two
  direction buttons each opening a kind menu).
- Rooting the editor's open-file dialog at the source cwd.
