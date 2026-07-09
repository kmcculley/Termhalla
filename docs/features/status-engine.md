# Status & Alert Engine

> Detects each terminal's busy / idle / needs-input state from OSC 133 shell-integration markers (with a heuristic fallback) and surfaces it as pane borders, 🔔 tab badges, and OS notifications.

**Status:** Shipped · **Spec:** [Phase 2 design](../superpowers/specs/2026-06-14-termhalla-phase2-status-engine-design.md) · **Plan:** [Phase 2 plan](../superpowers/plans/2026-06-14-termhalla-phase2-status-engine.md)

## What it does

A wall of terminals tells you when it needs you instead of requiring babysitting. Every session is classified into one of three states — **idle**, **busy**, **needs-input** — detected in the main process from the PTY byte stream, and pushed to the renderer where it drives:

- a per-pane **status border** (pulsing busy, flashing needs-input, success/failure-tinted idle that fades back to neutral),
- a **🔔 badge** on the pane title and on the owning workspace tab (count of terminals needing input; a subtler dot for busy),
- an **OS notification** when a terminal enters needs-input while the window is unfocused.

Detection is a hybrid: PowerShell and bash get true OSC 133 marker injection; cmd and anything else fall back to output heuristics. Every channel is configurable per terminal and persisted in the workspace.

## How it works

Detection lives in a standalone **status engine** in the main process (`src/main/status/`), kept separate from `PtyManager` so each module stays single-purpose. The data flow:

1. `PtyManager` (`src/main/pty/pty-manager.ts`) consults `shell-integration.ts:shellInjection` at spawn to augment the shell's args/env, then routes every `onData` chunk to `StatusEngine.feed` while still forwarding the raw bytes to the renderer unchanged.
2. `status-engine.ts:StatusEngine` owns a `Map<id, Session>`, one shared ~500 ms tick timer, and change-debounced emission. Per session it runs an `Osc133Parser` and a `StatusTracker`. It exposes `register(id)`, `feed(id, data)`, `markExit(id, code)`, `unregister(id)`.
3. `osc133-parser.ts:Osc133Parser` is pure: it scans a chunk (keeping a small carry-over tail for markers split across chunks) and returns `MarkerEvent[]` — `A` (prompt shown), `B`/`C` (command start), `D;<exit>` (command done + exit code). It never mutates the passthrough bytes (xterm ignores these OSC sequences).
4. `status-tracker.ts:StatusTracker` is the pure per-session state machine. It consumes marker events, output activity, and periodic ticks, and emits `TerminalStatus` (`{ state, lastExit?, since }`).
5. `needs-input.ts` is pure: `computeNeedsInput(quietMs, tail, cfg)` plus the prompt/text helpers below. Curated default patterns (`password:`, `[y/N]`, `(yes/no)`, `Press any key`, trailing `? `); default quiet threshold ~10 s (env-overridable via `TERMHALLA_NEEDS_INPUT_QUIET_MS`).

**State machine** (`StatusTracker`, shell-agnostic — only ever sees A/B/C/D, or nothing):

- `A` → **idle**, applying the `lastExit` recorded from the preceding `D;<exit>` (exit 0 = success, else failure).
- `B`/`C` → **busy**.
- `D;<exit>` → record the exit code (sticky until the next command); stay busy until the next `A`.
- **needs-input** is an overlay recomputed each `tick` while busy: `quietMs ≥ threshold` **and** the (ANSI-stripped) tail's last non-blank line matches a configured pattern. Cleared the instant real output arrives or the command ends.
- **Heuristic fallback** for sessions with no markers (or where markers stopped): output → busy; sustained silence at a prompt-looking tail → idle, with a two-tier threshold (`heuristicIdleMs` fast path when the tail `looksLikePrompt`, `heuristicIdleHardMs` for sustained silence even without a recognized prompt — covers cmd Ctrl+C and nested shells).

**Shell-integration injection** (`integration-scripts.ts`, best-effort, non-destructive): the script bodies are in-process string constants written to `userData/shell-integration/` (`termhalla.ps1`, `termhalla.sh`) at startup by `writeIntegrationScripts`. PowerShell (pwsh + Windows PowerShell): args dot-source the script, which wraps the existing `prompt` to emit `D;<exit>` + `A` and registers a PSReadLine Enter handler to emit `C`; degrades to A/D without PSReadLine. bash (Git Bash/WSL): an `--rcfile` sources the user's `.bashrc`, sets `PROMPT_COMMAND` (`D` + `A`) and a `DEBUG` trap (`C`). The same scripts also emit cwd sequences (OSC 9;9 / OSC 7) consumed by [cwd-awareness](cwd-awareness.md). `shellInjection` returns `null` for cmd → heuristics only.

**IPC channels** (`src/shared/ipc-contract.ts`, wired in `src/main/ipc/register.ts`):

- `pty:status` (`CH.ptyStatus`, main → renderer) — carries `(id, TerminalStatus)`; subscribed via `api.onPtyStatus`.
- `app:notify` (`CH.notify`, renderer → main) — `NotifyArgs { title, body }`; main shows an Electron `Notification` that focuses the window on click.

In `register.ts` the engine's `onStatus` callback both `safeSend`s `CH.ptyStatus` and gates `ProcessTracker.setBusy`, so busy/idle drives the shared busy-gated awareness pipeline (see [decisions](../decisions.md)).

**Renderer pieces:**

- `src/renderer/App.tsx` subscribes `api.onPtyStatus` → `useStore().setStatus`.
- `src/renderer/store.ts:setStatus` stores per-pane `statuses`, applies `effectiveStatus` (the needs-input → busy downgrade when a terminal's detection is muted), and fires `api.notify` when a terminal newly enters needs-input while `document.hasFocus()` is false and the terminal's `osNotification` channel is on.
- `src/renderer/components/WorkspaceView.tsx` renders the border (`term-status term-${state}` class, gated on `alerts.border`), the `data-status` attribute on the tile, the 🔔 title prefix, and the gear button opening `TerminalSettings`.
- `src/renderer/components/WorkspaceTabs.tsx` aggregates each tab's panes into a `🔔<count>` or busy-dot badge, honoring each pane's `tabBadge` toggle.
- `src/renderer/components/TerminalSettings.tsx` is the per-terminal popover: rename + four toggles, writing `TerminalConfig.alerts` via `updatePaneConfig` (auto-saved).

Per-terminal config is persisted on `TerminalConfig.alerts` (`AlertConfig`); absent fields resolve to all-on via `src/shared/alerts.ts:resolveAlerts`. The workspace `SCHEMA_VERSION` is **2**; v1 files still load (added fields optional; migrate 1→2 is identity).

## Key files

| File | Responsibility |
| --- | --- |
| `src/main/status/osc133-parser.ts` | Pure scanner: PTY chunks → `MarkerEvent[]`, with split-chunk carry-over |
| `src/main/status/status-tracker.ts` | Pure per-session state machine → `TerminalStatus`; ANSI-stripped tail + heuristic idle |
| `src/main/status/needs-input.ts` | Pure needs-input + prompt detection: `computeNeedsInput`, `looksLikePrompt`, `stripAnsi`, `isPureControl`, `tailMatchesInputPrompt`, default patterns |
| `src/main/status/status-engine.ts` | `StatusEngine`: sessions map, shared tick timer, change-debounced `onStatus` emit |
| `src/main/status/shell-integration.ts` | Pure `shellInjection(shell, dir)` → spawn args/env, or `null` (heuristics) |
| `src/main/status/integration-scripts.ts` | PowerShell + bash script bodies; `writeIntegrationScripts(dir)` |
| `src/shared/alerts.ts` | `DEFAULT_ALERTS`, `resolveAlerts`, `effectiveStatus` (needs-input mute downgrade) |
| `src/shared/ipc-contract.ts` | `CH.ptyStatus`, `CH.notify`, `NotifyArgs`, `onPtyStatus`/`notify` API |
| `src/main/ipc/register.ts` | Builds engine, writes scripts, forwards status, handles `notify` |
| `src/renderer/store.ts` | `statuses` map, `setStatus` (+ notify gating), `updatePaneConfig` |
| `src/renderer/components/WorkspaceView.tsx` | Pane border, `data-status`, 🔔 title, gear/settings |
| `src/renderer/components/WorkspaceTabs.tsx` | Per-tab 🔔 / busy-dot badge aggregation |
| `src/renderer/components/TerminalSettings.tsx` | Per-terminal rename + alert toggles popover |

## Behaviors & edge cases

- **ANSI-strip tail hazard (important).** The detection tail is stored as `stripAnsi(text)` (last ~400 chars) and `needs-input.ts:lastLine` skips trailing blank lines. Any terminal **layout change** (e.g. mounting the cloud status bar) triggers a full-screen ConPTY repaint whose trailing erase-line/cursor bytes would otherwise evict the prompt from the raw tail, wedging terminals in busy and breaking needs-input. This guard must be preserved — see [decisions: ANSI-strip the status tail; skip trailing blank lines](../decisions.md). `StatusTracker.onOutput` also treats pure-control / cursor-home-prefixed chunks (`isPureControl`) as non-output so a repaint doesn't reset the quiet timer or clear a needs-input state.
- **A repaint must not mark a marker-less pane busy (the ssh busy⇄idle oscillation).** The `!hasMarkers → busy` rule is the *only* busy signal a marker-less pane has — `ssh` launches get no shell-integration injection (`spawn-spec.ts`: a launch override runs verbatim) and remote-agent panes get none either, so `hasMarkers` stays false for their whole life. That rule therefore lives **inside** the `isPureControl` guard, alongside the tail/quiet-timer skip: a repaint leaves `lastOutputAt` untouched, so marking it busy would idle it again on the very next `tick()`. Combined with a pane chrome that once changed the terminal's size on a status flip (an idle-only `border-bottom`; see [CLAUDE.md](../../CLAUDE.md) → status chrome is paint-only), that closed a real oscillation loop: idle → chrome resizes the host → PTY resize → repaint → busy → chrome resizes back → … **Consequence to know:** a full-screen TUI over ssh whose frames *begin* with a cursor-home sequence (`top`, `vim`) reads as **idle** rather than flapping — a widening of the known `CURSOR_HOME_RE` catch-all (`.orky/baseline/architecture.md` known bug #4), and the deliberate trade over an oscillating pane. AI sessions are unaffected: the `AGENT_WORKING_RE` resume signal is scanned on *all* output, before the pure-control check.
- **Heuristic idle fallback** covers no-integration shells (cmd) and nested shells (e.g. `cmd` launched inside an integrated pwsh, where markers latch on but then stop). Two thresholds: `heuristicIdleMs` (~1.5 s) idles fast when the tail `looksLikePrompt`; `heuristicIdleHardMs` (~5 s) idles after sustained silence even without a recognized prompt — fixing the cmd "stuck busy after Ctrl+C" case — but never while the tail matches an input-prompt pattern (that path stays busy → needs-input).
- **cmd heuristics:** for cmd, `shellInjection` only injects a cwd report (an `OSC 9;9` `PROMPT`), **not** OSC 133 status markers, so *status* is still detected purely by the output heuristics above; the busy/idle e2e genuinely depends on PowerShell markers because heuristics alone cannot distinguish a sleeping command from idle.
- **needs-input mute** is applied in one place: `effectiveStatus` downgrades needs-input → busy before storage when a terminal's `needsInput` toggle is off, so all consumers (border, tab badge, notification) see the effective state.
- **OS notifications** fire only on the idle→needs-input *transition*, only when the window is unfocused, and only if `osNotification` is enabled; clicking shows + focuses the window.
- **Change-debounced emit:** `StatusEngine.emit` only calls `onStatus` when the `state|lastExit` key changes, so steady busy output produces no IPC churn.
- **Known limitation (M-1, deferred):** the 🔔 title prefix rides the needs-input channel, gated on `state === 'needs-input'`, not on `alerts.border`; muting only the border still shows the title bell. See [phase2 review follow-ups](../superpowers/phase2-review-followups.md).
- **Known limitation (M-3, deferred):** the bash DEBUG trap can emit a stray `C` during prompt rendering (a brief busy flicker, immediately cleared by the next `A`); contained to bash.

## Testing

Unit tests (vitest), all present under `tests/`:

- `tests/main/osc133-parser.test.ts` — single/multiple markers, `D` with/without exit, markers split across chunks (body and start sequence), ESC-`\` terminator, plain output not corrupting the buffer.
- `tests/main/status-tracker.test.ts` — `A→C→D;0→A` and failure exits, needs-input fire/clear, screen-redraw chunks not resetting quiet, the heuristic/no-marker + nested-shell idle cases, and that a screen repaint never resurrects busy on a marker-less pane (the ssh busy⇄idle oscillation) while real printable output still does.
- `tests/renderer/pane-status-css.test.ts` + `tests/e2e/status.spec.ts` — the pane's status chrome is paint-only: no status-keyed toolbar rule declares a box-changing property, and the real toolbar/terminal-host boxes measure identical across a busy→idle transition.
- `tests/main/needs-input.test.ts` — fires on quiet + pattern; not on slow-but-chatty output; disabled path; last-line-only matching; `looksLikePrompt`.
- `tests/main/status-engine.test.ts` — change-only emission, marker routing per session, `markExit` → idle (uses an injectable clock).
- `tests/main/shell-integration.test.ts` — `ShellInfo → injection|null` for pwsh/powershell/gitbash/wsl/cmd.
- `tests/shared/alerts.test.ts` — `resolveAlerts` defaults/merge and `effectiveStatus` needs-input downgrade.

End-to-end (Playwright), `tests/e2e/status.spec.ts` (sets `TERMHALLA_NEEDS_INPUT_QUIET_MS=2000` for speed; reuses the hermetic-userData + process-tree teardown):

- busy/idle: `Start-Sleep -Seconds 2; "done"` → `[data-status="busy"]` then `[data-status="idle"]`.
- needs-input: a `Read-Host`/`ReadLine` `[y/N]` prompt → `[data-status="needs-input"]` and a 🔔 tab badge; answering clears it.
- per-terminal mute: rename + uncheck the border toggle → no `.mosaic-window.term-status` element; rename reflected in the pane title.

## Related

- [Architecture](../architecture.md) — where the status engine sits in the main process.
- [Decisions](../decisions.md) — OSC 133 over heuristics, the shared busy-gated awareness pipeline, and the ANSI-strip tail hazard.
- [Phase 2 review follow-ups](../superpowers/phase2-review-followups.md) — deferred minor items (M-1…M-4).
- Sibling features: [workspaces](workspaces.md), [cwd-awareness](cwd-awareness.md) (shares the injected OSC stream), [ai-session-awareness](ai-session-awareness.md) (consumes the busy/idle signal and `onCommandDone`).
