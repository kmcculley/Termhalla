# CLAUDE.md

Guidance for AI coding agents (and humans) working in the Termhalla repo. Read
this first, then [`docs/architecture.md`](docs/architecture.md) for the system
model and [`docs/decisions.md`](docs/decisions.md) for the *why*.

## Commands

```bash
npm run dev          # run with hot reload
npm run build        # build to out/  (required before npm run e2e)
npm run typecheck    # tsc for renderer + node configs
npm test             # vitest unit tests (fast, headless)
npm run e2e          # Playwright-for-Electron (launches the real app)
npm run package      # build + pack a Windows NSIS installer into dist/ (no publish)
npm run release      # package, then publish installer + update feed (--publish always)
```

- **`npm run e2e` runs against `out/`** — always `npm run build` first (or after
  any source change you want exercised end-to-end).
- e2e is pinned to `workers: 1`. Don't parallelize it: concurrent Electron windows
  each run busy-gated CIM/WMI process polls and starve each other into flaky
  cwd/proc/ai detection. The product is single-instance; serial models reality.

## Architecture in one breath

Three sandboxed layers. **main** (`src/main/`) holds all privilege — PTYs, the
filesystem, process queries, cloud probes, persistence. **renderer**
(`src/renderer/`) is React + a zustand store and never touches Node directly.
**preload** (`src/preload/`) is the only bridge: it exposes a typed `window.api`
via `contextBridge`. The contract lives in `src/shared/ipc-contract.ts` (channel
names + the `TermhallaApi` interface); add a feature by extending that contract,
implementing it in the relevant per-domain registrar under `src/main/ipc/`
(`register-pty`/`-fs`/`-workspaces`/`-drafts`/`-cloud`/`-usage`/`-recording`/`-env`/`-clipboard`,
composed by the thin `register.ts` root), and consuming it through
`src/renderer/api.ts`. `contextIsolation: true`, `nodeIntegration: false`.

Pure logic lives in `src/shared/` and in small pure modules beside each main
service (e.g. `proc-tree.ts`, `parse-usage.ts`, `classify-ai.ts`) so it can be
unit-tested without Electron. The impure shell (chokidar watches, `execFile`,
node-pty) is kept thin.

## Conventions

- **TDD.** Write the failing test first. Pure logic → vitest in `tests/`.
  UI/IPC/integration → a Playwright e2e that launches the app. Match the style of
  the nearest existing test. Renderer pure logic you want unit-tested must not import
  `../api` (it reads `window.termhalla` at module load and throws under vitest's node
  env, so anything importing it transitively — e.g. `store/internals.ts` — can't be
  imported in a test). Inject the IPC call as an argument and pass `() => api.foo()`
  from the thin store action; see `op.ts` / `store/pane-ops.ts`.
- **Path alias:** import shared code as `@shared/...` (configured in
  `electron.vite.config.ts` and `tsconfig*.json`).
- **IPC naming:** `domain:verb` (e.g. `pty:spawn`, `usage:metrics`). Main→renderer
  push events are commented as such in the contract.
- **Persistence is versioned.** `SCHEMA_VERSION` in `src/shared/types.ts`. Data
  lives under Electron `userData`: `workspaces/`, `app-state.json`,
  `window-state.json`, `quick.json`, `shell-integration/`.
- **No secrets persisted.** SSH connections store host/user/port + identity-file
  *path* only; cloud status stores nothing. The usage feature reads the user's
  `~/.claude` transcripts read-only and only for token fields — never dump
  conversation content.

## Load-bearing gotchas

These are subtle and have each caused a real bug — respect them when touching the
related area:

- **Status tail must be ANSI-stripped.** `status-tracker.ts` keeps the last ~400
  chars of output for needs-input detection as `stripAnsi(text)`, and
  `needs-input.ts` skips trailing blank lines. Any terminal **layout change**
  triggers a full-screen ConPTY repaint whose trailing erase-line bytes would
  otherwise evict the prompt from the tail and wedge a terminal in "busy."
- **Avoid redundant PTY resizes.** Only call `ptyResize` when cols/rows actually
  change (`TerminalPane` guards this); a redundant resize forces a ConPTY repaint.
- **Long-lived child processes must be abortable + `unref()`'d.** An in-flight
  `execFile`/spawn child (cloud probes) otherwise keeps the Electron main process
  alive and hangs `app.close()` / the e2e suite. Pattern: `AbortController` in the
  service, abort on `stop()` wired to `win.on('closed')`, `child.unref()`.
- **Never unmount a workspace on tab switch.** All workspaces stay mounted; the
  inactive ones are hidden with `visibility: hidden` (not `display: none`, which
  zeros their size and thrashes xterm's FitAddon + the PTY grid). Unmounting
  disposes xterm instances (lost scrollback, frozen live TUIs) and Monaco models
  (lost edits). See `docs/features/workspaces.md`.
- **Chrome CSS must not change the box of `[data-testid="editor-tabs"]` children.**
  That tab strip is a flex *sibling* of the Monaco host; giving its buttons a
  `border`/`padding`/`font` shifts the strip height, perturbs Monaco's layout
  measurement, and wedges model-switch rendering (`.view-lines` stuck on the
  previous file — same class as a global `body` font-size). Theme it paint-only
  (`background`/`color`/`border-radius`). The UI-polish chrome styles are otherwise
  scoped to chrome `data-testid`s so Monaco/xterm widgets are never matched.
  Guarded by `tests/e2e/editor.spec.ts`.
- **Register process/ai trackers BEFORE spawning** a PTY: a failed spawn calls
  `onExit`→`unregister` synchronously, so registering after would orphan state.
- **Session-identity race pattern.** Watchers that `await` between claiming a map
  slot and using it (e.g. `UsageTracker`, `WatchManager`) claim the slot first,
  then re-check `map.get(id) !== sess` after every await so a concurrent
  watch/unwatch supersedes cleanly. Reuse this when adding watchers.
- **Multi-window tab handoff: single-owner + serialize-before-dispose.** With undock
  (`window-manager.ts`), a pane is rendered by exactly one window → exactly one xterm per PTY (no
  double echo). A move serializes the source xterms *before* the source unmounts (the one sanctioned
  unmount), and live pane-scoped events are held in a `transit` buffer until the destination's
  idempotent `pty:spawn` adopts the running PTY and replays the snapshot + buffer. Get the order
  wrong (dispose before snapshot, or route to the destination before it mounts) and you lose
  scrollback or output. App-state's `windows[]` arrangement is owned by main; the renderer keeps it
  in sync via `win:report` — don't write app-state from the renderer.
- **Same-window cross-workspace pane move is renderer-only.** Unlike the multi-window handoff above,
  `movePaneToWorkspace` (`store.ts`) needs no main-side `transit` buffer: the source unmount and
  destination mount happen in one synchronous React commit, so no `pty:data` is dispatched in the
  gap. Scrollback rides a renderer stash (`stashSnapshot`/`consumeSnapshot` in `terminal-registry.ts`),
  the PTY is re-adopted by the idempotent `pty:spawn`, and editor drafts are *flushed not deleted*
  while a pane is in transit (`pane-transit.ts`). The move must **not** call `closePane`/`teardownPanes`
  (those `api.ptyKill`). Don't add a transit buffer here thinking it's a missing piece.
- **Overlays opened from inside a mosaic tile must portal to `<body>`.** A `position: fixed` child of a
  react-mosaic tile is positioned/clipped relative to the tile (its transform is a containing block) and
  stacks *under* the tile toolbar. `PaneContextMenu` and `Modal` `createPortal` to escape it; a menu
  rendered inline silently mis-positions and intercepts no clicks. Guarded by `tests/e2e/pane-actions.spec.ts`.
- **Pane maximize hides siblings, never unmounts them.** `toggleMaximize` sets transient (non-persisted)
  `maximized[wsId]`; `PaneTile` marks its tile with a `data-max` attribute (imperatively, so react-mosaic
  re-renders don't strip it) and CSS fills it with `!important` while siblings get `visibility: hidden`
  (the keep-mounted pattern — `display:none` would thrash xterm). Swapping `ws.layout` to maximize would
  unmount siblings and dispose their scrollback/TUIs — don't.
- **Native `node-pty`** is patched (Spectre off) and must be `electron-rebuild`'d
  for Electron's ABI. See README → Native modules.

## Where things live

| Subsystem | Path | Feature doc |
|---|---|---|
| Shells, PTYs, spawn | `src/main/pty/` | [workspaces](docs/features/workspaces.md) |
| Status / OSC 133 / needs-input / cwd | `src/main/status/` | [status-engine](docs/features/status-engine.md), [cwd-awareness](docs/features/cwd-awareness.md) |
| Filesystem + watch | `src/main/fs/` | [editor-explorer](docs/features/editor-explorer.md) |
| Process tree | `src/main/proc/` | [child-process-tracking](docs/features/child-process-tracking.md) |
| Cloud CLI status | `src/main/cloud/` | [cloud-status](docs/features/cloud-status.md) |
| AI session detection | `src/main/ai/` | [ai-session-awareness](docs/features/ai-session-awareness.md) |
| Claude usage metrics | `src/main/usage/` | [usage-metrics](docs/features/usage-metrics.md) |
| SSH / favorites store | `src/main/persistence/quick-store.ts`, `src/shared/quick.ts` | [ssh-favorites](docs/features/ssh-favorites.md) |
| Multi-window / undock | `src/main/window-manager.ts` (+ `-core.ts`), `src/main/services.ts` | [window-management](docs/features/window-management.md) |
| Renderer store | `src/renderer/store.ts` (root) + `src/renderer/store/` (slices + helpers) | — |
| IPC contract | `src/shared/ipc-contract.ts` | — |
| Packaging / auto-update | `electron-builder.yml`, `src/main/updater.ts`, `build/icon.ico` | [packaging](docs/features/packaging.md) |

## Process / workflow

This project was built with the superpowers flow (brainstorm → spec → plan →
subagent-driven implementation → review → merge). Specs and plans live in
`docs/superpowers/`; per-feature deferred work is tracked in
`docs/superpowers/*-review-followups.md`. When you finish a unit of work, update
the [changelog](CHANGELOG.md) and the relevant feature/follow-up doc.
