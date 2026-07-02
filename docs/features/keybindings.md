# Rebindable Keyboard Shortcuts

> A data-driven command registry with a table-driven matcher, user-overridable via **Settings → Keybindings**; persisted on `quick.json`; rotating shortcut tips in the status bar; adaptive `--fg-on-elevated` contrast token for readable menus and settings nav on any theme.

**Status:** Shipped · **Branch:** feat/keybindings-contrast-statusbar-tips

## What it does

- **Command registry.** All rebindable app shortcuts are defined once in `src/shared/keybindings.ts` as a typed `COMMANDS` array. Each entry carries an id, label, category, default chord, and an optional `tip` string used in status-bar tips.
- **Table-driven matcher.** `matchShortcut(e, bindings)` resolves a keyboard event to a `Shortcut` using the provided binding map. It requires Ctrl/⌘ on every match and checks the Ctrl+1–9 reserved jump range before any user binding, so a rebind can never shadow a workspace jump.
- **Settings → Keybindings UI.** A new section in the unified Settings panel lists every command with its current chord. Clicking a row enters capture mode: the next valid key combination (Ctrl-required) becomes the new binding. Conflicts trigger a warn-and-confirm flow. Individual rows and the whole table have reset controls.
- **Persistence.** Overrides are written to `quick.json` as a flat `keybindings` map (`CommandId → chordKey string`, or `'none'` to explicitly unbind). Only diffs from defaults are stored — absent keys mean "use default".
- **Rotating status-bar tips.** The bottom-right corner of the status bar cycles through five selected commands every 7 s, showing the _current_ effective binding (default or user-set), e.g. "Press Ctrl+K to open the command palette".
- **Adaptive contrast token.** `--fg-on-elevated` is computed from `readableOn(elevatedBg)` and applied as a CSS variable at every theme scope. It fixes light-on-light menus and dark-on-dark Settings nav links.

## Key files

| File | Responsibility |
| --- | --- |
| `src/shared/keybindings.ts` | Command registry (`COMMANDS`, `CommandId`, `Chord`), chord helpers (`chordKey`, `parseChordKey`, `eventToChord`, `formatChord`), `DEFAULT_BINDINGS`, `resolveBindings`, `matchShortcut`, `findConflict`, `isValidRebind`, `TIP_COMMANDS`, `nextTipIndex` |
| `src/shared/keymap.ts` | Re-export shim (back-compat); all logic lives in `keybindings.ts` |
| `src/shared/quick.ts` (types) | `QuickStore.keybindings?: Record<string, string>` field |
| `src/shared/types.ts` | `QuickStore` type (includes the `keybindings` field) |
| `src/main/persistence/quick-store.ts` | `normalizeQuick`: validates `keybindings` as a `Record<string, string>` (strips non-string values, no-ops on malformed input) |
| `src/renderer/store/keybindings-slice.ts` | `setBinding`, `unbindCommand`, `resetBinding`, `resetAllBindings` — update `quick.keybindings` and schedule a debounced save |
| `src/renderer/App.tsx` | Global `keydown` listener: calls `resolveBindings(s.quick.keybindings)` and passes the result to `matchShortcut`; dispatches the returned `Shortcut` |
| `src/renderer/components/KeybindingsSettings.tsx` | Capture-phase keydown, Ctrl-required validation, conflict warn-and-confirm, per-row and global reset |
| `src/renderer/components/StatusBar.tsx` | `TIP_COMMANDS` rotation via `setInterval` / `nextTipIndex`; calls `resolveBindings` to render the live-bound chord in tip text |
| `src/shared/theme.ts` | `themeCssVars` / `themeCssVarsPartial`: computes `--fg-on-elevated` from `readableOn(elevatedBg)` |
| `src/shared/contrast.ts` | `readableOn(bg)` — returns `#000` or `#fff` based on relative luminance (WCAG) |
| `src/renderer/index.css` | Settings panel nav and themed chrome surfaces consume `--fg-on-elevated` |

## Command registry + chord model

`Chord` is `{ mod: boolean; shift: boolean; key: string }` where `mod` means Ctrl or ⌘ (cross-platform parity) and `key` is a lowercased `KeyboardEvent.key`. Every app shortcut requires `mod`, which guarantees unmatched keys flow through to the terminal or editor.

`chordKey(ch)` serializes a chord to a stable JSON-storable string, e.g. `"mod+shift+t"`. `parseChordKey(s)` reverses this. `eventToChord(e)` normalizes a browser `KeyboardEvent`.

`resolveBindings(overrides)` takes the raw `quick.keybindings` map (or `undefined`) and returns a `Partial<Record<CommandId, Chord>>`: defaults for all known commands, with overrides applied on top. An override value of `'none'` deletes the command's entry (explicitly unbound; omitted from the result). Unknown ids and unparseable chord strings are silently ignored (forward-compatible with future command ids).

`matchShortcut(e, bindings)` requires `mod`, checks the reserved `Ctrl+1–9` range first (non-rebindable jump), then linearly scans the bindings map. Returns a typed `Shortcut` or `null`; callers call `preventDefault` only on a non-null result.

`findConflict(bindings, chord, exceptId)` returns the first `CommandId` (other than `exceptId`) already bound to the given chord, used by `KeybindingsSettings` to warn on conflict.

`isValidRebind(ch)` rejects chords without `mod`, bare modifier keys, reserved Ctrl+1–9 digits, and the `+` key (which would corrupt chordKey serialization).

`TIP_COMMANDS` is the ordered subset of command ids surfaced as status-bar tips; `nextTipIndex(i, len)` wraps the rotation index.

## Persistence

The `keybindings` field on `QuickStore` is a `Record<string, string> | undefined`. Only user overrides are stored — commands at their default are absent. The sentinel value `'none'` means the command is explicitly unbound.

`normalizeQuick` in `quick-store.ts` validates the field on every read and write: must be a plain object; each value must be a string; non-string values are filtered out. This prevents a corrupt or renderer-supplied payload from injecting unexpected shapes.

Changes flow via the keybindings slice (debounced `scheduleQuickSave`) identically to theme overrides.

## Dispatch

`App.tsx` registers a global `keydown` listener on mount. It reads the live `quick.keybindings` from the store via `useStore.getState()` (imperative, not reactive — the listener is wired once) and resolves them with `resolveBindings`. The returned bindings are passed to `matchShortcut`, and on a hit `preventDefault` is called and the shortcut type is dispatched in a `switch`.

The pane view-state commands `toggle-maximize-pane` (default `Ctrl+Shift+M`) and `toggle-minimize-pane` (default `Ctrl+Shift+H`) act on the focused pane in the active workspace (guarded by `s.workspaces[activeId]?.panes[pane]`). The pane toolbar / context-menu tooltips for these affordances derive their displayed accelerator from the registry via `formatChord` over the resolved binding (never a hard-coded literal), so rebinding the command updates the surfaced tooltip.

The window-chrome drawer commands `toggle-notes` (default `Ctrl+Shift+N`), `toggle-search` (default `Ctrl+Shift+F`), and `toggle-orky-queue` (default `Ctrl+Shift+O` — the Orky decision-queue drawer, feature 0006; see [decision-queue](./decision-queue.md)) toggle their drawers without requiring an active workspace. Like every other entry they are rebindable and `'none'`-unbindable, and any surface displaying their chord (e.g. the status-bar toggle tooltips) derives it from `resolveBindings`.

## Store slice

`src/renderer/store/keybindings-slice.ts` exports `createKeybindingsSlice`, composed into the root store. It provides:

| Action | Behavior |
| --- | --- |
| `setBinding(id, chord)` | Write `chordKey(chord)` to `quick.keybindings[id]`; schedule save |
| `unbindCommand(id)` | Write `'none'` sentinel; schedule save |
| `resetBinding(id)` | Delete `id` from the map (reverts to default); schedule save |
| `resetAllBindings()` | Replace `quick.keybindings` with `{}`; schedule save |

## Keybindings settings UI

`KeybindingsSettings.tsx` renders a table of all `COMMANDS` with their current effective chord (from `resolveBindings`). Row interaction:

1. Click a row to enter **capture mode** — the next `keydown` event (with `useCapture: true`) is intercepted.
2. `isValidRebind` rejects modifier-only or no-Ctrl chords with an inline error message.
3. `findConflict` checks for an existing binding on the captured chord. A conflict shows a warning; a second click confirms and overwrites (the displaced command reverts to its default).
4. Confirmed: `setBinding(id, chord)`.
5. **Reset** (per row): `resetBinding(id)`. **Reset all**: `resetAllBindings()`.

Reserved chords: `Ctrl+1` through `Ctrl+9` are rejected by `isValidRebind` (the `/^[1-9]$/` guard) — workspace-jump chords are always checked first in `matchShortcut` and cannot be shadowed.

## Adaptive contrast token

`--fg-on-elevated` is generated by `themeCssVars` alongside the existing `--on-busy` / `--on-needs` tokens:

```ts
'--fg-on-elevated': readableOn(t.elevatedBg)
```

`readableOn` (from `src/shared/contrast.ts`) returns `'#000000'` or `'#ffffff'` based on the WCAG relative luminance of the background. A partial-override scope (per-workspace, per-pane) recomputes the token only when `elevatedBg` is present in that scope's override via `themeCssVarsPartial`.

Applied in CSS on all elevated-surface chrome: dropdown menus, modal bodies, the Settings panel sidebar nav links, and cloud-status popovers.

## Status-bar tips

`StatusBar` maintains a `tipIdx` state variable, advanced every 7 s by a `setInterval`. The tip is derived from `TIP_COMMANDS[tipIdx % TIP_COMMANDS.length]`, and the rendered chord comes from `resolveBindings(overrides)[tipId]` — so if the user has rebound a command, the tip immediately shows the custom chord. A tip is suppressed when the command is unbound (`resolved[tipId]` is `undefined`).

## Behaviors and edge cases

- **Reserved Ctrl+1–9 are checked first in `matchShortcut`** — this ensures a user rebind can never shadow the always-on workspace-jump chords.
- **`'none'` sentinel** allows a user to explicitly disable a shortcut (rather than just leave it unbound by reassigning its chord to another command).
- **Unknown / future command ids** in `quick.keybindings` are silently dropped by `resolveBindings` and by `normalizeQuick`, preserving forward-compatibility.
- **`+` key is blocked** by `isValidRebind` — it collides with the `chordKey` separator and would corrupt round-trip through persistence.
- **Tip rotation skips unbound commands** — if a tip command is set to `'none'`, `tipText` is `null` and no tip is rendered for that slot.
- **`--fg-on-elevated` cascades correctly** through the theme-scope stack: an app-level override sets the root value; a workspace or pane override recomputes it only when `elevatedBg` is part of that scope's partial theme.

## Testing

Unit tests (`tests/`):

- `tests/keybindings.test.ts` — `chordKey`/`parseChordKey` round-trip, `eventToChord`, `formatChord`, `resolveBindings` (defaults, override, `'none'` unbind, unknown ids), `matchShortcut` (reserved Ctrl+1–9, bound commands, unbound returns null), `findConflict`, `isValidRebind` (no-mod, modifier-only, reserved digit, `+` key), `nextTipIndex` wrap.
- `tests/keybindings-slice.test.ts` — `setBinding`, `unbindCommand`, `resetBinding`, `resetAllBindings` against an in-memory store.
- `tests/shared/theme.test.ts` — `themeCssVars` emits `--fg-on-elevated`; `themeCssVarsPartial` recomputes it when `elevatedBg` is present.
- `tests/theme-contrast.test.ts` / `tests/contrast.test.ts` — `readableOn` returns black on light backgrounds and white on dark; verifies default token pairs pass WCAG AA.

End-to-end (`tests/e2e/`):

- `tests/e2e/keybindings.spec.ts` — opens Settings → Keybindings, rebinds a command to a new chord, fires the new chord, and verifies the rebind took effect; separately confirms a chord without Ctrl is rejected, and that Settings nav links are readable on a light theme (contrast check for `--fg-on-elevated`).
- `tests/e2e/statusbar-tips.spec.ts` — verifies the status bar renders a tip containing a known shortcut label and that the tip reflects the current binding.

## Related

- [architecture.md](../architecture.md) — persistence layout, IPC contract, store model.
- [decisions.md](../decisions.md) — design-decision log.
- [ssh-favorites.md](./ssh-favorites.md) — `quick.json` is also the home for SSH connections, templates, and theme presets.
