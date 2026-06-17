# Keybindings, adaptive contrast, and status-bar tips — design

Date: 2026-06-17

Four UI changes from a punch list, grouped by theme:

- **Two contrast bug-fixes** (one shared root cause): unreadable dropdown menus and
  unreadable Settings nav buttons.
- **Two features**: a rebindable keybindings UI, and rotating keyboard-shortcut tips
  in the status bar.

The keybindings work is the backbone — both the status-bar tips and the cheat-sheet
read their chords from the same binding table, so a rebind is reflected everywhere.

---

## A. Adaptive contrast (items 2 & 3)

### Problem

Every elevated surface (menus, modals, the Settings panel) hardcodes its text color to
`--fg`, which maps to `theme.text` — always light (`#eeeeee` in the default theme). On a
light theme, `elevatedBg` goes light but `text` stays light → light-on-light, unreadable
(item 2: dropdown menus).

The Settings nav buttons are doubly broken (item 3): `[data-testid="settings-panel"]` is
**not** in the themed-chrome `:is(…)` selector list in `index.css` (the rule at the menu/
chrome block), so its `<button>`s fall back to OS-default button colors — dark text on the
dark elevated modal → the dark-on-dark the user reported.

### Fix — extend the existing luminance-adaptive token pattern

The codebase already solves this for alert bars: `themeCssVars()` derives `--on-busy` /
`--on-needs` via `readableOn(bgHex)` in `src/shared/theme.ts`. We extend the same pattern
to elevated surfaces:

1. **`src/shared/theme.ts`** — add a derived token in both `themeCssVars()` and
   `themeCssVarsPartial()`:
   - `--fg-on-elevated` = `readableOn(t.elevatedBg)`
   - In `themeCssVarsPartial`, recompute `--fg-on-elevated` whenever `elevatedBg` is among
     the overridden keys (same conditional style as the existing `statusBusy`/`statusNeedsInput`
     recompute).
2. **`src/renderer/components/Modal.tsx`** — `SURFACE.color`: `var(--fg, #eee)` →
   `var(--fg-on-elevated, var(--fg, #eee))`.
3. **`src/renderer/index.css`** — in the menu/chrome button rule(s) that set
   `color: var(--fg, #eee)`, switch to `var(--fg-on-elevated, var(--fg, #eee))`. Add
   `[data-testid="settings-panel"]` to the themed-chrome `:is(…)` selector list so its nav
   buttons get consistent themed colors (background `rgba(255,255,255,0.06)`, border, etc.)
   instead of OS defaults.
4. **Settings nav (`SettingsPanel.tsx`)** — selected button keeps `background: var(--sel-bg)`;
   text now inherits the themed `--fg-on-elevated`. No change to selection logic.

### Why this approach

- Reuses an established, tested helper (`readableOn`) and the exact token-derivation pattern
  already in `theme.ts` — no new contrast machinery.
- Fixes *all* elevated surfaces at once (menus, modals, Settings), not just the two reported.
- The `var(--fg-on-elevated, var(--fg, #eee))` fallback chain degrades safely if the token is
  ever absent.

### Notes / scope

- Only `--fg-on-elevated` is added. A dim variant (`--fg-dim-on-elevated`) is **not** added
  unless a dim-text-on-elevated readability problem surfaces during implementation — YAGNI.

---

## B. Rebindable keybindings (item 4)

The user asked for this "under Edit," but Termhalla has **no menu bar** (no native Electron
File/Edit/View; confirmed). Decision (approved): the Keybindings UI lives as a **new Settings
section** alongside General/Appearance/Environment/Terminal. Bindings are **fully rebindable**
and persisted.

### Current state

`src/shared/keymap.ts` is a hardcoded `if/else` `matchShortcut(e): Shortcut | null` returning a
discriminated union. `App.tsx`'s global `keydown` listener switches on `sc.type`. Bindings are
not data-driven and not persisted.

### Approach — make the table data-driven, keep the dispatch switch

Reuse the existing `Shortcut` `type` strings as **command ids** so the `App.tsx` dispatch switch
is untouched. Only the *matching* becomes table-driven.

#### `src/shared/keybindings.ts` (new)

- **`Chord`** — structured `{ mod: boolean; shift: boolean; key: string }` where `mod` means
  "Ctrl OR ⌘" (preserves the existing mac-parity behavior). `key` is the lowercased
  `KeyboardEvent.key`.
- **`COMMANDS`** — registry array. Each entry:
  `{ id: CommandId; label: string; category: string; defaultChord: Chord }`.
  `CommandId` = the rebindable `Shortcut` type strings:
  `toggle-palette`, `toggle-broadcast`, `new-terminal`, `close-workspace`,
  `next-workspace`, `prev-workspace`, `open-settings`, `toggle-maximize-pane`.
  (`jump-workspace` is **excluded** — see scope cuts.)
- **`eventToChord(e)`** — normalize a `KeyboardEvent` to a `Chord` (mod = `ctrlKey||metaKey`).
- **`chordKey(chord)`** — canonical string (e.g. `"mod+shift+t"`) used as a map key for lookup
  and conflict detection.
- **`formatChord(chord)`** — display string (`"Ctrl+Shift+T"`); platform label for `mod`
  (`Ctrl` on win/linux). Shared by the cheat sheet, the capture UI, and the status-bar tips.
- **`resolveBindings(overrides)`** — merge `COMMANDS` defaults with the user override map
  (commandId→Chord); unknown ids ignored (forward-compatible).
- **`matchShortcut(e, bindings)`** — build a `chordKey → commandId` lookup from `bindings`,
  return the matching `Shortcut` (or `null`). `jump-workspace` (Ctrl+1–9) handled by a fixed
  numeric branch retained here, independent of the override table.
- **`findConflict(bindings, chord, exceptId)`** — returns the command id already bound to
  `chord`, if any (for the capture UI).
- **`isValidRebind(chord)`** — enforces the matcher contract: chord **must** include `mod`
  (Ctrl/⌘). Rejects plain-key / Alt-only chords.

`src/shared/keymap.ts` is folded into / re-exported from `keybindings.ts` (keep `Shortcut`
exported from its current path or re-export to avoid churn at import sites). `matchShortcut`
gains the `bindings` parameter; the default export path used by tests adapts to pass
`DEFAULT_BINDINGS`.

#### Persistence

- A `keybindings` override map (commandId → Chord) added to app-state, behind a
  **`SCHEMA_VERSION` bump** in `src/shared/types.ts`. Stores **only diffs from defaults** —
  a command at its default is absent from the map.
- Persistence follows the existing **app-theme** path (main owns app-state.json; renderer
  store slice holds the live value and writes through the same mechanism theme uses).
  Migration on load: missing `keybindings` → `{}` (all defaults).
- Renderer store slice exposes: `keybindings` state + actions `setBinding(id, chord)`,
  `resetBinding(id)`, `resetAllBindings()`, and a `resolveBindings`-derived selector for the
  active table.

#### Dispatch

`App.tsx`'s `keydown` handler reads the active binding table from the store and calls
`matchShortcut(e, bindings)`. The `switch (sc.type)` block is unchanged.

#### Settings → Keybindings section

- `SettingsSection` union (`src/renderer/store/types.ts`) gains `'keybindings'`; `SECTIONS`
  in `SettingsPanel.tsx` gains `{ id: 'keybindings', label: 'Keybindings' }`; the panel body
  switch renders a new `KeybindingsSettings` component.
- **`KeybindingsSettings.tsx`** — a table: one row per command (`label`, current
  `formatChord`, **Change**, **Reset**). Reserved (`Ctrl+1–9`) shown read-only. A **Reset all**
  button.
  - **Change** enters capture mode: the next `keydown` is read via `eventToChord`, then
    validated with `isValidRebind` (must include Ctrl/⌘ — inline error if not) and
    `findConflict` (inline warning naming the conflicting command; the user confirms to
    reassign or cancels). On accept → `setBinding`.
  - Esc cancels capture.

### Scope cuts (approved)

- **`Ctrl+1–9` (jump-to-workspace) is non-rebindable** — parametric (9 bindings), awkward in a
  rebind table. Retained as a fixed branch in `matchShortcut`; shown in the section as reserved.
- **Rebinds must include Ctrl/⌘** (`isValidRebind`). No plain-key/Alt-only bindings — protects
  terminal input and preserves the `matchShortcut` "ctrl required" contract.

---

## C. Status-bar rotating tips (item 1)

### Current state

`StatusBar.tsx` is a left-aligned flex row of cloud-status items; there is no right section.

### Approach

- Add a spacer (`<div style={{ flex: 1 }} />`) after the cloud items, then a right-aligned,
  dim, non-interactive hint span (`color: var(--fg-dim)`, `whiteSpace: 'nowrap'`,
  `data-testid="statusbar-tip"`).
- The hint rotates through a **short curated list** of the most useful commands every ~7s. Each
  tip renders **"Press {chord} to {action}"**, where `{chord}` = `formatChord` of that command's
  **current** binding (read live from the store's active binding table) — so a rebind updates the
  tip automatically.
- Rotation index logic is extracted to a **pure helper** (`nextTipIndex(i, len)` or equivalent)
  for unit testing; the `setInterval` timer lives in the component (cleared on unmount). The
  curated tip list references commands by id (e.g. `new-terminal`, `toggle-palette`,
  `open-settings`, `toggle-maximize-pane`) and resolves label + chord at render.

---

## Testing (TDD)

Per project convention: pure logic → vitest in `tests/`; UI/IPC/integration → Playwright e2e
that launches the app. Renderer pure logic under test must not import `../api`.

### vitest (pure)

- `keybindings.ts`:
  - `eventToChord` maps modifiers/keys correctly (mod = ctrl||meta).
  - `formatChord` produces expected display strings.
  - `matchShortcut(e, bindings)` resolves defaults, and resolves an **overridden** chord to the
    right command; an old default chord no longer matches after override.
  - `findConflict` detects a duplicate and respects `exceptId`.
  - `isValidRebind` rejects no-mod and Alt-only chords, accepts mod-bearing chords.
  - `resolveBindings` merges defaults + overrides; unknown ids ignored.
  - `jump-workspace` (Ctrl+1–9) still matches regardless of overrides.
- `theme.ts`: `themeCssVars` / `themeCssVarsPartial` emit `--fg-on-elevated` =
  `readableOn(elevatedBg)`; partial recomputes it only when `elevatedBg` is overridden.
- Status tips: `nextTipIndex` rotation helper wraps correctly.

### Playwright e2e

- **Keybindings:** open Settings → Keybindings; rebind `new-terminal` to a new chord; press it
  and assert a new terminal pane appears; assert the old chord no longer fires it. Trigger a
  conflict and assert the inline warning. Reset a binding and assert default restored.
- **Contrast:** apply a light theme; assert a dropdown menu's computed text color and the
  Settings nav buttons are readable (e.g. computed `color` resolves to the dark token, or
  `--fg-on-elevated` is present and applied).
- **Status bar:** assert `[data-testid="statusbar-tip"]` renders text containing "Press" and a
  chord reflecting the current binding (rebind a command, assert the tip text updates).

---

## Files touched (summary)

| Area | File | Change |
|---|---|---|
| Contrast token | `src/shared/theme.ts` | add `--fg-on-elevated` (full + partial) |
| Contrast apply | `src/renderer/components/Modal.tsx`, `src/renderer/index.css` | use `--fg-on-elevated`; add `settings-panel` to themed chrome |
| Keybindings core | `src/shared/keybindings.ts` (new), `src/shared/keymap.ts` | data-driven table, chord helpers, conflict/validate |
| Persistence | `src/shared/types.ts`, renderer store slice, main app-state | versioned `keybindings` overrides |
| Dispatch | `src/renderer/App.tsx` | pass active bindings to `matchShortcut` |
| Keybindings UI | `src/renderer/components/SettingsPanel.tsx`, `src/renderer/store/types.ts`, `KeybindingsSettings.tsx` (new) | new section + capture UI |
| Status tips | `src/renderer/components/StatusBar.tsx` | right-aligned rotating hint |

## Out of scope

- A native menu bar (no Edit menu exists; Keybindings lives in Settings instead).
- Rebinding `Ctrl+1–9` or any non-Ctrl/⌘ chord.
- Context-aware (focus-dependent) status tips — curated rotating list only.
- `--fg-dim-on-elevated` unless a concrete readability gap appears.
