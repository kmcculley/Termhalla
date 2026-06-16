# UI Polish — Phase 1: Design-token & visual-consistency foundation

**Date:** 2026-06-16
**Status:** Implemented
**Part of:** UI polish + QoL initiative (Phase 1 of 4). Later phases: 2 = feedback &
micro-QoL, 3 = keyboard/a11y + command palette, 4 = unified Settings panel. Light
mode was explicitly cut.

## Goal

Eliminate hardcoded design values scattered through the renderer and route them
through a single token layer, so the UI is visually consistent and every later
phase has tokens to build on. No new features, no behavior change, minimal
regression risk.

## Non-goals

- No changes to the user-editable `Theme` type, the theme editor, persistence, or
  `SCHEMA_VERSION`. (Adding user-facing tokens is out of scope and high-cost; see
  "Key decision".)
- No keyboard navigation logic (Phase 3) — Phase 1 only adds the *visual* focus
  ring where one is missing.
- No toast system, context menus, or settings panel (Phases 2 & 4).

## Key decision: derived `:root` tokens, not new `Theme` fields

The existing theme system maps a fixed `Theme` interface → CSS vars
(`src/shared/theme.ts`), and every field is user-editable + persisted + migrated.
Adding new *persisted* tokens would touch `types.ts`, `theme.ts`, `ThemeEditor`,
the `VAR_OF` map, and migration — heavy, and these new values aren't things users
should tune.

Instead, Phase 1 introduces a layer of **static/derived design tokens defined once
in `:root` in `index.css`**, derived from the existing user tokens via
`color-mix()` where they should track the theme. This keeps persistence untouched
and is pure CSS. (Electron's Chromium supports `color-mix(in srgb, …)`.)

New `:root` tokens:

| Token | Value | Replaces |
|---|---|---|
| `--mono` | `'Consolas', 'Cascadia Mono', monospace` | the 8 hardcoded `'Consolas, monospace'` literals |
| `--radius` / `--radius-lg` | `4px` / `6px` | scattered `borderRadius: 4/6` |
| `--shadow-pop` | `0 4px 16px rgba(0,0,0,0.4)` | (none — popovers gain depth) |
| `--shadow-modal` | `0 8px 32px rgba(0,0,0,0.5)` | inline shadow on `CommandPalette` |
| `--sel-bg` | `color-mix(in srgb, var(--accent) 32%, transparent)` | `#094771` selected palette item |
| `--warn-bg` | `color-mix(in srgb, var(--status-needs) 30%, var(--elevated))` | `#5a4a00` editor reload bar |
| `--warn-fg` | `var(--fg)` | `#fff` on the reload bar |
| `--dim` / `--dimmer` | `0.7` / `0.5` | the spread of `opacity: 0.45/0.5/0.6/0.7/0.8/0.9` text |

Secondary **text** that is purely dimmed (no colored content underneath) switches
from `opacity:` to `color: var(--fg-dim)` (already a token). The `--dim`/`--dimmer`
opacity tokens are for the remaining cases that dim mixed/colored content.

## Concrete change list

Grounded in the current source (file:line as of this spec):

**Colors → tokens**
- `CommandPalette.tsx:83` — selected `background: '#094771'` → `var(--sel-bg)`.
- `EditorPane.tsx:23` — "too large" `color: '#bbb'` → `var(--fg-dim)`.
- `EditorPane.tsx:25` — reload bar `#5a4a00`/`#fff` → `var(--warn-bg)`/`var(--warn-fg)`.
- `StatusBar.tsx:22` — `color: '#bbb'` → `var(--fg-dim)`.

**Monospace → `--mono`** (drop hardcoded family + size, inherit size where sensible):
`BroadcastDialog.tsx:35`, `ScheduleDialog.tsx:43,75`, `ExplorerPane.tsx:78`,
`ProcessPopover.tsx:33`, `StatusBar.tsx:35`, `EnvManager.tsx:16,115`.

**Dim text** — convert pure-text `opacity:` spans to `color: var(--fg-dim)`
(`ProcessPopover`, `TemplatesMenu`, `StatusBar`, `CommandPalette` "No matches",
`BroadcastDialog` labels, `SshConnectionForm`); keep `--dim`/`--dimmer` for the
layered cases (`ProcessPopover.tsx:48` command-on-name).

**Depth/shadow**
- `Modal.tsx` `CARD_BASE` gains `boxShadow: 'var(--shadow-modal)'`; remove the inline
  `boxShadow` override in `CommandPalette.tsx:64`.
- `Modal.tsx` `SURFACE` gains `boxShadow: 'var(--shadow-pop)'` so in-tile popovers
  and dropdown menus get consistent depth.

**Transitions** — add a `@keyframes ui-pop-in` (opacity 0→1, translateY 4px→0,
~120ms) in `index.css`, applied to the modal card and `SURFACE` popovers via a
shared class. Respect `@media (prefers-reduced-motion: reduce)` (no transform).

**Overflow / ellipsis**
- `index.css` — `.mosaic-window-title` gets `overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap` so long pane titles truncate instead of pushing toolbar
  buttons off.

**Scrollbars**
- `index.css` — add `[data-testid^="explorer-"]` to the themed-scrollbar `:is(…)`
  list (explorer currently uses the default browser scrollbar).

**Visual focus ring (no nav logic)**
- `index.css` — workspace tabs (`[data-testid^="tab-"]`) get the same
  `:focus-visible` outline treatment as other chrome controls. Keyboard *movement*
  between tabs is Phase 3.

**Spacing** — replace the `depth * 14` indent literal in `ProcessPopover.tsx:46`
and `ExplorerPane` tree with a shared `INDENT_PX` constant in a new tiny
`src/renderer/ui-tokens.ts` (JS-side numeric tokens that CSS vars can't express for
computed `paddingLeft`). Keep this module minimal — only values that must be
numbers in JS.

## Architecture / where things live

- `src/renderer/index.css` — `:root { … }` token block at top; new keyframes;
  ellipsis + scrollbar + focus-ring selectors. This is the bulk of the change.
- `src/renderer/components/Modal.tsx` — `CARD_BASE`/`SURFACE` shadow; pop-in class.
- `src/renderer/ui-tokens.ts` (new) — `INDENT_PX` and any other JS-numeric tokens.
- Per-component inline-style edits as listed above.

No IPC, no main-process, no store changes. `src/shared/theme.ts` and `types.ts`
untouched.

## Testing

Per CLAUDE.md TDD. The work is mostly CSS/inline-style, so:

1. **Guard test (unit, vitest) — `tests/ui-no-hardcoded-literals.test.ts` (new).**
   Reads the renderer source and asserts the specific banned literals are gone:
   `#094771`, `#5a4a00`, `'Consolas, monospace'` (and the `#bbb` text colors). This
   is the TDD anchor — write it first, watch it fail, then make the edits. It also
   prevents regressions.
2. **Pure unit — `ui-tokens.ts`.** Trivial but unit-test `INDENT_PX` is exported and
   used (guards against re-introducing the magic number). Light.
3. **e2e — extend `tests/e2e/editor.spec.ts` (or a new `ui-polish.spec.ts`).**
   - Regression: editor still renders correct file after model switch (the Monaco
     layout gotcha — the CSS touches `.mosaic-window-title`, a toolbar sibling, so
     re-confirm the existing guard passes).
   - Assert a dialog card's computed `box-shadow` is non-`none` (shadow applied).
   - Assert the command palette selected item's computed `background-color` is the
     accent-derived color, not the old `#094771` (i.e. tracks `--accent`).
4. `npm run typecheck` + full `npm test` + `npm run build && npm run e2e` green
   before done.

## Load-bearing gotchas respected

- **`.mosaic-window-title` ellipsis is paint/layout-safe**: it changes only the
  title flex child, not the editor-tabs strip (the documented Monaco-perturbation
  surface). e2e editor regression confirms.
- **No `font-size` on `body`** — `--mono` only sets `font-family`; per-surface
  `font-size` stays as-is.
- **`color-mix` fallback**: each `color-mix()` token ships with the existing
  literal as the CSS fallback value where a var is used, so an unsupported engine
  degrades to today's look rather than breaking.

## Risks

- Low. Largest risk is a `color-mix` token reading visually off; mitigated by
  tuning the mix percentages during implementation against the running app.
- `--mono` dropping the explicit `fontSize: 13` on some surfaces could change their
  size if the surface had no other size set; each edit preserves the existing
  `fontSize` where one was present.
