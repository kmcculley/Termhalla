# Architecture

Termhalla is an Electron app split into three sandboxed layers with a single,
typed bridge between them. This document covers the process model, the IPC
contract pattern, the terminal "awareness" pipeline, persistence, security, and
the build system. For per-feature detail see [`features/`](features/); for the
reasoning behind specific choices see [`decisions.md`](decisions.md).

## Process model

```
┌─────────────────────────────────────────────────────────────────┐
│ MAIN  (src/main/)  — Node + Electron, all privilege              │
│  pty/      node-pty (ConPTY) shells, spawn-spec, env, detection  │
│  status/   OSC 133 parser → status engine → busy/idle/needs-input│
│  fs/       read/write/readDir/stat + chokidar WatchManager       │
│  proc/     Get-CimInstance process tree (busy-gated polling)     │
│  cloud/    AWS/Azure CLI probes (abortable execFile)             │
│  ai/       Claude/Codex session detection from the process tree  │
│  usage/    Claude transcript watcher → usage metrics             │
│  persistence/ workspaces, app-state, quick.json, window-state    │
│  ipc/register.ts  wires every service to IPC channels            │
└───────────────▲───────────────────────────────┬─────────────────┘
                │ contextBridge (window.api)     │ push events
┌───────────────┴───────────────────────────────▼─────────────────┐
│ PRELOAD (src/preload/) — the ONLY main↔renderer surface          │
│  exposes the typed TermhallaApi over ipcRenderer                 │
└───────────────▲───────────────────────────────┬─────────────────┘
                │ window.api.*                   │ on* callbacks
┌───────────────┴───────────────────────────────▼─────────────────┐
│ RENDERER (src/renderer/) — React, no Node access                 │
│  store.ts (zustand)  · App / WorkspaceView (react-mosaic)        │
│  TerminalPane (xterm) · EditorPane (Monaco) · ExplorerPane       │
│  StatusBar · WorkspaceTabs · UsageWatcher · CommandPalette       │
└─────────────────────────────────────────────────────────────────┘
            SHARED (src/shared/) — types, IPC contract, pure logic
```

- **main** owns everything privileged. A `BrowserWindow` is created in
  `src/main/index.ts`; `registerHandlers(win)` in `src/main/ipc/register.ts`
  constructs every service and binds it to IPC channels.
- **preload** runs with `contextIsolation` and exposes exactly one object,
  `window.api`, implementing the `TermhallaApi` interface. The renderer has no
  other way to reach Node.
- **renderer** is a normal React app. All its side effects go through `window.api`
  (wrapped as `src/renderer/api.ts`). State lives in a single zustand store.

## The IPC contract

`src/shared/ipc-contract.ts` is the spine. It declares:

- `CH` — the channel-name constants (`domain:verb`, e.g. `pty:spawn`,
  `usage:metrics`). Channels commented `main -> renderer event` are push events.
- `TermhallaApi` — the typed method surface the preload implements and the
  renderer consumes.

A request/response call uses `ipcRenderer.invoke` ↔ `ipcMain.handle`. A
fire-and-forget call uses `ipcRenderer.send` ↔ `ipcMain.on`. A push event uses
`win.webContents.send` → an `on*(cb)` subscription in the renderer that returns an
unsubscribe function.

**Adding a feature** is always the same three edits: extend `ipc-contract.ts`,
implement in `register.ts`, consume via `api.ts` + the store. The shared contract
keeps both sides honest at compile time.

### safeSend

Main→renderer events can still fire during teardown (a pty exit after the window
is destroyed on app close). `register.ts` wraps every push in `safeSend`, which
checks `win.isDestroyed()` / `webContents.isDestroyed()` and swallows the throw —
so shutdown never crashes with "Object has been destroyed."

## The terminal awareness pipeline

Several features share one data stream rather than each polling independently:

```
node-pty onData ──► StatusEngine (OSC 133 markers + cwd OSC) ──► pty:status / pty:cwd
       │                   │ busy/idle
       │                   └────────────► ProcessTracker (busy-gated CIM poll) ──► pty:procs
       │                                          │ process info on busy
       │                                          └────► AiSessionTracker ──► ai:session
       └────────────────────────────────────────────────► (renderer xterm.write)
```

- **StatusEngine** parses injected **OSC 133** shell-integration markers
  (`A`=prompt, `C`=command-start, `D`=command-done) plus cwd sequences
  (**OSC 9;9** for PowerShell, **OSC 7** for bash) out of the raw PTY stream,
  emitting `busy` / `idle` / `needs-input` and cwd updates. Shell-specific init
  scripts are written to `userData/shell-integration/` and injected at spawn.
- **ProcessTracker** only polls (`Get-CimInstance Win32_Process`) while a terminal
  is busy, so an idle terminal costs nothing. It feeds the foreground process +
  descendant tree.
- **AiSessionTracker** classifies that process info to detect Claude/Codex, and
  stays "sticky" until the command finishes — so the chip persists through
  Claude's quiet waiting periods.
- **UsageTracker** is the one awareness piece driven from the *renderer*: when a
  pane is a Claude session with a known cwd, the `UsageWatcher` component asks main
  to watch that cwd's transcript directory.

This sharing is deliberate — see [decisions.md](decisions.md). The cross-cutting
hazards it created (ANSI-stripping the status tail, avoiding redundant resizes)
are documented in [CLAUDE.md](../CLAUDE.md) → Load-bearing gotchas.

## State management

The renderer keeps one zustand store (`src/renderer/store.ts`) holding the
workspaces plus per-pane runtime maps keyed by paneId: `statuses`, `cwds`,
`procs`, `aiSessions`, `usage`. Push events update these maps; `closePane` clears
all of them together (cleanup parity matters — a missed map is a slow leak).
Workspace edits trigger a debounced auto-save.

## Persistence

All persistent data lives under the Electron `userData` directory
(`src/main/persistence/paths.ts`):

| File / dir | Contents |
|---|---|
| `workspaces/<id>.json` | One file per workspace (layout tree + pane configs). |
| `app-state.json` | Open workspace ids, active workspace, `schemaVersion`. |
| `window-state.json` | Window bounds + maximized, clamped to current displays. |
| `quick.json` | App-global SSH connections + favorite/recent dirs (sanitized on read+write). |
| `shell-integration/` | Generated per-shell init scripts injected into terminals. |

Pane configs are a discriminated union (`PaneConfig` = terminal | editor |
explorer) so the layout can mix pane kinds. `SCHEMA_VERSION` in
`src/shared/types.ts` gates migrations.

## Security

- `contextIsolation: true`, `nodeIntegration: false` — the renderer cannot touch
  Node; everything goes through the preload's typed bridge.
- The renderer CSP allows Monaco's needs (`script-src 'unsafe-eval'`,
  `worker-src blob:`) and nothing broader.
- No secrets are persisted (SSH = host/user/port + key *path*; cloud = nothing).
- The usage feature reads `~/.claude` transcripts read-only and extracts only
  token-count fields, never conversation content.

## Build system

[electron-vite](https://electron-vite.org/) builds three targets — `main`,
`preload`, `renderer` — to `out/`, with a shared `@shared` path alias. The main
and preload bundles externalize deps; the renderer bundles React + Monaco. Native
`node-pty` is patched (Spectre off) and rebuilt for Electron's ABI. Type-checking
runs against two tsconfigs (`tsconfig.json` for the renderer, `tsconfig.node.json`
for main/preload).

## Testing

- **vitest** for pure logic (`src/shared` and the pure modules beside each
  service). Fast, no Electron.
- **Playwright for Electron** for anything needing a real window. Specs launch
  `out/main/index.js` with `--no-sandbox --disable-gpu` and a hermetic temp
  `--user-data-dir`, and tear down with `taskkill /F /T` (node-pty children keep
  Electron's pipes open). Pinned to `workers: 1`.
