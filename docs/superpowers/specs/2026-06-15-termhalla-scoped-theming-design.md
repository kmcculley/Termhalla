# Termhalla — Scoped (Per-Entity) Theming — Design Spec

**Date:** 2026-06-15
**Status:** Approved (autonomous batch; recommended options chosen)
**Builds on:** the app-global theming just shipped (`2026-06-15-termhalla-ui-theming`).

## 1. Summary

Make themes **scoped**: customize the look of the **app** (default), an individual
**workspace**, or an individual **pane** (terminal / editor / explorer) — each as an
**override** layered on the ones below it. Also fix two issues in the current theming:
the **window background** color is invisible (covered by the mosaic), and the color picker
**lags** while dragging.

## 2. Decisions (recommended)

| Decision | Choice |
|---|---|
| Model | A theme **override** (`Partial<Theme>`) at three levels; the effective theme for a pane = `mergeTheme({ ...app, ...workspace, ...pane })`. |
| Persistence | App → `quick.theme` (exists). Workspace → `Workspace.theme?`. Pane → `PaneConfig.theme?` (all three pane kinds). Saved in the workspace JSON; captured by templates. |
| Application | CSS-variable **cascade**: full app vars on `:root`; the workspace's override vars on its host element; the pane's override vars on its tile element. Per-pane xterm/Monaco use the pane's **resolved** theme. |
| Window background | `--bg` is applied to the app root and the mosaic background/gutters so it's actually visible. |
| Editing | The `🎨` editor gains a **scope selector** (App · This workspace · each pane in the active workspace). Edits write to the selected scope; **Reset** clears that scope's override. |
| Live-edit performance | On `input` (drag) the picker writes the CSS variable **directly to the scope's element** (no store, no Monaco). On `change` (release) it commits to the store (persist + re-theme). |

## 3. Resolution

Pure `src/shared/theme.ts`:
- `resolveTheme(app: Partial<Theme> | undefined, ws: Partial<Theme> | undefined, pane:
  Partial<Theme> | undefined): Theme` = `mergeTheme({ ...app, ...ws, ...pane })`.
- `themeCssVarsPartial(partial: Partial<Theme>): Record<string, string>` — like `themeCssVars`
  but maps only the tokens present in `partial` (used for the override layers so the cascade
  falls through to the level below).

## 4. Types & persistence

- `Workspace.theme?: Partial<Theme>` (workspace JSON).
- A `theme?: Partial<Theme>` field on each pane config (`TerminalConfig`/`EditorConfig`/`ExplorerConfig`).
- `quick.theme` (app) unchanged.
- `serializeWorkspace`/`deserializeWorkspace` already round-trip arbitrary config objects (JSON), so
  no serializer change is needed beyond the type additions.

## 5. Store

- `setThemeScoped(scope: ThemeScope, patch: Partial<Theme>)` where
  `ThemeScope = { kind: 'app' } | { kind: 'workspace'; wsId } | { kind: 'pane'; wsId; paneId }`.
  Merges `patch` into that scope's override (`quick.theme`, `workspace.theme`, or `paneConfig.theme`),
  persisting via `scheduleQuickSave` (app) or `scheduleAutosave` (workspace/pane).
- `resetThemeScope(scope)` — clears that scope's override (app → `DEFAULT_THEME`; workspace/pane → delete the field).
- The existing `setTheme`/`resetTheme` become thin wrappers over the `app` scope; preset
  save/apply/delete stay app-scoped (named app themes).
- Selectors: `appTheme(s)`, `workspaceThemeOf(s, wsId)`, `paneThemeOf(s, wsId, paneId)`,
  and `resolvedPaneTheme(s, wsId, paneId)` (for xterm/Monaco).

## 6. Application

- **`ThemeProvider`** (app): writes the **full** app vars (`themeCssVars(mergeTheme(quick.theme))`)
  to `document.documentElement`. Monaco theme is defined from the app theme **debounced** (so live
  drags don't re-tokenize per tick).
- **Workspace host** (`App.tsx` host div): a small effect sets `themeCssVarsPartial(ws.theme)` on
  that element (and removes vars no longer overridden). Cascade overrides descendants.
- **Pane tile** (`WorkspaceView` tile div): sets `themeCssVarsPartial(pane.theme)` on the tile.
- **Terminal/editor instances:** `TerminalPane` applies `resolvedPaneTheme(...)` colors/font to xterm
  (live, no respawn — extend the existing theme effect to read the resolved pane theme); `EditorPane`
  defines a per-pane Monaco theme from its resolved theme and applies it to its editor (Monaco themes
  are global, so use a per-pane theme name and `setTheme` on focus / model set — acceptable: the
  active editor shows its pane theme; documented).
- **Window background visible:** `index.css` — `.mosaic, .mosaic-root, .mosaic-blueprint-theme {
  background: var(--bg) }` and the App root wrapper `background: var(--bg)`, so the gutters/empty areas
  show the window color.

## 7. ThemeEditor (scope + performance)

- A **scope `<select>`** (`data-testid="theme-scope"`): `App`, `This workspace`, and one entry per
  pane in the active workspace (`Terminal …` / `Editor …` / `Explorer …`, value = paneId). The shown
  control values reflect the **resolved** theme for that scope; editing writes the override at that scope.
- Each color picker: `onInput` → `applyLive(scopeElement, cssVar, value)` (direct
  `element.style.setProperty`, cheap, no React); `onChange` → `setThemeScoped(scope, { token: value })`.
  Font/size inputs commit on change. `Reset` → `resetThemeScope(scope)`.
- The scope's target element: app → `document.documentElement`; workspace → the active workspace host
  (`[data-testid="workspace-host"][data-ws="<activeId>"]`); pane → the tile
  (`[data-testid="tile-<paneId>"]`). Resolved by a tiny helper.

## 8. Error handling

- A scope with no override resolves to the level below (partials, `mergeTheme`); deleting an override
  reverts instantly.
- An old workspace/pane JSON without `theme` → `undefined` → no override (back-compatible).
- Per-pane Monaco theme define/set wrapped in try/catch.

## 9. Testing

- **Unit (vitest):** `resolveTheme` (app/ws/pane precedence; undefineds); `themeCssVarsPartial` (only
  present tokens, px on sizes).
- **e2e (Playwright):**
  - *Scoped override:* set the App window background to color X (assert `:root --bg` = X and the app
    root paints it); then set a **pane** terminal background to color Y via the scope selector and
    assert the tile's `--term-bg`/the resolved value differs from the app for that pane only.
  - *Persistence:* relaunch → the app + workspace + pane overrides persist.
  - *Window background:* assert the app root / mosaic background computed color reflects `--bg`.

## 10. Non-goals

- No per-pane **preset** library (presets remain app-scoped named themes).
- No cross-workspace pane theming (a pane's override lives with its workspace).
- No live xterm/Monaco preview during a color drag (chrome previews live; terminal/editor colors apply
  on release) — a deliberate performance trade-off.
