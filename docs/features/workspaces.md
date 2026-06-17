# Terminal Workspaces

> Multiple real Windows shells tiled in a saveable, named-tab layout that survives restart.

**Status:** Shipped · **Spec:** [termhalla-design](../superpowers/specs/2026-06-13-termhalla-design.md) · **Plan:** [phase1-terminal-workspace](../superpowers/plans/2026-06-13-termhalla-phase1-terminal-workspace.md)

## What it does

A workspace is a named tab holding a tiled arrangement of panes. In Phase 1 every pane is a live Windows terminal (PowerShell 7, Windows PowerShell, Git Bash, WSL, or cmd — whichever are installed). Panes split horizontally or vertically via `react-mosaic`, resize by dragging the gutters, and rearrange by drag-and-drop. A picker in the tab strip selects which discovered shell new terminals use.

Workspaces are saved to disk and restored on the next launch: layout tree, per-pane shell, and cwd come back, the window returns to its last size/position/maximized state, and fresh PTYs are spawned (no process resurrection, per spec). Saving is automatic and debounced — an explicit Save button exists but is rarely needed.

## How it works

**Main process** owns all privileged state. `src/main/pty/shells.ts:detectShells` probes a candidate list (`DEFAULT_SHELL_CANDIDATES`) with an injectable `exists` function and always guarantees a `cmd` fallback. `src/main/pty/pty-manager.ts:PtyManager` spawns/tracks node-pty (ConPTY) sessions keyed by pane id — `spawn`/`write`/`resize`/`kill`/`killAll`. `resolveSpawnSpec` (`src/main/pty/spawn-spec.ts`) decides the actual file/args/env (a `launch` override such as SSH runs verbatim; otherwise the shell's integrated args/env), and `sanitizeShellEnv` (`src/main/pty/env.ts`) strips Electron-injected vars (e.g. `ELECTRON_RUN_AS_NODE`) before they leak into the child. Persistence lives in `src/main/persistence/store.ts:WorkspaceStore` (one `workspaces/<id>.json` per workspace plus `app-state.json`) and `src/main/window-state.ts` (`clampWindowState` + load/save `window-state.json`); file paths resolve through `src/main/persistence/paths.ts`.

**IPC channels** (verified against `src/shared/ipc-contract.ts`, the `CH` map): `shells:list`; `ws:listIds`, `ws:load`, `ws:save`; `app:loadState`, `app:saveState`; `pty:spawn`, `pty:write`, `pty:resize`, `pty:kill` (renderer→main), and `pty:data`, `pty:exit` (main→renderer events). The typed `TermhallaApi` is exposed via `src/preload/index.ts` and consumed in the renderer through `src/renderer/api.ts`.

**Shared model** is pure and unit-tested. `src/shared/types.ts` defines the `PaneConfig` discriminated union (`TerminalConfig | EditorConfig | ExplorerConfig`, keyed on `kind`), the `MosaicNode` layout tree (string leaves = pane ids; `MosaicParent` = `{ direction, first, second, splitPercentage? }`), and `Workspace`/`AppState`/`WindowState`. `src/shared/workspace-model.ts` provides `createWorkspace`, `addFirstPane`, `splitPane`, `removePane` (collapses the orphaned parent), and `serializeWorkspace`/`deserializeWorkspace` which stamp/validate `schemaVersion` and `migrate` (rejects future versions).

**Renderer** holds the mirror state in `src/renderer/store.ts` (zustand). `init` loads shells + app-state, hydrates the open workspaces, and falls back to creating "Workspace 1". Mutations (`newWorkspace`, `setActive`, `setLayout`, `addTerminal`, `closePane`, `setCwd`) call `scheduleAutosave` (500 ms debounce → `saveAll`, which writes every workspace + app-state); `applyCwds` folds live cwds into each terminal config before persisting so restore reopens in the right directory. `src/renderer/App.tsx` renders the tab strip + the mosaic host and wires the lifecycle (below). `src/renderer/components/WorkspaceTabs.tsx` is the tab strip + shell picker + add-pane menu. `src/renderer/components/WorkspaceView.tsx` renders the `Mosaic`, mapping each leaf to a `MosaicWindow` with a `TerminalPane`. `src/renderer/components/TerminalPane.tsx` wires xterm.js to a PTY: it `ptySpawn`s on mount, streams `onPtyData`→`term.write` and keystrokes→`ptyWrite`, and resizes via a `ResizeObserver`+`FitAddon` (only firing `ptyResize` when the grid actually changes, to avoid a ConPTY repaint).

## Key files

| File | Responsibility |
|---|---|
| `src/shared/types.ts` | `Workspace`, `PaneConfig` union, `MosaicNode`, `AppState`, `WindowState`, `ShellInfo` |
| `src/shared/workspace-model.ts` | Pure layout ops + serialize/deserialize/migrate |
| `src/shared/ipc-contract.ts` | `CH` channel names + `TermhallaApi` types |
| `src/main/pty/shells.ts` | Windows shell discovery with guaranteed cmd fallback |
| `src/main/pty/pty-manager.ts` | node-pty/ConPTY session spawn/write/resize/kill |
| `src/main/pty/spawn-spec.ts` | Resolve file/args/env (launch override vs. integrated shell) |
| `src/main/pty/env.ts` | Strip Electron-injected env vars from child shells |
| `src/main/persistence/store.ts` | Per-workspace JSON + app-state read/write |
| `src/main/persistence/paths.ts` | userData file path resolution |
| `src/main/window-state.ts` | Window-bounds clamping + persistence |
| `src/renderer/store.ts` | zustand mirror store + debounced autosave |
| `src/renderer/App.tsx` | Tab strip + mosaic host + keep-mounted lifecycle |
| `src/renderer/components/WorkspaceView.tsx` | react-mosaic rendering of the layout tree |
| `src/renderer/components/WorkspaceTabs.tsx` | Workspace tabs, shell picker, add-pane menu |
| `src/renderer/components/TerminalPane.tsx` | xterm.js wired to a PTY over IPC |

## Behaviors & edge cases

- **Keep-workspaces-mounted lifecycle.** `App.tsx` renders *every* workspace host at once; only the active one is shown via `visibility: hidden` — deliberately **not** `display: none`, which would zero each host's size and thrash xterm's `FitAddon` / the PTY grid (the ConPTY full-screen-repaint hazard). Inactive hosts stay full-size but non-interactive (`pointer-events: none`, `aria-hidden`). Switching tabs never unmounts a `TerminalPane`, so scrollback survives and live TUIs (e.g. a Claude session) don't freeze.
- **Eager terminal spawn.** Because nothing unmounts, all workspaces' terminals spawn at launch rather than lazily on first view. Cost is paid up front for users with many saved workspaces × terminals; deferred as acceptable (see lifecycle follow-ups).
- **Debounced auto-save.** Layout/active/cwd mutations schedule `saveAll` on a 500 ms timer; `beforeunload` flushes synchronously so a quit mid-debounce still persists. `updatePaneConfig`/`addEditor`/`addExplorer` save immediately.
- **Window-state clamping.** `clampWindowState` recenters a window that lands off all displays onto the first display; an on-screen window is returned unchanged and the `maximized` flag is preserved. Missing state falls back to `DEFAULT_WINDOW_STATE` (1200×800).
- **Failed-spawn guard.** A bad launch (e.g. `ssh` not on PATH) is caught in `PtyManager.spawn`; it surfaces a `[failed to launch …]` line to the pane, unwinds status-engine registration, and emits `onExit` instead of crashing main.
- **Fresh PTYs on restore.** Reload rebuilds layout + config and spawns new processes; there is no live-process resurrection.
- **cwd round-trip.** Live cwd updates are mirrored into each terminal's `config.cwd` via `applyCwds` before persisting, so a restored workspace reopens in the last directory.
- **cmd fallback.** If no candidate shell resolves, `detectShells` still returns cmd so the app is never shell-less.

### Clipboard

- **Copy:** select text with the mouse and press **Ctrl+C**. With a selection, Ctrl+C copies it (and clears the selection); with no selection, Ctrl+C sends the interrupt signal (`^C`) as usual. The selection-vs-interrupt decision is the pure `clipboardKeyAction` (`components/terminal-clipboard.ts`), wired via xterm's `attachCustomKeyEventHandler`.
- **Paste:** **Ctrl+V** or **right-click**. Paste goes through `term.paste()`, which honors bracketed-paste mode, so pasting multi-line text into a shell or a TUI (e.g. Claude) does not auto-execute each line. It flows out through the existing `onData → ptyWrite` path.
- Clipboard access lives in the **main** process (Electron `clipboard`) behind the `clipboard:read` / `clipboard:write` IPC channels (`ipc/register-clipboard.ts`); the renderer never touches the OS clipboard directly.

## Pane title-bar actions

### Right-click context menu

Right-clicking any pane's title bar opens a context menu (portaled to `<body>` so
it is never clipped by the mosaic tile's stacking context — `src/renderer/components/PaneContextMenu.tsx`).
The menu has four items:

| Item | Behaviour |
|---|---|
| **Rename** | Switches the title to an inline text field. The value is saved as an optional `name` field on the pane config (all three pane kinds — terminal, editor, explorer — support it). |
| **Move to workspace ▸** | Sub-menu listing the other workspaces the current window hosts, plus **New Workspace**. See [Cross-workspace move](#cross-workspace-move) below. |
| **Settings** | Opens the unified Settings panel (`src/renderer/components/WorkspaceView.tsx`) with that pane pre-selected, covering the same surfaces previously reached by the dedicated 🎨/🔑/⚙ title-bar buttons (which were removed). |
| **Close** | Removes the pane from the layout (same as the existing × button). |

`src/renderer/components/PaneToolbar.tsx` renders the title bar; `src/renderer/components/PaneTile.tsx` wires the right-click handler.

### Maximize

A **Maximize** toggle button (🗖 when normal, 🗗 when maximized) sits in every
pane's title bar. The keyboard shortcut **Ctrl+Shift+M** toggles it for the focused
pane.

Maximizing a pane fills the workspace with that pane alone. The siblings are **not**
unmounted — they are hidden with `visibility: hidden` (the same strategy used for
inactive workspaces; see [Keep-workspaces-mounted lifecycle](#behaviors--edge-cases)).
This preserves xterm scrollback, live TUI state, and open Monaco models for all
sibling panes while the maximized pane takes the full space.

The store action is `toggleMaximize(wsId, paneId)` in `src/renderer/store.ts`.
Restoring (clicking the button again or pressing Ctrl+Shift+M) returns all siblings
to their previous layout positions.

### Cross-workspace move

**Move to workspace ▸** moves a live pane to another workspace in the same window
(or to a brand-new workspace) without interrupting the running process.

**Terminals.** The PTY keeps running throughout. Before the source workspace
unmounts the pane, the xterm instance is serialized into a renderer-side stash
(`src/renderer/components/terminal-registry.ts`). In transit the pane is buffered
via `src/renderer/components/pane-transit.ts`. The destination workspace issues
an idempotent `pty:spawn` which adopts the already-running PTY, then replays the
snapshot and any buffered output — so scrollback is fully preserved.

**Editors.** Any unsaved edits are flushed to a recovery draft before the pane
leaves the source workspace. The draft is not deleted; the editor reopens in the
destination workspace and picks it up, so no content is lost.

**New Workspace.** When **New Workspace** is chosen, the new workspace is created
with the source workspace's theme override already applied, so the pane's visual
appearance is unchanged after the move.

The pure layout operation is `movePane(from, to, paneId)` in
`src/shared/workspace-model.ts`; the store actions are `movePaneToWorkspace` and
`movePaneToNewWorkspace` in `src/renderer/store.ts`.

## Testing

Vitest (in `tests/`):
- `tests/shared/workspace-model.test.ts` — create/add/split/remove layout ops, serialize↔deserialize round-trip, schema-version stamping, malformed-JSON rejection.
- `tests/main/shells.test.ts` — `detectShells` filters to existing executables and guarantees the cmd fallback.
- `tests/main/store.test.ts` — `WorkspaceStore` save/load/list workspaces, app-state round-trip, missing-workspace returns null.
- `tests/main/window-state.test.ts` — `clampWindowState` defaults, on-screen passthrough, off-screen recenter, maximized preservation.
- `tests/main/env.test.ts` — `sanitizeShellEnv` strips Electron vars; `tests/main/spawn-spec.test.ts` — `resolveSpawnSpec` launch-override vs. integrated paths; `tests/shared/pane-union.test.ts` — `PaneConfig` discriminated-union handling.

Playwright-for-Electron (in `tests/e2e/`):
- `tests/e2e/smoke.spec.ts` — launch, open a terminal, type and see echoed output, split into a second tile.
- `tests/e2e/persistence.spec.ts` — create two tiled terminals, save, relaunch with the same `--user-data-dir`, assert the 2-terminal layout restores with no empty state.
- `tests/e2e/workspace-switch.spec.ts` — leave a marker in a terminal, create a second workspace (switching away), switch back, assert scrollback survives (regression test for the keep-mounted decision).
- `tests/e2e/clipboard.spec.ts` — copy a selected line with Ctrl+C (asserts the system clipboard via `app.evaluate`), and paste with Ctrl+V and right-click.

## Related

- [Architecture](../architecture.md) · [Decisions](../decisions.md)
- Lifecycle follow-ups: [workspace-lifecycle-review-followups](../superpowers/workspace-lifecycle-review-followups.md)
- Sibling features: [status-engine](status-engine.md) · [editor-explorer](editor-explorer.md) · [cwd-awareness](cwd-awareness.md) · [ssh-favorites](ssh-favorites.md)
