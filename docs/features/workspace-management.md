# Workspace Tab Management

> Right-click a workspace tab for Rename / Save / Close, name a new workspace the moment you create it, and drag tabs to reorder them.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-workspace-management-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-workspace-management.md)

## What it does

- **Right-click a workspace tab** → a context menu with **Rename**, **Save**, **Close**.
- **Rename** inline — the tab becomes a text input with the existing name **pre-selected** (type to replace; Enter/blur commits, Esc cancels, blank keeps the old name). Double-clicking a tab also starts a rename.
- **Name on creation** — clicking `+` creates the workspace and immediately drops its tab into rename mode, so you can type the name right away.
- **Drag to reorder** — hold the left mouse button on a tab and drop it on another to reorder.
- **Close** removes the workspace, closing its terminals; it asks for confirmation only when the workspace has panes, and if you close the last one a fresh empty workspace is created.

## How it works

Pure `reorderIds(order, fromId, toId)` (`src/shared/workspace-model.ts`) moves a tab in the order array. Store actions (`store.ts`): `renameWorkspace` (trim, ignore blank), `closeWorkspace` (kills terminal PTYs + `usageUnwatch`, deletes the workspace's entries from the `statuses/cwds/procs/aiSessions/usage` maps — the same cleanup as `closePane` — picks a neighbor as active, and creates a fresh workspace if none remain), and `moveWorkspace` (via `reorderIds`). `WorkspaceTabs.tsx` holds the local UI state (`renamingId`, `menuFor`, `draggedId`), renders an `<input>` in place of a tab while renaming, a fixed-position context menu with a click-away backdrop, and native HTML5 drag-and-drop on the tab buttons. "Save" reuses the existing `saveAll()`.

## Key files

| File | Responsibility |
|---|---|
| `src/shared/workspace-model.ts` | pure `reorderIds` |
| `src/renderer/store.ts` | `renameWorkspace` / `closeWorkspace` / `moveWorkspace` |
| `src/renderer/components/WorkspaceTabs.tsx` | tabs, inline rename, context menu, name-on-create, drag |

## Behaviors & edge cases

- Rename to blank/whitespace keeps the current name.
- Closing a workspace with panes confirms first; closing the active one moves to a neighbor; closing the last creates a fresh `Workspace 1`.
- Closing leaves the saved workspace JSON on disk (restore loads only `openWorkspaceIds`, so it is not reloaded) — orphan cleanup is deferred.
- Drag onto self or a non-tab is a no-op.

## Testing

- **Unit:** `tests/shared/workspace-reorder.test.ts` (`reorderIds` forward/backward/no-op).
- **e2e:** `tests/e2e/workspace-mgmt.spec.ts` — name-on-create focuses the inline input; context-menu rename persists across relaunch; close removes the tab. (Native drag is covered by the unit test, not e2e.)

## Related

- [Architecture](../architecture.md) · [Workspaces](workspaces.md)
