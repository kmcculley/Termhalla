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
| **Tiled workspaces** | Multiple real shells in a [react-mosaic](https://nomcopter.github.io/react-mosaic/) split layout; named workspace tabs with right-click Rename / Save / Close, inline rename, and drag-to-reorder; save/restore + debounced auto-save; reusable layout **templates** (save a layout, spawn new workspaces from it); window-state memory. |
| **Multi-window undock** | Tear a workspace tab off into its own OS window on any monitor and drag it back to re-dock; live shells survive the move with scrollback intact, and the multi-window arrangement is restored on relaunch. |
| **Status & alerts** | Per-terminal busy / idle / needs-input state from OSC 133 shell integration; status borders, 🔔 tab badges, OS notifications, per-terminal alert settings. |
| **Editor & explorer** | Monaco editor panes with per-file tabs, dirty tracking, Ctrl+S, external-change reload; a lazy, watched file-tree explorer. |
| **CWD awareness** | Live working directory per terminal (OSC 9;9 / OSC 7); "Open Explorer here" / "Reveal"; restored on reload. |
| **SSH & favorites** | Ctrl+K command palette; saved SSH connections (no secrets stored); recent/favorite directories. |
| **Child-process tracking** | The foreground process on a chip + a descendant process tree popover. |
| **Git status** | A per-pane branch chip (branch name + dirty dot) for panes inside a git working tree, with upstream ref, ahead/behind, and staged/unstaged/untracked counts in a popover. |
| **Cloud status** | Global status bar showing AWS / Azure CLI login state. |
| **AI session awareness** | Detects Claude Code / Codex sessions in a terminal; `✨ Claude` chip + tab indicator + "waiting for you" notification. |
| **Claude usage metrics** | Live context-window % on the chip and a token breakdown in the popover, parsed from Claude's transcript. |
| **Broadcast & scheduled input** | Send the same text to every terminal in a workspace at once (raw keystrokes or bracketed paste, plus a row of quick-keys); or schedule command(s) to a single terminal after a delay, when it goes idle, or on a recurring schedule. |
| **Saved run commands** | Named, persisted run-on-click commands (e.g. Test / Build / Watch) at pane and workspace scope, riding into saved workspace templates. |
| **Output search history** | Full-text search across current and past terminal output (local SQLite FTS5 index), with reveal-in-pane / relaunch-at-cwd actions and a per-pane indexing mute. |
| **Terminal recording** | Record a terminal's output to a replayable asciinema `.cast` file — per-terminal, or automatically for every new terminal. |
| **Per-project notepad** | A collapsible notes drawer scoped to the focused pane's project (git root, else cwd), persisted across restarts. |
| **Environment variables** | Inject env vars into terminals from an AES-256-GCM-encrypted local vault — global vars for every shell or per-terminal overrides. |
| **Theming** | Customize window / panel / text / accent / alert / terminal colors, fonts, and sizes, with named presets. |
| **Keybindings** | Rebindable keyboard shortcuts via **Settings → Keybindings**, persisted; reserved Ctrl+1–9 workspace jumps; rotating shortcut tips in the status bar. |

See [`docs/features/`](docs/features/) for a doc per feature.

## Install (Windows)

Grab the latest installer from [**Releases**](https://github.com/kmcculley/Termhalla/releases/latest)
(`Termhalla-Setup-<version>.exe`), or use a package manager.

> **Heads-up: the installer is unsigned.** Windows SmartScreen will show
> "Windows protected your PC / unknown publisher." It's expected for an unsigned build — click
> **More info → Run anyway**, or run `Unblock-File .\Termhalla-Setup-<version>.exe` first. Signing
> is on the roadmap ([`packaging/signing.md`](packaging/signing.md)); the package-manager installs
> below verify by hash and avoid the prompt.

**winget** (manifests in [`packaging/winget/`](packaging/winget/), pending submission to
`winget-pkgs`):
```powershell
winget install localhostworks.Termhalla
```

**Scoop** (portable build; see [`packaging/scoop/`](packaging/scoop/)):
```powershell
scoop install https://raw.githubusercontent.com/kmcculley/Termhalla/main/packaging/scoop/termhalla.json
```

**Portable:** download `Termhalla-<version>-win.zip` from the release, unzip anywhere, run
`Termhalla.exe` — no install, no SmartScreen prompt.

## Quick start

**Prerequisites:** Node.js 18+, npm, Windows 10/11, and the Visual Studio C++
build tools (for the native `node-pty` module).

```bash
npm install                 # also runs patch-package (node-pty Spectre patch)
npm run rebuild:native       # rebuild node-pty against Electron's ABI (see Native modules)
npm run dev                  # launch the app with hot reload
```

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run the app in development (electron-vite, hot reload). |
| `npm run build` | Production build to `out/`. |
| `npm start` | Preview a production build (`electron-vite preview`). |
| `npm run typecheck` | Type-check the renderer, the node (main/preload), and the e2e configs. |
| `npm test` | Run the unit test suite (vitest, headless). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run e2e` | Run the Playwright-for-Electron end-to-end suite. |
| `npm run rebuild:native` | Rebuild `node-pty` against Electron's ABI, auto-handling the Windows Python/env gotchas (see Native modules). Add `-- --force` to force. |
| `npm run package` | Build and pack a Windows NSIS installer + `latest.yml` into `dist/` (no publish). |

Releasing is done by CI on a tag push, not a local script: bump the `package.json` version, commit, tag `vX.Y.Z`, and push the tag. The `release.yml` workflow runs `npm run package` and uploads the installer + `latest.yml` to a single GitHub Release.

### Native modules

Two native addons must be compiled against Electron's ABI:

**`node-pty`** (terminal layer):

- `npm install` runs `patch-package`, applying `patches/node-pty+1.1.0-beta34.patch`. It does two
  things: disables the Spectre mitigation (which needs MSVC Spectre libs we don't require), and
  defines `NDEBUG` for the Windows targets — node-gyp Release builds leave raw `assert()` calls
  live, and node-pty's ConPTY teardown race (`conpty.cc` `remove_pty_baton`) otherwise pops a
  blocking MSVC "Assertion failed" dialog when the app is force-closed with a live PTY.
- Then run **`npm run rebuild:native`** to rebuild it for the installed Electron version. It wraps
  `electron-rebuild` and handles two Windows gotchas automatically: it points node-gyp at a real
  Python via the `py` launcher (working around a Microsoft Store `python.exe` alias stub that
  reports "Python was not found"), and strips `NoDefaultCurrentDirectoryInExePath` from the build
  subprocess only (a security-hardening env var — a sandbox can set it — that otherwise stops
  cmd.exe finding winpty's `GetCommitHash.bat`). Add `-- --force` to force a rebuild.
- Plain `npx electron-rebuild` still works when your environment has neither gotcha.

**`better-sqlite3`** (output search index):

- Run `npx electron-rebuild -f -w better-sqlite3` after install (or after any Electron version change).
- The compiled `.node` binary is kept out of the asar archive (`asarUnpack` in `electron-builder.yml`) so it loads at runtime.
- The same `NoDefaultCurrentDirectoryInExePath` caveat applies if the rebuild fails.

### Packaging & distribution

`npm run package` produces a per-user Windows NSIS installer in `dist/` via
[electron-builder](https://www.electron.build/) (config: `electron-builder.yml`).
The build rebuilds `node-pty` for Electron's ABI automatically, then keeps it out of
the asar (`asarUnpack`) so the native binary loads at runtime.

- **Unsigned by default** — internal distribution clicks through Windows SmartScreen.
  Add `certificateFile`/`certificatePassword` (or rely on a cert in the Windows store)
  under `win:` to sign.
- **App icon** lives at `build/icon.ico` (multi-res, auto-discovered). Regenerate icon
  candidates with `python design/gen_icons.py` (drives a ComfyUI instance).
- **Auto-update** uses `electron-updater` against **GitHub Releases** (the `github`
  provider under `publish:` in `electron-builder.yml`). Installed apps poll the public
  repo's Releases on launch and install on restart (packaged builds only; a no-op in
  dev). No runtime token is needed because the repo is public.

### Releases (GitHub Actions)

Releases are built by GitHub Actions, not locally. To cut one:

1. Bump `version` in `package.json` and commit.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` (the tag must match `package.json`'s
   version — the workflow fails fast on a mismatch).

The **Release** workflow (`.github/workflows/release.yml`) builds the Windows installer
and publishes it plus `latest.yml` to a GitHub Release for the tag; installed apps
auto-update from there on next launch. The **CI** workflow (`.github/workflows/ci.yml`)
runs `typecheck` + unit tests on every push/PR. `npm run package` still builds an
installer locally for testing.

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

[MIT](LICENSE) © 2026 localhostworks.
