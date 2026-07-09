# Window Management — Review Follow-ups

Deferred items from the final code review of `feat/undock-workspace-window`. The feature is merged
as functionally complete (tear-off, preserved scrollback, PTY survival, re-dock, restart all work
and are covered by `tests/e2e/undock.spec.ts`). These are minor multi-window polish items.

## Fixed in-branch

- **Native dialogs parent to the invoking window.** `register-fs.ts` dialogs now anchor to
  `BrowserWindow.fromWebContents(e.sender)`, so a folder/save dialog from an undocked window appears
  over that window, not the main one.
- **Notification-click focuses the raising window.** `register-pty.ts` notify-click resolves the
  sender window instead of always focusing main.
- **`closeWorkspace` only re-seeds in the main window** (`store.ts`), so a future close affordance in
  a floating window can't spawn a phantom "Workspace 1".

## Deferred

- ~~**Initial `env:state` in undocked windows.**~~ — **RESOLVED 2026-07-09** (quality/polish
  batch), exactly as recorded: `register-env.ts` re-emits the vault state on every `win:ready`
  signal (the broadcast `send` + idempotent renderer state make the re-emit harmless everywhere;
  main's `did-finish-load` emit kept), pinned by `tests/main/register-env-winready.test.ts`; and
  `register-cloud.ts`'s focus-refresh now rides the app-level `browser-window-focus` (any window,
  one shared debounce) instead of main's `win.on('focus')`. Cloud INITIAL state per window was
  already covered — every window's renderer pulls `cloud:current` on boot.
- **One-time bounds reset on upgrade.** `loadAppState` seeds the lifted main window's bounds from
  `DEFAULT_WINDOW_STATE` rather than the legacy `window-state.json`, so an upgrading user's main
  window jumps to 1200×800 once. To preserve it, read `loadWindowState()` and pass it as
  `migrateAppState`'s `fallbackBounds`.
- **Snapshot timeout = blank re-attach (by design).** If a source renderer doesn't reply within
  `captureSnapshots`' 500ms timeout, the destination adopts the live PTY but re-attaches blank
  (no scrollback). Graceful degradation, not a bug — noted so it isn't mistaken for one.
- **Defensive main-promotion path.** `onClosed`'s "promote a survivor to main" branch is currently
  unreachable (main's `onClose` always `app.quit()`s), kept only as a guard.
