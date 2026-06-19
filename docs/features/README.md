# Feature Docs

One doc per shipped Termhalla feature — what it does, how it works, key files,
edge cases, and tests. For the system-wide picture start with
[../architecture.md](../architecture.md); for the *why* behind specific choices
see [../decisions.md](../decisions.md).

## Core (Phases 1–3)

- [Terminal Workspaces](workspaces.md) — tiled shells, named workspace tabs,
  save/restore, and the keep-mounted tab-switch lifecycle.
- [Status & Alert Engine](status-engine.md) — busy / idle / needs-input from OSC 133
  shell integration; borders, tab badges, notifications, per-terminal alerts.
- [Editor & File Explorer](editor-explorer.md) — Monaco editor panes and a live,
  watched file-tree explorer.

## Awareness (roadmap A–F)

- [CWD Awareness](cwd-awareness.md) — live working directory per terminal (A).
- [SSH Connections & Favorites](ssh-favorites.md) — command palette, saved SSH
  connections (no secrets), favorite/recent dirs (B).
- [Child-Process Tracking](child-process-tracking.md) — foreground process chip +
  descendant process tree (C).
- [Cloud CLI Status](cloud-status.md) — AWS / Azure login status bar (D).
- [AI Session Awareness](ai-session-awareness.md) — detect Claude Code / Codex
  sessions and surface them (E).
- [Claude Usage Metrics](usage-metrics.md) — live context-% and token breakdown for
  a Claude session (F).

## Workspaces & windows

- [Workspace Tab Management](workspace-management.md) — right-click Rename / Save /
  Close, inline rename on create, and drag-to-reorder tabs.
- [Workspace Layout Templates](workspace-templates.md) — save a workspace's pane
  layout as a named template and spawn new workspaces from it.
- [Window Management (Undock / Re-dock)](window-management.md) — tear a workspace tab
  into its own OS window on any monitor; live shells survive the move.

## Terminal productivity

- [Broadcast Input](broadcast-input.md) — send the same text (keystrokes or bracketed
  paste) to every terminal in the active workspace at once.
- [Scheduled / Automated Commands](scheduled-commands.md) — send command(s) to a
  terminal after a delay, when it goes idle, or on a recurring schedule.
- [Saved Run Commands](run-commands.md) — named, persisted run-on-click commands at
  pane and workspace scope.
- [Searchable Output History](search-history.md) — full-text search across current and
  past terminal output (SQLite FTS5), with reveal / relaunch-at-cwd.
- [Terminal Session Recording](terminal-recording.md) — record a terminal's output to a
  replayable asciinema `.cast` file.

## Project & environment

- [Git Status on Pane Chip](git-status.md) — per-pane branch + dirty indicator with
  ahead/behind and file-count detail.
- [Per-Project Notepad](notepad.md) — a collapsible notes drawer scoped to the focused
  pane's project, persisted across restarts.
- [Environment Variable Manager](env-vars.md) — inject env vars from an
  AES-256-GCM-encrypted local vault, global or per-terminal.

## Customization

- [UI Theming](theming.md) — customize colors, fonts, and sizes with named presets.
- [Rebindable Keyboard Shortcuts](keybindings.md) — data-driven command registry,
  user-overridable via Settings → Keybindings.

## Platform

- [Packaging & Distribution](packaging.md) — Windows NSIS installer, app icon, and
  background auto-update.

## Conventions in these docs

- Code is referenced as `path:symbol`, not pasted in bulk.
- IPC channel names match `src/shared/ipc-contract.ts`.
- The "Testing" section names the real vitest / Playwright files that cover the
  feature. Per-feature deferred work lives in
  [`../superpowers/*-review-followups.md`](../superpowers/).
