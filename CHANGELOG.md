# Changelog

All notable changes to Termhalla are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/). Dates are YYYY-MM-DD.

## [Unreleased]

### Added
- **Per-terminal environment variables** — edit a single terminal's own env vars from its
  `🔑` button (layered over globals).

### Changed
- **Theming is now scoped** — a Scope selector in the `🎨` editor themes the **app**, a
  **workspace**, or an individual **pane** (terminal/editor/explorer), layered nearest-wins.
  The window-background color is now visible (app root + mosaic gutters), and the color picker
  no longer lags (live preview writes the CSS var directly; Monaco re-theme is debounced).
- **Broadcast dialog** — **Shift+Enter** now sends; added quick-key buttons (Esc, Ctrl+C/D/Z/L,
  Tab, Enter, ↑/↓) that send the control sequence to all terminals.
- **Workspace rename** — the existing name is selected on focus, so you can type to replace it.

### Fixed
- **Scheduled-command dialog** was clipped by adjacent terminals — it now portals to `<body>`
  and covers the full window (react-mosaic tiles created a transform containing block).
- **Claude usage metrics** showed a stuck `0%` and the wrong context window.
  The transcript watcher now watches the project *directory* and re-resolves the
  newest transcript on every change (fixes binding to stale/empty session stubs),
  and the 1M context window is detected from the Claude settings model alias
  (`opus[1m]`) since the `[1m]` flag is never written to transcripts — plus an
  auto-bump to 1M when observed context exceeds 200k.
- **Switching workspace tabs blanked every pane** — terminals lost scrollback,
  the editor lost unsaved text, and a live Claude TUI froze until its next write.
  Inactive workspaces now stay mounted (hidden via `visibility`, not unmounted),
  preserving all pane state across switches.

### Added
- **Environment variable manager** — a `🔑` button opens an encrypted-local vault for env vars
  injected into terminals on spawn (global vars for every shell, plus per-terminal overrides).
  Values are stored only as an AES-256-GCM blob (scrypt-derived key) at `userData/env-vault.json`;
  decrypted values and the passphrase live in main-process memory only while unlocked, and
  workspace JSON stores only an `envId`, never values.
- **Terminal session recording** — a `⏺` button records a terminal's output to a replayable
  asciinema `.cast` file (in `userData/recordings/`); a per-terminal-settings toggle auto-records
  every new terminal.
- **Customizable UI theming** — a `🎨` editor to customize colors (window, toolbars, menus,
  borders, text, accent, busy/needs-input alerts, terminal), fonts, and sizes throughout the
  app, applied live via CSS variables and themed xterm/Monaco. Save named **presets**; the
  active theme and presets persist in `quick.json`.
- **Scheduled terminal commands** — schedule command(s) to a terminal after a delay,
  once it becomes idle, or recurring with a jitter window (the `⏱` tile button), sent as
  a command or raw keystrokes.
- **Workspace layout templates** — save a workspace's pane layout as a named template
  (the `▾` button) and create new workspaces from it; templates persist in `quick.json`.
- **Workspace tab management** — right-click a workspace tab for Rename / Save / Close,
  name a new workspace inline the moment you create it, and drag tabs to reorder them.
- **Broadcast input** — send a command to every terminal in the active workspace at
  once (the `⇉` button or `Ctrl+Shift+Enter`), as raw keystrokes or a bracketed paste.
- **Editor scratch buffer** — every editor pane now has a persistent **Untitled**
  scratch tab: type into an empty editor and the text survives a restart. **Ctrl+S**
  (or "Save As…") turns the scratch into a real file.
- **Editor hot-exit** — unsaved editor buffers now persist across an app restart
  (or crash) and are restored exactly on reopen. If a drafted file also changed on
  disk while the app was closed, the existing "Changed on disk" bar appears
  (Reload / Keep mine). Drafts are stored separately (`editor-drafts.json`), so
  workspace files stay small.
- Project documentation: `README.md`, `CLAUDE.md`, `docs/architecture.md`,
  `docs/decisions.md`, this changelog, and a doc per feature under `docs/features/`.

## [0.1.0] — in development

The initial feature set, built as a sequence of spec→plan→implement sub-projects
(see `docs/superpowers/` and `docs/features/`).

### Added — core (Phases 1–3)
- **Tiled terminal workspaces** (2026-06-13): multiple real Windows shells with a
  shell picker, react-mosaic split/resize/rearrange, named workspace tabs,
  save/restore with debounced auto-save, and window-state memory.
- **Terminal status & alert engine** (2026-06-14): OSC 133 shell integration
  (PowerShell + bash; cmd heuristics) driving busy/idle/needs-input; pane status
  borders, 🔔 tab badges, OS notifications, and per-terminal alert settings.
- **Monaco editor + live file explorer** (2026-06-14): editor panes with per-file
  tabs, dirty tracking, Ctrl+S, and undo-preserving external-change reload; a lazy,
  chokidar-watched file-tree explorer that opens files into the editor.

### Added — awareness (roadmap A–F)
- **A · CWD awareness** (2026-06-14): live per-terminal working directory via
  OSC 9;9 / OSC 7; "Open Explorer here" / "Reveal in File Explorer"; restored on
  reload; split-inherit.
- **B · SSH & favorites** (2026-06-14): Ctrl+K command palette, saved SSH
  connections (no secrets stored), recent/favorite directories, launch-override
  terminals. App-global `quick.json`.
- **C · Child-process tracking** (2026-06-14): foreground process on a chip and a
  descendant process-tree popover, via busy-gated `Get-CimInstance` polling. Works
  for all shells including cmd and SSH.
- **D · Cloud CLI status** (2026-06-14): a global bottom status bar showing AWS
  (`sts get-caller-identity`) and Azure (`az account show`) login state, with a
  detail popover and a "Log in" action.
- **E · AI session awareness** (2026-06-14): detects Claude Code / Codex sessions
  from the process tree; `✨ Claude` pane chip + workspace-tab indicator; a
  "waiting for you" notification on busy→quiet.
- **F · Claude usage metrics** (2026-06-15): live context-window % on the chip and
  a token breakdown (input/output/cache) in the popover, parsed from the session's
  Claude transcript. Claude-only; pluggable for Codex later.

### Notes
- No secrets are persisted (SSH stores host/user/port + key path only; cloud status
  stores nothing; usage reads transcripts read-only).
- Windows-first; the awareness features target Windows (ConPTY, CIM, PowerShell).
