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

## Third review (2026-06-16 #3) — Critical + Major resolved

A third `/review-quality` pass over the post-refactor `src/` found 2 Critical +
9 Major + 16 Minor. All Critical and Major were resolved on `main` as
behavior-preserving changes, covered by the existing unit + e2e suites plus new
unit tests (256 unit tests, all 25 e2e specs green):

- **[Critical] `closeTab` ran side effects inside a `setOrder` updater** (model
  switch + persist), which React may double-invoke under StrictMode/batching. The
  next order/active is now computed *outside* the updater and the effects run
  after. Moved into the new `editor/use-editor-tabs.ts` hook.
- **[Critical] `EnvVault.unlock` could silently destroy stored vars.** A
  decrypted-but-malformed payload was coerced to empty maps, so the next
  `setGlobal` overwrote the real file. New pure `parseVaultData` strictly
  validates shape (and a `version` field) and *rejects* rather than coercing;
  `persist` now stamps `VAULT_VERSION`. Legacy (version-less) vaults still read.
- **[Major] `EditorPane` god component** → all Monaco/tab/draft/save/untitled/
  theme lifecycle moved into `editor/use-editor-tabs.ts`; the tab-strip JSX (incl.
  the inline untitled IIFE) is now `components/EditorTabStrip.tsx`
  (`UntitledTab`/`FileTab`). `EditorPane` is ~35 lines of presentation.
- **[Major] `register.ts` god module** → split into per-domain registrars
  (`register-pty`/`-fs`/`-workspaces`/`-drafts`/`-cloud`/`-usage`/`-recording`/
  `-env`, with `ipc/types.ts` for the shared `Send`/`Disposer`). `registerHandlers`
  is now a thin composition root that aggregates disposers into one
  `win.on('closed')`.
- **[Major] Env-vault unlock backoff lived in the IPC layer** (loose closure vars
  + magic numbers). Moved into `EnvVault.unlock(passphrase, now?)` with named
  `UNLOCK_BACKOFF_BASE_MS`/`MAX_MS`, so it can't be bypassed and is unit-tested.
- **[Major] Corrupt workspace/app-state crashed `ws:load`.** `loadWorkspace` now
  degrades a malformed file to `null` (like quick/draft state) instead of
  rejecting the IPC call; `loadAppState` validates shape via `isAppState`.
- **[Major] `StatusTracker.tick` idle heuristic** extracted to a pure
  `computeIdleFallback(quietMs, tail, hasMarkers, cfg)` in `needs-input.ts`, with
  named intermediates and direct unit tests.
- **[Major] `App` subscribed to the whole store** → scoped `useShallow` selector
  for `{ activeId, workspaces, order }`.
- **[Major] Per-pane theme effect duplicated** in `EditorPane`/`TerminalPane` →
  shared `useResolvedPaneTheme(wsId, paneTheme)` hook.
- **[Major] Divergent `basename` helpers** (4 copies) → one `@shared/paths`
  `basename` (trailing-slash-safe), imported everywhere.
- **[Major] Duplicated MRU logic** (`pushRecent` vs `nextRecentDirs`) →
  `pushRecent` gained an optional equality predicate; `nextRecentDirs` delegates.

Minor fixes folded in along the way: the fragile `join(' ')` order-equality check
is now element-wise `sameOrder`; several magic numbers named (`CLOUD_FOCUS_REFRESH_MS`,
`DEFAULT_REC_SIZE`). The remaining Minor findings (IPC channel casing, `as never`
preload casts, `VaultData`/`EnvVaultData` duplicate, window-state dynamic import +
debounce, `WorkspaceView` mosaic cast, etc.) stay deferred below.

## Fourth review (2026-06-17 #4) — Major resolved

A fourth `/review-quality` pass over `src/` found 0 Critical, 6 Major, 13 Minor.
All **6 Major** were resolved on `main` (`6e4039f`, `e7173dd`) — TDD where the
logic is pure (23 new renderer unit tests + 1 env-vault test), covered by the
existing e2e suite for the UI wiring. See [decisions.md](../decisions.md) (the
`runOp`/vault-write and api-free-helpers entries) and the
[changelog](../../CHANGELOG.md):

- **[Major] Editor save lost content on a failed write.** A rejected `fs:write`
  still marked the buffer clean and deleted its recovery draft. Save now commits
  clean-state + drops the draft only after the write succeeds (via the new tested
  `op.ts` `runOp`), else toasts "Save failed" and leaves the buffer dirty.
- **[Major] Env add/create toasted a false success.** `env:setGlobal`/`setTerminal`
  promoted from `send` to `invoke` and `EnvVault.persist()` no longer swallows
  write errors, so create/set propagate a failure to the renderer's `runOp`.
  Removes stay best-effort. *(Resolves the deferred persist-swallow item below.)*
- **[Major] Shell-id fallback duplicated across 4 launch sites** → `defaultShellId`
  in the new api-free `store/pane-ops.ts`.
- **[Major] Add-pane dispatch triplicated and drifted** (App/CommandPalette/
  WorkspaceTabs each re-inlined `ws.layout ? … : null` + the kind branch, one with
  a latent unguarded `ws.layout`) → one `addPaneOfKind` store action over the
  tested `dispatchAddPane` (guards a missing workspace).
- **[Major] `ThemeSettings` god component** → the three scope ladders (`t`,
  `scopeOf`, target parse) collapse into tested `components/theme-scope.ts`
  helpers.
- **[Major] `WorkspaceTabs` doing too much** → pointer-drag/undock orchestration
  extracted to a `useTabDrag` hook.

The 13 Minor findings (dead exports in `paths.ts`/`window-state.ts`,
`parseClaudeUsage` window-policy split, `detectShells` cmd-fallback literal,
`computeIdleFallback` boolean-trap flags, `deserializeWorkspace` raw `JSON.parse`
[also tracked under review #2], `normalizeQuick` theme cast, scattered timing
constants, `tabBadge`/`StatusBar` inline assembly, `ScheduleDialog` 6-state clump,
`EnvSettings` row duplication, `SettingsPanel` render-phase setState) stay
deferred.

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
- ~~**Silent write-error swallow in `EnvVault.persist()`.**~~ **Resolved** (review #4,
  `e7173dd`): `persist()` now propagates, and create/set are `invoke` so a failed
  vault write surfaces a toast instead of a false success. The empty `catch` in
  `integration-scripts.ts` remains deferred (best-effort shell-integration write).

### Newly tracked from review #2 (Minor)

- **`proc-tree.buildProcInfo` builds `childrenMap(rows)` twice** per poll
  (in `descendantsOf` and `pickForeground`); build once and pass `byParent` down.
- **`buildPaletteItems` favorite dedup is case-sensitive** while `nextRecentDirs`
  dedups via `normDir` — on Windows a dir can appear as both favorite and recent.
- **`deserializeWorkspace` lets a raw `JSON.parse` `SyntaxError` escape** instead
  of the friendly domain error; wrap the parse.
- **`workspace-model.migrate` is identity for all versions** with no v1/v2 cases
  though `SCHEMA_VERSION` is 3 — document the no-op or add explicit cases.
- ~~**`preload` listeners use `as never`** to satisfy `ipcRenderer.on`; type with
  `IpcRendererEvent` instead.~~ **Resolved** — every push channel now goes through one
  `pushChannel<A>()` factory that attaches a single `IpcRendererEvent`-typed listener and fans
  out to subscribers (no casts). This also fixed a `MaxListenersExceededWarning` at 11+ open
  terminals (each pane previously added its own `pty:data`/`pty:exit` listener).
- **`ThemeProvider`'s 150 ms Monaco-theme delay is a magic timing hack;**
  `status-tracker`'s `400` tail length and `ScheduleDialog`'s `dV/dU/...` paired
  state names are unnamed/opaque.
- **Type design:** `CloudState` folds the transient `'checking'` into the same
  union as stable states; `Partial<Theme>` is reused unnamed across configs
  (introduce a `ThemeOverride` alias). (`AiTool` already named in review #2.)
- **IPC contract is a flat 50-method surface;** could be grouped by domain
  namespace (`api.pty.*`, `api.fs.*`, …) — deliberately deferred as a large,
  app-wide, mostly-stylistic change.
