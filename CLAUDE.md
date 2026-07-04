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
npm run package      # build + pack a Windows NSIS installer + latest.yml into dist/ (no publish)
```

- **Releasing is a tag push, not an npm script.** Bump `package.json` version, commit, tag
  `vX.Y.Z`, push the tag → `release.yml` runs `npm run package` then uploads the installer +
  `latest.yml` to a single GitHub Release via `gh release create`. There is intentionally no
  `npm run release` (electron-builder's own publisher raced into duplicate releases — see
  [decisions](docs/decisions.md)).

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
  stacks *under* the tile toolbar. `PaneContextMenu`, `Modal`, and `SplitMenu` (the combined split/compass
  popover) `createPortal` to escape it; a menu rendered inline silently mis-positions and intercepts no
  clicks. Guarded by `tests/e2e/pane-actions.spec.ts` (and `tests/e2e/split-compass.spec.ts` TEST-007 for
  the split popover).
- **Pane maximize hides siblings, never unmounts them.** `toggleMaximize` sets `maximized[wsId]` — now a
  **persisted** per-workspace view-state field (it rides the workspace record via `applyViewState` and is
  derived back on load in `applyAssignment`, so a maximized pane survives reload). `PaneTile` marks its
  tile with a `data-max` attribute (imperatively, so react-mosaic re-renders don't strip it) and CSS fills
  it with `!important` while siblings get `visibility: hidden` (the keep-mounted pattern — `display:none`
  would thrash xterm). Swapping `ws.layout` to maximize would unmount siblings and dispose their
  scrollback/TUIs — don't. The maximized tile's `visibility: visible` punch-through MUST stay scoped to
  `[data-testid="workspace-host"][data-active="true"]`: a descendant's `visible` overrides `hidden` on ANY
  ancestor, so unscoped it bleeds an inactive workspace's maximized pane through a transparent active one
  (workspace hosts also carry an opaque `var(--bg)` background as a mask — keep both).
- **Pane minimize prunes the *visible* tree but keeps the body mounted off-layout.** Unlike maximize (CSS
  hides siblings in place), minimize must let the survivors **reflow**: `WorkspaceView` feeds `<Mosaic>`
  `computeVisibleLayout(ws)` (`workspace-model.ts`) — `ws.layout` with every `minimized` leaf removed — so
  the freed area is filled. Each minimized pane's body is rendered in a kept-mounted `MinimizedPaneHost`
  (`visibility:hidden`, sized non-zero, off-layout — NEVER `display:none`, NEVER unmounted: that disposes
  xterm scrollback / Monaco models and kills the live PTY). The minimize/restore transition REUSES the
  same-window cross-workspace move machinery (snapshot stash + `beginPaneTransit` + idempotent `pty:spawn`
  re-adoption); it MUST NOT call `api.ptyKill`/`closePane`/`teardownPanes`. View-state (`minimized` list +
  `maximized` id) is persisted per-workspace (added under the `SCHEMA_VERSION` 6→7 migration, 0003; the
  constant itself is now 8, bumped 7→8 by 0009's `orky` pane kind); the renderer derives the maps on load and
  folds them back on save — it never writes app-state. The per-workspace tray (`MinimizedTray`) is a
  workspace-body sibling of `.mosaic` (not inside a tile), so it needs no portal; its chips carry
  focus/hover styling in `index.css` (the portalled `pane-menu` Minimize item must be in those allow-lists
  too). Guarded by `tests/e2e/minimize-*.spec.ts`. **Two non-obvious gotchas within minimize** (each a real
  review finding — don't regress): (1) unlike the *same-window cross-workspace move*, minimize/restore is
  NOT one synchronous commit — the source `TerminalPane` unmounts (dropping its `onPtyData` sub) before the
  destination mounts, so `pty:data` in that gap WOULD be dropped. The store arms the main-side `transit`
  buffer for the same window via `api.ptyTransitBegin` BEFORE the unmount (reusing `WindowManager.transit` +
  `replayInto`, drained on the idempotent `pty:spawn` re-adoption — no pane re-ownership; main still owns
  `windows[]`); never remove that arm. (2) An Explorer pane keeps its expanded-folder set + scroll in LOCAL
  React state, lost on the remount — `explorer-registry.ts` bridges it (sibling of the terminal snapshot /
  editor draft), stashed by the store before unmount and consumed by the remounting `ExplorerPane`. The
  off-layout host is sized to the pane's pre-minimize tile size (`pane-geometry.ts`) so a multi-tile
  minimize doesn't force an avoidable ConPTY repaint (status-tail eviction).
- **Native `node-pty`** is patched (Spectre off) and must be `electron-rebuild`'d
  for Electron's ABI. See README → Native modules. The patch must be a real
  `patch-package`-generated diff (regenerate with `npx patch-package node-pty --include
  '\.gyp$'`) — a hand-edited one with wrong hunk counts fails to *parse* and breaks
  `npm ci` postinstall on a fresh checkout (e.g. CI) even though local builds, which
  already have node-pty built, never re-run it. `.gitattributes` pins patches to LF.
- **`better-sqlite3` is a second native module** (used by `SearchService`) and likewise
  needs `npx electron-rebuild -f -w better-sqlite3` for Electron's ABI plus an
  `asarUnpack` entry in `electron-builder.yml`. In this sandbox environment, clear the
  `NoDefaultCurrentDirectoryInExePath` env var before rebuilding — it breaks the `.bat`
  invocations used by native build tools (same fix as for node-pty's winpty `.bat`).
- **Orky status reads `active.json.phase` + gate topology — NEVER `state.json.phase`.** The Orky
  mirror (`src/main/orky/orky-tracker.ts` + the pure mappers in `src/shared/orky-status.ts`) detects a
  run's live phase and needs-you state from **gates**, because the per-feature `state.json.phase`
  *lags* the real pipeline and is **never** set to `'human-review'` (completed features terminate at
  `state.json.phase === 'doc-sync'` with `human-review` recorded only as an external gate). Live phase =
  `active.json.phase` for the single active feature / the **gate frontier** (`gateFrontier`) for every
  other; needs-human = autonomous gates through `doc-sync` all passed AND `human-review` gate not yet
  passed (NOT a phase-string equality — that bug, FINDING-DA-001, meant a run blocked on a human never
  lit). `ORKY_PHASES` is the 8-phase mirror of Orky's recorded gate keys / `DRIVER_WORK_PHASES`, NOT
  Orky's *separate* 9-entry `PHASE_ORDER` (intake…human-review) — see the provenance caveat in
  `docs/features/orky-status.md` before re-syncing it. The tracker is **strictly read-only** (clones the
  `UsageTracker` session-identity race pattern; one debounced chokidar watcher + read per resolved
  `.orky/` root, `.json`-filtered, IPC args validated + known-window sender-scoped); it never writes under
  `.orky/`, never spawns a CLI, and bumps no `SCHEMA_VERSION`. Open follow-ups (incl. the clean-DONE
  `null`-phase chip, FINDING-DA-007) are tracked in
  `docs/superpowers/0004-orky-status-review-followups.md`.
- **Orky registry (feature 0005) shares ONE `OrkyRootEngine` across the pane-chip path AND the
  cross-project aggregate — never two watchers per root.** 0004's `OrkyTracker` (`src/main/orky/
  orky-tracker.ts`) was refactored into a thin pane-facing facade over a new, extracted
  `OrkyRootEngine` (`src/main/orky/orky-root-engine.ts`) that generalizes "consumer = a pane" to
  "consumer = an opaque string id" (`pane:<id>` / `persisted:<root>`) and fans every re-read out via a
  multi-subscriber `onStatus(cb): unsubscribe`. The composition root (`services.ts`) constructs this
  engine ONCE and injects the SAME instance into both `OrkyTracker` (via `registerOrky`) and the new
  `OrkyRegistry` (`src/main/orky/orky-registry.ts`, the cross-project aggregator behind the
  `registry:*` IPC channels + the persisted `orky-registry.json`, `src/main/persistence/
  orky-registry-store.ts`) — so a root tracked by N panes *and* the persisted explicit list still costs
  exactly one chokidar watcher process-wide. This also required widening `registerOrky`'s IPC sender
  check from "exactly the one owning `BrowserWindow`" to "any currently-tracked app window"
  (`WindowManager.isKnownWindowSender`, built on the existing private `windowIdOf`) — REQ-002/REQ-020
  need pane-root membership aggregated across **every** window, not just one; a truly foreign/destroyed
  sender is still rejected (the original FINDING-SEC-002 intent survives, just widened in scope). No
  renderer UI ships with this feature (IPC/data only — see `docs/features/orky-status.md` §
  "Cross-project registry").

## Where things live

| Subsystem | Path | Feature doc |
|---|---|---|
| Shells, PTYs, spawn | `src/main/pty/` | [workspaces](docs/features/workspaces.md) |
| Status / OSC 133 / needs-input / cwd | `src/main/status/` | [status-engine](docs/features/status-engine.md), [cwd-awareness](docs/features/cwd-awareness.md) |
| Filesystem + watch | `src/main/fs/` | [editor-explorer](docs/features/editor-explorer.md) |
| Process tree | `src/main/proc/` | [child-process-tracking](docs/features/child-process-tracking.md) |
| Cloud CLI status | `src/main/cloud/` | [cloud-status](docs/features/cloud-status.md) |
| AI session detection | `src/main/ai/` | [ai-session-awareness](docs/features/ai-session-awareness.md) |
| Git status on pane chip | `src/main/git/` | [git-status](docs/features/git-status.md) |
| Claude usage metrics | `src/main/usage/` | [usage-metrics](docs/features/usage-metrics.md) |
| Orky pipeline status (read-only `.orky/` mirror, except F7's CLI-mediated writes below — never a direct file write) + cross-project orky-registry aggregate | `src/main/orky/`, `src/shared/orky-status.ts`, `src/shared/orky-registry.ts` | [orky-status](docs/features/orky-status.md) |
| Orky OSC heartbeat (stream-derived status, fallback for bare-SSH panes) | `src/main/status/orky-osc-parser.ts`, `src/main/orky/orky-stream-status.ts` | [orky-osc-heartbeat](docs/features/orky-osc-heartbeat.md) |
| Orky action dispatch (write-capable IPC into an Orky-adopted project, via Orky's own CLIs — never a direct `.orky/` write, never drives the pipeline) | `src/main/orky/orky-action-dispatcher.ts` | [orky-action-dispatch](docs/features/orky-action-dispatch.md) |
| Orky decision-queue drawer (renderer consumer of the `registry:status` aggregate — the "what needs me now" queue; since feature 0008 each row composes the write-capable `OrkyEntryActions` region, while F6's own files still own no dispatch) | `src/renderer/components/DecisionQueuePanel.tsx`, `src/renderer/store/registry-slice.ts`, `src/shared/decision-queue.ts` | [decision-queue](docs/features/decision-queue.md) |
| OS-level needs-you notifications (main-process observer over the `registry:status` aggregate — fires an OS `Notification` on a needs-you transition, incl. pane-less projects; app-wide opt-in `quick.orkyNeedsYouNotifications`, default on; click → `orkyNotify:focus`) | `src/main/orky/orky-needs-you-notifier.ts`, `src/renderer/components/pane-reveal.ts` | [os-needs-you-notifications](docs/features/os-needs-you-notifications.md) |
| Native Orky pane (persisted `orky` pane kind — full-project status via the `registry:detail` pull + `registry:rootChanged` push; the SCHEMA_VERSION v7→v8 bump; since feature 0010 it composes the shared entry-actions region per feature row + the pre-targeted capture opener `openOrkyCapture(root)` behind a header inject button, owning no dispatch/capture logic of its own) | `src/renderer/components/OrkyPane.tsx` (+ `OrkyRootPicker.tsx`), `src/renderer/store/orky-pane-slice.ts`, `src/shared/orky-pane.ts`, `src/main/orky/orky-root-detail.ts` | [orky-pane](docs/features/orky-pane.md) |
| Orky quick-capture inbox (global capture modal — the first renderer consumer of the write-capable dispatch, `submitWork` only) | `src/renderer/components/OrkyCaptureModal.tsx`, `src/renderer/store/orky-capture-slice.ts` | [quick-capture-inbox](docs/features/quick-capture-inbox.md) |
| Orky queue entry actions (answer an escalation / record a human-review verdict / read-only next-action preview / resume-in-terminal — the shared, F10-reusable action layer over the remaining three dispatch actions) | `src/renderer/components/orky-entry-actions.tsx` (+ `orky-entry-actions-core.ts`, the injected-pull pure core) | [queue-answer-resume-actions](docs/features/queue-answer-resume-actions.md) |
| Per-project Orky cockpit workspace (single-gesture pick → a fresh workspace: Orky pane + plain terminal at the tracked root; palette / templates-menu built-in row / decision-queue entries; includes the shared `newWorkspaceFromTemplate` reporting repair — templates now survive assignment pushes) | `src/shared/orky-cockpit.ts`, `newOrkyWorkspace` in `src/renderer/store.ts`, `src/renderer/store/quick-slice.ts` | [orky-workspace-template](docs/features/orky-workspace-template.md) |
| Remote wire protocol core (pure `@shared/remote/protocol` barrel — framing, strict v1 message vocabulary incl. deep JSON-representability checks on the any-JSON positions, exact-version handshake, request correlation, reserved F17 flow-control shapes; vitest-only in v1 — zero `src/main`/`preload`/`renderer` imports, guarded by TEST-746 until F16/F21 consume it) | `src/shared/remote/` | [remote-protocol](docs/features/remote-protocol.md) |
| Per-project notepad | `src/main/persistence/notes-store.ts`, `src/renderer/components/NotesPanel.tsx` | [notepad](docs/features/notepad.md) |
| SSH / favorites store | `src/main/persistence/quick-store.ts`, `src/shared/quick.ts` | [ssh-favorites](docs/features/ssh-favorites.md) |
| Multi-window / undock | `src/main/window-manager.ts` (+ `-core.ts`), `src/main/services.ts` | [window-management](docs/features/window-management.md) |
| Renderer store | `src/renderer/store.ts` (root) + `src/renderer/store/` (slices + helpers) | — |
| IPC contract | `src/shared/ipc-contract.ts` | — |
| Keybindings | `src/shared/keybindings.ts`, `src/renderer/components/KeybindingsSettings.tsx` | [keybindings](docs/features/keybindings.md) |
| Native app menu / Settings entry | `src/main/menu.ts` (Edit ▸ Settings… → `menu:open-settings` push, consumed in `src/renderer/App.tsx`) | — |
| Toast notifications | `src/renderer/store/toasts-slice.ts` (single `pushToast` gate; `quick.toastsEnabled` opt-in for success/info, errors always show) | — |
| Output search history | `src/main/search/` | [search-history](docs/features/search-history.md) |
| Saved run commands | `src/shared/run-commands.ts`, `src/renderer/store/run-commands-slice.ts` | [run-commands](docs/features/run-commands.md) |
| Terminal links / image preview | `src/shared/terminal-links.ts`, `src/renderer/terminal/links.ts`, `src/main/ipc/register-preview.ts` | [terminal-links](docs/features/terminal-links.md) |
| Packaging / auto-update | `electron-builder.yml`, `src/main/updater.ts`, `build/icon.ico` | [packaging](docs/features/packaging.md) |

## Process / workflow

This project was built with the superpowers flow (brainstorm → spec → plan →
subagent-driven implementation → review → merge). Specs and plans live in
`docs/superpowers/`; per-feature deferred work is tracked in
`docs/superpowers/*-review-followups.md`. When you finish a unit of work, update
the [changelog](CHANGELOG.md) and the relevant feature/follow-up doc.

### Orky baseline (`.orky/`)

The repo is also adopted into Orky (gated spec→plan→tests→implement→review
pipeline). `.orky/profiles/node-app.json` is the verified gate profile
(`npm run build` + `npm test`); `.orky/baseline/` holds a **confirmed inferred
baseline** — an architecture map, 24 `REQ-` requirements recovered from the code,
and a REQ→CHAR traceability matrix. New features run via `/orky:new` build against
this baseline.

- **`tests/characterization-*.test.ts` (CHAR-001..020) are change-detectors, not
  ordinary tests.** They pin *current* behavior (bugs included). A failure means
  behavior **changed** — decide whether that's intended (update the CHAR test
  through the tests phase) or a regression (fix the code). Don't blindly "fix" a
  CHAR assertion to make it pass.
- **`.orky/baseline/architecture.md` records four confirmed known bugs** (unanchored
  AI-detection substrings, whitespace-strict input-prompt catch-all, undercounted
  git merge-conflict entries, cursor-home output suppression) as candidate Orky
  features. Issue #4 is load-bearing (ConPTY repaint-eviction guard) — fix with care.
