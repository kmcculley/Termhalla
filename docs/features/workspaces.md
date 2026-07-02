# Terminal Workspaces

> Multiple real Windows shells tiled in a saveable, named-tab layout that survives restart.

**Status:** Shipped · **Spec:** [termhalla-design](../superpowers/specs/2026-06-13-termhalla-design.md) · **Plan:** [phase1-terminal-workspace](../superpowers/plans/2026-06-13-termhalla-phase1-terminal-workspace.md)

## What it does

A workspace is a named tab holding a tiled arrangement of panes. In Phase 1 every pane is a live Windows terminal (PowerShell 7, Windows PowerShell, Git Bash, WSL, or cmd — whichever are installed). Panes split horizontally or vertically via `react-mosaic`, resize by dragging the gutters, and rearrange by drag-and-drop. A picker in the tab strip selects which discovered shell new terminals use.

Workspaces are saved to disk and restored on the next launch: layout tree, per-pane shell, and cwd come back, the window returns to its last size/position/maximized state, and fresh PTYs are spawned (no process resurrection, per spec). Saving is automatic and debounced — an explicit Save button exists but is rarely needed.

## How it works

**Main process** owns all privileged state. `src/main/pty/shells.ts:detectShells` probes a candidate list (`DEFAULT_SHELL_CANDIDATES`) with an injectable `exists` function and always guarantees a `cmd` fallback. `src/main/pty/pty-manager.ts:PtyManager` spawns/tracks node-pty (ConPTY) sessions keyed by pane id — `spawn`/`write`/`resize`/`kill`/`killAll`. `resolveSpawnSpec` (`src/main/pty/spawn-spec.ts`) decides the actual file/args/env (a `launch` override such as SSH runs verbatim; otherwise the shell's integrated args/env), and `sanitizeShellEnv` (`src/main/pty/env.ts`) strips Electron-injected vars (e.g. `ELECTRON_RUN_AS_NODE`) before they leak into the child. Persistence lives in `src/main/persistence/store.ts:WorkspaceStore` (one `workspaces/<id>.json` per workspace plus `app-state.json`) and `src/main/window-state.ts` (`clampWindowState` + load/save `window-state.json`); file paths resolve through `src/main/persistence/paths.ts`.

**IPC channels** (verified against `src/shared/ipc-contract.ts`, the `CH` map): `shells:list`; `ws:listIds`, `ws:load`, `ws:save`; `app:loadState`, `app:saveState`; `pty:spawn`, `pty:write`, `pty:resize`, `pty:kill` (renderer→main), and `pty:data`, `pty:exit` (main→renderer events). The typed `TermhallaApi` is exposed via `src/preload/index.ts` and consumed in the renderer through `src/renderer/api.ts`.

**Shared model** is pure and unit-tested. `src/shared/types.ts` defines the `PaneConfig` discriminated union (`TerminalConfig | EditorConfig | ExplorerConfig`, keyed on `kind`), the `MosaicNode` layout tree (string leaves = pane ids; `MosaicParent` = `{ direction, first, second, splitPercentage? }`), and `Workspace`/`AppState`/`WindowState`. `src/shared/workspace-model.ts` provides `createWorkspace`, `addFirstPane`, `splitPane` (takes a trailing `position: 'before' | 'after'`, default `'after'` = today's `{ direction, first: target, second: new }`; `'before'` makes the new pane the parent's `first`), the pure `splitDirToLayout(dir)` mapping (`right→{row,after}`, `down→{column,after}`, `left→{row,before}`, `up→{column,before}`), `removePane` (collapses the orphaned parent), and `serializeWorkspace`/`deserializeWorkspace` which stamp/validate `schemaVersion` and `migrate` (rejects future versions).

**Pane toolbar / split control.** Each pane's `MosaicWindow` toolbar (`PaneToolbar.tsx`) carries a single split button `data-testid="split-${paneId}"` (⬌) that toggles the combined split popover `SplitMenu.tsx` (`data-testid="split-menu"`, portalled to `<body>` like `PaneContextMenu`/`Modal`). The popover holds a four-direction **compass** — `split-dir-{up,left,right,down}-${paneId}`, always enabled, roving-tabindex keyboard nav with `right` ▶ focused by default — plus a kind selector `split-kind-{terminal,editor,explorer}-${paneId}` (Terminal selected by default via `aria-checked`; Explorer disabled when the pane has no cwd). Pick a kind, then activate a direction (click or Enter) to commit; opening commits nothing, Esc dismisses. There is no longer a separate `split-col-${paneId}` button. Session **recording** moved off the toolbar (no more `rec-${paneId}`) into the pane title-bar context menu (`PaneContextMenu.tsx`, `data-testid="pane-menu-record"`, terminal-only, label toggles Start/Stop recording).

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
| `src/renderer/components/WorkspaceView.tsx` | react-mosaic rendering of the (visible) layout tree + minimized hosts + tray |
| `src/renderer/components/WorkspaceTabs.tsx` | Workspace tabs, shell picker, add-pane menu |
| `src/renderer/components/TerminalPane.tsx` | xterm.js wired to a PTY over IPC |
| `src/renderer/components/MinimizedPaneHost.tsx` | Off-layout, kept-mounted host for a minimized pane's body (sized to its pre-minimize tile) |
| `src/renderer/components/MinimizedTray.tsx` | Per-workspace tray of restore chips with live status (incl. `exited`) |
| `src/renderer/components/explorer-registry.ts` | Renderer stash bridging an Explorer's expanded-set/scroll across a minimize remount |
| `src/renderer/components/pane-geometry.ts` | Last-known per-pane tile size, so the minimized host avoids an avoidable PTY resize |
| `src/shared/chip-status.ts` | Pure live-status → tray-chip indicator map (REQ-005 surface) |

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
| **Rename** | Switches the title to an inline text field. The value is saved as an optional `name` field on the pane config (every pane kind — terminal, editor, explorer, orky — supports it). |
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
to their previous layout positions. Maximize view-state is **persisted** per
workspace (it rides the workspace record), so a maximized pane stays maximized across
a reload.

### Minimize / restore

A **Minimize** button (🗕) sits in every pane's title bar next to Maximize; a pane can
also be minimized from the title-bar right-click menu or with the rebindable
**Minimize pane** keybinding (**Ctrl+Shift+H** by default). Minimizing applies
uniformly to Terminal, Editor, and Explorer panes.

Unlike maximize (which hides siblings in place), minimizing removes the pane's leaf
from the **visible** mosaic so the remaining panes **reflow** to fill the freed area.
The minimized pane is **not** unmounted — its body is kept mounted off-layout
(`MinimizedPaneHost`, `visibility: hidden`), so its PTY keeps running, output keeps
accumulating, and xterm scrollback / Monaco models / unsaved drafts are preserved. The
transition reuses the same-window cross-workspace move machinery (snapshot stash +
draft flush + idempotent `pty:spawn` re-adoption) — the PTY is never torn down.

Each workspace shows a per-workspace **tray** of restore chips along the bottom of the
workspace body — one chip per minimized pane, shown only when at least one pane is
minimized. Each chip surfaces the minimized pane's **live** status (running/idle,
needs-input, recording, AI session) and is a real focusable, keyboard-activatable
control; clicking or pressing Enter restores the pane, split to the right of the current
visible layout. When **every** pane in a workspace is minimized, the body shows an
all-minimized empty state alongside the tray (the restore home), so no pane becomes
unreachable.

Minimize and maximize are **mutually exclusive on the same pane**: minimizing a
maximized pane clears its maximize first. Minimize view-state (the `minimized` list and
the `maximized` id) is **persisted** per workspace with an explicit `SCHEMA_VERSION`
6 → 7 migration; only pane id references / flags are stored — never pane content or
secrets. The store actions are `toggleMinimize(wsId, paneId)` and
`restorePane(wsId, paneId)` in `src/renderer/store.ts`; the pure reducers
(`minimizePane`, `restorePane`, `computeVisibleLayout`) live in
`src/shared/workspace-model.ts`.

### Cross-workspace move

**Move to workspace ▸** moves a live pane to another workspace in the same window
(or to a brand-new workspace) without interrupting the running process.

**Terminals.** The PTY keeps running throughout. Before the source workspace
unmounts the pane, the xterm instance is serialized into a renderer-side stash
(`stashSnapshot` in `src/renderer/components/terminal-registry.ts`). The
destination workspace mounts a fresh `TerminalPane` which writes the stashed
scrollback (`consumeSnapshot`) and issues an idempotent `pty:spawn` that adopts
the already-running PTY (`pty.has`) instead of respawning — so scrollback and the
live process are fully preserved.

> No main-side output buffer is needed for a same-window move (unlike the
> cross-*window* undock handoff, which does buffer): the source unmount and the
> destination mount happen in a single synchronous React commit, so no `pty:data`
> can be dispatched to the renderer in the gap. Don't "restore" a transit buffer
> here as if it were a missing piece.

**Editors.** Any unsaved edits are flushed to a recovery draft before the pane
leaves the source workspace. While the pane is in transit (tracked by
`src/renderer/components/pane-transit.ts`) the unmount *flushes* the draft instead
of deleting it; the editor reopens in the destination workspace and picks it up,
so no content is lost.

**New workspace.** Moving to **New Workspace** clones the source workspace's
theme override onto the new one (`carryTheme` in `src/shared/workspace-model.ts`)
so the pane renders identically in its new home.

**New Workspace.** When **New Workspace** is chosen, the new workspace is created
with the source workspace's theme override already applied, so the pane's visual
appearance is unchanged after the move.

The pure layout operation is `movePane(from, to, paneId)` in
`src/shared/workspace-model.ts`; the store actions are `movePaneToWorkspace` and
`movePaneToNewWorkspace` in `src/renderer/store.ts`.

## Testing

Vitest (in `tests/`):
- `tests/shared/workspace-model.test.ts` — create/add/split/remove layout ops, serialize↔deserialize round-trip, schema-version stamping, malformed-JSON rejection.
- `tests/shared/split-direction.test.ts` — `splitPane` before/after insertion (default-after regression pin, before on a deep leaf, round-trip/schema-version invariance) and the `splitDirToLayout` four-direction mapping (`right→{row,after}`, `down→{column,after}`, `left→{row,before}`, `up→{column,before}`).
- `tests/main/shells.test.ts` — `detectShells` filters to existing executables and guarantees the cmd fallback.
- `tests/main/store.test.ts` — `WorkspaceStore` save/load/list workspaces, app-state round-trip, missing-workspace returns null.
- `tests/main/window-state.test.ts` — `clampWindowState` defaults, on-screen passthrough, off-screen recenter, maximized preservation.
- `tests/main/env.test.ts` — `sanitizeShellEnv` strips Electron vars; `tests/main/spawn-spec.test.ts` — `resolveSpawnSpec` launch-override vs. integrated paths; `tests/shared/pane-union.test.ts` — `PaneConfig` discriminated-union handling.
- Minimize/restore (feature 0003): `tests/shared/minimize-persistence.test.ts` (schema v6→v7 migration, dangling-ref prune, malformed tolerance, load-path minimize/maximize mutual exclusion), `tests/shared/minimize-view-state.test.ts` (pure `minimizePane`/`restorePane`/`computeVisibleLayout`/`movePane` reducers), `tests/shared/chip-status.test.ts` (live-status → chip map incl. `exited`), `tests/shared/minimize-keybinding.test.ts` (`toggle-minimize-pane` command + rebind), `tests/minimize-pane-menu-style.test.ts` (portalled `pane-menu` focus/hover allow-list), `tests/docs-feature-0003.test.ts` (doc reconciliation).

Playwright-for-Electron (in `tests/e2e/`):
- `tests/e2e/smoke.spec.ts` — launch, open a terminal, type and see echoed output, split into a second tile.
- Minimize/restore: `tests/e2e/minimize-restore.spec.ts`, `minimize-uniform.spec.ts`, `minimize-persistence.spec.ts`, `minimize-tray-status.spec.ts`, `minimize-undock.spec.ts`, and `minimize-hardening.spec.ts` (transit-gap output retention, multi-tile geometry, explorer state bridge, runtime mutual exclusion, tray click-through, context-menu chord).
- `tests/e2e/persistence.spec.ts` — create two tiled terminals, save, relaunch with the same `--user-data-dir`, assert the 2-terminal layout restores with no empty state.
- `tests/e2e/workspace-switch.spec.ts` — leave a marker in a terminal, create a second workspace (switching away), switch back, assert scrollback survives (regression test for the keep-mounted decision).
- `tests/e2e/clipboard.spec.ts` — copy a selected line with Ctrl+C (asserts the system clipboard via `app.evaluate`), and paste with Ctrl+V and right-click.

## Related

- [Architecture](../architecture.md) · [Decisions](../decisions.md)
- Lifecycle follow-ups: [workspace-lifecycle-review-followups](../superpowers/workspace-lifecycle-review-followups.md)
- Sibling features: [status-engine](status-engine.md) · [editor-explorer](editor-explorer.md) · [cwd-awareness](cwd-awareness.md) · [ssh-favorites](ssh-favorites.md)
