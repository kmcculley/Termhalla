# Window Management (Undock / Re-dock)

> Tear a workspace tab off the strip into its own OS window — positionable on any monitor — and
> drag it back, dock-button it, or close it to re-dock. Live shells survive the move with their
> scrollback intact, and the multi-window arrangement is restored on relaunch.

**Status:** Shipped · **Spec:** [undock-workspace-window](../superpowers/specs/2026-06-16-undock-workspace-window-design.md) · **Plan:** [undock-workspace-window](../superpowers/plans/2026-06-16-undock-workspace-window.md)

## What it does

Every workspace is a tab in the main window. Drag a tab **off** the strip and it tears out into a
genuine second Electron window (its own title bar, movable onto a second monitor, minimisable
independently). While dragging, a lightweight ghost of the tab follows the cursor: inside the app
window it is a DOM element; once the cursor leaves every app window (where a DOM element clips at
the window edge) main shows a frameless, click-through, always-on-top ghost chip window
(`src/main/drag-ghost.ts`, fed by the throttled fire-and-forget `win:dragGhost` channel) that
follows the screen cursor, hides again inside any app window, and is destroyed on drop, window
close, and quit. The real window is created when you release outside the strip. An undocked window shows a slim header (workspace
name + **Dock** button) instead of the full tab strip.

Re-dock three ways: drag the tab from the floating window back onto the main strip, click the
floating window's **Dock** button, or click its native window ✕ — all send the workspace (and its
live shells) back to the main window. ✕ **never** kills the shells; to delete a workspace you close
its tab as before.

The move never interrupts the running processes, and the visible terminal content (screen +
scrollback) is preserved across the handoff. On the next launch each window reopens at its last
size/position, hosting the workspaces it had (a window whose monitor disappeared recenters onto the
primary display).

## How it works

The privileged service layer (`PtyManager`, status/proc/ai trackers, stores) is built **once** and
is window-agnostic — PTYs are global and must not be duplicated per window. A new **`WindowManager`**
(`src/main/window-manager.ts`) owns everything multi-window:

- **Window lifecycle in three phases** so no renderer can invoke an IPC handler before it exists:
  `prepare(state)` creates a `BrowserWindow` per saved window *without loading content*;
  `registerHandlers(services, wm)` registers the global `ipcMain` handlers once; `start()` then
  loads the renderer into every window. Assignments are pushed on `did-finish-load`.
- **Event routing.** `registerHandlers`' `send` routes each push event through the manager:
  pane-scoped channels (`pty:data`/`-status`/`-cwd`/`-procs`/`-exit`, `ai:session`,
  `usage:metrics`, `rec:state`, `term:serialize`) go to the window that owns the pane; app-global
  channels (`cloud:status`, `env:state`, `fs:change`) broadcast to all windows.
- **Pane ownership** (`paneId → windowId`) is established from the `pty:spawn` event *sender*
  (`claimPane`) and re-affirmed on every spawn, so main never guesses which window holds a pane.
  An unowned pane defaults to the main window.
- **The handoff.** On a tab drop, the renderer sends `win:dragEnd { workspaceId, cursor }`; the
  manager hit-tests the cursor against the **main** window's tab-strip rectangle (the only re-dock
  target — floating windows hold exactly one workspace). `move()` then: asks the source window to
  `term:serialize` the workspace (the renderer replies one `term:snapshot { paneId, data }` per
  terminal pane + an `__end__:<workspaceId>` sentinel); updates the pure ownership model
  (`undock`/`redock` in `window-manager-core.ts`); creates+loads the new window (undock) or moves to
  the target and closes an emptied floating source (redock); and re-assigns both ends. The source
  window then unmounts the workspace (the one sanctioned xterm dispose — *after* the snapshot is
  captured; the PTY keeps running in main).
- **Adopting the live PTY.** When the destination window mounts the workspace, each `TerminalPane`
  calls `pty:spawn` as usual — but the pane already has a live pty, so the **idempotent** spawn
  handler (`pty.has(id)`) adopts it instead of respawning and calls `replayInto`, which writes the
  captured snapshot then flushes every pane-scoped event buffered during the move. Live `pty:data`
  (and status/cwd/exit) arriving mid-move is held in a `transit` buffer so nothing is lost or
  delivered to a not-yet-mounted window; a GC timer (`TRANSIT_GC_MS`) flushes a handoff whose
  destination never re-attached so a dropped move can't leak or wedge a terminal.
- **Arrangement persistence.** `AppState` is now `windows: WindowLayout[]` (each = workspace ids +
  active tab + bounds + `isMain`). Main is the sole writer; the renderer keeps main in sync by
  sending `win:report` whenever the user adds, closes, reorders, or switches a workspace.
  `loadAppState` migrates the legacy single-window shape (`openWorkspaceIds`/`activeWorkspaceId`)
  into `windows[0]`.

**Renderer.** The store is window-local: `applyAssignment` (driven by the `win:assignment` push)
loads the workspaces main says this window hosts, drops ones it no longer owns, and seeds a starter
workspace only in an empty main window. `App.tsx` renders `WorkspaceTabs` in the main window and
`FloatingHeader` (the Dock button) in undocked windows. `WorkspaceTabs` tabs drag via pointer
events — a sub-threshold press is a click (activate), past it a ghost follows the cursor; an
intra-strip drop reorders locally, an off-strip drop goes to main as `win:dragEnd`. `TerminalPane`
loads `@xterm/addon-serialize` and registers a per-pane snapshot function in `terminal-registry.ts`.

## Key files

| File | Responsibility |
|---|---|
| `src/main/window-manager-core.ts` | Pure ownership model: `undock`/`redock`/`decideDrop`/`windowOf`/`ghostVisibleAt` |
| `src/main/drag-ghost.ts` | OS-level tear-off ghost chip window (outside-the-window drag feedback) |
| `src/main/window-manager.ts` | Electron shell: window lifecycle, event routing, the live handoff |
| `src/main/services.ts` | `buildServices()` — the build-once privileged layer |
| `src/main/ipc/register.ts` | Registers handlers once; the routing `send` seam |
| `src/main/ipc/register-pty.ts` | Idempotent `pty:spawn` (adopt + replay), `claimPane` |
| `src/shared/app-state-model.ts` | `migrateAppState` (legacy single-window → `windows[]`) |
| `src/renderer/store.ts` | `applyAssignment`, `serializeWorkspace`, `win:report` on mutations |
| `src/renderer/components/FloatingHeader.tsx` | Undocked-window header + Dock button |
| `src/renderer/components/WorkspaceTabs.tsx` | Pointer-drag tab tear-off + ghost |
| `src/renderer/components/terminal-registry.ts` | Per-pane xterm snapshot registry |

## Behaviors & edge cases

- **One xterm per PTY (single-owner invariant).** A pane is rendered by exactly one window at a
  time; ownership is updated before the destination attaches, so there's never double echo.
- **Floating windows hold one workspace.** Only the main strip is a re-dock target, so a floating
  window never accumulates tabs — keeping the header and the handoff simple.
- **Native ✕ on a floating window re-docks** (preventDefault → move workspace back to main), never
  killing PTYs. The main window's ✕ is a normal close → app quit.
- **Crash safety.** Window bounds + assignment are persisted on every change (debounced for the
  resize/move drag), so even a force-killed floating window is restored as its own window next
  launch — a workspace is never lost.
- **Handoff GC.** If a destination never re-attaches a pane within `TRANSIT_GC_MS`, its buffer is
  flushed and buffering stops, bounding memory and un-wedging the terminal.
- **One-time upgrade reset.** Migrating from the legacy single-window state seeds the main window's
  bounds from the default (the old `window-state.json` position isn't carried over).

## Testing

Vitest:
- `tests/shared/app-state-model.test.ts` — legacy→`windows[]` migration, passthrough, junk/future-version rejection.
- `tests/main/window-manager-core.test.ts` — `undock`/`redock` ownership transfers (incl. empty-window close, never-empty-main), `decideDrop` hit-testing, and `ghostVisibleAt` (OS ghost only outside every app window).
- `tests/main/store.test.ts` — `loadAppState` migrates a legacy app-state on load.
- `tests/main/pty-manager-has.test.ts` — `PtyManager.has` detects an already-running pane.

Playwright-for-Electron (`tests/e2e/undock.spec.ts`):
- Tear a workspace off → a second window appears owning it, showing preserved scrollback; typing in
  it echoes (the PTY survived); Dock re-docks and the floating window closes.
- Relaunch with the same user-data-dir restores both windows.
- The OS-level drag ghost: an out-of-window `win:dragGhost` position creates+shows the ghost window,
  an in-window one hides it, `null` (drag end) destroys it. (Playwright can't move the OS cursor
  outside the Electron window, so the e2e drives the channel directly; the show/hide decision is
  unit-tested.) Specs that tear off select the floating window **by its `floating-header`**, never
  "any window ≠ main" — the transient ghost window also appears in `app.windows()` mid-drag.

The `workers: 1` e2e pin is about a single Electron *instance*, not a single window — Playwright
observes all `BrowserWindow`s in the one instance, so multi-window tests are unaffected.

## Related

- [Architecture](../architecture.md) · [Workspaces](workspaces.md) · [Decisions](../decisions.md)
- Load-bearing gotchas this respects: keep-workspaces-mounted (the only unmount is the
  post-snapshot dispose on a move), ANSI-stripped status tail, avoid redundant resizes.
