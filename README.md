# Termhalla

> Unified terminals, code editor, and file explorer with saveable workspaces and terminal "awareness."

Termhalla is a Windows desktop app that brings tiled terminals, a Monaco-based
editor, and a live file explorer into one window — arranged into named, saveable
**workspaces**. On top of plain terminals it layers *awareness*: it knows when a
shell is busy or waiting for input, what process is running in it, what directory
it's in, whether an AI coding agent (Claude Code / Codex) is running there, and —
for Claude — how full its context window is.

> **Platform:** Windows-first. The terminal layer uses ConPTY, PowerShell/cmd
> shell integration, and `Get-CimInstance` process queries. It runs on Electron,
> which is cross-platform, but the awareness features target Windows.

---

## Features

| Area | What you get |
|---|---|
| **Tiled workspaces** | Multiple real shells in a [react-mosaic](https://nomcopter.github.io/react-mosaic/) split layout; named workspace tabs; save/restore + debounced auto-save; window-state memory. |
| **Status & alerts** | Per-terminal busy / idle / needs-input state from OSC 133 shell integration; status borders, 🔔 tab badges, OS notifications, per-terminal alert settings. |
| **Editor & explorer** | Monaco editor panes with per-file tabs, dirty tracking, Ctrl+S, external-change reload; a lazy, watched file-tree explorer. |
| **CWD awareness** | Live working directory per terminal (OSC 9;9 / OSC 7); "Open Explorer here" / "Reveal"; restored on reload. |
| **SSH & favorites** | Ctrl+K command palette; saved SSH connections (no secrets stored); recent/favorite directories. |
| **Child-process tracking** | The foreground process on a chip + a descendant process tree popover. |
| **Cloud status** | Global status bar showing AWS / Azure CLI login state. |
| **AI session awareness** | Detects Claude Code / Codex sessions in a terminal; `✨ Claude` chip + tab indicator + "waiting for you" notification. |
| **Claude usage metrics** | Live context-window % on the chip and a token breakdown in the popover, parsed from Claude's transcript. |

See [`docs/features/`](docs/features/) for a doc per feature.

## Quick start

**Prerequisites:** Node.js 18+, npm, Windows 10/11, and the Visual Studio C++
build tools (for the native `node-pty` module).

```bash
npm install                 # also runs patch-package (node-pty Spectre patch)
npx electron-rebuild         # rebuild node-pty against Electron's ABI (see Native modules)
npm run dev                  # launch the app with hot reload
```

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run the app in development (electron-vite, hot reload). |
| `npm run build` | Production build to `out/`. |
| `npm start` | Preview a production build (`electron-vite preview`). |
| `npm run typecheck` | Type-check both the renderer and the node (main/preload) configs. |
| `npm test` | Run the unit test suite (vitest, headless). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run e2e` | Run the Playwright-for-Electron end-to-end suite. |

### Native modules

`node-pty` is a native addon and must be compiled against Electron's ABI:

- `npm install` runs `patch-package`, applying `patches/node-pty+1.1.0-beta34.patch`
  (disables the Spectre mitigation, which needs MSVC Spectre libs we don't require).
- Then run `npx electron-rebuild` to rebuild it for the installed Electron version.
- If the rebuild fails invoking a `.bat`, clear the `NoDefaultCurrentDirectoryInExePath`
  environment variable first — a sandbox can set it and break `.bat`-invoking builds.

## Testing philosophy

Pure logic in `src/shared` and the main-process services is unit-tested with
**vitest**. Everything that needs a real Electron window — terminals, editor,
IPC, the awareness features — is verified by launching the actual app under
**Playwright for Electron** (`npm run e2e`). Playwright is used as a per-build
self-feedback loop, not just CI. e2e runs serial (`workers: 1`) because the app
is single-instance and concurrent windows starve the process polls.

## Project layout

```
src/
  main/        Electron main process (privileged): pty, status, fs, proc, cloud, ai, usage, persistence
  preload/     contextBridge — the only main↔renderer surface
  renderer/    React UI (zustand store, react-mosaic, xterm, Monaco)
  shared/      Types, the IPC contract, and pure logic shared by both sides
tests/
  main/        vitest unit tests for pure/main logic
  shared/      vitest unit tests for shared logic
  renderer/    vitest unit tests for renderer-side pure logic
  e2e/         Playwright-for-Electron specs
docs/
  architecture.md           System architecture
  decisions.md              Decision log (ADR-style)
  features/                 One doc per shipped feature
  superpowers/              Per-feature design specs, plans, and review follow-ups
```

## Tech stack

Electron 33 · TypeScript (strict) · electron-vite · React 18 · zustand ·
react-mosaic-component · xterm.js · node-pty (ConPTY) · Monaco · chokidar ·
vitest · Playwright.

## Documentation

- [Architecture](docs/architecture.md) — process model, IPC, data flow, security.
- [Decision log](docs/decisions.md) — why things are the way they are.
- [Changelog](CHANGELOG.md) — what changed and when.
- [Feature docs](docs/features/) — one per feature.
- [`CLAUDE.md`](CLAUDE.md) — guidance for AI coding agents working in this repo.

## License

Unpublished / private. No license granted.
