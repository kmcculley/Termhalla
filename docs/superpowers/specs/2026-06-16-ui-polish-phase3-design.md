# UI Polish — Phase 3: Keyboard & a11y + command palette

**Date:** 2026-06-16
**Status:** Design — pending review
**Part of:** UI polish + QoL initiative (Phase 3 of 4). Phases 1 (tokens) and 2
(feedback) are merged. Phase 4 = unified Settings panel.

## Goal

Make the app keyboard-operable and more screen-reader-correct: expand the command
palette into a real command menu (typed-to-reveal), add a curated set of
collision-safe global shortcuts via a pure keymap, give the workspace-tab strip
real arrow-key navigation + tab roles, and close the obvious ARIA gaps.

## What already exists (do NOT rebuild)

- **Palette keyboard nav** — Esc / ArrowUp / ArrowDown / Enter all work
  (`CommandPalette.tsx:53`). The `PaletteItem` union already has a
  `kind: 'action'` variant with two actions (`new-connection`, `pin-cwd`) and a
  dispatch switch (`CommandPalette.tsx:46`). Substring filter
  (`filterPaletteItems`).
- **Two global shortcuts** — Ctrl+K (palette), Ctrl+Shift+Enter (broadcast) in an
  inline `App.tsx` keydown handler (`App.tsx:55`).
- **Dialog ARIA** — command palette + SSH form have `role="dialog"`/`aria-modal`.
  Tabs are `<button>`s with a Phase-1 `:focus-visible` ring but no roles/nav.

## Decisions (from brainstorming)

1. Palette commands are **typed-to-reveal**: hidden when the query is empty, shown
   (and filtered) once the user types. The existing two actions stay always-shown.
2. Global shortcuts use a **curated, terminal-collision-safe** scheme
   (Ctrl+Shift+letter, Ctrl+number, Ctrl+Tab).
3. **Pane-to-pane focus navigation is cut** (react-mosaic is render-only; not worth
   the store/geometry cost). This is why "close pane" maps to "close workspace".

## Components

### 1. Command palette → command menu

**`@shared/quick.ts`** — extend the `action` union and add a pure builder:

```ts
export type PaletteItem =
  | { kind: 'connection'; … }
  | { kind: 'dir'; … }
  | { kind: 'action'; action: PaletteAction; label: string; search: string }

export type PaletteAction =
  | 'new-connection' | 'pin-cwd'        // existing, always-shown
  | 'new-terminal' | 'new-editor' | 'new-explorer'
  | 'new-workspace' | 'broadcast' | 'save-all' | 'refresh-cloud'

/** Command items appended only when the palette query is non-empty. Pure list. */
export function buildCommandItems(): PaletteItem[]
```

`buildCommandItems` returns the 7 command items with rich `search` strings
(e.g. `'new terminal pane shell'`, `'broadcast send all terminals'`).

**`CommandPalette.tsx`** — when `query.trim()` is non-empty, append
`buildCommandItems()` to the base list before filtering:

```ts
const base = buildPaletteItems(quick, currentCwd)
const all = query.trim() ? [...base, ...buildCommandItems()] : base
const items = filterPaletteItems(all, query)
```

`activate()` gains arms for the new actions, dispatching existing store actions
with active-workspace defaults (mirroring `WorkspaceTabs`'s add-pane logic — target
= first pane if the ws has a layout, else null):

- `new-terminal` → `addTerminal(activeId, target, 'row')`; close.
- `new-editor` → `addEditor(activeId, target, 'row')`; close.
- `new-explorer` → `const r = await api.openFolder(); if (r) addExplorer(activeId, target, 'row', r)`; close.
- `new-workspace` → `newWorkspace('Workspace N')`; close.
- `broadcast` → `setBroadcastOpen(true)`; close.
- `save-all` → `saveAll()` + `pushToast('Workspaces saved')`; close.
- `refresh-cloud` → `refreshCloud()`; close.

All require `activeId`; the pane/save/broadcast commands no-op (and don't close)
when `activeId` is null. **Theme/Env commands are intentionally deferred to Phase
4** — they're `WorkspaceTabs` local state and the Settings panel will own them.

### 2. Global shortcuts — pure keymap

**`src/shared/keymap.ts`** (new, pure, unit-tested):

```ts
export type Shortcut =
  | { type: 'toggle-palette' }
  | { type: 'toggle-broadcast' }
  | { type: 'new-terminal' }
  | { type: 'close-workspace' }
  | { type: 'next-workspace' }
  | { type: 'prev-workspace' }
  | { type: 'jump-workspace'; index: number }   // 0-based

/** Map a keyboard event to a Shortcut, or null. Pure: takes a minimal event shape
 *  so it unit-tests without a DOM. Ctrl OR Meta satisfies "ctrl" (mac parity). */
export function matchShortcut(e: {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean
}): Shortcut | null
```

Mapping (ctrl = ctrlKey || metaKey):
- ctrl + `k` → toggle-palette
- ctrl + shift + `Enter` → toggle-broadcast
- ctrl + shift + `T` → new-terminal
- ctrl + shift + `W` → close-workspace
- ctrl + `Tab` (no shift) → next-workspace; ctrl + shift + `Tab` → prev-workspace
- ctrl + `1`…`9` (no shift) → jump-workspace {index: N-1}

**`App.tsx`** — replace the inline handler body with `matchShortcut` + a dispatch
that reads the live store via `getState()`:

- toggle-palette / toggle-broadcast → as today.
- new-terminal → `addTerminal(activeId, target, 'row')` (target as above).
- close-workspace → the same guarded close the ws-menu uses: confirm if the
  workspace has panes, then `closeWorkspace(activeId)`.
- next/prev-workspace → `setActive(order[(idx ± 1 + n) % n])`.
- jump-workspace → `if (order[index]) setActive(order[index])`.

`preventDefault()` is called **only when `matchShortcut` returns non-null**, so
unmatched keys still reach xterm/inputs. Keys are evaluated globally (a terminal
having focus is the intended case for new-terminal); the chosen chords don't
collide with common shell/readline bindings.

### 3. Tab strip keyboard nav + ARIA (`WorkspaceTabs.tsx`)

- The strip container gets `role="tablist"` + `aria-label="Workspaces"`.
- Each tab button gets `role="tab"`, `aria-selected={id === activeId}`, and a
  **roving tabIndex** (`tabIndex={id === activeId ? 0 : -1}`) so Tab reaches the
  strip once and arrows move within it.
- An `onKeyDown` on each tab: **ArrowRight/ArrowLeft** move to the next/previous
  tab in `order` (wrapping), calling `setActive` and focusing that tab's button;
  **Home/End** jump to first/last. Refs to the tab buttons (a `Map<string,
  HTMLButtonElement>`) let the handler move DOM focus.
- The rename `<input>` and drag logic are untouched; arrow handling is skipped
  while a tab is being renamed (the input owns keys then).

### 4. Smaller a11y gaps

- **BroadcastDialog**: pass `cardProps={{ role: 'dialog', 'aria-modal': true,
  'aria-label': 'Broadcast to all terminals' }}` to its `Modal` (Modal already
  forwards `cardProps`).
- **Palette list**: the scroll `<div>` gets `role="listbox"`; each item row gets
  `role="option"` + `aria-selected={i === clampedSel}`.

## Architecture / where things live

- New: `src/shared/keymap.ts` (pure), tests for it.
- `@shared/quick.ts`: `PaletteAction` type + `buildCommandItems()`.
- `CommandPalette.tsx`: append commands when querying; new `activate` arms; listbox
  roles. Needs `api` (folder picker) + store actions (`addTerminal`/`addEditor`/
  `addExplorer`/`newWorkspace`/`setBroadcastOpen`/`saveAll`/`refreshCloud`/
  `pushToast`) — all already on the store.
- `App.tsx`: keymap-driven dispatch.
- `WorkspaceTabs.tsx`: tablist roles + roving tabindex + arrow/Home/End nav.
- `BroadcastDialog.tsx`: dialog ARIA.

No main-process, IPC, persistence, or `SCHEMA_VERSION` changes.

## Testing (TDD per CLAUDE.md)

- **Unit — `matchShortcut`**: each chord returns the right `Shortcut`; modifiers
  matter (plain `Tab` → null; Ctrl+1 → jump index 0; Meta parity); non-matches →
  null.
- **Unit — `buildCommandItems`**: returns the 7 commands with non-empty `search`;
  `filterPaletteItems([...base, ...commands], 'terminal')` surfaces New terminal.
- **e2e — palette command**: open palette, type "terminal", Enter on the New
  terminal item, assert the workspace's terminal/pane count rose.
- **e2e — global shortcut**: from a seeded single-terminal workspace, press
  Ctrl+Shift+T, assert a second `terminal-` pane appears; seed two workspaces and
  assert Ctrl+2 / Ctrl+Tab activates the other (tab `data-active`).
- **e2e — tab arrow nav**: focus the active tab, press ArrowRight, assert the next
  tab becomes active/focused.
- **e2e — broadcast ARIA**: open broadcast, assert its card has `role="dialog"`.
- Full `npm run typecheck && npm test && npm run build`, then
  `npm run e2e -- ui-polish.spec.ts` (+ the keyboard spec). Read the typecheck exit
  code directly (don't pipe through `tail` — Phase-1 lesson). Terminal-spawning
  specs may flake on CIM/WMI polling (recover on retry); evaluate as in Phases 1–2.

## Load-bearing gotchas respected

- **`preventDefault` only on a keymap match** so the global listener never eats a
  key the terminal needs.
- **Collision-safe chords** — Ctrl+Shift+letter / Ctrl+number / Ctrl+Tab avoid
  readline/shell bindings (no raw Ctrl+T/Ctrl+W/Ctrl+C).
- **Roving tabindex** (one tab in the Tab order, arrows move within) is the ARIA
  Authoring Practices pattern for a tablist — prevents the strip from trapping Tab.
- **Arrow nav yields to the rename input** so typing in a renamed tab isn't hijacked.
- Adding palette commands **only when querying** keeps the connect/jump default
  view uncluttered (the explicit brainstorming decision).

## Risks

- Low–medium. The global keydown listener is the main risk surface; mitigated by
  matching only the curated chords and `preventDefault`-on-match-only, plus
  `matchShortcut` being pure and exhaustively unit-tested.
- `Ctrl+Tab` default behavior in Electron is harmless to override (no native tab
  UI); we still only preventDefault on match.
