# Undock Workspace Into Its Own Window — Design

> Drag a workspace's tab off the strip to tear it out into its own real OS
> window, positionable anywhere including a second monitor; drag it back (or use
> a dock button / native close) to re-dock. Live shells survive the move with
> their scrollback intact, and the multi-window arrangement is restored on
> relaunch.

**Status:** Designed · **Date:** 2026-06-16

## Goal

A workspace is currently a tab in the single app window. This feature lets a
user **tear off** a workspace tab into a genuinely separate Electron
`BrowserWindow` that can be moved onto any display, and **re-dock** it back into
the main window. The running PTYs are never interrupted by the move, and the
visible terminal scrollback is preserved across the handoff.

### Resolved decisions (from brainstorming)

| Question | Decision |
|---|---|
| What does an undocked workspace become? | A real separate OS `BrowserWindow` (only model that can cross monitors). |
| Visible terminal content on move? | **Preserve scrollback** — serialize each xterm and replay into the new window; PTY keeps running. |
| How to re-dock? | Drag the tab back onto the main window's strip **and** a dock button in the floating window header. |
| Native window close (X) on a floating window? | **Re-dock** the workspace (never kill its PTYs). To delete a workspace, close its tab as today. |
| Persist across restart? | **Yes** — restore each window's bounds + which workspaces it holds. |
| Drag feel? | **Ghost tab** follows the cursor; the real window is created only on drop. |

## Non-goals

- No live "window follows the cursor while dragging" (Chrome-style). The window
  is created on drop.
- No tiling/snapping of floating windows beyond what the OS provides.
- No process resurrection semantics change — restore still spawns fresh PTYs on a
  cold launch (as today); the survive-the-move guarantee applies to a *live*
  undock/re-dock within a running session.
- The **main** window cannot be torn off (it is the root) and its native X quits
  the app, exactly as today.

## Architecture

### The core shift

Today `registerHandlers(win)` (`src/main/ipc/register.ts`) builds the **entire**
service layer bound to one `BrowserWindow`, and its `send` helper always targets
that one window's `webContents`. PTYs live in `PtyManager` keyed by pane id;
every push event (`pty:data`, `pty:status`, …) goes to the single window.

To support N windows we make the service layer **window-agnostic and built once**,
and **route each pane-scoped event to the window that owns the pane.**

### 1. Data model — `src/shared/types.ts`, `app-state.json`

`AppState` changes from one flat window to a list of windows:

```ts
interface WindowLayout {
  workspaceIds: string[]   // workspaces docked in this window, in tab order
  activeId: string | null  // active tab within this window
  bounds: WindowState      // reuses existing WindowState (x/y/w/h + maximized)
  isMain: boolean          // exactly one true; the main window is the root
}
interface AppState {
  windows: WindowLayout[]  // windows[0] is main; replaces openWorkspaceIds/activeId
  schemaVersion: number
}
```

- Bump `SCHEMA_VERSION` in `src/shared/types.ts`.
- **Migration:** an old `AppState` (`{ openWorkspaceIds, activeId }`) becomes
  `windows: [{ workspaceIds: openWorkspaceIds, activeId, bounds: <from window-state.json>, isMain: true }]`.
  The standalone `window-state.json` is read once during migration and folded
  into `windows[0].bounds`; thereafter window bounds live in `app-state.json`.
  `clampWindowState` is retained and applied **per window** on restore (a window
  whose monitor disappeared recenters onto the primary display).

### 2. `WindowManager` — `src/main/window-manager.ts` (new)

Owns everything multi-window. Split into a **pure core** (testable without
Electron) and a thin **Electron shell**:

- **Pure core** (`window-manager-core.ts`): the ownership tables and the
  transfer operations as pure functions over plain data —
  `paneId → windowId`, `workspaceId → windowId`, and
  `undock`/`redock`/`removeEmptyWindow` that return the next assignment state.
  Hit-testing (`cursor + window bounds → target`) is pure too. This is where the
  invariants live and where the unit tests point.
- **Electron shell**: creates/destroys `BrowserWindow`s, reads
  `screen.getCursorScreenPoint()` and window bounds, pushes `win:assignment`
  events, and persists `AppState`. It delegates all decisions to the core.

**Single-owner invariant:** every pane is owned by exactly one window, so exactly
one xterm is ever attached to a given PTY — no double-echo. Ownership is updated
atomically *before* the destination window attaches.

### 3. Service construction moves up — `src/main/index.ts`, `register.ts`

- Extract service construction (`PtyManager`, `StatusEngine`, `ProcessTracker`,
  `AiSessionTracker`, `WorkspaceStore`, `QuickStore`, `Recorder`, `EnvVault`,
  integration scripts) into an app-level `buildServices()` run **once** at
  startup — not per window.
- `registerHandlers` becomes `registerHandlers(services, windowManager)` and
  registers the IPC handlers once. The win-bound `send` is replaced by
  `routeToPane(paneId, channel, …)` and `broadcast(channel, …)` provided by the
  `WindowManager`.
- **Routing rules:**
  - Pane-scoped → owning window: `pty:data`, `pty:status`, `pty:cwd`,
    `pty:procs`, `ai:session`, `usage:metrics`, `rec:state`, `pty:exit`.
  - App-global → broadcast to all windows: `cloud:status`, `env:state`.
  - All sends stay wrapped in `safeSend` (a window may be torn down mid-send).

### 4. New IPC — `src/shared/ipc-contract.ts`

| Channel | Dir | Payload | Purpose |
|---|---|---|---|
| `win:dragEnd` | r→m | `{ workspaceId, cursor: {x,y} }` | Drag released; main hit-tests and decides undock / re-dock / snap-back. |
| `win:redock` | r→m | `{ workspaceId, targetWindowId }` | Explicit re-dock (dock button / native X). |
| `win:assignment` | m→r **event** | `{ workspaceIds, activeId }` | Tells a renderer which workspaces it now owns; drives mount/unmount. |
| `term:serialize` | m→r **event** | `{ paneId }` | Ask the source window to snapshot a terminal. |
| `term:snapshot` | r→m | `{ paneId, data }` | The ANSI snapshot string back to main. |

Window identity in events is implicit (each window only ever hears about its own
assignment); `targetWindowId` is an opaque id minted by the `WindowManager`.

### 5. Renderer — `src/renderer/`

- The store gains a window-local `order`/`activeId` driven by `win:assignment`
  rather than loading the global app-state directly. `App.tsx` renders only the
  workspaces this window owns (the keep-mounted lifecycle is unchanged *within* a
  window).
- `WorkspaceTabs.tsx`: tabs become pointer-drag sources. A drag past the strip
  shows a **ghost tab** (a lightweight element following the cursor). On
  `pointerup`, send `win:dragEnd { workspaceId, cursor }`.
- A floating (non-main) window renders a slim header with a **dock** button
  (→ `win:redock` to the main window) and the workspace name. The main window's
  strip is also a drop target for a ghost dragged back from a floating window
  (the hit-test is done in main on `win:dragEnd`).
- `@xterm/addon-serialize` is added to each `TerminalPane`'s xterm so it can
  answer `term:serialize` with `serialize.serialize()`.

## Tear-off / handoff sequence

1. User pointer-drags a tab; on `pointerup` the renderer sends
   `win:dragEnd { workspaceId, cursor }`.
2. Main hit-tests `cursor` against every window's tab-strip rect (pure core).
   Outside all strips → **undock**; over another window's strip → **re-dock**
   there; over its own strip → snap back (no-op).
3. **Undock path:** main emits `term:serialize` for each pane in the workspace to
   the **source** window; the source replies `term:snapshot { paneId, data }`
   per pane. Main buffers any `pty:data` arriving for those panes from this point
   until the destination attaches (so no live bytes are dropped).
4. Main creates a new `BrowserWindow` at the cursor, updates ownership
   (`paneId`/`workspaceId` → new window), removes the workspace from the source
   window's assignment, and emits `win:assignment` to **both** windows.
5. Source window unmounts the workspace — the single sanctioned xterm dispose,
   performed *after* the snapshot is captured. The PTY keeps running in main.
6. New window mounts the workspace with fresh xterms, writes each snapshot
   string, attaches the live `pty:data` stream, then main flushes the buffered
   bytes from step 3. Result: uninterrupted process, seamless scrollback.

Re-dock is the same sequence in reverse, with the destination being the target
window's strip; if the source floating window is left with no tabs it closes
itself.

## Error handling & edge cases

- **Main window is the root:** never torn off; native X quits the app (today's
  behavior). Floating-window native X is intercepted → `win:redock` to main
  (PTYs never killed by an X click).
- **Empty floating window:** when its last workspace re-docks, the window closes.
- **Orphaned workspaces:** if a floating window is destroyed by the OS without a
  graceful re-dock, its workspaces are reassigned to the main window on the next
  app focus, so a workspace is never lost (PTYs still live in main).
- **Handoff race — `pty:exit` mid-move:** the destination still mounts and shows
  the final buffered output plus the exit line; the buffer-then-flush ordering
  guarantees no lost bytes.
- **Restore clamping:** each restored window runs through `clampWindowState`; a
  window off all current displays recenters onto the primary.
- **Quit during a debounced save:** `beforeunload` flush still applies; the
  multi-window `AppState` is written synchronously on quit.

## Persistence

`AppState` (`app-state.json`) now stores `windows[]` with per-window bounds and
assignments. On launch the `WindowManager` recreates one `BrowserWindow` per
entry, clamps bounds, and emits each window's `win:assignment`. Workspaces' own
files (`workspaces/<id>.json`) are unchanged — only *which window hosts which
workspace* is new state.

## Testing (TDD)

**Pure unit (vitest):**
- `AppState` migration: old single-window `{ openWorkspaceIds, activeId }` +
  `window-state.json` → `windows: [{ …, isMain: true }]`; future-version
  rejection still holds.
- `window-manager-core`: undock moves ownership and removes from source; redock
  reverses it; empty non-main window is flagged for removal; main window is never
  emptied to nothing; hit-test maps a cursor to the right window / "outside".
- Per-window `clampWindowState` on restore (off-screen recenter, maximized
  preserved) — extends existing `window-state.test.ts` patterns.

**e2e (Playwright-for-Electron):** Playwright observes multiple `BrowserWindow`s
in one Electron instance — the `workers: 1` rule is about a single *instance*,
not a single *window*, so it is unaffected.
- Tear-off: drag a tab out → a second window appears owning that workspace; its
  terminal shows the **preserved scrollback** (marker text typed before the
  drag).
- Survival: type into the undocked terminal → echo appears (PTY survived the
  move).
- Re-dock via dock button → workspace returns to the main strip and the floating
  window closes.
- Restart: with one undocked workspace, relaunch with the same
  `--user-data-dir` → two windows restore with the right workspaces.

## Files touched

| File | Change |
|---|---|
| `src/shared/types.ts` | `WindowLayout`, new `AppState`, `SCHEMA_VERSION` bump, migration. |
| `src/shared/ipc-contract.ts` | `win:dragEnd`/`win:redock`/`win:assignment`/`term:serialize`/`term:snapshot`. |
| `src/main/index.ts` | `buildServices()` once; create windows via `WindowManager`. |
| `src/main/window-manager.ts` + `window-manager-core.ts` | New — ownership, hit-test, window lifecycle. |
| `src/main/ipc/register.ts` | `registerHandlers(services, windowManager)`; routed `send`. |
| `src/main/ipc/register-pty.ts` (+ siblings) | Use `routeToPane`/`broadcast` instead of win-bound `send`. |
| `src/main/persistence/store.ts` | Read/write the new `AppState`; one-time migration. |
| `src/main/window-state.ts` | Per-window clamp on restore. |
| `src/renderer/store.ts` (+ slices) | Window-local `order`/`activeId` from `win:assignment`. |
| `src/renderer/components/WorkspaceTabs.tsx` | Pointer-drag tabs + ghost; floating-window header + dock button. |
| `src/renderer/components/TerminalPane.tsx` | `@xterm/addon-serialize`; answer `term:serialize`. |
| `package.json` | Add `@xterm/addon-serialize`. |

## Related

- [Architecture](../../architecture.md) · [Workspaces feature](../../features/workspaces.md)
- Load-bearing gotchas this respects: keep-workspaces-mounted (the only unmount
  is the post-snapshot dispose on undock), ANSI-stripped status tail, avoid
  redundant resizes.
