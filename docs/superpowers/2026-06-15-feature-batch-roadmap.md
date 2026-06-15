# Feature Batch Roadmap (2026-06-15)

Autonomous batch requested by the user: build all 7 features below via the superpowers
flow (spec → plan → subagent-driven implementation → review → merge to main), choosing
the recommended option at every decision point (no user gating).

## Requested features → sub-projects

| # | Feature | Sub-project |
|---|---|---|
| 1 | Paste to all terminals in a workspace (regular paste + typed keystrokes) | **A — Broadcast input** |
| 2 | Right-click workspace button → context menu (Rename, Save, Close) | **B — Workspace tab management** |
| 4a | Name a workspace immediately on creation | **B** |
| 6 | Reorder workspace tabs by left-click-drag | **B** |
| 3 | Workspace layout templates (save/load/offer on new workspace) | **C — Workspace templates** |
| 4b | Issue command(s) after X sec/min, or once a terminal is not busy (keystroke option) | **D — Scheduled commands** |
| 5 | Issue command(s) on a recurring schedule with time-window randomization (keystroke option) | **D** |

## Status

- [x] **A — Broadcast input to all terminals** — DONE, merged (`feat/broadcast-input`)
- [ ] **B — Workspace tab management** (context menu, name-on-create, drag-reorder) — spec / plan / implement / merge
- [ ] **C — Workspace layout templates** — spec / plan / implement / merge
- [ ] **D — Scheduled / automated terminal commands** — spec / plan / implement / merge

Each sub-project: `docs/superpowers/specs/2026-06-15-termhalla-<name>-design.md` +
`docs/superpowers/plans/2026-06-15-termhalla-<name>.md`, implemented on its own
`feat/<name>` branch and merged to `main`. Memory (`termhalla-phase-status.md`) updated
after each merge.
