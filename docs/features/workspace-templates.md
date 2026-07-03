# Workspace Layout Templates

> Save a workspace's pane layout as a named template and create new workspaces from it in one click.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-workspace-templates-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-workspace-templates.md)

## What it does

The `▾` button next to `+` in the tab bar opens the **templates menu**. There you can **Save current** (capture the active workspace's split layout + pane configs under a name) and pick any saved template to **create a new workspace** from it (which then opens in inline rename). Each template has a `×` to delete it. Templates are app-global and persist in `quick.json`.

Since feature 0011 the menu also carries a **built-in first row** — `Orky project cockpit…` (`tpl-orky-cockpit`) — above the saved templates. It is chrome, not a saved template: always rendered, never deletable, never persisted; activating it opens the per-project Orky cockpit gesture (see [orky-workspace-template](orky-workspace-template.md)). The "No templates yet." copy still refers to saved templates and may co-render with the built-in row.

## How it works

Pure helpers in `src/shared/workspace-model.ts`: `templateFromWorkspace(ws, id, name)` deep-copies the workspace's `layout` tree + `panes` into a `WorkspaceTemplate`; `workspaceFromTemplate(tpl, wsId, name, uuid)` instantiates a fresh workspace, using `remapPaneIds` to assign every pane a new uuid (consistently across the layout-tree leaves and the panes map) so instances never share ids. Templates live in `QuickStore.templates` (`quick.json`), reusing the existing `quick:load`/`quick:save` IPC — no new IPC. Store actions: `saveTemplate`, `deleteTemplate`, `newWorkspaceFromTemplate`. `TemplatesMenu.tsx` is the dropdown; `WorkspaceTabs.tsx` hosts the `▾` button and passes its `startRename` so a new-from-template workspace opens in rename. Rendering the new workspace's panes spawns their terminals / opens their files (same path as restore).

## Key files

| File | Responsibility |
|---|---|
| `src/shared/types.ts` | `WorkspaceTemplate`; `templates` on `QuickStore`/`EMPTY_QUICK` |
| `src/shared/workspace-model.ts` | pure `remapPaneIds` / `templateFromWorkspace` / `workspaceFromTemplate` |
| `src/main/persistence/quick-store.ts` | `normalizeQuick` coerces `templates` to an array |
| `src/renderer/store.ts` | `saveTemplate` / `deleteTemplate` / `newWorkspaceFromTemplate` |
| `src/renderer/components/TemplatesMenu.tsx` | the templates dropdown |
| `src/renderer/components/WorkspaceTabs.tsx` | the `▾` button |

## Behaviors & edge cases

- A template captures pane configs (shell/cwd/files/root); instantiating re-creates them. Stale shells fall back to the default; missing editor files show the existing "(deleted)" state.
- A blank-named save (or no active workspace) is a no-op.
- Templates deep-copy on capture, so later edits to the source workspace don't mutate the template.
- Since feature 0011, `newWorkspaceFromTemplate` reports the instantiated workspace into main's authoritative window arrangement (`reportAssignment` over the existing `winReport` channel), so a menu-instantiated workspace survives assignment pushes (window reload, promotion, move) and quit→relaunch instead of being silently lost.

## Testing

- **Unit:** `tests/shared/workspace-template.test.ts` (`remapPaneIds` fresh-ids/passthrough; capture→instantiate; deep-copy isolation).
- **e2e:** `tests/e2e/workspace-templates.spec.ts` — build a 2-terminal workspace, save as a template, create a new workspace from it, assert the new (active) workspace has two terminals.

## Related

- [Architecture](../architecture.md) · [Workspaces](workspaces.md) · [Workspace tab management](workspace-management.md)
