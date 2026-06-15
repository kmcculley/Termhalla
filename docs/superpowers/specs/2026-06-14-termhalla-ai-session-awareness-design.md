# Termhalla — Claude Code / Codex Session Awareness — Design Spec

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phases 1–3 + CWD awareness (A) + SSH/favorites (B) + child-process tracking (C) + cloud status (D), all merged to `main`.

## 1. Summary

Recognize when a terminal is running **Claude Code** (`claude`) or **Codex** (`codex`)
and surface it as a first-class **AI session**: a pane chip (`✨ Claude`), a workspace-tab
indicator, and an **"awaiting input"** state so you can spot at a glance — and via an
OS notification — when Claude is waiting for you. This is the first sub-project of the
"deeper Claude/Codex integration" roadmap item (E); deep state (model, tokens) is a
later, separate sub-project.

Detection reuses sub-project C's process-tree tracking and the status engine's OSC 133
markers — **no new polling**.

## 2. Decisions (from brainstorming, 2026-06-14)

| Decision | Choice |
|---|---|
| Primary value | **Detect & surface AI sessions** (the awareness layer), not quick-launch or deep state. |
| Surfaces | **Both** — a pane process chip (`✨ <tool>`) AND a workspace-tab indicator. |
| State | **Reflect live state** — working / awaiting-input / (ended), with an AI-labeled "needs input" notification. |
| Detection | **C — Sticky, reuse C + markers** — set the AI flag from C's busy-time process info, clear it on the shell command-done (OSC 133 D) marker. No new polling; pure/testable. |

## 3. Architecture & data flow

A new main-process **`AiSessionTracker`** (`src/main/ai/`) holds a per-terminal active
tool (`'claude' | 'codex' | null`). It consumes two **existing** signals — no new polling:

- **Set** from sub-project C's process emissions. When `ProcessTracker` emits `ProcInfo`
  for a terminal (during its busy-gated poll), a pure `classifyAiSession(tree)` scans the
  descendant command lines; a match marks the session active (sticky — it persists across
  busy→idle).
- **Clear** on **command-done**. `StatusEngine` gains an `onCommandDone(id)` callback,
  fired when it parses an OSC 133 **D** marker (the shell command — i.e. the whole `claude`
  session — completed) or the pty exits. Also cleared on pane close (`unregister`).

The session therefore stays active from detection through any awaiting-input quiet period,
until `claude` actually exits. The tracker emits `ai:session (id, AiSession | null)` to the
renderer (deduped). It is pure event-driven logic (events in, classification out) and is
fully unit-testable with injected events.

## 4. The "awaiting input" reinterpretation

While a `claude` session is active, the generic status engine marks it **busy** when Claude
produces output and **idle** when Claude goes quiet at its prompt (Claude's prompt ends in
`>`, so the idle heuristic reads it as idle). For an **active AI session**, that quiet-idle
means **"Claude is waiting for you."** So the renderer **derives** the AI display state:

- active **+ busy** → **working**
- active **+ not-busy** → **awaiting input**

The command-done (OSC 133 D) clear — rather than a plain idle clear — is what lets the badge
persist through the awaiting period without being mistaken for "session ended."

## 5. Detection (pure, configurable)

```ts
export interface AiToolPattern { tool: string; label: string; re: RegExp }
export const AI_TOOLS: AiToolPattern[] = [
  { tool: 'claude', label: 'Claude',
    re: /(^|[\\/\s"])claude(\.\w+)?($|[\s"])|claude-code|@anthropic-ai[\\/]claude/i },
  { tool: 'codex', label: 'Codex',
    re: /(^|[\\/\s"])codex(\.\w+)?($|[\s"])/i }
]

export function classifyAiSession(tree: ProcNode[]): AiSession | null
```
`claude`/`codex` run as `node`, so the matcher tests each node's `command` (and `name`),
not just the image name. The patterns are anchored on path/word boundaries to avoid false
positives such as `vim claude.md` (an argument, not the program). Built-in for now;
extensible later. Unit-tested across `node …\claude\cli.js`, `claude.cmd`, package paths,
nested trees, the `claude.md`-argument non-match, and the empty case.

## 6. Types & IPC

```ts
export interface AiSession { tool: string; label: string }   // e.g. { tool: 'claude', label: 'Claude' }
```
- New channel **`ai:session`** (main → renderer, carries `(id, AiSession | null)`); preload
  `onAiSession`.
- `StatusEngine`'s constructor gains an `onCommandDone: (id: string) => void` callback,
  fired on an OSC 133 D marker and on pty exit.
- Runtime-only; nothing is persisted.

## 7. Renderer — chip, tab, notification

- Store gains `aiSessions: Record<paneId, AiSession>` (updated on `ai:session`;
  delete-on-null) and `setAiSession(id, ai | null)`. `closePane` also drops the entry
  (alongside `statuses`/`cwds`/`procs`). A small derivation `aiState(paneId)` returns
  `'working' | 'awaiting' | null` from `aiSessions[paneId]` + `statuses[paneId]`.
- **Pane chip** (`WorkspaceView`): when `aiSessions[paneId]` is set, the process chip shows
  **`✨ <label>`** instead of the raw foreground `node`; the existing status tint conveys
  working/awaiting.
- **Tab indicator** (`WorkspaceTabs`): a tab containing an active AI session shows **✨**
  plus its state — `✨⏳` when any contained AI session is awaiting input, else `✨` while
  working — folded into the existing `tabBadge` logic next to the 🔔/• badges.
- **Notification**: when an active AI session transitions to **awaiting input** (derived
  state flips to `awaiting`) and the window is unfocused, fire an AI-labeled OS notification
  — **"Claude is waiting for you"** (tool-specific) — via the existing `notify` path. The
  transition is detected in the store's status/ai update (mirroring the existing
  needs-input notification gate).

## 8. Testing & verification

- **Unit (vitest, pure):**
  - `classifyAiSession` — matches `node …\claude\cli.js`, `claude.cmd`, `@anthropic-ai/claude`
    package paths, and `codex`; does NOT match `vim claude.md` (argument); nested tree;
    returns null when absent.
  - `AiSessionTracker` — set on detect; persists through a busy→idle sequence; clears on
    command-done; clears on `unregister`; dedups repeat emits — all with injected events.
- **e2e (Playwright, hermetic):** seed a stub program named `claude` (a small script on a
  temp PATH that prints a line then waits on stdin) and run it in a terminal → assert the
  pane chip shows `✨ Claude` and the workspace tab shows the ✨ indicator; signal the stub
  to exit → assert the chip/tab AI indicator clears.

## 9. Non-goals (this sub-project)

- No deep state (model, token usage, Claude/Codex internals) — a later sub-project.
- No new always-on polling (reuses C's busy-time process info + status markers).
- No quick-launch/presets here (that was the alternative E framing; can follow later,
  reusing the B launch override).
- cmd / non-integrated shells: detection still works while busy, but without the OSC 133 D
  marker the badge may linger until the next command (documented limitation).
- No control of Claude/Codex — read-only awareness.
