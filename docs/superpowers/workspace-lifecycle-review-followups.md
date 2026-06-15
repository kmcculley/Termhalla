# Workspace Lifecycle — Review Follow-ups (deferred)

Post-launch bug: switching workspace tabs blanked every pane — terminals lost
scrollback, the editor lost unsaved text, and a live Claude TUI froze until its
next write. **Fixed** on branch `fix/usage-and-workspace-switch` (`f45f36c`).

## The decision

`App.tsx` previously rendered only the active workspace
(`active ? <WorkspaceView/>`). Switching tabs unmounted the previous
`WorkspaceView`, disposing each pane's renderer state — `TerminalPane` calls
`term.dispose()` (and re-runs `ptySpawn` on remount → a blank terminal), and
`EditorPane` disposes its Monaco models (losing unsaved edits). The PTYs survive
in the main process; only the view was destroyed.

**Decision:** keep **all** workspaces mounted and show only the active one via
`visibility: hidden` — **not** `display: none`, which would zero each host's size
and thrash xterm's `FitAddon` and the PTY grid (the ConPTY full-screen-repaint
hazard documented in the cloud-status / sub-project D notes). Inactive hosts stay
full-size but non-interactive (`pointer-events: none`, `aria-hidden`).

## Consequence to watch (deferred)

- **Eager terminal spawn.** All workspaces' terminals now spawn at app launch
  instead of lazily on first view. This is required for state to survive switching
  (and means background workspaces are live immediately), but a user with many
  saved workspaces × many terminals pays that cost up front. If this becomes a
  problem, consider spawning a workspace's PTYs on first activation while still
  never unmounting once spawned. No action for now.

## Test

`tests/e2e/workspace-switch.spec.ts` — type a marker in a terminal, create a
second workspace (switching away), switch back, assert the marker survives. Fails
on the old conditional-render code (blank terminal); passes with the fix.
