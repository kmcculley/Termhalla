# Changelog

All notable changes to Termhalla are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/). Dates are YYYY-MM-DD.

## [Unreleased]

### Fixed
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
