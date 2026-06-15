# Child-Process Tracking

> A per-terminal foreground-process chip and a descendant process-tree popover, driven by busy-gated `Get-CimInstance Win32_Process` polling — works for every shell, including `cmd` and SSH, because detection is OS-level (process tree under the shell's PID).

**Status:** Shipped · **Spec:** [child-process-tracking design](../superpowers/specs/2026-06-14-termhalla-child-process-tracking-design.md) · **Plan:** [child-process-tracking plan](../superpowers/plans/2026-06-14-termhalla-child-process-tracking.md)

## What it does

Each terminal pane gets a toolbar **chip** showing what is actually running inside it:

- **Busy** — `▶ <process>`, where `<process>` is the foreground command's image name (e.g. `▶ ping`, `▶ node`).
- **Idle** — the shell name (e.g. `pwsh`, `cmd`, `bash`), with no polling cost.

Clicking the chip opens a **popover** listing the shell's full descendant process tree, one row per process, indented by depth, each showing the image name plus its truncated command line. Because everything keys off the OS process table under the shell's PID, this works uniformly across `cmd`, PowerShell, bash, and SSH (the local `ssh` process is shown — remote children are not visible). Nothing is persisted; the state is runtime-only.

## How it works

**Pure core — `proc-tree.ts`.** No I/O; fully unit-tested.
- `proc-tree.ts:parseCimRows` parses `ConvertTo-Json` output. PowerShell emits a **single** result as one object rather than a one-element array, so the parser wraps a non-array, non-null value into `[value]`. Rows lacking a numeric `ProcessId`/`ParentProcessId` are dropped; malformed JSON yields `[]`.
- `proc-tree.ts:parseCimDate` reads both the WMI `/Date(ms)/` form and an ISO string, returning `0` when unknown.
- `proc-tree.ts:cleanName` strips a trailing `.exe` (case-insensitive).
- `proc-tree.ts:descendantsOf` builds a `ppid → children[]` map (children sorted ascending by creation date) and walks it DFS pre-order from the shell PID, excluding the shell itself, emitting `ProcNode`s carrying `depth` (a `seen` set guards against cycles).
- `proc-tree.ts:pickForeground` follows the **most-recently-created child** chain from the shell down to the deepest leaf — that leaf is the foreground process. Handles single-chain, multi-child, and no-child cases.
- `proc-tree.ts:buildProcInfo` combines them into `ProcInfo { foreground, tree }`.

**Query — `cim-query.ts`.** `cim-query.ts:queryProcesses` runs one `execFile('powershell.exe', …)` of `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress` with a 2s `timeout` and `killSignal: 'SIGKILL'`. It never rejects — any error or timeout resolves to `[]`, so the chip keeps its shell-name fallback.

**Tracker — `process-tracker.ts`.** `ProcessTracker` owns a `{ paneId → { busy } }` registry and per-session signature cache.
- `process-tracker.ts:setBusy` is fed from `StatusEngine` (busy/idle). Going idle immediately emits a cleared (`null`) state.
- A ~1s timer drives `process-tracker.ts:pollOnce`. It is a **no-op when nothing is busy** (so idle terminals cost nothing) and when a query is already in flight (`querying` guard — no overlapping polls). It runs one snapshot, then for each still-busy session resolves the shell PID via `PtyManager.pidOf` and calls `buildProcInfo`.
- Emits are **deduped** by a `foreground|pid,pid,…` signature, so an unchanged snapshot emits nothing. A session whose PID has vanished mid-poll is cleared.
- `unregister`/`clear` are idempotent (`Map.delete` returns `false` on the second call), so the renderer sees a single clear even when both the synchronous `ptyKill` path and the async pty `onExit` path fire.

**Channel & wiring.** The tracker emits over the `pty:procs` IPC channel (`ipc-contract.ts`, `onPtyProcs`). In `register.ts` the `ProcessTracker` is constructed and, critically, `tracker.register(a.id)` runs **BEFORE** `pty.spawn` in the `ptySpawn` handler — so a failed spawn's synchronous `onExit → unregister` can't orphan a registry entry. Busy state is forwarded from the `StatusEngine` status callback; `ptyExit`/`ptyKill` unregister.

**Renderer.** `App.tsx`'s `onPtyProcs` subscription calls `store.ts:setProcs`, maintaining `procs: Record<paneId, ProcInfo>`. `WorkspaceView.tsx` derives the chip text (`▶ <foreground>` busy, else the shell label) and renders the popover.

## Key files

| File | Responsibility |
|---|---|
| `src/main/proc/proc-tree.ts` | Pure core: `parseCimRows` (single-object quirk), `parseCimDate`, `cleanName`, `descendantsOf` (DFS + depth), `pickForeground` (most-recent-child chain), `buildProcInfo`. |
| `src/main/proc/cim-query.ts` | `queryProcesses` — one PowerShell CIM snapshot via `execFile`, 2s timeout + SIGKILL, `[]` on any error. |
| `src/main/proc/process-tracker.ts` | `ProcessTracker` — registry, busy gate, `pollOnce` (no-overlap, dedup), cleared-on-idle, vanished-PID clear. |
| `src/shared/types.ts` | `ProcNode { pid, ppid, name, command, depth }`, `ProcInfo { foreground, tree }`. |
| `src/shared/ipc-contract.ts` | `pty:procs` channel + `onPtyProcs`. |
| `src/main/ipc/register.ts` | Constructs the tracker; busy feed from `StatusEngine`; **register-before-spawn**; unregister on exit/kill. |
| `src/main/pty/pty-manager.ts` | `pidOf(id)` — the shell PID from `node-pty`'s `IPty.pid`. |
| `src/renderer/store.ts` | `procs` map, `setProcs`, `closePane` cleanup. |
| `src/renderer/App.tsx` | `onPtyProcs` subscription. |
| `src/renderer/components/WorkspaceView.tsx` | Toolbar chip + tree popover. |

## Behaviors & edge cases

- **Busy-gated polling.** `pollOnce` queries only while ≥1 registered terminal is busy; idle terminals incur zero PowerShell spawns. Idle chips fall back to the shell name for free.
- **No overlapping polls.** A `querying` flag skips a tick if the previous CIM query hasn't returned (PowerShell can be slow under load).
- **Register-before-spawn.** `tracker.register` runs before `pty.spawn`, so a spawn that fails and fires `onExit → unregister` synchronously leaves no orphaned registry entry.
- **Single-object JSON quirk.** PowerShell's `ConvertTo-Json` emits a lone process as an object, not a one-element array; `parseCimRows` normalizes both forms.
- **Chip relabels.** `SHELL_CHIP_LABEL` in `WorkspaceView.tsx` shortens idle shell names: `Windows PowerShell` → `pwsh`, `Command Prompt` → `cmd`. Other shells fall through to their label or raw `shellId`.
- **Popover auto-dismiss.** When the popover is open on a terminal with no child processes, it shows "No child processes." and auto-closes after 2s. If a process appears within that window the `procs` change re-runs the effect, sees a non-empty tree, and cancels the close.
- **Foreground / detail split.** The chip shows the reliable image **name**; the popover shows the full **command line** per row (e.g. `npm run dev` surfaces as a `node …npm-cli.js run dev` invocation).
- **Vanished PID.** A busy session whose shell PID disappears mid-poll emits a cleared state → shell-name fallback.
- **Dedup.** Identical consecutive snapshots (same foreground + same tree PIDs) emit nothing.
- **Cleanup parity.** `closePane` drops the per-pane `procs` entry alongside `statuses` and `cwds`.

## Testing

- `tests/main/proc-tree.test.ts` (vitest, pure) — covers `parseCimRows` array vs. single-object form and malformed/idless-row rejection; `parseCimDate` for `/Date(ms)/`, ISO, and null/garbage; `cleanName` `.exe` stripping; `descendantsOf` DFS-pre-order + depth, exclusion of the shell and unrelated processes, and empty-on-no-children; `pickForeground` most-recent-child chain, chain-to-leaf descent, and null-on-no-children; `buildProcInfo` combining foreground name + tree.
- `tests/main/process-tracker.test.ts` (vitest) — `pollOnce` emits `ProcInfo` for a busy session, does **not** query when nothing is busy, dedups repeated identical snapshots, emits a single `null` when a session goes idle (and not again on a repeat `setBusy(false)`), and clears a busy session whose PID has vanished.
- `tests/e2e/procs.spec.ts` (Playwright/Electron, hermetic) — opens a PowerShell terminal, asserts the chip is visible (idle = shell name), runs `ping -n 20 127.0.0.1`, asserts the chip shows `ping` (busy-gated CIM poll), then opens the popover and asserts it lists a `ping` row.

All three files exist and are wired into the suites (`npm test`, `npm run e2e`).

## Related

- [Architecture](../architecture.md) — status/cwd → store → pane pattern this mirrors.
- [Decisions](../decisions.md) — CIM-snapshot vs. native-dependency tradeoff; chip-shows-name / popover-shows-command choice.
- [Status engine](./status-engine.md) — the busy/idle signal that gates polling.
- [AI session awareness](./ai-session-awareness.md) — sibling chip consumer; also receives `pty:procs` via `ai.onProcs`.
