# Termhalla — Child-Process Tracking — Design Spec

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phases 1–3 + CWD awareness (A) + SSH/favorites (B), all merged to `main`.

## 1. Summary

Track and surface what is actually running inside each terminal: a compact
**foreground-command chip** in the pane toolbar, plus an expandable **descendant
process tree** popover. This is sub-project C of the post-launch roadmap.

A defining property: because detection is OS-level (the process tree under the
shell's PID), this works for **every** shell — `cmd`, PowerShell, bash, **and SSH**
(the chip shows the local `ssh` process) — unlike status/cwd, which require
shell-integration scripts.

## 2. Decisions (from brainstorming, 2026-06-14)

| Decision | Choice |
|---|---|
| What to surface | **Both** — a compact foreground-command chip + a drill-down full descendant tree. |
| Placement | **Toolbar chip + popover** — chip in the pane toolbar; clicking it opens the tree popover (same mechanism as the existing 📁 cwd menu). |
| Idle display | **Shell name when idle** — the chip always shows something: the shell (e.g. `pwsh`) when idle, the active command when busy. Idle requires no polling. |
| Detection | **A — CIM snapshot, busy-gated** — one `Get-CimInstance Win32_Process` poll (~1s) only while ≥1 terminal is busy; full command lines, no native dependencies. |

## 3. Architecture & data flow

A new main-process **`ProcessTracker`** (`src/main/proc/`) owns this feature:

- Holds a registry `{ paneId → shellPid }`. The shell PID is `node-pty`'s
  `IPty.pid`; `PtyManager` registers it on spawn and unregisters on exit/close.
- Subscribes to the status engine's busy/idle signal so it knows which terminals
  are currently busy.
- Runs a ~1s timer. **Only when ≥1 registered terminal is busy**, it fires a single
  `Get-CimInstance Win32_Process` snapshot of all processes, builds a `pid → children`
  map, and for each busy terminal computes its descendant tree + foreground process.
- Emits over a new `pty:procs` IPC channel `(paneId, ProcInfo)`. Idle terminals emit
  a **cleared** state; the renderer then falls back to the shell name (free, no poll).

This mirrors the existing status/cwd → store → pane pattern (`safeSend` guarded).

## 4. ProcessTracker internals (pure, testable core)

- **CIM parse.** Query:
  `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress`,
  run via `execFile('powershell', …)` and parsed in main. Must handle PowerShell's
  quirk where a **single** result is emitted as one object, not a one-element array.
- **Tree build.** Pure `descendantsOf(rows, shellPid): ProcNode[]` — the subtree
  under the shell (excluding the shell itself), as a flat list carrying `ppid` so the
  renderer can indent by depth.
- **Foreground selection.** Pure heuristic: starting at the shell, repeatedly follow
  the **most-recently-created child** (by `CreationDate`) down to the deepest leaf;
  that leaf is the foreground process. Single-chain, multi-child, and no-child cases
  are all defined.
- **Naming.** The OS reliably gives the **image name** (`node.exe` → `node`, `ssh`,
  `vim`), so the **chip shows the process name**. The full **command line**
  (which for `npm run dev` is really a `node …npm-cli.js run dev` invocation) is shown
  per-row in the **tree popover**, where detail is appropriate. The chip stays
  clean/reliable; the popover is where exact invocations are visible.

## 5. Types & IPC

```ts
interface ProcNode {
  pid: number
  ppid: number
  name: string      // image name without ".exe", e.g. "node"
  command: string   // full CommandLine, or name when CommandLine is empty
}
interface ProcInfo {
  foreground: string   // the leaf process name (chip text when busy)
  tree: ProcNode[]     // flat descendant list (popover rows)
}
```
- New channel `pty:procs` (main → renderer). Preload `onPtyProcs(cb)`.
- **Runtime-only, not persisted** (like `statuses`/`cwds`). Nothing is written to a
  workspace or quick file.

## 6. Renderer (chip + popover)

- The store gains `procs: Record<paneId, ProcInfo>`, updated on `pty:procs` (and
  cleared per the cleared-state event).
- A toolbar **chip** (left of the 📁 button) shows `▶ <foreground>` when busy, or the
  **shell name** (derived from the pane's `shellId` via the loaded `ShellInfo` list;
  fall back to the raw `shellId`) when idle / when no `ProcInfo` is present.
- Clicking the chip toggles a **popover** (same overlay mechanism as the 📁 cwd menu)
  listing the descendant tree: each row indented by depth, showing the process name and
  a truncated command line. When idle / empty, the popover shows "No child processes."

## 7. Error handling & performance

- **Busy-gated** polling; **one** `execFile` PowerShell spawn per tick with a ~2s
  timeout; **no overlapping polls** (skip a tick if the previous query has not returned).
- CIM failure/timeout → emit nothing (the chip keeps its shell-name fallback); the
  tracker never throws into the main process.
- A shell PID that has vanished mid-poll yields an empty tree → shell-name fallback.
- The registry is cleaned up on pane close/exit. The renderer `procs` map entry is
  cleaned up on `closePane` — done **together with** the existing `statuses`/`cwds`
  maps, closing the long-standing cleanup-parity follow-up.

## 8. Testing & verification

- **Unit (vitest, pure):**
  - CIM JSON parse — single-object form AND array form; ignores malformed rows.
  - `descendantsOf` — single chain, multiple children, grandchildren, unrelated
    processes excluded, missing shell pid → empty.
  - Foreground-selection heuristic — most-recently-created-child chain, single child,
    no children.
  - Name/command extraction — strips `.exe`; falls back to name when CommandLine empty.
- **e2e (Playwright, hermetic):** open a terminal, run a long foreground command
  (`ping -n 10 127.0.0.1`), assert the chip shows the process name (`ping`) and the
  popover lists it; let it finish → the chip returns to the shell name.

## 9. Non-goals (this sub-project)

- No per-process CPU/memory stats.
- No kill-from-tree action (possible later).
- No remote/SSH child visibility (only the local `ssh` process is shown).
- No sub-second updates (1s poll cadence).
- Windows-only, consistent with the rest of the app.
