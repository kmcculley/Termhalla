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
  - **CHANGELOG on release: per-feature detail STAYS under `[Unreleased]`.** Insert the new
    `## [X.Y.Z]` section as a *summary* directly above the previous release's heading — never
    directly under `## [Unreleased]` (that rotates the detail out, and the frozen doc-drift
    guards in `tests/docs-feature-*.test.ts` pin per-feature detail in `[Unreleased]`; the
    v0.12.0 release went red on exactly this). Convention recorded since 0.9.0.

- **`npm run e2e` runs against `out/`** — always `npm run build` first (or after
  any source change you want exercised end-to-end).
- e2e is pinned to `workers: 1`. Don't parallelize it: concurrent Electron windows
  each run busy-gated CIM/WMI process polls and starve each other into flaky
  cwd/proc/ai detection. The product is single-instance; serial models reality.
- **An e2e run puts nothing on screen — no window, no desktop toast.** `win.show()` raises *and
  activates*, so a run used to yank focus ~190 times. `playwright.config.ts` defaults
  `TERMHALLA_E2E_WINDOW=hidden`; windows are created, laid out, and fully scriptable but never
  presented, so layout-measuring specs (Monaco, xterm FitAddon, toolbar boxes) are unaffected.
  `showInactive()` is *not* enough — it withholds keyboard focus but still raises — so `=inactive`
  is only a fallback; `=show` restores production behavior when you want to watch. Every mode
  decision goes through `src/main/e2e-presentation.ts` (a structural test forbids reading the env
  var anywhere else in `src/main`). Product behavior is untouched — the var is unset outside the
  harness. Two non-obvious consequences, each already a real bug:
  - **A never-shown window is a *background* window**, so Chromium throttles the timers/rAF that
    xterm's render loop rides. `backgroundThrottling: false` is what keeps rows painting; without
    it every spec that reads rendered xterm output hangs. Pinned by
    `tests/e2e/window-presentation.spec.ts`.
  - **Presentation is not the only thing that reaches the screen.** The Orky needs-you notifier lives
    in main and consults no window, so it raised real desktop toasts for every spec that seeds a
    needs-you root without arming `TERMHALLA_E2E_NOTIFY_SPY`; its click handler then called `show()`
    on the main window. Both `Notification` sites and the click-time raise are gated on
    `raisesOsSurfaces()` (true only for `show`), as is `win.maximize()`, which Electron documents as
    showing an undisplayed window. Note `document.hasFocus()` is **true** in every mode (Playwright
    emulates renderer focus), so the *renderer's* `!document.hasFocus()` toast guard is already
    closed under test — but `BrowserWindow.getFocusedWindow()` is **null** under `hidden`, which is
    why `menu.ts` must fall back to the first window.
  - **Never assert an e2e invariant on a count of *visible* windows** — it is zero under `hidden`
    (`undock.spec.ts` did, and broke). Assert on a specific window's visibility instead. Likewise,
    `hidden` is slower to settle: focus the terminal with a `.xterm-screen` click before typing, and
    don't assume a rotating widget still shows the frame you saw a moment ago.
  - **Monaco can stop RE-RENDERING under `hidden` while its model still updates** — typed keys reach
    the buffer (Ctrl+S saves them) but `.view-lines` stays on the old frame, so a rendered-text
    assertion fails while the app is actually fine. Measured in `minimize-uniform.spec.ts` TEST-030's
    editor+explorer seed (its long-standing "flake"; deterministic 2026-07-09, reproduced on the
    released v0.16.1 build); `editor.spec.ts`'s single-editor seed is unaffected, so it's
    layout/timing-sensitive. Such a spec forces `TERMHALLA_E2E_WINDOW=inactive` in its OWN
    `electron.launch` env (the designed fallback — presented, never activated) rather than weakening
    assertions; details in `docs/deferred.md` ("hidden-window Monaco re-render stall").
- **Remote/ssh integration e2e rides a second env-gated seam.** `TERMHALLA_E2E_REMOTE_SSH`
  (JSON `{program, prefixArgs}`, read ONLY by `src/main/e2e-remote.ts` — same structural-test
  discipline as the presentation gate; `services.ts` spreads it into `connectWithProvisioning`
  with the fake pty backend FORCED) routes in-app remote connects through
  `tests/fixtures/fake-ssh.mjs`, so `remote-connected` / `remote-reconnect` / `marker-less-pane`
  specs drive the REAL agent bundle, bridge, and per-workspace daemon as local child processes —
  no network, no native pty. Unset ⇒ production connects byte-identical. Two hard-won rules live
  in `tests/e2e/remote-harness.ts`: (1) reap the detached daemon BEFORE `app.close()` — on Windows
  it inherits Playwright's control-pipe handles down the spawn chain, so close() hangs the
  worker's full teardown timeout while the daemon lives (its idle self-exit never arms with a live
  pane, 0024 FINDING-027); (2) never target the transport child by `ParentProcessId` of
  `app.process().pid` — that pid is a launcher, not the Electron main that spawns the wire; match
  the shim's command line instead.

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
  Also: a resize can legally race a pty's exit — node-pty withholds the exit event
  for `FLUSH_DATA_INTERVAL` (1 s) after the real exit, so a layout change can resize
  a pane whose process just died and `proc.resize()` THROWS. `PtyManager.resize`
  swallows that (dead-pty resize is meaningless); never let a pty op throw uncaught
  in an `ipcMain.on` listener — Electron's default handler raises a **modal error
  dialog that freezes the whole app**.
- **…but every `fit()` MUST be paired with a `ptyResize`.** The dual of the rule above.
  `FitAddon.fit()` calls `term.resize()` internally and *nothing listens to `term.onResize`*,
  so an unpaired `fit()` silently desyncs xterm's grid from the program's: the program keeps
  drawing at the old width into a terminal of a new width and renders garbled. **Ctrl+L cannot
  fix that** (the program just redraws at the same wrong width) — only a real resize can, which
  is why maximizing the pane *appears* to cure it. Both renderer fit sites go through `syncGrid`
  (`src/renderer/components/grid-sync.ts`) sharing one `gridRef`; the font/theme effect is a fit
  site too (a new cell size re-grids xterm). On the main side, `pty:spawn` short-circuits on
  `pty.has(id)` and **drops the renderer's cols/rows**, so an ADOPTED pty (minimize/restore,
  cross-workspace move, undock) keeps its old tile's grid while the remounted pane seeds its
  ResizeObserver guard from xterm — the difference would never be corrected. `register-pty`
  reconciles at adopt time via `needsGridReconcile` (`src/main/pty/grid-reconcile.ts`), which
  also upholds the no-redundant-resize rule. Guarded by `tests/e2e/font-zoom.spec.ts`.
- **A pane's status may change how chrome is PAINTED, never the size of its box.** The
  `.mosaic-window-toolbar` is content-box with a fixed `height: 30px` (react-mosaic scopes
  `box-sizing: border-box` to `.mosaic > *`, which never reaches it), and it is a flex *sibling*
  of the terminal host — the same coupling as the editor tab strip below. A `border-bottom` on
  the idle-only rule made the idle bar 31px against busy's 30px, so every status flip resized the
  terminal host by 1px → refit xterm → resize the PTY → full-screen repaint → which re-marked the
  pane **busy** (see the `StatusTracker` note below) → border gone → resize again: a permanent
  busy⇄idle oscillation on ssh/agent panes. Use an inset `box-shadow` for a hairline, never a
  border/padding/height. Pinned by `tests/renderer/pane-status-css.test.ts` + a real-box
  measurement in `tests/e2e/status.spec.ts`.
- **A marker-less pane treats output as the only busy signal — so a repaint must stay inert.**
  `hasMarkers` is false forever for `ssh` launches (a launch override runs verbatim with **no**
  shell-integration injection, `spawn-spec.ts`) and for remote-agent panes (`src/agent/` injects
  none), so `StatusTracker.onOutput`'s `!hasMarkers → busy` rule is their only busy signal. It
  MUST stay inside the `isPureControl` guard: a screen repaint leaves `lastOutputAt` untouched,
  so marking it busy would idle it again on the very next `tick()` — and because the busy/idle
  chrome once perturbed the pane's size, that resize provoked the next repaint. Local integrated
  shells are immune (marker-driven), which is why this only ever bit SSH.
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
  stacks *under* the tile toolbar; a menu rendered inline silently mis-positions and intercepts no clicks.
  `Modal` portals itself; every popover menu renders through the shared `MenuSurface`
  (`src/renderer/components/MenuSurface.tsx`, 2026-07-06 audit Group C #10) — it owns the click-catcher,
  right-click dismiss, Escape dismiss, and the `portal` opt-in, which tile-hosted menus (`PaneContextMenu`,
  `SplitMenu`, `OrkyPopover`, the explorer context menu) MUST pass. New popovers go through `MenuSurface`,
  never a hand-rolled backdrop (pinned by `tests/renderer/menu-surface-structure.test.ts`). Guarded by
  `tests/e2e/pane-actions.spec.ts` (and `tests/e2e/split-compass.spec.ts` TEST-007 for the split popover).
- **Pane maximize hides siblings, never unmounts them.** `toggleMaximize` sets `maximized[wsId]` — now a
  **persisted** per-workspace view-state field (it rides the workspace record via `applyViewState` and is
  derived back on load in `applyAssignment`, so a maximized pane survives reload). `PaneTile` marks its
  tile with a `data-max` attribute (imperatively, so react-mosaic re-renders don't strip it) and CSS fills
  it with `!important` while siblings get `visibility: hidden` (the keep-mounted pattern — `display:none`
  would thrash xterm). Swapping `ws.layout` to maximize would unmount siblings and dispose their
  scrollback/TUIs — don't. **Scope the PAINT, never the GEOMETRY.** The maximized tile's
  `visibility: visible` punch-through MUST stay scoped to
  `[data-testid="workspace-host"][data-active="true"]`: a descendant's `visible` overrides `hidden` on ANY
  ancestor, so unscoped it bleeds an inactive workspace's maximized pane through a transparent active one
  (workspace hosts also carry an opaque `var(--bg)` background as a mask — keep both). But the fill itself
  (`inset`/`width`/`height` `!important`, which overrides react-mosaic's inline tile geometry) must stay
  **unscoped**: bundled into the active-scoped rule, it dropped on every workspace switch and the tile
  snapped back to its small mosaic box — a real box change on a mounted terminal, so `TerminalPane`'s
  ResizeObserver (which has no visibility guard) refit xterm and resized the PTY, and the full-screen
  ConPTY repaint threw the viewport to the top of the scrollback. Keep-mounted means keep-sized. Guarded by
  `tests/renderer/pane-maximize-css.test.ts` + a real box measurement in `tests/e2e/pane-actions.spec.ts`.
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
| Remote wire protocol core (pure `@shared/remote/protocol` barrel — framing, strict v1 message vocabulary incl. deep JSON-representability checks on the any-JSON positions, exact-version handshake, request correlation, reserved F17 flow-control shapes; zero `src/main`/`preload`/`renderer` imports, guarded by TEST-746 until F21 retires it — consumed in production by the F16 agent from `src/agent/`, outside the guarded trees) | `src/shared/remote/` | [remote-protocol](docs/features/remote-protocol.md) |
| Remote agent runtime skeleton (headless plain-Node agent over stdio — pty + status domains only; agent-first exact-version handshake; injectable pty backend: lazy `node-pty` (Linux-only v1) vs the deterministic `--pty=fake` CI shell; status detection AT THE SOURCE via the reused pure `src/main/status/` stack; `npm run build` also emits the single-file `out/agent/termhalla-agent.cjs` through `vite.agent.config.ts`, and the stdio integration test bundles through that same config on demand — no ssh / no real node-pty in CI; shared error/method vocabulary at `src/shared/remote-agent-api.ts`, codes defined in `src/agent/error-codes.ts` and re-exported (TEST-752 reserves `shared/remote`-shaped specifiers in the agent tree for the F15 barrel)) | `src/agent/`, `src/shared/remote-agent-api.ts`, `vite.agent.config.ts` | [remote-agent](docs/features/remote-agent.md) |
| Agent session survival + replay (F18/0019 — pane ownership in a session store that OUTLIVES a connection: any connection-end path detaches, PTYs keep running with one bounded-scrollback `@xterm/headless` terminal per pane (`HISTORY_LIMIT_DEFAULT` 2000, tmux `history-limit` analog); `pty:attach` returns the serialize snapshot under a hold-window ordering guarantee (no `pty:data` crosses the res; same-pane overlap rejected) and `pty:sessions` is the reattach inventory; the SHIPPED stdio artifact keeps F16 kill-on-end — survival engages by composition (F19/F21 wire the transport); explicitly NOT the window-manager transit buffer — no missed-event queue exists (structural guard pins the non-import); the single-connection bind guard is retired by F20's lease) | `src/agent/session-store.ts`, `src/agent/replay.ts`, `src/agent/session-api.ts` | [remote-agent](docs/features/remote-agent.md) |
| SSH tunnel + client-provisioned agent bootstrap (headless client library — system-`ssh` stdio exec channel spawned argv-array/no-shell, NEVER an ssh library; named-agent registry seeded from SSH favorites, no secrets; F15 handshake + pure provisionable-vs-fatal classification (only `absent`/`version-mismatch` provision — auth/transport/framing failures never upload); size-verified atomic upload to the version-embedded `~/.termhalla/agent/termhalla-agent-<v>.cjs`, retry exactly once; caller-owned cancellation via `AbortSignal` (mid-upload abort = INDETERMINATE); no app wiring until F21 — F19's own `remote-client` scope guard mirrors TEST-746's retirement path; tests drive a fake-ssh shim + canned agents, gold test provisions the real bundle) | `src/remote-client/`, `src/shared/remote-agents.ts`, `tests/fixtures/fake-ssh.mjs` | [remote-bootstrap](docs/features/remote-bootstrap.md) |
| Remote node-pty prebuilt co-provisioning (F22/0023 — an installer ships a prebuilt native `node-pty` per v1 target `linux-x64-glibc`, staged/verified at release time with a per-file sha-256 manifest; the client probes the remote then co-provisions the prebuilt onto `<remoteAgentDir>/node_modules/node-pty` at connect time so the agent's lazy `import('node-pty')` resolves on a stock remote with zero manual setup — ground-truth skip re-verification of the on-disk native binary (never trust the marker alone), a race-tolerant rename-first promote (93/94/95 sentinels), a bounded early-settling probe channel, an always-reachable glibc-floor hint, and at most one recovery cycle on a post-install launch failure; strictly additive to `connectWithProvisioning` — byte-identical when the `nodePty` option is absent) | `src/remote-client/prebuilt.ts` (+ additions in `bootstrap.ts`), `src/main/remote/agent-artifact.ts` (`resolvePrebuiltRoot`), `scripts/stage-node-pty-prebuild.mjs`, `scripts/verify-node-pty-prebuild.mjs` | [remote-node-pty-prebuilt](docs/features/remote-node-pty-prebuilt.md) |
| Exclusive attach lease (F20/0021 — `tmux attach -d`, no mirrored attach: the store binding IS the lease, exactly ONE holder ever; bind-while-bound STEALS atomically (displace with full F17×F18 unbind semantics → notify → grant; newest bind wins, reentrancy-safe) and the loser gets `lease:revoked` (`AGENT_LEASE_REVOKED_EVT`, two-door via `remote-agent-api.ts`) as its FINAL frame then exits 0 — F21 renders the banner; release is HOLDER-scoped (a never-bound or displaced connection can't strip the holder — the session's `holdsLease`/`revoked` flags); no agent-side byte loss across a steal (replay covers the loser's undelivered tail); shipped stdio artifact unaffected (steals need F19/F21's transport wiring); this feature also owned the sanctioned TEST-1905 bind-guard amendment + the weld's typecheck housekeeping) | `src/agent/session-store.ts` (`bind`), `src/agent/session.ts`, `src/agent/session-api.ts` | [remote-agent](docs/features/remote-agent.md) |
| Per-project notepad | `src/main/persistence/notes-store.ts`, `src/renderer/components/NotesPanel.tsx` | [notepad](docs/features/notepad.md) |
| SSH / favorites store | `src/main/persistence/quick-store.ts`, `src/shared/quick.ts` | [ssh-favorites](docs/features/ssh-favorites.md) |
| Multi-window / undock | `src/main/window-manager.ts` (+ `-core.ts`), `src/main/services.ts` | [window-management](docs/features/window-management.md) |
| Remote workspaces (per-workspace home: routing over the ssh-tunneled agent client, the disconnected/reconnecting banner, capability greying; SCHEMA_VERSION v8→v9) | `src/main/remote/`, `src/shared/remote-home.ts`, `src/shared/remote-workspace.ts`, `src/renderer/store/remote-slice.ts`, `src/renderer/components/RemoteBanner.tsx` (+ `RemoteAgentPicker.tsx`) | [remote-workspaces](docs/features/remote-workspaces.md) |
| Agent daemonization (F23/0024 — the agent gains a persistent `--daemon` mode listening on a version-stable, **per-WORKSPACE** unix-domain socket under `~/.termhalla/agent/` (`agent-<wsToken>.sock` created 0600 by an umask-wrapped bind, `daemon-<wsToken>.json` cross-version-frozen metadata now carrying `proto`, `daemon-<wsToken>.log` truncated per generation AND capped at `DAEMON_LOG_MAX_BYTES`), reached through a thin byte-transparent `--attach` bridge over each ssh exec channel (spawn-then-attach, detached/`setsid` with stdout/stderr routed to the log fd, bounded readiness wait, one 4-field `TERMHALLA_BRIDGE_V1` stderr status line incl. `daemonProto`); one daemon per remote WORKSPACE so two same-host workspaces are fully independent (locked D6′ — the `wsToken` is derived client-side from the workspace id, `deriveWsToken`); race-safe single-instance claim where ALL crash-remnant reclaim lives INSIDE the daemon's serialized `claimSocket` (the bridge NEVER removes a file — FINDING-016) and cleanup is ownership-checked (a superseded daemon never unlinks a successor's endpoint); a really-scheduled idle self-exit armed on an established-connection COUNT (never a boolean — FINDING-008); and a non-destructive drift refusal driven by a wire-protocol version DECOUPLED from the app version (locked D4′): the daemon flow establishes on protocol compatibility only (`DAEMON_PROTO_COMPAT`, derived from `WIRE_PROTO`), so a routine auto-update (proto unchanged) REATTACHES and sessions survive; only a protocol-BREAKING release drifts and is refused non-destructively (old daemon keeps running until it idles out or is manually killed — the exact-version machines/default stdio mode are untouched). Makes the SHIPPED F18 inventory/replay reattach path survive a real client close/reopen INCLUDING across an auto-update. Client change is opt-in and confined to the launch/transport layer (`BootstrapOptions.daemon?: { workspaceId }`, absent ⇒ byte-identical pre-0024 flow; `services.ts` opts production connects in, threading each workspace id as the scope) — zero renderer/IPC/`SCHEMA_VERSION` change; `RemoteWorkspaceManager` needed only a one-line change (passing the workspace id through)) | `src/agent/daemon-server.ts`, `src/agent/bridge.ts`, `src/agent/daemon-lifecycle.ts`, `src/agent/daemon-guard.ts`, `src/agent/spawn-daemon.ts`, `src/agent/daemon-constants.ts`, `src/shared/remote/daemon-handshake.ts`, `src/remote-client/ws-token.ts`, `src/remote-client/bootstrap-daemon.ts`, `src/remote-client/bridge-status.ts` | [remote-agent](docs/features/remote-agent.md), [remote-workspaces](docs/features/remote-workspaces.md) |
| Renderer store | `src/renderer/store.ts` (root) + `src/renderer/store/` (slices + helpers) | — |
| IPC contract | `src/shared/ipc-contract.ts` | — |
| Keybindings | `src/shared/keybindings.ts`, `src/renderer/components/KeybindingsSettings.tsx` | [keybindings](docs/features/keybindings.md) |
| Native app menu / Settings entry | `src/main/menu.ts` (Edit ▸ Settings… → `menu:open-settings`; File ▸ New/Open/Reopen/Save/Save As → `menu:file-*` pushes, all consumed in `src/renderer/App.tsx`) | — |
| Workspace documents (File menu — save/close/reopen a workspace as a portable `.thws` file; the document format IS the existing workspace record, no `SCHEMA_VERSION` bump) | `src/shared/workspace-doc.ts`, `src/main/ipc/register-workspace-doc.ts`, `src/main/persistence/workspace-doc-store.ts`, `src/renderer/components/ReopenWorkspaceModal.tsx` (+ File-menu actions in `src/renderer/store.ts`) | [workspace-documents](docs/features/workspace-documents.md) |
| Toast notifications | `src/renderer/store/toasts-slice.ts` (single `pushToast` gate; `quick.toastsEnabled` opt-in for success/info, errors always show) | — |
| Output search history | `src/main/search/` | [search-history](docs/features/search-history.md) |
| Saved run commands | `src/shared/run-commands.ts`, `src/renderer/store/run-commands-slice.ts` | [run-commands](docs/features/run-commands.md) |
| Terminal links / image preview | `src/shared/terminal-links.ts`, `src/renderer/terminal/links.ts`, `src/main/ipc/register-preview.ts` | [terminal-links](docs/features/terminal-links.md) |
| Packaging / auto-update | `electron-builder.yml`, `src/main/updater.ts`, `build/icon.ico` | [packaging](docs/features/packaging.md) |

## Process / workflow

This project was built with the superpowers flow (brainstorm → spec → plan →
subagent-driven implementation → review → merge). Specs and plans live in
`docs/superpowers/`; per-feature deferred work is tracked in
`docs/superpowers/*-review-followups.md`, and repo-wide deferred work that belongs
to no single feature in [`docs/deferred.md`](docs/deferred.md). When you finish a
unit of work, update the [changelog](CHANGELOG.md) and the relevant
feature/follow-up doc.

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
