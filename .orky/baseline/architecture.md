# Termhalla — Baseline Architecture Map

> **Status: inferred.** This map was reconstructed by reading the code (a lifting pass), cross-checked
> against `docs/architecture.md` and `CLAUDE.md`, and verified against the green vitest suite. It
> describes what the system **currently does**, not what it should do. A human must confirm it before it
> governs anything.

**Generated:** 2026-06-29

## Overview

Termhalla is an Electron + TypeScript + React desktop app: unified terminals (xterm.js front-end over
`node-pty`/ConPTY back-end), a Monaco code editor, and a file explorer, arranged as saveable
multi-pane **workspaces** (react-mosaic tiling) that can be undocked into separate OS windows. Around
the terminals it layers an "awareness" pipeline — busy/idle/needs-input status, cwd tracking, process
tree, AI-session detection, cloud-CLI login status, git status, and Claude token-usage metrics — all
driven from a single `node-pty` output stream.

The codebase is split into **three sandboxed layers** with one typed bridge between them:

| Layer | Path | Role |
|---|---|---|
| **main** | `src/main/` | All privilege: PTYs, filesystem, process queries, cloud probes, persistence, search index. Node + Electron. |
| **preload** | `src/preload/` | The *only* main↔renderer surface. Exposes a typed `window.api` (`TermhallaApi`) via `contextBridge`. |
| **renderer** | `src/renderer/` | React + a single zustand store. No Node access; every side effect goes through `window.api`. |
| **shared** | `src/shared/` | Types, the IPC contract, and pure logic bundled into both sides. |

Security posture (from `src/main/index.ts` / `docs/architecture.md`): `contextIsolation: true`,
`nodeIntegration: false`; renderer CSP allows only Monaco's `unsafe-eval` + `worker-src blob:`; no
secrets persisted (SSH stores host/user/port + identity-file *path*; cloud stores nothing; usage reads
`~/.claude` transcripts read-only for token fields only).

## Module map

Pure, headlessly-testable logic (no `node:*`/Electron imports) lives in `src/shared/` and in small pure
modules beside each main service; the impure shell (chokidar, `execFile`, `node-pty`, sqlite) is kept
thin around it. That pure core is what this baseline characterizes (see CHAR ids).

### IPC spine
- **`src/shared/ipc-contract.ts`** — `CH` channel-name constants (`domain:verb`) + the `TermhallaApi`
  interface. The compile-time contract both sides implement. *Calls:* nothing (declarations only).
- **`src/main/ipc/register.ts`** — thin composition root; registers the per-domain registrars and
  routes push events (pane-scoped → owning window, app-global → broadcast) through `safeSend` (guards
  `win.isDestroyed()` so a late PTY-exit during teardown can't crash). *Calls:* the `register-*`
  registrars, `WindowManager`.
- **`src/main/ipc/register-{pty,fs,workspaces,drafts,cloud,usage,recording,env,clipboard,git,search,notes,shell,preview}.ts`**
  — per-domain wiring of a service to its channels.

### Terminal + status (`src/main/pty/`, `src/main/status/`)
- **`pty/pty-manager.ts`**, **`pty/spawn-spec.ts`**, **`pty/shells.ts`**, **`pty/env.ts`** — spawn and
  manage `node-pty` shells; idempotent `pty:spawn` (re-adopts a running PTY across pane moves).
- **`status/osc-scanner.ts`** — shared OSC sequence scanner (find-prefix / locate BEL-or-ST terminator
  / slice body / carry partial). Used by both parsers below.
- **`status/osc133-parser.ts`** — extracts OSC 133 shell-integration markers (A=prompt, C=command-start,
  D=command-done+exit).
- **`status/cwd-parser.ts`** — extracts cwd from OSC 9;9 (PowerShell) and OSC 7 `file://` URLs,
  translating DOS / msys (`/c/…`) / WSL (`/mnt/c/…`) forms to Windows paths. *(CHAR-005)*
- **`status/needs-input.ts`** — pure status heuristics: `stripAnsi`, `isPureControl`,
  `tailMatchesInputPrompt`, `computeNeedsInput`, `looksLikePrompt`, `computeIdleFallback`, plus the
  `AGENT_WORKING_RE` ("esc to interrupt") AI indicator. *(CHAR-001, CHAR-002, CHAR-003)*
- **`status/status-tracker.ts`** — `StatusTracker` state machine combining markers + output silence +
  the AI indicator into `idle | busy | needs-input` with `lastExit`. *(CHAR-004)*
- **`status/status-engine.ts`**, **`status/integration-scripts.ts`**, **`status/shell-integration.ts`**
  — wire parsers to the live stream; generate per-shell init scripts injected at spawn.

### Process tree & AI (`src/main/proc/`, `src/main/ai/`)
- **`proc/proc-tree.ts`** — pure parse of `Get-CimInstance` JSON into a process tree: `parseCimRows`,
  `parseCimDate` (WMI `/Date(ms)/` + ISO), `cleanName`, `descendantsOf` (DFS pre-order + depth),
  `pickForeground` (newest-child chain to leaf), `buildProcInfo`. *(CHAR-006, CHAR-007)*
- **`proc/cim-query.ts`**, **`proc/process-tracker.ts`** — busy-gated CIM/WMI polling (only while a
  terminal is busy). *Impure — not characterized.*
- **`ai/classify-ai.ts`** — regex-classify a tree into a Claude/Codex `AiSession` or null. *(CHAR-008)*
- **`ai/ai-session-tracker.ts`** — sticky AI-session lifecycle (persists through quiet waits).

### Cloud, git, usage, search
- **`cloud/classify.ts`** — pure probe-outcome → `CloudStatus` (`not-installed`/`error`/`logged-out`/
  `logged-in`). *(CHAR-011)* **`cloud/providers.ts`**, **`cloud/aws-profiles.ts`**, **`cloud/probe.ts`**,
  **`cloud/cloud-status-service.ts`** — abortable `execFile` AWS/Azure probes.
- **`shared/group-cloud.ts`** — collapse a flat `CloudStatus[]` into per-family chip groups. *(CHAR-012)*
- **`git/parse-status.ts`** — parse `git status --porcelain=v2 --branch`. *(CHAR-018)* **`git/probe.ts`**,
  **`git/git-status-service.ts`** — run git, attach repo root.
- **`usage/parse-usage.ts`** — sum Claude transcript token usage; `[1m]` context-window selection.
  *(CHAR-009, CHAR-010)* **`usage/usage-tracker.ts`**, **`usage/project-dir.ts`**, **`usage/model-alias.ts`**.
- **`search/fts-query.ts`** — sanitize free text into a safe FTS5 MATCH expression. *(CHAR-020)*
  **`search/prune-policy.ts`** — segment-cap overage. *(CHAR-020)* **`search/search-service.ts`**,
  **`search/indexer.ts`**, **`search/segment-buffer.ts`** — `better-sqlite3` FTS5 index (WAL).
- **`src/main/orky/`** — *added by feature 0004 (Orky status awareness).* A new privileged, **read-only**
  subsystem that watches a project's `.orky/` tree (resolved by `find-orky-root.ts`, a bounded upward
  walk) with a chokidar watcher cloned from `UsageTracker` (`orky-tracker.ts`): one watcher + debounced
  re-read per resolved root, `.json` event filter, bounded readdir/readFile + symlink guard, never
  spawning a CLI and never writing under `.orky/`. **Note (feature 0007, CONV-008): this "read-only"
  characterization now applies only to the WATCHER/tracker path above** — `src/main/orky/` as a whole
  directory also hosts `OrkyActionDispatcher` (below), Termhalla's first write-capable surface into a
  project's `.orky/` tree; every one of ITS mutations happens strictly through an Orky CLI subprocess
  (never a direct file write from Termhalla's own code) and it never drives the pipeline. The pure status
  mappers live in
  **`src/shared/orky-status.ts`** (gate-based live-phase / needs-human roll-up; `ORKY_PHASES` mirrors the
  recorded gate keys / `DRIVER_WORK_PHASES`). Status is pushed over the pane-scoped **`orky:status`** IPC
  channel (with `orky:watch` / `orky:unwatch`, validated + per-window sender-scoped in `register-orky.ts`)
  and held as live runtime state in the renderer store. **Render-time precedence:** for a bound Orky run
  the Orky-derived status takes precedence over the byte-derived `TerminalStatus` for the pane border and
  the workspace tab badge (the byte-status computation itself is unchanged — baseline REQ-004). Nothing is
  persisted (no `SCHEMA_VERSION` bump).
- **`src/main/orky/orky-registry.ts`** — *added by feature 0005 (cross-project Orky registry).*
  Generalizes the single-root `OrkyTracker` above to a pane-independent, cross-project aggregate
  (`OrkyRegistry`): the union of every open pane's resolved `.orky/` root (ephemeral) and a new persisted
  explicit list (manual, `registry:addRoot`/`registry:removeRoot` only), reusing the SAME per-root status
  roll-up. The per-root watch/read machinery was *extracted* from `orky-tracker.ts` into a new shared
  `OrkyRootEngine` (`src/main/orky/orky-root-engine.ts`) — constructed ONCE in `services.ts` and injected
  into BOTH `OrkyTracker` and `OrkyRegistry`, so a root tracked by several panes *and* the persisted list
  still has exactly one chokidar watcher. The persisted list lives in a new, self-versioned
  **`orky-registry.json`** under `userData` (`src/main/persistence/orky-registry-store.ts`,
  `{version:1, roots:[...]}`, atomic write; independent of `SCHEMA_VERSION`). The aggregate is pushed over
  a new app-global `registry:status` IPC channel (`src/main/ipc/register-registry.ts`); its first renderer
  consumer is feature 0006's decision-queue drawer (`src/renderer/components/DecisionQueuePanel.tsx` +
  `src/renderer/store/registry-slice.ts`), which subscribes to the push plus one generation-guarded
  `registry:current` recovery pull — read surface only; the mutation surface
  (`registry:addRoot`/`removeRoot`) still has no renderer consumer. *Extended by feature 0009 (native
  Orky pane)* with two more read-only surfaces in the same registrar: `registry:detail` (a
  renderer→main pull, per-tracked-root, membership-gated) and `registry:rootChanged` (a bare-string
  main→renderer push on every completed engine re-read) — see [orky-pane](../../docs/features/orky-pane.md).
- **`src/main/orky/orky-action-dispatcher.ts`** (`OrkyActionDispatcher`) — *added by feature 0007
  (Orky action-dispatch substrate).* Termhalla's **first write-capable IPC surface** into an
  Orky-adopted project: four actions (`resolveEscalation`/`submitWork`/`recordHumanGate`/`driveStatus`)
  over four new `orkyAction:*` channels. EVERY mutation is performed by invoking one of Orky's OWN CLIs
  (`feedback submit`, `feedback emit`, `gatekeeper resolve-escalation`, `gatekeeper record`) via an abortable/`unref()`'d
  `execFile` (`orky-cli-runner.ts`, argument array only, never a shell) — this dispatcher **never writes a
  file under any `.orky/` tree itself, never spawns an agent, and never drives the pipeline** (D1). Every
  `projectRoot` is checked against the SAME app-wide `OrkyRegistry.roots()` allowlist (D3) via the shared
  `normalizeProjectRoot`; every `feature` slug is confined to a single path segment and the target
  `featureDir` is always built server-side, never renderer-supplied. The Orky CLI location is resolved
  through a single injectable function (`orky-cli-locate.ts`, `ORKY_PLUGIN_DIR` env var, no default path
  assumed valid). Mutating actions on the SAME resolved `featureDir` are serialized through a
  per-key promise-chain queue (`orky-action-queue.ts`) so a concurrent submission can never lose another's
  `state.json` update; read-only `driveStatus` bypasses it. Every dispatcher-reached invocation — success
  or rejection — is recorded in an append-only `orky-actions.jsonl` audit log under Electron `userData`
  (`orky-action-audit.ts`) — the ONLY filesystem write this feature performs anywhere; a sender rejected at
  the IPC-registrar boundary (`register-orky-action.ts`) never reaches the dispatcher and is not audited.
  This feature itself ships no renderer UI (D1); its first renderer consumer is feature 0012's
  quick-capture modal (`submitWork` only, which rides the plugin's local-inbox `feedback submit` —
  amended there per its REQ-013); see `docs/features/orky-action-dispatch.md`.

### Shared renderer/UI logic
- **`shared/keybindings.ts`** — command registry, chord parse/format, `resolveBindings`,
  `matchShortcut`, `isValidRebind`. *(CHAR-013)*
- **`shared/run-commands.ts`** — immutable CRUD on saved run commands. *(CHAR-014)*
- **`shared/font-zoom.ts`** — Ctrl+wheel terminal font-size clamp. *(CHAR-015)*
- **`shared/terminal-links.ts`** — image-link detection/resolution for clickable terminal links.
  *(CHAR-016)*
- **`shared/language.ts`** — file-extension → Monaco language id. *(CHAR-017)*
- **`shared/project-key.ts`** — resolve a pane's "project" (git root → live cwd → persisted cwd → ''). *(CHAR-019)*
- **`shared/{workspace-model,app-state-model,paths,theme,contrast,schedule,quick,broadcast,editor-draft,cast,alerts,keymap}.ts`**
  — workspace/layout models, theme + contrast math, schedule triggers, SSH/favorites, broadcast,
  draft keys. *(Already covered by the pre-existing vitest suite; not re-characterized here.)*

### Renderer & persistence
- **`src/renderer/store.ts`** + **`src/renderer/store/`** — one zustand store, composed from slices
  (`theme`, `runtime`, `quick`, `schedule`, …), holding workspaces plus per-pane runtime maps keyed by
  `paneId` (`statuses`, `cwds`, `procs`, `aiSessions`, `usage`, `recording`, `gitStatus`). Push events
  update the maps; `clearPaneRuntime` is the single cleanup site.
- **`src/main/persistence/`** — `paths.ts` (userData locations), `store.ts` (workspaces + app-state),
  `quick-store.ts` (`normalizeQuick` sanitize), `draft-store.ts` (hot-exit buffers), `notes-store.ts`,
  `atomic-write.ts`. `SCHEMA_VERSION` in `src/shared/types.ts` gates migrations. *(Bumped 6 → 7 by
  feature 0003-pane-minimize-restore, which added persisted per-workspace pane view-state —
  `Workspace.minimized` + `Workspace.maximized`. Pane **maximize** view-state, previously transient,
  is now persisted alongside minimize; the renderer derives the maps on load and folds them back on
  save via `applyViewState`, never writing app-state. This is a deliberate behavior change to the
  inferred baseline, reconciled through the tests phase.)*
- **`src/main/window-manager.ts`** + **`-core.ts`** — multi-window / undock; main owns the `windows[]`
  arrangement, renderer syncs via `win:report`.

## Main data/control flows

1. **Terminal awareness (shared stream).** `node-pty onData` → `StatusEngine` (OSC 133 markers + cwd
   OSC) emits `pty:status` / `pty:cwd`; on *busy*, `ProcessTracker` polls the CIM process tree
   (`pty:procs`); that feeds `AiSessionTracker` (`ai:session`); the same raw bytes are also written to
   the renderer's xterm. `StatusTracker.tick` resolves sustained silence into idle/needs-input.
2. **Usage (renderer-driven).** When a pane is a detected Claude session with a known cwd, the
   `UsageWatcher` asks main to watch that cwd's `~/.claude` transcript dir; `parse-usage` recomputes
   metrics on change → `usage:metrics`.
3. **Persistence.** Workspace edits → debounced auto-save to `workspaces/<id>.json`; window arrangement
   → `app-state.json` (main-owned). Editor drafts hot-exit to `editor-drafts.json`.

## Entry points
- `src/main/index.ts` — `buildServices()` then `WindowManager` creates window(s); `registerHandlers`.
- `src/preload/` — exposes `window.api`.
- `src/renderer/` — React app root; `api.ts` wraps `window.api`.

## External dependencies
`node-pty` (PTY; patched Spectre-off, needs electron-rebuild), `better-sqlite3` (FTS index; needs
electron-rebuild + `asarUnpack`), `@xterm/xterm` + addons, `monaco-editor`, `react`/`react-dom`,
`react-mosaic-component`, `zustand`, `chokidar` (fs watch), `electron-updater`, `uuid`. External CLIs
shelled out to: PowerShell `Get-CimInstance` (process tree), `aws`/`az` (cloud), `git` (status).

## Build & test
- **Build:** `npm run build` (electron-vite → `out/`, targets main/preload/renderer; `@shared` alias).
- **Tests (this baseline's gate):** `npm test` = `vitest run` — pure logic, headless, **verified green
  (631 tests incl. the 20 new CHAR tests; exit 0)**. Profile: `.orky/profiles/node-app.json`,
  `testRoots: ["tests"]`.
- **Not run by `npm test`:** `npm run e2e` (Playwright-for-Electron, launches the real app, `workers: 1`),
  `npm run typecheck`.

## Suspected issues
Observations of likely-wrong behavior. **Not fixed here** — characterization pins current behavior, bugs
and all. Adjudicated by Kevin (2026-06-29): **all four confirmed as known bugs** and are candidate Orky
features. Fixing each becomes a deliberate, gated change (with its CHAR test updated through the tests
phase), never a silent edit. The relevant CHAR test currently pins the *buggy* current behavior, so each
fix's tests-phase update is the auditable record of the intended change.

1. **[KNOWN BUG — FIXED 2026-07-09]** ~~**AI-detection substrings are unanchored**~~
   (`ai/classify-ai.ts`, `AI_TOOLS`). The `claude-code` / `@anthropic-ai[\\/]claude` /
   `@openai[\\/]codex` alternatives were plain substrings; fixed in the 2026-07-09 quality/polish
   batch (user-directed, outside the Orky pipeline): every alternative is boundary-anchored, the
   bare `claude`/`codex` patterns byte-identical. New pins in `tests/main/classify-ai.test.ts`
   (`claude-codebase`, `my-claude-code-notes`, `@anthropic-ai/claudette` all null). CHAR-008
   needed no amendment — it never pinned the false positive (verified green post-fix).
2. **[KNOWN BUG — FIXED 2026-07-09]** ~~**Generic input-prompt catch-all is whitespace-strict**~~
   (`status/needs-input.ts`, `DEFAULT_NEEDS_INPUT_PATTERNS`). The fallback pattern was `/\?\s$/` —
   a question-style prompt ending in `?` with **no** trailing space (common — the cursor sits right
   after `?`) never matched the catch-all and could wedge busy. Fixed in the 2026-07-09
   quality/polish batch (user-directed, outside the Orky pipeline): the pattern is now `/\?\s*$/`,
   pinned by new cases in `tests/main/needs-input.test.ts`. CHAR-002 needed no amendment — it never
   pinned the negative case (verified green post-fix); this note is the auditable record.
3. **[KNOWN BUG — FIXED 2026-07-09]** ~~**Merge-conflict (`u`) entries are counted only as
   `unstaged`**~~ (`git/parse-status.ts`). Fixed in the 2026-07-09 quality/polish batch
   (user-directed, outside the Orky pipeline): `u` entries are a distinct `conflicted` count on
   `GitStatus` (runtime-only, no schema), included in `dirty`, surfaced in the git popover while
   non-zero. CHAR-018 amended as the deliberate change-record — the `toEqual` shape gained
   `conflicted: 0`, every pinned count unchanged.
4. **[KNOWN BUG — confirmed, fix with care]** **`isPureControl` can suppress real output that begins
   with a cursor-home sequence** (`status/needs-input.ts`, `CURSOR_HOME_RE`). Any chunk that *starts*
   with a cursor-home escape is treated as a screen repaint and excluded from the status tail / quiet
   timer, even if it carries new printable text (e.g. a TUI that redraws then prints a fresh prompt in
   one chunk). **Load-bearing:** this guard exists to avoid prompt eviction on ConPTY full-screen
   repaints (see `CLAUDE.md` → "Status tail must be ANSI-stripped"). A fix must distinguish a pure
   repaint from a repaint-that-also-emits-a-new-prompt **without** reopening the eviction bug — so its
   feature must re-verify the repaint-eviction scenario, not just the new case. *Fix touches REQ-007 /
   CHAR-001.*

## Not characterized (coverage boundary)
Surface that cannot be pinned headlessly with the vitest profile — no CHAR test exists for it; it needs
the e2e/Electron harness (a later milestone) or live external state:

- **Electron IPC wiring & teardown** — `src/main/ipc/register*.ts`, `safeSend`, contextBridge exposure.
  Requires a real `BrowserWindow`/`ipcMain`. (Exercised only by `tests/e2e/`.)
- **`node-pty` spawning & ConPTY behavior** — `pty/pty-manager.ts`, real shell I/O.
- **xterm / Monaco rendering** — terminal grid, FitAddon, editor model switching, layout gotchas.
- **chokidar fs watches** — `fs/watch-manager.ts` real filesystem events (the *manager* has unit tests
  with fakes; live watching does not).
- **Live process-tree polling** — `proc/cim-query.ts`, `proc/process-tracker.ts` busy-gated PowerShell
  `Get-CimInstance` (the *parse* is characterized; the *poll/gate* is not).
- **Live cloud probes** — `cloud/probe.ts`, `cloud/cloud-status-service.ts` real `aws`/`az` `execFile`
  (the *classification* is characterized; the spawn is not).
- **Live git probe** — `git/probe.ts` real `git` invocation (the *parse* is characterized).
- **SQLite FTS index I/O** — `search/search-service.ts`, `search/indexer.ts` real `better-sqlite3` (the
  query builder and prune math are characterized; the DB is not).
- **Multi-window undock / app-state persistence on disk** — `window-manager.ts`, real `userData` files.
- **Auto-update** — `updater.ts`, `electron-updater`.
