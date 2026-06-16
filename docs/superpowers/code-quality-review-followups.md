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
  *(Minor.)*
- **`WorkspaceView`: six parallel `*For` popover states (data clump) and a
  ~105-line `renderTile`.** Collapse to a single `openPopover` state and extract
  toolbar/popover subcomponents. *(Minor.)*
- **`App`: subscribes to the whole store and repeats 11 near-identical IPC
  subscription effects.** Use narrow selectors and a subscription table.
  *(Minor.)*
