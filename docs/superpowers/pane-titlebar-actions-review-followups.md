# Pane Title-bar Actions — Review Follow-ups

Deferred items from the final code review of `feat/pane-titlebar-actions`. The feature is merged as
functionally complete: the right-click title-bar menu (Rename / Move to workspace / Settings / Close),
the Maximize toggle (button + `Ctrl+Shift+M`), removal of the env/⚙/🎨 buttons, cross-workspace move
with preserved PTY + scrollback (terminals) and unsaved edits (editors), and theme carry-over to a new
workspace all work and are covered by `tests/e2e/pane-actions.spec.ts` plus the migrated
`settings`/`scoped-theme`/`status`/`env-per-terminal` specs and the `move-pane`/`pane-transit` unit tests.

## Fixed in-branch

- **Context menu portals to `<body>`.** Rendered inline it sat under the mosaic tile toolbar and
  intercepted no clicks (the tile's transform is a containing block for `position: fixed`). Now
  `createPortal`s like `Modal`.
- **Settings opens the right section per pane kind.** `PaneContextMenu` opens the terminal section for
  terminals and Appearance for editors/explorers (which have no terminal settings), instead of always
  the terminal section.
- **Stale `⚙` hint removed.** `TerminalAlertsSettings`' "open from a terminal's ⚙" fallback now reads
  "Right-click a terminal's title bar → Settings."
- **Theme carry-over extracted + unit-tested.** `carryTheme` in `workspace-model.ts` clones the source
  workspace's theme override onto a new workspace; covered in `tests/move-pane.test.ts`.
- **Pre-existing crash hardened (in passing).** `WindowManager.routeToPane` no longer asserts a main
  window exists when routing a late `pty:data` chunk during teardown (reproduced on `main`); fixes the
  flaky `cwd` e2e and the main-process error dialog.

## Deferred

- ~~**`focusedPaneId` is only set on pane mouse-down.** `Ctrl+Shift+M` (maximize the focused pane) is a
  silent no-op in a workspace the user hasn't clicked into yet~~ — **RESOLVED 2026-07-09**
  (quality/polish batch), via a chord-time fallback rather than focus seeding (narrower — no change
  to focus/`paneFocusSeq` semantics): the maximize AND minimize chords now target
  `chordPaneTarget(ws, focusedPaneId)` (`pane-ops.ts`, unit-tested) — the focused pane when it
  belongs to the active workspace, else the workspace's first pane.
