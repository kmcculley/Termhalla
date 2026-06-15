# Termhalla — Customizable UI Theming — Design Spec

**Date:** 2026-06-15
**Status:** Approved (autonomous batch; recommended options chosen)
**Builds on:** the whole renderer UI + `QuickStore` (quick.json), all merged to `main`.

## 1. Summary

Let the user customize the look of the whole app — window/background colors, toolbar &
panel colors, text font/size/color, accent, borders, alert (status) colors, and terminal
colors/font — and **persist** it across restarts, with **named theme presets** ("templates")
you can save/switch/delete. Implemented as a set of design **tokens** applied through **CSS
custom properties**, so changing a token restyles every surface that references it; xterm and
Monaco are themed from the same tokens.

## 2. Decisions (recommended)

| Decision | Choice |
|---|---|
| Mechanism | Design **tokens** → **CSS variables** on `:root`; components and `index.css` use `var(--token)`. |
| Token application | A `ThemeProvider` effect sets `document.documentElement.style.setProperty('--x', …)` for each token and re-applies on change. |
| Terminal/editor | xterm `Terminal.options.theme`/font driven by tokens (live-updated per terminal); Monaco via `monaco.editor.defineTheme('termhalla', …)` + `setTheme`, redefined on change. |
| Persistence | App-global in **`quick.json`**: `theme` (the active theme) + `themePresets` (named saved themes). Reuses `quick:load`/`quick:save` — no new IPC. |
| Editing | A **Theme editor** panel (color/font/size controls, live preview), opened from a `🎨` tab-bar button; Save-as-preset, switch preset, Reset to default. |
| Defaults | `DEFAULT_THEME` = the current dark values; partial/old persisted themes are merged over defaults. |

## 3. The Theme (tokens)

```ts
export interface Theme {
  windowBg: string          // --bg          whole window / workspace background
  panelBg: string           // --panel       toolbars, tab bar, status bar, workspace buttons
  elevatedBg: string        // --elevated    menus & dialogs
  border: string            // --border
  text: string              // --fg          primary text
  textDim: string           // --fg-dim      secondary text
  accent: string            // --accent      active tab / selection / focus
  statusBusy: string        // --status-busy     busy alert color
  statusNeedsInput: string  // --status-needs    needs-input alert color
  fontFamily: string        // --font        UI font
  fontSize: number          // --font-size   UI base size (px)
  termBg: string            // terminal background
  termFg: string            // terminal foreground
  termFontFamily: string    // terminal font
  termFontSize: number      // terminal size (px)
}
```
`DEFAULT_THEME` mirrors today's look (`windowBg:'#1e1e1e'`, `panelBg:'#1e1e1e'`,
`elevatedBg:'#252526'`, `border:'#444'`, `text:'#eee'`, `textDim:'#aaa'`, `accent:'#1e88e5'`,
`statusBusy:'#1e88e5'`, `statusNeedsInput:'#ff8f00'`, `fontFamily:"'Segoe UI', sans-serif"`,
`fontSize:13`, `termBg:'#000000'`, `termFg:'#ffffff'`, `termFontFamily:"'Consolas', monospace"`,
`termFontSize:13`).

## 4. Pure core (testable) — `src/shared/theme.ts`

- `DEFAULT_THEME: Theme`.
- `mergeTheme(partial: Partial<Theme> | undefined): Theme` — defaults filled in (forward-compatible
  with older persisted themes missing tokens).
- `themeCssVars(theme: Theme): Record<string, string>` — `{ '--bg': theme.windowBg, '--panel': …,
  '--font-size': `${theme.fontSize}px`, … }` (UI tokens only; terminal/editor handled separately).

## 5. Persistence (`QuickStore` / quick.json)

Add to the `QuickStore` interface + `EMPTY_QUICK` + `normalizeQuick`:
```ts
theme?: Partial<Theme>                                  // active theme (partial → merged with defaults)
themePresets: { id: string; name: string; theme: Theme }[]
```
`normalizeQuick` coerces `themePresets` to an array and passes `theme` through (an object or undefined).

## 6. Store

- `theme` is derived in selectors via `mergeTheme(quick.theme)` (no separate state field; the source of
  truth is `quick.theme`).
- `setTheme(patch: Partial<Theme>)` — `quick.theme = { ...mergeTheme(quick.theme), ...patch }`; `scheduleQuickSave()`.
- `resetTheme()` — `quick.theme = { ...DEFAULT_THEME }`; save.
- `saveThemePreset(name)` — push `{ id: uuid(), name, theme: mergeTheme(quick.theme) }` to `themePresets`; save.
- `applyThemePreset(id)` — `quick.theme = { ...preset.theme }`; save.
- `deleteThemePreset(id)` — filter it out; save.

## 7. Applying the theme

`ThemeProvider.tsx` (renders null, mounted once in `App`):
- Reads `theme = mergeTheme(quick.theme)`.
- Effect on `[theme]`: for each entry of `themeCssVars(theme)`, `documentElement.style.setProperty(k, v)`;
  also set `--term-bg`/`--term-fg`/`--term-font`/`--term-font-size` (used by the terminal host) and
  define+select the Monaco theme `monaco.editor.defineTheme('termhalla', { base:'vs-dark', colors:{
  'editor.background': termBg, 'editor.foreground': termFg }})` + `setTheme('termhalla')`.
- `index.html`/`index.css`: `body`/`#root` use `var(--bg)`/`var(--fg)`/`font-family:var(--font)`/
  `font-size:var(--font-size)`; the status keyframes use `var(--status-busy)`/`var(--status-needs)`.
- **xterm**: `TerminalPane` builds the `Terminal` with `theme:{ background: termBg, foreground: termFg }`,
  `fontFamily: termFontFamily`, `fontSize: termFontSize` from the current theme, and a separate effect
  live-updates `term.options.theme`/`fontFamily`/`fontSize` (+ `fit`) when the theme changes — without
  re-spawning the PTY.

## 8. UI token sweep

Replace the hardcoded colors/sizes in the renderer with `var(--token)` (fallbacks preserve today's look):
`index.css` (status colors), `WorkspaceTabs`, `WorkspaceView`, `StatusBar`, `BroadcastDialog`,
`ScheduleDialog`, `TemplatesMenu`, `CommandPalette`, `SshConnectionForm`, `TerminalSettings`,
`EditorPane`/`ExplorerPane` chrome. The recurring map: `#1e1e1e→var(--panel)`, `#252526→var(--elevated)`,
`#444→var(--border)`, `#eee/#ddd→var(--fg)`, `#333→var(--accent)` (active), text → `var(--fg)`.
(Some deep one-off colors may remain with sensible fallbacks; noted in follow-ups.)

## 9. Theme editor UI — `ThemeEditor.tsx`

- A `🎨` button (`data-testid="theme-button"`) in `WorkspaceTabs` toggles the editor (a side panel/modal).
- Controls (live — each change calls `setTheme`): an `<input type="color">` + hex text for each color token
  (`theme-<token>`), a font-family text input (`theme-fontFamily`), number inputs for `fontSize`/`termFontSize`,
  and term color/font controls. A live preview is automatic (CSS vars apply immediately).
- Preset row: a name input + **Save preset** (`theme-save-preset`), a list of presets (click to apply
  `theme-preset-<id>`, `×` to delete), and **Reset to default** (`theme-reset`).

## 10. Error handling

- A persisted theme missing tokens → `mergeTheme` fills defaults (no crash on upgrade).
- An invalid color string is applied as-is to the CSS var (browser ignores invalid values, falling back to
  the inherited/var fallback) — non-fatal.
- Monaco theme define/set is wrapped so a failure never breaks the editor.

## 11. Testing

- **Unit (vitest):** `mergeTheme` (fills missing tokens; overrides; undefined → defaults); `themeCssVars`
  (correct `--token` keys incl. `px` suffix on sizes).
- **e2e (Playwright):** open the theme editor, change the window background color (and UI font size), assert
  a CSS variable on `document.documentElement` updated and the tab bar reflects it; save as a preset, Reset,
  then apply the preset → the color returns. Relaunch with the same `--user-data-dir` → the customized theme
  persists.

## 12. Non-goals

- No full ANSI 16-color palette editor for terminals (background/foreground/font only this version).
- No per-workspace themes (app-global theme; presets cover "templates").
- No import/export of theme files (presets live in quick.json).
- No light/dark auto-switching by OS.
