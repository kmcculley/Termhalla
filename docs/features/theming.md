# UI Theming

> Customize the whole app's look — window/panel/text/accent/alert/terminal colors, fonts and sizes — and persist it, with named presets.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-ui-theming-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-ui-theming.md)

## What it does

The `🎨` button in the workspace tab bar opens the **Theme** editor. Pick colors for the window background, toolbars/panels, menus & dialogs, borders, text, dim text, accent (active/selection), the busy/needs-input **alert** colors, and the terminal background/foreground; set the UI font & size and the terminal font & size. Changes apply **live**. Save the current look as a named **preset**, switch between presets, or **Reset to default**. The active theme and your presets persist in `quick.json` and survive restarts.

## How it works

A `Theme` (15 tokens) in `src/shared/theme.ts` with `DEFAULT_THEME` (today's dark look), `mergeTheme(partial)` (fills missing tokens — forward-compatible), and `themeCssVars(theme)` (token → `--bg`/`--panel`/`--elevated`/`--border`/`--fg`/`--fg-dim`/`--accent`/`--status-busy`/`--status-needs`/`--font`/`--font-size`/…). `ThemeProvider` (mounted first in `App`) writes those variables onto `document.documentElement` and defines/selects a Monaco theme from the tokens. The renderer chrome and `index.css` reference `var(--token, fallback)`, so changing a token restyles every surface; the status-bar alert keyframes pulse the themed `--status-busy`/`--status-needs`. `TerminalPane` builds each xterm with the theme's colors/font and **live-updates** them on theme change without respawning the PTY. The active theme is `quick.theme` (a `Partial<Theme>`); store actions `setTheme`/`resetTheme`/`saveThemePreset`/`applyThemePreset`/`deleteThemePreset` persist to `quick.json` via the existing `quick:save` (no new IPC).

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
- The theme is app-global; presets act as the "templates" for saved looks.

## Testing

- **Unit:** `tests/shared/theme.test.ts` (`mergeTheme` defaults/overrides; `themeCssVars` keys + `px` on sizes).
- **e2e:** `tests/e2e/theme.spec.ts` — change the window background via the editor (assert `--bg` updates live), save a preset, reset, re-apply the preset, then relaunch and assert the theme persisted.

## Non-goals (this version)

- No full ANSI 16-color terminal palette (background/foreground/font only); no per-workspace themes; no theme file import/export; no OS light/dark auto-switch.

## Related

- [Architecture](../architecture.md) · [Status & alerts](status-engine.md) (alert colors) · [Editor & explorer](editor-explorer.md) (Monaco theme)
