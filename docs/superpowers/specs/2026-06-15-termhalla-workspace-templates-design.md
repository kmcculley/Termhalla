# Termhalla — Workspace Layout Templates — Design Spec

**Date:** 2026-06-15
**Status:** Approved (autonomous batch; recommended options chosen)
**Builds on:** workspace model + `QuickStore` (quick.json) + workspace tab management, merged to `main`.

## 1. Summary

Save the **layout** of a workspace (its mosaic split tree + pane configs) as a named
**template**, and create new workspaces from a template — so a multi-pane setup (e.g. three
terminals + an editor) can be re-created in one click. Templates are offered when you make a
new workspace. Covers requested feature 3.

## 2. Decisions (recommended)

| Decision | Choice |
|---|---|
| What a template stores | The workspace's `layout` tree + `panes` (a blueprint); pane configs (shell/cwd/files/root) are kept. |
| Storage | App-global, in **`quick.json`** via `QuickStore` (a new `templates` array) — reuses the existing `quick:load`/`quick:save` IPC; **no new IPC**. |
| Instantiation | Remap every pane id to a fresh uuid (consistently in the layout tree and the panes map); rendering the new panes spawns their terminals/opens their files (same as restore). |
| Trigger | A `▾` templates button next to `+` in the tab bar opens a menu: save the active workspace as a template (inline name input), list templates (click → new workspace from it), and delete (×). |
| Naming | New-from-template creates the workspace then drops it into inline rename (reuses sub-project B). |
| Prompt | Inline text input (Electron disables `window.prompt`). |

## 3. Pure core (testable)

In `src/shared/workspace-model.ts`:
- `remapPaneIds(layout: MosaicNode | null, panes: Record<string, PaneNode>, uuid: () => string):
  { layout: MosaicNode | null; panes: Record<string, PaneNode> }` — assign each existing pane id a
  fresh id, rewriting the layout-tree leaves and the panes map (and each `PaneNode.paneId`). Pure.
- `templateFromWorkspace(ws: Workspace, id: string, name: string): WorkspaceTemplate` —
  `{ id, name, layout: ws.layout, panes: ws.panes }` (deep enough copy via structured rebuild).
- `workspaceFromTemplate(tpl: WorkspaceTemplate, wsId: string, name: string, uuid): Workspace` —
  remap ids, return `{ id: wsId, name, layout, panes }`.

## 4. Types

```ts
export interface WorkspaceTemplate {
  id: string
  name: string
  layout: MosaicNode | null
  panes: Record<string, PaneNode>
}
```
Add `templates: WorkspaceTemplate[]` to the `QuickStore` interface and to `EMPTY_QUICK`;
`normalizeQuick` (main) coerces `templates` to an array (drop if not).

## 5. Store

- `saveTemplate(name)` — `templateFromWorkspace(activeWorkspace, uuid(), name.trim())` pushed onto
  `quick.templates`; `scheduleQuickSave()`. No-op on blank name / no active workspace.
- `deleteTemplate(id)` — filter it out of `quick.templates`; `scheduleQuickSave()`.
- `newWorkspaceFromTemplate(templateId, name)` — find the template; `workspaceFromTemplate(...)` →
  add to `workspaces`/`order`, set `activeId`; `scheduleAutosave()`; return the new id (for inline rename).

## 6. UI — `TemplatesMenu.tsx` + a button in `WorkspaceTabs`

- A `▾` button (`data-testid="templates-button"`) next to `+` toggles `TemplatesMenu`.
- `TemplatesMenu` (`data-testid="templates-menu"`): a "Save current as template" row (an
  `<input data-testid="tpl-name">` + `Save` `tpl-save`), then the list — each template is a row
  with the name (`data-testid="tpl-<id>"`, click → `newWorkspaceFromTemplate` then start rename of
  the new ws) and a `×` (`tpl-del-<id>` → `deleteTemplate`). Empty → "No templates yet."
- Click-away backdrop closes the menu. Saving/instantiating closes it.

## 7. Error handling

- Save with blank name / no active workspace → no-op (Save disabled when name blank).
- A template referencing shells/paths that no longer exist instantiates anyway (terminals fall back
  to the default shell via existing spawn logic; missing editor files show the existing "(deleted)"
  state) — no special handling.
- `remapPaneIds` on an empty workspace (`layout: null`, `panes: {}`) yields the same (creates a blank
  workspace from a blank template).

## 8. Testing

- **Unit (vitest):** `remapPaneIds` (fresh ids in tree + map, structure preserved, paneId fields
  updated; null/empty passthrough); `workspaceFromTemplate` (new id/name, remapped panes).
- **e2e (Playwright):** open a workspace, split into two terminals, save as a template (name it),
  open the templates menu and create a new workspace from it → the new workspace has **two**
  terminal tiles.

## 9. Non-goals

- No template editing (delete + re-save instead).
- No export/import of templates to a file.
- No per-template default shell override beyond what the captured configs already hold.
