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

## Fourth review (2026-06-17 #4) — Major + Minor resolved

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

All **13 Minor** findings were then swept on `main` (`283ce0f`) as
behavior-preserving changes (pure extractions TDD-covered, +13 new unit tests;
383 unit + all touched e2e green):

- **Dead code** — removed unused `paths.ts` exports (`workspacesDir`/`appStatePath`/
  `windowStatePath`) and `window-state.ts` `loadWindowState`/`saveWindowState`.
- **`parseClaudeUsage` window policy** → extracted `computeContextWindow`.
- **`computeIdleFallback` 4 positional booleans** → trailing AI flags grouped into
  an options object.
- **`deserializeWorkspace` raw `JSON.parse`** → wrapped into a clear "not valid
  JSON" error. *(Also closes the review-#2 item below.)*
- **`normalizeQuick` triple theme cast** → extracted `normalizeTheme`.
- **`detectShells` duplicated cmd literal** → shared `CMD_FALLBACK`.
- **Scattered magic timing/size numbers** → named constants (shared
  `AUTOSAVE_DEBOUNCE_MS`, `NEW_WINDOW_SIZE`, `TOAST_DISMISS_MS`,
  `NO_CHILDREN_AUTO_CLOSE_MS`, `MONACO_THEME_DEFER_MS`, `HANDOFF_SCROLLBACK_LINES`).
- **`tabBadge`/`StatusBar` inline assembly** → tested `components/tab-badge.ts`
  (`workspaceBadgeState` + `formatBadge`) and a `StatusBar` `accountLabel` helper;
  `aiState` moved to the api-free `pane-ops` module.
- **`ScheduleDialog` 6-state clump** → three `Duration` objects + a `DurationInput`.
- **`EnvSettings` row duplication** → `EnvRow` reused for the per-terminal rows.
- **`SettingsPanel` render-phase setState** → kept (the sanctioned React pattern)
  with a sharpened comment.
- Also: `withoutWorkspace` shared by undock/redock, `cancelPersist` shared by
  schedule/persistState, `pickOne` dialog factory, and the "dispose disposer"
  doc-comment wording.

## Still deferred

- **EditorPane tab state still lives in a ref-held `Map` + `force` re-render.**
  The hooks extraction isolated the IO/timer concerns but did not retire the
  manual re-render hack. Moving per-tab dirty/missing/externalChanged flags into
  real React state (or a subscribable `TabSet`) is the deeper fix. *(Major #1,
  partially addressed.)*
- **Duplicate vault type: `VaultData` (main `env-vault.ts`) vs `EnvVaultData`
  (`@shared/types`).** Identical shape declared twice; main should import the
  shared type. *(Minor.)*
- ~~**`AppState.schemaVersion` hardcoded to `1` (store `saveAll`) while
  `SCHEMA_VERSION` is `3`, and the field is never read in `loadAppState`.**~~
  **Resolved** (verified 2026-07-07): `migrateAppState` (`src/shared/app-state-model.ts`, the
  2026-07-06 audit Group A #4 rework) now validates `schemaVersion` on load, rejects
  newer-than-supported values, and stamps `SCHEMA_VERSION` on the normalized output.
- ~~**Silent write-error swallow in `EnvVault.persist()`.**~~ **Resolved** (review #4,
  `e7173dd`): `persist()` now propagates, and create/set are `invoke` so a failed
  vault write surfaces a toast instead of a false success. The empty `catch` in
  `integration-scripts.ts` remains deferred (best-effort shell-integration write).

### Newly tracked from review #2 (Minor)

- **`proc-tree.buildProcInfo` builds `childrenMap(rows)` twice** per poll
  (in `descendantsOf` and `pickForeground`); build once and pass `byParent` down.
- **`buildPaletteItems` favorite dedup is case-sensitive** while `nextRecentDirs`
  dedups via `normDir` — on Windows a dir can appear as both favorite and recent.
- ~~**`deserializeWorkspace` lets a raw `JSON.parse` `SyntaxError` escape.**~~
  **Resolved** (review #4, `283ce0f`): the parse is wrapped into a friendly
  "Invalid workspace file: not valid JSON" error.
- ~~**`workspace-model.migrate` is identity for all versions** with no v1/v2 cases
  though `SCHEMA_VERSION` is 3 — document the no-op or add explicit cases.~~
  **Resolved** (verified 2026-07-07): `migrate` now carries explicit documented per-version
  steps (v7 view-state backfill; v8/v9 documented identities) plus a newer-than-supported
  rejection guard.
- ~~**`preload` listeners use `as never`** to satisfy `ipcRenderer.on`; type with
  `IpcRendererEvent` instead.~~ **Resolved** — every push channel now goes through one
  `pushChannel<A>()` factory that attaches a single `IpcRendererEvent`-typed listener and fans
  out to subscribers (no casts). This also fixed a `MaxListenersExceededWarning` at 11+ open
  terminals (each pane previously added its own `pty:data`/`pty:exit` listener).
- **`status-tracker`'s `400` tail length** is an unnamed magic number.
  (`ThemeProvider`'s 150 ms delay → `MONACO_THEME_DEFER_MS` and `ScheduleDialog`'s
  `dV/dU/...` → `Duration` objects were resolved in review #4, `283ce0f`.)
- **Type design:** `CloudState` folds the transient `'checking'` into the same
  union as stable states; `Partial<Theme>` is reused unnamed across configs
  (introduce a `ThemeOverride` alias). (`AiTool` already named in review #2.)
- **IPC contract is a flat 50-method surface;** could be grouped by domain
  namespace (`api.pty.*`, `api.fs.*`, …) — deliberately deferred as a large,
  app-wide, mostly-stylistic change.

## Whole-project audit (2026-07-06) — Groups A + B resolved

A six-reviewer `/review-quality` audit over the whole project (every finding
adversarially verified) found **0 Critical, 10 Major, 22 Minor**. The working
fix plan (all medium-and-above findings + recommended fixes, grouped A–C) lives
in the session handoff; resolution is tracked here.

**Group A — crash/freeze paths: resolved on `main` (2026-07-07)**, see the
changelog `[Unreleased]` → Fixed for full detail:

- chokidar watchers had no `'error'` listener (×4 factories) → all main-process
  watchers now go through `safeWatch` (`src/main/safe-watcher.ts`), pinned by a
  structural test; agent-side siblings (daemon-spawn `'error'`, `process.stdout`
  `'error'` in bridge + stdio agent) fixed in the same pass.
- Unguarded `addon.serialize()` in replay `drain()`/`dispose()` (a throw inside
  xterm's write callback killed the daemon + all surviving panes) → degraded
  settle + diagnostic (`tests/agent-replay-containment.test.ts`).
- Notification click captured the raising `BrowserWindow` (destroyed-window
  `.show()` on an Action Center click) → id captured, re-resolved at click time;
  `WindowManager.mainWindow()/mainWindowId()` return `undefined` instead of
  `!`-throwing, making `focusMainWindow`'s guard live.
- `migrateAppState` blind-cast persisted `windows[]` entries (startup crash-loop
  on one junk entry) → per-entry normalization (tests in
  `tests/shared/app-state-model.test.ts`).

**Group B — unbounded buffers: resolved on `main` (2026-07-07)**, see the
changelog `[Unreleased]` → Fixed for full detail:

- `Osc133Parser`/`CwdParser` carry-over via `scanOsc` was unbounded + O(n²) on
  the StatusEngine hot path → the OrkyOscParser `MAX_PENDING_BYTES` ceiling
  layered in both `push` methods (`scanOsc` untouched; 512 B / 8 KiB; pinned by
  `tests/main/osc-pending-bound.test.ts`, marker semantics unchanged).
- Image preview buffered the whole body before the 25 MB cap, no timeout →
  streaming `fetchImageBytes` (Content-Length early reject, mid-stream abort at
  the cap, 15 s `AbortSignal.timeout`; unit-covered in
  `tests/main/preview.test.ts`).
- `connectDaemonAgent`'s `stderrRaw` grew for the connection's lifetime →
  accumulation stops at settle (FINDING-010 posture).

**Group C #8 + the borderline items: resolved on `main` (2026-07-07)**, see the
changelog `[Unreleased]`:

- Workspace-registration ritual ×4 (+ `adoptWorkspace` overlap) → the one shared
  `registerWorkspace` (`src/renderer/store/workspace-registration.ts`, threaded
  as `SliceDeps.registerWorkspace`; pure-tested, 0011 pins amended to the new
  seam with assertions intact).
- Editor save (`writeTextFile`) was the app's one non-atomic durable write →
  routes through `atomicWrite` (mtime still returned).
- Remote evt payloads forwarded into renderer IPC on unvalidated casts →
  `onEvt` type-checks each payload position, drops with one diagnostic
  (`tests/main/remote-manager-evt-validation.test.ts`).

**Group C #9 + 0024 FINDING-001: resolved on `main` (2026-07-07)** as one
behavior-preserving refactor, see the changelog `[Unreleased]` → Changed:

- `connectAgent`/`connectDaemonAgent` ~140-line fork → the ONE shared
  `runConnectPump` (`src/remote-client/connect-pump.ts`).
- The ssh exec-channel scaffold ×3 (upload/probe/install) →
  `runSshExecChannel` (`src/remote-client/exec-channel.ts`).
- Node-pty co-provision orchestration moved out of `bootstrap.ts` →
  `src/remote-client/co-provision.ts` (connect leg injected, no cycles).
- Duplicated `sanitizeStderr`/diagnostic constants consolidated (the 0024
  ledger Minor #25); `prebuilt.ts` keeps its own copy by documented
  dependency-free design.

**Group C #10: resolved on `main` (2026-07-07)**, see the changelog
`[Unreleased]` → Changed: the six hand-rolled popover chromes now render
through one shared `MenuSurface` (backdrop, right-click dismiss, Escape
dismiss — previously 2 of 6 — and the portal opt-in; the explorer context menu
gains the tile-escape portal it was missing). Pinned by
`tests/renderer/menu-surface-structure.test.ts`; menu-touching e2e suites all
green.

**Still open from this audit:** the 20 structural Minors (re-run
`/review-quality` scoped for detail). The 0024 ledger's FINDING-031
(`net.Server` `'error'` handler) remains explicitly deferred by Kevin
(2026-07-06) despite being the same family as the watcher fix.
