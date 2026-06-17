# UI Polish — Phase 4: Unified Settings panel

**Date:** 2026-06-16
**Status:** Design — pending review
**Part of:** UI polish + QoL initiative (Phase 4 of 4, final). Phases 1–3 merged.

## Goal

Give the app one Settings window. Today config is scattered: theme in a `ThemeEditor`
modal, env in an `EnvManager` modal, and a per-pane `TerminalSettings` popover that
oddly also hosts *global* record-by-default + recordings-folder. Consolidate into a
single sidebar-nav panel reachable from one place, with the existing editors embedded
as inline sections, and route the per-pane buttons into the same panel with that
pane's context.

## Decisions (from brainstorming)

1. **Inline sections** (true unified panel), not a hub-of-modals — extract the
   `ThemeEditor`/`EnvManager` bodies out of their `Modal` wrappers and render them as
   sections.
2. **Per-pane settings route into the panel too** — a pane's 🎨/🔑/⚙ open the panel
   pre-focused on the right section with that pane as context.

## Architecture

**Store — `src/renderer/store/settings-slice.ts` (new, pure):**

```ts
export type SettingsSection = 'general' | 'appearance' | 'environment' | 'terminal'
export interface SettingsTarget { section: SettingsSection; paneId?: string }
// on State:
settings: SettingsTarget | null
openSettings: (t: SettingsTarget) => void
closeSettings: () => void
```

`openSettings` sets `settings`; `closeSettings` nulls it. Ephemeral, never persisted.

**`SettingsPanel.tsx` (new)** — rendered once in `App.tsx` (like the other global
overlays). When `settings !== null`, renders a `Modal` (wide card) with a left
**sidebar** listing General / Appearance / Environment / Terminal, and the active
section body on the right. Local `section` state seeds from `settings.section` and the
sidebar switches it; `paneId` comes from `settings.paneId`. Close nulls `settings`.

**Section bodies** (each a focused component, no `Modal` wrapper):
- **`GeneralSettings.tsx` (new)** — default-shell `<select>` (binds
  `newTerminalShellId`/`setNewTerminalShell`), "record new terminals by default"
  checkbox (`quick.recordByDefault`/`setRecordByDefault`), "Open recordings folder"
  (`api.recReveal()`).
- **`ThemeSettings.tsx`** — the current `ThemeEditor` body verbatim (scope selector,
  colors, fonts, reset, presets), minus the `Modal` wrapper and its bottom Close
  button. Prop `paneId?: string` replaces `initialPaneId` (same meaning: seed scope to
  that pane). All `data-testid`s (`theme-scope`, `theme-<key>`, `theme-save-preset`, …)
  preserved.
- **`EnvSettings.tsx`** — the current `EnvManager` body verbatim minus the `Modal`
  wrapper and Close button. Props `{ wsId?, paneId? }`. testids preserved
  (`env-passphrase`, `env-name`, `env-add`, `env-term-section`, …); the `autoFocus`
  on the passphrase input stays.
- **`TerminalAlertsSettings.tsx` (new)** — the per-pane bits of the current
  `TerminalSettings`: the name input + the four alert checkboxes (`setting-name`,
  `setting-border`/`-tabBadge`/`-osNotification`/`-needsInput`). Props `{ wsId, paneId }`;
  reads the pane's `TerminalConfig`, writes via `updatePaneConfig`. If the target isn't
  a terminal pane (or none), shows a dim "Open from a terminal to edit its alerts."

**Removed:** the standalone `ThemeEditor` and `EnvManager` *Modal* components and the
`TerminalSettings` popover. (Their bodies live on in the new section components.) The
`PaneMenu` union drops `'settings' | 'theme' | 'env'` (keeps `'proc' | 'cwd' | 'schedule'`).

## Entry points (the consolidation)

| Trigger | Action |
|---|---|
| Tab bar — new ⚙ button (replaces 🎨 + 🔑) | `openSettings({ section: 'general' })` |
| Pane toolbar 🎨 (`theme-chip`) | `openSettings({ section: 'appearance', paneId })` |
| Pane toolbar 🔑 (`env-chip`) | `openSettings({ section: 'environment', paneId })` |
| Pane toolbar ⚙ (`gear`) | `openSettings({ section: 'terminal', paneId })` |
| Command palette "Settings" (new `PaletteAction 'settings'`) | `openSettings({ section: 'general' })`; close palette |
| **Ctrl+,** (new keymap `Shortcut 'open-settings'`) | `openSettings({ section: 'general' })` |

The quick shell-picker stays in the tab bar (fast action); General also exposes default
shell (same store state — both stay in sync).

## Implementation stages (one spec, two shippable stages)

**Stage A — panel shell + General + entry points.** `settings-slice`, `SettingsPanel`
with the sidebar (Appearance/Environment/Terminal sections render a temporary "moved in
Stage B" placeholder), `GeneralSettings`, the ⚙ tab-bar button, the Ctrl+, keymap entry,
and the palette "Settings" command. General works end to end; nothing else removed yet.

**Stage B — embed editors + reroute panes + remove old surfaces.** Extract
`ThemeSettings`/`EnvSettings`/`TerminalAlertsSettings`; wire them into the panel
sections; repoint the three pane-toolbar buttons to `openSettings`; delete the
`ThemeEditor`/`EnvManager`/`TerminalSettings` components and their `PaneTile` menu cases;
migrate the e2e flows that opened the old surfaces.

## Testing (TDD per CLAUDE.md)

- **Unit — `settings-slice`**: `openSettings` sets target; `closeSettings` clears.
- **Unit — keymap**: `Ctrl+,` → `{ type: 'open-settings' }`; unaffected chords unchanged.
- **Unit — `buildCommandItems`**: includes a `settings` action with a searchable string;
  `filterPaletteItems(..., 'settings')` surfaces it.
- **e2e — `settings.spec.ts` (new)**: ⚙ opens the panel (`settings-panel` visible);
  clicking the Appearance sidebar item shows `theme-scope`; toggling `rec-default` in
  General persists (reopen shows it checked); a pane's 🎨 opens the panel with the
  Appearance section and that pane preselected in `theme-scope`.
- **e2e migration**: the env-autofocus assertion (currently opens via tab-bar `env-button`)
  switches to ⚙ → Environment and still asserts `env-passphrase` is focused.
- Full `npm run typecheck && npm test && npm run build`, then `npm run e2e -- settings.spec.ts ui-polish.spec.ts keyboard.spec.ts`. Read typecheck's exit code directly (no `tail` pipe). Terminal-spawning specs may flake on CIM/WMI polling and recover on retry (Phases 1–3 pattern), not regressions.

## Load-bearing gotchas respected

- **Theme live-preview still targets the DOM, not the panel** — `ThemeSettings` keeps
  the existing `scopeTarget()` (documentElement / workspace-host / `tile-<paneId>`), so
  embedding it in the panel doesn't change which element previews.
- **Pane theme `tile-<paneId>` target requires the pane mounted** — it always is (all
  workspaces stay mounted), so pane-scoped preview works while the panel is open.
- **EnvVault unlock/create flow unchanged** — moved verbatim; `autoFocus` retained.
- **`SettingsPanel` rendered once at app root** (not per pane) so a pane's button opens
  the single panel with `paneId` context rather than spawning per-tile modals.
- **Don't write app-state from new code** — settings state is renderer-ephemeral only.

## Risks

- Medium — this touches many trigger sites and removes three components, so the main
  risk is a missed wiring (a pane button still pointing at a deleted menu case) or a
  broken testid. Mitigated by: stage A ships independently; the section bodies are
  moved *verbatim* (same testids), so inner behavior is unchanged; e2e covers the new
  open paths and the migrated env flow.
- The `ThemeEditor`/`EnvManager` bodies currently end with a Close button bound to
  `onClose`; in the panel the Modal owns close, so those per-body Close buttons are
  dropped (the panel has one). No behavior lost.
