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

- **Initial `env:state` in undocked windows.** `register-env.ts` emits the one-time vault state on
  the *main* window's `did-finish-load` only; a floating window's env UI shows stale state until the
  next vault mutation re-broadcasts. Fix: re-emit app-global state (env, cloud) to a window when it
  signals `win:ready`, or have the renderer pull it on ready via `invoke`. Same shape would also
  cover **cloud focus-refresh** (`register-cloud.ts` `win.on('focus')` fires only for main).
- **One-time bounds reset on upgrade.** `loadAppState` seeds the lifted main window's bounds from
  `DEFAULT_WINDOW_STATE` rather than the legacy `window-state.json`, so an upgrading user's main
  window jumps to 1200×800 once. To preserve it, read `loadWindowState()` and pass it as
  `migrateAppState`'s `fallbackBounds`.
- **Snapshot timeout = blank re-attach (by design).** If a source renderer doesn't reply within
  `captureSnapshots`' 500ms timeout, the destination adopts the live PTY but re-attaches blank
  (no scrollback). Graceful degradation, not a bug — noted so it isn't mistaken for one.
- **Defensive main-promotion path.** `onClosed`'s "promote a survivor to main" branch is currently
  unreachable (main's `onClose` always `app.quit()`s), kept only as a guard.
