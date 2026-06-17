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
- [Packaging & Distribution](packaging.md) — Windows NSIS installer, app icon, and
  background auto-update.

## Conventions in these docs

- Code is referenced as `path:symbol`, not pasted in bulk.
- IPC channel names match `src/shared/ipc-contract.ts`.
- The "Testing" section names the real vitest / Playwright files that cover the
  feature. Per-feature deferred work lives in
  [`../superpowers/*-review-followups.md`](../superpowers/).
