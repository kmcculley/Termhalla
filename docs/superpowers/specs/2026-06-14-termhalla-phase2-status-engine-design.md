# Termhalla Phase 2 — Terminal Status & Alert Engine — Design Spec

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phase 1 (terminal workspace), merged to master.

## 1. Summary

Each terminal communicates its state back to the user so a wall of terminals
tells you when it needs you instead of requiring babysitting. Three states —
**idle**, **busy**, **needs-input** — are detected in the main process from the
PTY byte stream (hybrid: injected OSC 133 shell-integration markers where
available, output heuristics elsewhere) and surfaced through multiple alert
channels (pane border, workspace-tab badge, OS notification). Alerting is
configurable per terminal.

## 2. Decisions (from brainstorming, 2026-06-14)

| Decision | Choice |
|---|---|
| Shell integration scope | **PowerShell (pwsh + Windows PowerShell) + bash (Git Bash/WSL)** get true OSC 133 injection; cmd and anything else use the heuristic fallback. |
| needs-input default | **On, conservative** — busy + output quiet ~10s + curated prompt-pattern tail; per-terminal toggle; threshold + patterns configurable. |
| Per-terminal config | **Full per-terminal panel** — rename + toggle border / tab badge / OS notification / needs-input. Sensible defaults so it works untouched. |

These refine, and stay consistent with, the original Phase 2 outline in
`docs/superpowers/specs/2026-06-13-termhalla-design.md` §4.

## 3. Architecture & data model

A new **status engine in the main process**, kept separate from `PtyManager` so
each module stays single-purpose. New modules under `src/main/status/`:

- **`osc133-parser.ts`** — pure. Scans a byte chunk (keeping a small carry-over
  tail for markers split across chunks) and returns the OSC 133 marker events
  found: `A` (prompt shown), `B`/`C` (command start / pre-exec), `D;<exit>`
  (command end + exit code). It does **not** modify the passthrough bytes — xterm
  ignores these OSC sequences, so terminals still render clean.
- **`status-tracker.ts`** — pure per-session state machine. Consumes marker
  events, output-activity timestamps, and periodic ticks; emits
  `TerminalStatus`.
- **`needs-input.ts`** — pure: `(state, msSinceLastOutput, tailText, config) →
  boolean`. Curated default patterns (`password:`, `[y/N]`, `(yes/no)`,
  `Press any key`, trailing `? `); default quiet threshold ~10s.
- **`shell-integration.ts`** — pure mapping `ShellInfo → { args, env } | null`
  describing how to inject the integration script for that shell (null = no
  integration → heuristics).
- **`status-engine.ts`** — owns `Map<id, StatusTracker>`, one shared ~500ms tick
  timer, and an `onStatus(id, status)` callback. Exposes
  `register(id, shellId)`, `feed(id, data)`, `markExit(id, code)`,
  `unregister(id)`.

`PtyManager` change is minimal: its constructor gains a third callback
(`onStatus`); in `spawn` it calls `engine.register` and routes `onData` bytes to
`engine.feed` (still forwarding raw data to the renderer unchanged); on exit it
calls `engine.markExit` + `unregister`. Injection: `spawn` consults
`shell-integration.ts` to augment the shell's args/env before launching.

### Types

```
type TermState = 'idle' | 'busy' | 'needs-input'
interface TerminalStatus {
  state: TermState
  lastExit?: 'success' | 'failure'   // from the most recent D;<exit>
  since: number                      // ms timestamp of this state's onset
}
interface AlertConfig {              // all optional; defaults applied when absent
  border?: boolean                   // default true
  tabBadge?: boolean                 // default true
  osNotification?: boolean           // default true
  needsInput?: boolean               // default true (conservative detection)
}
// TerminalConfig (Phase 1) gains:  name?: string (exists), alerts?: AlertConfig
```

Status flows main→renderer on a new IPC channel **`pty:status`** carrying
`(id, TerminalStatus)`. A new **`notify`** channel lets the renderer ask main to
show an OS notification. The renderer store keeps
`statuses: Record<paneId, TerminalStatus>`.

## 4. Detection mechanics

**State machine** (shell-agnostic — only ever sees A/B/C/D, or nothing):

- `A` (prompt) → **idle**, applying `lastExit` from the preceding `D;<exit>`
  (exit 0 = success, else failure).
- `B`/`C` (command start / pre-exec) → **busy**.
- `D;<exit>` → record exit code (sticky until the next command); remain busy
  until the next `A`.
- **needs-input** is an overlay recomputed each tick while busy: if
  `msSinceLastOutput ≥ threshold` **and** the tail matches a configured pattern →
  `needs-input`; cleared the instant new output arrives or the command ends.
- **Heuristic fallback** (no markers seen for a session): output activity → busy;
  a quiet spell with a prompt-looking tail → idle; the same needs-input overlay
  applies. Guarantees a usable status even when injection didn't take.

**Shell-integration injection** (best-effort, non-destructive):

- Integration scripts ship under `resources/shell-integration/`
  (`termhalla.ps1`, `termhalla.sh`), bundled with the app.
- **PowerShell** (pwsh + Windows PowerShell): spawn args dot-source the script,
  which wraps the existing `prompt` function to emit `D;<exit>` + `A`, and
  registers a PSReadLine handler to emit `C` on command accept. Without
  PSReadLine it degrades to `A`/`D` only (still yields busy/idle).
- **bash** (Git Bash/WSL): an injected init script sources the user's normal rc,
  then sets `PROMPT_COMMAND` (emit `D;<exit>` + `A`) and a `DEBUG` trap (emit
  `C`).
- Injection always chains the user's existing prompt/rc; on any failure the
  session falls back silently to heuristics. cmd has no clean hook → heuristics.

## 5. Alert UX & per-terminal config

**Visual treatment:**
- **idle** — thin neutral border, subtly tinted green/red by the last command's
  success/failure, fading back to neutral after a few seconds.
- **busy** — gently pulsing accent border (CSS animation).
- **needs-input** — flashing high-attention border (amber/red) + a badge on the
  pane title.

**Tab badges** — a workspace tab shows a needs-input badge (count) when any of its
terminals need input, and a subtler dot when any are merely busy.

**OS notifications** — fired from main via the `notify` channel only when a
terminal enters `needs-input` **and** the window is unfocused **and** that
terminal's notification channel is enabled. Clicking focuses the window.

**Per-terminal config** — a gear button in each pane toolbar opens a small
popover (`TerminalSettings`): rename the terminal and toggle border / tab badge /
OS notification / needs-input. Persisted on `TerminalConfig.alerts`, serialized
into the workspace, auto-saved. `schemaVersion` bumps to **2**; v1 files still
load (added fields optional; migrate 1→2 is identity). The Phase 1 `migrate`
guard already rejects versions newer than supported.

## 6. Testing & verification

**Unit (vitest, TDD — pure logic):**
- `osc133-parser` — markers split across chunks, malformed/partial sequences,
  clean output; assert exact extracted events + carry-over handling.
- `status-tracker` — event sequences (`A→C→D;0→A`, failure exits, interleaved
  output); assert state + `lastExit` transitions.
- `needs-input` — fires on quiet+pattern; does **not** fire on a slow-but-chatty
  command (false-positive guard); clears on new output.
- `shell-integration` — `ShellInfo → injector|null` for pwsh/powershell/bash/cmd.
- config-defaults merge — absent `alerts` yields documented defaults; a v1
  workspace still deserializes.

**e2e (Playwright, real app; reuses Phase 1 hermetic-userData + process-tree
teardown):**
- Busy/idle: run `Start-Sleep 2; echo done`; assert the pane's `data-status`
  attribute goes `busy` then `idle`.
- needs-input: run a prompting command (e.g. PowerShell `Read-Host`); assert
  `data-status="needs-input"` and the tab badge appears.
- per-terminal mute: disable the border toggle in the settings popover; assert no
  status-border class is applied.

The renderer reflects each pane's status as a `data-status` attribute, making the
otherwise timing-sensitive status assertions deterministic.

## 7. Non-goals (Phase 2)

- No per-terminal theme/font styling beyond naming (that broader styling can come
  later; naming is included here because it aids at-a-glance identification).
- No editor/explorer panes (Phase 3).
- No configurable alert *sounds* or notification routing beyond the OS
  notification described.
- needs-input remains heuristic — no attempt to introspect the child process's
  stdin-read state.
