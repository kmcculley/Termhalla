# Termhalla — Workspace Tab Management — Design Spec

**Date:** 2026-06-15
**Status:** Approved (autonomous batch; recommended options chosen)
**Builds on:** Phase 1 workspace model + tabs, all merged to `main`.

## 1. Summary

Make workspace tabs manageable: **right-click** a tab for a context menu (**Rename**, **Save**,
**Close**); **name a new workspace immediately** on creation (inline edit); and **reorder**
tabs by left-click dragging. Covers requested features 2, 4 (name-on-create), and 6.

## 2. Decisions (recommended)

| Decision | Choice |
|---|---|
| Context menu | Right-click (`onContextMenu`) a tab → a small menu: **Rename**, **Save**, **Close**. |
| Rename UX | Inline: the tab becomes a text `<input>` (Enter/blur commits, Esc cancels, blank keeps old). |
| Name on create | The `+` button creates the workspace AND immediately puts its tab into inline-rename. |
| Save | Context-menu "Save" calls the existing `saveAll()` (persists all open workspaces + app state). |
| Close | Removes the workspace from the open set, kills its terminals, cleans per-pane maps; confirms only when it has panes; if it was the last open workspace, a fresh empty one is created. |
| Reorder | Native HTML5 drag-and-drop on the tab buttons; reorders the `order` array. |
| Orphan files | Closing leaves the workspace JSON on disk (restore only loads `openWorkspaceIds`, so it is not reloaded); orphan cleanup is deferred. |

## 3. Pure core (testable)

In `src/shared/workspace-model.ts`:
- `reorderIds(order: string[], fromId: string, toId: string): string[]` — return a new array with
  `fromId` moved to the index of `toId` (no-op if either missing or equal). Unit-tested.

## 4. Store

New actions (`src/renderer/store.ts`):
- `renameWorkspace(id, name)` — trims; ignores empty (keeps current); updates `workspaces[id].name`;
  `scheduleAutosave()`.
- `closeWorkspace(id)` — for every pane in the workspace: if terminal, `api.ptyKill(paneId)` +
  `api.usageUnwatch(paneId)`; delete the pane's entries from `statuses/cwds/procs/aiSessions/usage`.
  Remove `id` from `order` and `workspaces`. New `activeId` = the neighbor in `order` (or null). If
  `order` becomes empty, `newWorkspace('Workspace 1')`. `scheduleAutosave()`.
- `moveWorkspace(fromId, toId)` — `set({ order: reorderIds(order, fromId, toId) })`; `scheduleAutosave()`.
- `newWorkspace(name)` already returns the new id (used by the `+` flow to start inline rename).

## 5. UI — `WorkspaceTabs.tsx`

- **Inline rename:** local state `renamingId: string | null`. When a tab `id === renamingId`, render a
  focused `<input data-testid={`ws-rename-${id}`}>` instead of the button; `onKeyDown` Enter →
  `renameWorkspace(id, value)` + clear; Esc → clear; `onBlur` → commit. Otherwise render the button.
- **Context menu:** `onContextMenu` on a tab sets `menuFor: { id, x, y }`; render a fixed-position menu
  (`data-testid="ws-menu"`) with buttons **Rename** (`ws-menu-rename` → set `renamingId`), **Save**
  (`ws-menu-save` → `saveAll()`), **Close** (`ws-menu-close` → confirm-if-panes then `closeWorkspace`).
  A full-screen transparent backdrop closes the menu on click.
- **Name on create:** the `+` button → `const id = newWorkspace(`Workspace ${order.length + 1}`)`
  then `setRenamingId(id)`.
- **Drag-reorder:** each tab gets `draggable`, `onDragStart` (set dragged id), `onDragOver`
  (`preventDefault`), `onDrop` (`moveWorkspace(draggedId, id)`). A subtle drop indicator via a
  `dragOverId` highlight is optional.

## 6. Error handling

- Rename to blank/whitespace → keeps the existing name.
- Close on a workspace with panes → `window.confirm("Close workspace \"<name>\"? Its terminals will be closed.")`; declining aborts.
- Closing the active workspace → active moves to a neighbor (or a fresh workspace if none remain).
- Drag onto self or a non-tab → no-op.

## 7. Testing

- **Unit (vitest):** `reorderIds` — move forward/backward, no-op on equal/missing.
- **e2e (Playwright):**
  - *Rename:* right-click a tab → Rename → type a new name → Enter → the tab shows the new name; relaunch → name persisted.
  - *Close:* create a second workspace, close the first via the menu → one tab remains, the right one is active.
  - *Reorder:* with two workspaces, drag tab 2 before tab 1 → order swaps (assert tab text order).
  - *Name on create:* click `+` → an inline input is focused → type a name → Enter → the new tab shows it.

## 8. Non-goals

- No delete-of-the-saved-file (orphan JSON remains; deferred cleanup).
- No multi-select / bulk tab operations.
- No reordering across windows (single window).
