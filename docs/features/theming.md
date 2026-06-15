# UI Theming

> Customize the whole app's look — window/panel/text/accent/alert/terminal colors, fonts and sizes — and persist it, with named presets.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-ui-theming-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-ui-theming.md)

## What it does

The `🎨` button in the workspace tab bar opens the **Theme** editor. Pick colors for the window background, toolbars/panels, menus & dialogs, borders, text, dim text, accent (active/selection), the busy/needs-input **alert** colors, and the terminal background/foreground; set the UI font & size and the terminal font & size. Changes apply **live**. Save an **App preset**, switch presets, or **Reset this scope**. Everything persists across restarts.

### Scope (per-entity)

A **Scope** selector chooses what your edits apply to, layered as overrides: **App (default)** (base theme, in `quick.json`), **This workspace** (overrides the app theme for the active workspace, in the workspace JSON), or **a pane** (terminal / editor / explorer — overrides for that pane only, in its config). A pane's effective look = `app ← workspace ← pane` (nearest wins). "Reset this scope" clears just that level; presets are named **app**-level themes.

## How it works

A `Theme` (15 tokens) in `src/shared/theme.ts` with `DEFAULT_THEME`, `mergeTheme(partial)`, `resolveTheme(app, ws, pane)` (layered override resolution), `themeCssVars(theme)` (full token → `--bg`/`--panel`/…/`--term-font-size`), and `themeCssVarsPartial(partial)` (only the present tokens — for override layers). Application is a **CSS-variable cascade**: `ThemeProvider` writes the full app vars onto `document.documentElement` (and defines the Monaco theme, **debounced** so color drags don't re-tokenize per tick); each workspace **host** element and each pane **tile** element spread their override vars (`themeCssVarsPartial`) into their inline `style` as custom properties, so the nearest level wins for any descendant. Per-pane terminals/editors read `resolveTheme(app, ws, pane)`: `TerminalPane` live-updates its xterm colors/font (no PTY respawn); `EditorPane` defines a per-pane Monaco theme (`termhalla-<paneId>`) and `updateOptions({ theme })` so panes don't fight over Monaco's global theme. The window background (`--bg`) is painted on the app root and the mosaic background/gutters so it's actually visible. Store: `setThemeScoped(scope, patch)` / `resetThemeScope(scope)` write to `quick.theme` (app), `Workspace.theme` (workspace), or `PaneConfig.theme` (pane); app presets via `saveThemePreset`/`applyThemePreset`/`deleteThemePreset`. The editor previews live by writing the CSS variable directly to the scope's element on `input`, committing to the store on `change`.

## Key files

| File | Responsibility |
|---|---|
| `src/shared/theme.ts` | `Theme` tokens, `DEFAULT_THEME`, `mergeTheme`, `themeCssVars` |
| `src/shared/types.ts` | `Theme`; `theme`/`themePresets` on `QuickStore` |
| `src/renderer/components/ThemeProvider.tsx` | applies CSS variables + the Monaco theme |
| `src/renderer/components/ThemeEditor.tsx` | the editor panel (live edit, presets, reset) |
| `src/renderer/components/TerminalPane.tsx` | xterm colors/font from the theme (live) |
| `src/renderer/index.css` | base body + themed status/alert CSS via `var()` |
| `src/renderer/store.ts` | theme + preset actions |

## Behaviors & edge cases

- An unset theme = the default look (every swept `var(--token, original)` keeps its original fallback).
- An old persisted theme missing tokens is filled by `mergeTheme` — no crash on upgrade.
- Color pickers always produce `#rrggbb`; the Monaco theme define/set is wrapped so a bad color never breaks the editor.
- Themes are scoped (app / workspace / pane), resolved nearest-wins; app presets are the named saved looks.
- **UI text-size** (`--font-size`) is applied per chrome surface (tab bar, status bar, dialogs), **not** on `body` — a global `body` font-size corrupts Monaco's char-width measurement and breaks editor model-switch rendering.
- **Per-pane editor theming** only colors the editor's background/foreground (Monaco base `vs-dark` for syntax); each editor uses its own named Monaco theme so panes don't conflict.
- The window background (`--bg`) shows on the app root and the mosaic gutters/empty areas (panes paint their own backgrounds over the rest).

## Testing

- **Unit:** `tests/shared/theme.test.ts` (`mergeTheme`; `themeCssVars`/`themeCssVarsPartial` keys + `px`; `resolveTheme` app<workspace<pane precedence).
- **e2e:** `tests/e2e/theme.spec.ts` (app theme: change window bg, preset save/reset/apply, persist) and `tests/e2e/scoped-theme.spec.ts` (app vs per-pane override — the pane override lands on its tile, not `:root`; both persist across relaunch).

## Non-goals (this version)

- No full ANSI 16-color terminal palette (terminal background/foreground/font only); no per-pane preset library (presets are app-scoped); no theme file import/export; no OS light/dark auto-switch.

## Related

- [Architecture](../architecture.md) · [Status & alerts](status-engine.md) (alert colors) · [Editor & explorer](editor-explorer.md) (Monaco theme)
