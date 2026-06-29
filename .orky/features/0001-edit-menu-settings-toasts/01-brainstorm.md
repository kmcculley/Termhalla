# 0001 — Brainstorm (Phase 1, human-led)

**Status:** concept agreed with the human → recording brainstorm gate as PASS.

## Current-state findings (from code scout)

- The **"settings button"** is a gear icon (⚙) in the workspace-tabs bar
  (`src/renderer/components/WorkspaceTabs.tsx:103`), `onClick={() => openSettings({ section: 'general' })}`.
- Settings is a **modal** (`src/renderer/components/SettingsPanel.tsx`) with 5 sections: General,
  Appearance, Environment, Terminal, Keybindings. General settings live in `GeneralSettings.tsx`.
- Settings is *also* reachable via Command Palette (`CommandPalette.tsx:69`), pane context menu
  (`PaneContextMenu.tsx:45`), and the `Ctrl+,` keybinding (`open-settings`, fired in `App.tsx:100`).
- The only menus today are a **native Electron application menu** (`src/main/menu.ts`) with **View**
  and **Help** submenus. There is **no Edit menu and no renderer menu bar**.
- **Toasts**: store slice `src/renderer/store/toasts-slice.ts` (`pushToast(text, kind)`), rendered by
  `src/renderer/components/Toasts.tsx` (bottom-right, auto-dismiss 4s, max 4). No on/off setting exists.
- **Preferences** persist in `QuickStore` (`src/shared/types.ts:81-93`) → `quick.json`, via debounced
  `scheduleQuickSave()` in `src/renderer/store/quick-slice.ts`. `SCHEMA_VERSION = 6` (`types.ts:275`).

## Decisions (agreed with human)

1. **Edit menu = native Electron app menu.** Add a new **"Edit"** submenu to `src/main/menu.ts`,
   positioned before View/Help (Edit · View · Help). It contains a single **"Settings…"** item
   (accelerator `Ctrl+,`) that sends a main→renderer IPC event to open the settings modal.
2. **Edit menu contents = Settings only.** No Cut/Copy/Paste/Find in this feature; can be added later
   as a separate feature.
3. **Move the gear button into the menu.** Remove the ⚙ button from the workspace-tabs bar; Settings
   is now reached via the Edit menu (plus the existing Command Palette, pane context menu, and `Ctrl+,`,
   which all remain).
4. **Toast notifications toggle** in the Settings window:
   - New persisted boolean preference (in `QuickStore`), gating whether toasts render/are pushed.
   - **Disabled by default** — toasts are OFF unless the user opts in. This is a deliberate behavior
     change for existing users (the spec must call this out, and a test must pin the default = off).
   - Toggle lives in the **General** settings section (`GeneralSettings.tsx`), alongside copy-on-select.

## Implications to carry into the spec

- A new IPC channel (`menu:open-settings` or similar, main→renderer push) per the `domain:verb` convention.
- The toast gate must suppress toasts globally regardless of call site — gate at the source
  (`pushToast`) and/or render, so no individual call site needs changing.
- Persisted-schema change: adding a `QuickStore` field is additive; decide whether `SCHEMA_VERSION`
  must bump (existing optional fields suggest additive booleans may not require a bump — spec to confirm
  the migration story so old `quick.json` loads cleanly with the new default).
- Default-off changes current behavior → call out in docs/changelog; the toggle's default is a tested
  acceptance criterion (CONV-003: no silent behavior change without an asserted spec).

## Addendum — Iteration 1 (loop-back from review, ESC-001 resolved)

Review (devils-advocate FINDING-DA-001, HIGH; echoed by ux/qol/doc-drift) found that gating
**all** toasts at `pushToast` silences **error/failure** toasts too — including the editor's
"Save failed" toast, which is the *only* signal of a failed write (`use-editor-tabs.ts:118,134`
via `runOp`). With toasts default-OFF that is a **silent data-loss path** and contradicts the
documented runOp guarantee (`docs/decisions.md:404-410`).

**Human decision (ESC-001):** *Errors always show.* The toast disable preference silences only
**success/info** toasts; **`kind === 'error'` toasts ALWAYS render** regardless of `toastsEnabled`.
Non-error toasts remain **OFF by default**.

This **supersedes** decision #4's "blanket gate with no kind carve-out" above. The spec must add an
explicit error-bypass requirement and a test pinning it (an error toast surfaces even when
`toastsEnabled` is unset/false); the suppression chokepoint stays single (`pushToast`) but now
branches on `kind`. `docs/decisions.md` runOp guarantee is preserved (no longer needs amending).

## Concern tags (finalized for the spec to route review lenses)

- `ux` — moved entry point + new menu changes discoverability and interaction.
- `qol` — user-controllable toast preference.
- `doc-drift` — feature docs, the "where things live" table, keybindings docs, and changelog need updates.
