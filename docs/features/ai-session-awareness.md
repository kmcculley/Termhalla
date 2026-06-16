# AI Session Awareness

> Detects Claude Code / Codex running in a terminal and surfaces it as a first-class AI session — a `✨ Claude` chip, a workspace-tab indicator, and a "waiting for you" notification on busy→quiet.

**Status:** Shipped · **Spec:** [design spec](../superpowers/specs/2026-06-14-termhalla-ai-session-awareness-design.md) · **Plan:** [implementation plan](../superpowers/plans/2026-06-14-termhalla-ai-session-awareness.md)

## What it does

Recognizes when a terminal is running an AI coding agent (`claude` / `codex`) by scanning the terminal's descendant process tree, and surfaces it as an **AI session**:

- A **pane chip** showing `✨ <label>` (e.g. `✨ Claude`) instead of the raw foreground process.
- A **workspace-tab indicator** — `✨` while working, `✨⏳` while the agent is awaiting your input.
- A derived **working / awaiting** state: an active session is *working* while busy and *awaiting input* once it goes quiet at its prompt.
- An **AI-labeled OS notification** ("Claude is waiting for you") when an active session flips busy→quiet and the window is unfocused.

This is detection + surfacing only. Deep state (model, token usage, context %) is a separate feature — see [Claude usage metrics](usage-metrics.md).

## How it works

Detection reuses the existing process-tree tracking (child-process tracking) and the status engine's OSC 133 markers — **no new polling**.

1. **Classify (pure).** `classify-ai.ts:classifyAiSession(tree)` scans a `ProcNode[]` and returns `{ tool, label }` or `null`. Patterns live in `classify-ai.ts:AI_TOOLS`; each is anchored on path/word boundaries and only accepts *executable* extensions (`.exe`/`.cmd`/`.bat`/`.ps1`) plus the package paths `claude-code` / `@anthropic-ai/claude` / `@openai/codex`. Both `command` and `name` are tested for every node, so a `node …\claude-code\cli.js`, a `claude.cmd` shim, or a bare `claude` all match — but `vim claude.md` (a doc *argument*) does not. First tool matching any node wins.

2. **Track (sticky).** `ai-session-tracker.ts:AiSessionTracker` holds a per-pane active session in a `Map`. It is fed from the process tracker via `onProcs(id, info)`, which **only SETS** (classifies `info.tree`; emits on a new/changed tool, deduped). Clearing is driven elsewhere: `commandDone(id)` (the shell command finished) and `unregister(id)` (pane close) delete the entry and emit `null`. The session therefore persists through Claude's busy→idle quiet period and is cleared only when `claude` actually exits.

3. **Command-done signal.** `status-engine.ts:StatusEngine` takes a 4th constructor callback `onCommandDone(id)`, fired when `feed` parses an OSC 133 **D** marker (at most once per feed) and from `markExit` (pty exit). In `register.ts` this is wired to `ai.commandDone(id)`; pty exit and `pty:kill` also call `ai.unregister(id)`.

4. **Channel.** `AiSessionTracker` emits over the `ai:session` IPC channel (`ipc-contract.ts:CH.aiSession`, preload `onAiSession`), carrying `(id, AiSession | null)`. Wired in `register.ts`: the process tracker callback calls `ai?.onProcs(id, info)` alongside the existing `pty:procs` send.

5. **Awaiting signal.** The same `AiSessionTracker` emit also calls `StatusEngine.setAiActive(id, session !== null)` (wired in `register-pty.ts`). `StatusEngine` forwards it to the per-terminal `StatusTracker`, whose `computeIdleFallback` then treats sustained output silence as idle for AI-active terminals — without it, a quiet agent would stay busy forever (markers latched, TUI tail not a shell prompt). This is what makes `aiState`'s `'awaiting'` branch actually reachable.

6. **Renderer.** `App.tsx` subscribes via `api.onAiSession` into `store.ts:setAiSession`, which maintains `aiSessions: Record<paneId, AiSession>` (delete-on-null; also dropped in `closePane`). The exported pure helper `store.ts:aiState(s, paneId)` derives `'working'` (status busy) / `'awaiting'` (else) / `null` (not an AI session). Surfaces:
   - `WorkspaceView.tsx` — `chipText` becomes `✨ ${label}` when `aiSessions[paneId]` is set.
   - `WorkspaceTabs.tsx:tabBadge` — uses `aiState` per pane to fold `✨` / `✨⏳` into the existing badge next to 🔔/•.
   - `store.ts:setStatus` — for an active AI session, an `else`-gated branch fires the "{label} is waiting for you" notification on busy→quiet (unfocused, alerts enabled), instead of the generic "Terminal needs input".

## Key files

| File | Responsibility |
|---|---|
| `src/main/ai/classify-ai.ts` | Pure `classifyAiSession(tree)`; `AI_TOOLS` exec-anchored regexes |
| `src/main/ai/ai-session-tracker.ts` | `AiSessionTracker` — sticky set from procs, clear on command-done / unregister, emit deduped |
| `src/main/status/status-engine.ts` | `onCommandDone` callback fired on OSC 133 D + pty exit; `setAiActive(id, …)` forwards the AI signal to the tracker |
| `src/main/status/status-tracker.ts` / `needs-input.ts` | `setAiActive` + `computeIdleFallback(…, aiActive)` — quiet AI terminal reads as idle/awaiting |
| `src/shared/types.ts` | `AiSession { tool, label }` |
| `src/shared/ipc-contract.ts` | `ai:session` channel + `onAiSession` API method |
| `src/main/ipc/register-pty.ts` | Constructs `AiSessionTracker`; wires procs feed, command-done, unregister, and `setAiActive` |
| `src/preload/index.ts` | Exposes `onAiSession` |
| `src/renderer/store.ts` | `aiSessions`, `setAiSession`, exported `aiState`, `closePane` cleanup, AI notification |
| `src/renderer/App.tsx` | Subscribes to `ai:session` |
| `src/renderer/components/WorkspaceView.tsx` | `✨ <label>` pane chip |
| `src/renderer/components/WorkspaceTabs.tsx` | `✨` / `✨⏳` tab indicator via `aiState` |

## Behaviors & edge cases

- **Sticky until command-done.** Detection sets the session; it is NOT cleared when the process tree goes idle (Claude going quiet). It clears only on the OSC 133 D marker, pty exit, or pane close — which is what lets the badge survive the awaiting-input period without being mistaken for "session ended."
- **Awaiting = quiet, not gone.** An AI agent runs as one long shell command sitting at its own **TUI prompt** (a box — *not* a shell prompt the generic idle heuristic recognizes), and the launching shell emits no command-done **D** marker until the agent exits. So the status tracker would otherwise stay **busy** for the agent's whole lifetime (the historical "Claude always shows active" bug). `AiSessionTracker` therefore drives `StatusEngine.setAiActive(id, …)`, and `StatusTracker` treats **sustained output silence on an AI-active terminal as idle** — which the renderer surfaces as *awaiting input* (`aiState` → `✨⏳`) and the busy→quiet notification. Gated on the AI signal, so an ordinary silent command still stays busy.
- **Regex anchoring avoids false positives.** Only executable extensions match, so `claude.md` / `claudeesque.md` arguments do not register a session; matching tests both `name` and `command` so a renamed shim is still caught.
- **Reuses C + status markers — no new polling.** Set comes from the busy-gated process emissions of child-process tracking; clear comes from the status engine's existing OSC 133 stream. No always-on timer is added.
- **Notification is else-gated.** An active AI session takes the "{label} is waiting for you" path; only non-AI panes fall through to the generic needs-input notification. Both require `alerts.needsInput`, `alerts.osNotification`, and an unfocused window.
- **Runtime-only.** Nothing is persisted; sessions are reconstructed live from the process tree after a restart.
- **Non-integrated shells (cmd).** Without an OSC 133 D marker, detection still works while busy, but the badge may linger until the next command (documented limitation).

## Testing

- `tests/main/classify-ai.test.ts` — `classifyAiSession` across a `node …\@anthropic-ai\claude-code\cli.js` invocation, a `claude.cmd` shim, a bare `claude`, `@openai/codex`, match-by-name, the tree-scan case, the `claude.md` / `claudeesque.md` false-positive guard, and the empty/ordinary-tree null case.
- `tests/main/ai-session-tracker.test.ts` — set + dedup; no set/clear on non-AI or null snapshots; persists through busy→idle and clears only on `commandDone`; clears on `unregister`; no-op on unknown ids; re-emits when the tool changes.
- `tests/main/status-engine.test.ts` — `describe('StatusEngine.onCommandDone')` verifies it fires on an OSC 133 D marker and on `markExit`.
- `tests/main/needs-input.test.ts` / `status-tracker.test.ts` — `computeIdleFallback`'s `aiActive` branch and a `StatusTracker` reproduction: a marker-launched, non-shell-prompt session stays busy without the AI signal and idles (awaiting) with it.
- `tests/e2e/ai-session.spec.ts` — hermetic Playwright run: seeds a stub `claude.cmd` (busy, then waits on stdin), asserts the pane chip shows `✨ Claude` and the tab shows `✨`, then — once the stub goes quiet at its `set /p` — asserts the tab flips to `✨⏳` (awaiting), then satisfies the stub's input so it exits and asserts the AI indicator clears (command-done).

## Related

- [Architecture](../architecture.md)
- [Decision log](../decisions.md)
- [Claude usage metrics](usage-metrics.md) — the deep-state sibling (model, tokens, context %) that decorates the same chip.
- [Child-process tracking](child-process-tracking.md) — sub-project C, whose busy-time process emissions feed detection.
