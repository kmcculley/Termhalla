# Code-Quality Review — Follow-ups (deferred)

A `/review-quality` pass over `src/` (2026-06-16) found 0 Critical, 3 Major, and
5 Minor issues. The **3 Major** findings were resolved on `main`
(`6bd2dd5`) as behavior-preserving refactors — see
[decisions.md](../decisions.md) (the `<Modal>`/`Z` and EditorPane-hooks entries)
and the [changelog](../../CHANGELOG.md). The deferred remainder is tracked below.

## Resolved (6bd2dd5)

- **Duplicated pane-placement logic.** The 7 copy-pasted
  `addFirstPane`/`splitPane` branches in `store.ts` now route through
  `placePane()`/`firstTarget()`.
- **Duplicated modal overlays + inconsistent z-index/backdrop.** Extracted
  `components/Modal.tsx` (`<Modal>` + `Z` scale); migrated the broadcast,
  schedule, env, theme, command-palette, and SSH dialogs; menu/popover
  z-indexes now draw from `Z`.
- **`EditorPane` god component.** Draft persistence and external-file-change
  handling moved into `editor/use-editor-drafts.ts` and
  `editor/use-external-file-watch.ts`, with shared types/helpers in
  `editor/tabs.ts`.

## Second review (2026-06-16 #2) — Critical + Major resolved (`8cc6400`)

A follow-up `/review-quality` pass found 2 Critical + 10 Major. All were resolved
on `main` (`8cc6400`) as behavior-preserving refactors — see
[decisions.md](../decisions.md) (store-slices/PaneTile and EditorPane-tab-ownership
entries), [architecture.md](../architecture.md) (State management), and the
[changelog](../../CHANGELOG.md):

- **`WorkspaceView` god component** → split into `PaneTile` (per-tile, owns its
  single `menu` state, scoped per-pane subscriptions) + `PaneToolbar`,
  `ProcessPopover`, `CwdMenu`. *(Resolves the deferred WorkspaceView item below.)*
- **Store god module** → cohesive slices under `store/` composed by a thin root.
- **Parallel per-pane cleanup** → one `clearPaneRuntime` + `teardownPanes` path
  (also fixed `closeWorkspace` not stopping recordings / clearing `recording`).
- **7 copy-pasted pane-open actions** → `commitPane`; persistence unified on the
  debounced autosave.
- **`App` 8 IPC effects + `WorkspaceTabs` whole-store subscription** → one
  subscription effect; scoped `useShallow` selectors with derived badge strings.
  *(Resolves the deferred App item below.)*
- **Duplicated OSC scan loop** → `scanOsc`; **`register.ts`** single teardown +
  no `tracker!`/`ai!`; **shared `SURFACE`** popover style; **named
  `RecState`/`EnvVaultState`/`AiTool`** types + `draftsSet`/`draftsDelete` naming.
- **`EditorPane` tab drift** → additive sync + documented ownership + accurate
  `openTab` persist + shared `dropTab` (full removal omitted; see decision entry).

## Still deferred

- **EditorPane tab state still lives in a ref-held `Map` + `force` re-render.**
  The hooks extraction isolated the IO/timer concerns but did not retire the
  manual re-render hack. Moving per-tab dirty/missing/externalChanged flags into
  real React state (or a subscribable `TabSet`) is the deeper fix. *(Major #1,
  partially addressed.)*
- **Duplicate vault type: `VaultData` (main `env-vault.ts`) vs `EnvVaultData`
  (`@shared/types`).** Identical shape declared twice; main should import the
  shared type. *(Minor.)*
- **`AppState.schemaVersion` hardcoded to `1` (store `saveAll`) while
  `SCHEMA_VERSION` is `3`, and the field is never read in `loadAppState`.**
  Either wire it to a constant + validate on load, or introduce a dedicated
  `APP_STATE_VERSION` with a note on why it versions independently. *(Minor.)*
- **Silent write-error swallow in `EnvVault.persist()`** (and the empty `catch`
  in `integration-scripts.ts`). A failed vault write loses a just-entered secret
  with no signal; consider surfacing a `persisted: false` to the renderer.
  *(Minor — re-flagged by review #2.)*

### Newly tracked from review #2 (Minor)

- **`proc-tree.buildProcInfo` builds `childrenMap(rows)` twice** per poll
  (in `descendantsOf` and `pickForeground`); build once and pass `byParent` down.
- **`buildPaletteItems` favorite dedup is case-sensitive** while `nextRecentDirs`
  dedups via `normDir` — on Windows a dir can appear as both favorite and recent.
- **`deserializeWorkspace` lets a raw `JSON.parse` `SyntaxError` escape** instead
  of the friendly domain error; wrap the parse.
- **`workspace-model.migrate` is identity for all versions** with no v1/v2 cases
  though `SCHEMA_VERSION` is 3 — document the no-op or add explicit cases.
- **`preload` listeners use `as never`** to satisfy `ipcRenderer.on`; type with
  `IpcRendererEvent` instead. (`onRecState`/`onEnvState` reformatted; rest remain.)
- **`ThemeProvider`'s 150 ms Monaco-theme delay is a magic timing hack;**
  `status-tracker`'s `400` tail length and `ScheduleDialog`'s `dV/dU/...` paired
  state names are unnamed/opaque.
- **Type design:** `CloudState` folds the transient `'checking'` into the same
  union as stable states; `Partial<Theme>` is reused unnamed across configs
  (introduce a `ThemeOverride` alias). (`AiTool` already named in review #2.)
- **IPC contract is a flat 50-method surface;** could be grouped by domain
  namespace (`api.pty.*`, `api.fs.*`, …) — deliberately deferred as a large,
  app-wide, mostly-stylistic change.
