# Termhalla — Claude Usage Metrics — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phases 1–3 + A (CWD awareness) + B (SSH) + C (child-process tracking) + D (cloud status) + E (Claude/Codex session awareness), all merged to `main`.

## 1. Summary

For a terminal running a **Claude Code** session (detected by sub-project E), surface live
**usage metrics**: cumulative token counts (input / output / cache-read / cache-creation)
and a **context-window % gauge** (how full the context is). The glanceable context % shows
on the E chip (`✨ Claude 78%`); the token breakdown shows in the chip's popover.

This is the "deep state" follow-up to E. **Claude only** for now, behind a pluggable source
so Codex can follow once its on-disk format is reverse-engineered. No cost/model display, no
cross-session aggregate — per the brainstorming selections.

## 2. Decisions (from brainstorming, 2026-06-15)

| Decision | Choice |
|---|---|
| Tools | **Claude first**, pluggable source; Codex is a later follow-up. |
| Metrics | **Tokens** (input/output/cache-read/cache-creation) **+ context-window %**. (No cost, model, or message count.) |
| Scope | **Per active session** — the Claude session running in that terminal. |
| Placement | **Chip headline + popover detail** — context % on the chip; token breakdown in the chip popover. |
| Data source | **A — cwd → encoded project dir → newest `.jsonl`, chokidar-watched** (pure encode + parse; watch is the thin impure layer). |

## 3. Architecture & data flow

A new main-process **`UsageTracker`** (`src/main/usage/`), driven by sub-project E:

- The renderer reconciles desired watches from `aiSessions` + `cwds`: when a pane is a
  **Claude** AI session with a known cwd, it calls `usage:watch (id, cwd)`; when that stops,
  `usage:unwatch (id)`.
- `UsageTracker.watch(id, cwd)` resolves the active transcript —
  `cwd → <claudeHome>/projects/<encodeProjectDir(cwd)>/` → the newest `.jsonl` — then
  **chokidar-watches** that file. It parses immediately and on every change (debounced
  ~750ms) via the pure `parseClaudeUsage`, emitting `usage:metrics (id, UsageMetrics)`.
- `UsageTracker.unwatch(id)` stops the watch and emits `usage:metrics (id, null)`.

Pure `encodeProjectDir` + `parseClaudeUsage` (+ `pickNewestTranscript`) do all the logic;
the chokidar watch and the file read are the only impure pieces. `claudeHome` defaults to
`os.homedir()/.claude`, overridable via `TERMHALLA_CLAUDE_HOME`.

## 4. Pure core (testable)

- `encodeProjectDir(cwd: string): string` — Claude's project-dir encoding: replace every
  non-alphanumeric character with `-`. e.g. `C:\dev\Termhalla` → `C--dev-Termhalla`,
  `C:\dev\my.app` → `C--dev-my-app`. Case preserved.
- `pickNewestTranscript(entries: { name: string; mtimeMs: number }[]): string | null` —
  the `.jsonl` entry with the greatest `mtimeMs`, or null when none.
- `parseClaudeUsage(jsonl: string): UsageMetrics` — split on newlines, `JSON.parse` each
  (skip malformed/blank). For each assistant line (`type === 'assistant'` with
  `message.usage`), accumulate `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`. Track the **last** assistant
  message's `message.model` and its input-side total
  (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`) as the current
  **context size**. `contextWindow = windowFor(model)`; `contextPct =
  round(contextTokens / contextWindow * 100)` (0 when no context). Missing fields default
  to 0.
- `windowFor(model: string): number` via `MODEL_WINDOWS` — default `200000`; `1000000`
  when the model id contains `[1m]` (the 1M-context variants). A small built-in table,
  extensible.

## 5. Types & IPC

```ts
export interface UsageMetrics {
  input: number          // cumulative non-cached input tokens
  output: number         // cumulative output tokens
  cacheRead: number      // cumulative cache-read tokens
  cacheCreation: number  // cumulative cache-creation tokens
  contextTokens: number  // current context size (last assistant turn's input-side total)
  contextWindow: number  // the model's context window (e.g. 200000)
  contextPct: number     // round(contextTokens / contextWindow * 100), 0..(>100 possible)
}
```
- Channels: `usage:watch` (renderer → main, `(id: string, cwd: string)`),
  `usage:unwatch` (renderer → main, `(id: string)`),
  `usage:metrics` (main → renderer, `(id: string, metrics: UsageMetrics | null)`).
- Preload: `usageWatch(id, cwd)`, `usageUnwatch(id)`, `onUsageMetrics(cb)`.
- Runtime-only; nothing is persisted. `TERMHALLA_CLAUDE_HOME` env override for the
  Claude home directory.

## 6. Renderer wiring

- A tiny **`UsageWatcher`** component (renders `null`) subscribes to `aiSessions` + `cwds`
  and, via a `useRef` map of currently-watched `{ id → cwd }` to avoid redundant IPC,
  reconciles each pane: desired = (`aiSessions[id]?.tool === 'claude'` && `cwds[id]`) ?
  `cwds[id]` : none. On a change vs the ref, call `usage:watch(id, cwd)` or
  `usage:unwatch(id)` and update the ref. Mounted once in `App`.
- Store gains `usage: Record<string, UsageMetrics>`, `setUsage(id, m | null)`
  (delete-on-null), and `closePane` drops the `usage` entry alongside the other per-pane maps.
- `App` subscribes to `usage:metrics` → `setUsage`.

## 7. UI — chip headline + popover

- **Chip headline** (`WorkspaceView`): when `usage[paneId]` exists, append the context %
  to the E chip — `✨ ${label} ${contextPct}%` (just `✨ ${label}` until metrics arrive).
- **Popover** (the existing C `proc-menu`, toggled by clicking the chip): when
  `usage[paneId]` exists, render a **usage section at the top** of that popover, above the
  process tree — rows for input / output / cache-read / cache-creation tokens (compact,
  e.g. `1.2k`) and a context line (`156k / 200k · 78%`). No new overlay component.

## 8. Error handling

- No project dir / no `.jsonl` / unreadable file → emit `null` (chip stays `✨ Claude`,
  no %). A transcript with no assistant messages → zeroed metrics (`contextPct 0`).
- Malformed JSONL lines are skipped individually; one bad line never fails the parse.
- The chokidar watcher is removed on `unwatch`/close; one in-flight debounced re-parse per
  terminal. The whole transcript is re-read on each change — acceptable for v1;
  incremental-by-offset parsing is a noted future optimization.
- All file/watch operations are guarded so a missing/locked file never throws into main.

## 9. Testing & verification

- **Unit (vitest, pure):**
  - `encodeProjectDir` — `C:\dev\Termhalla` → `C--dev-Termhalla`; dots/spaces → `-`.
  - `pickNewestTranscript` — picks max `mtimeMs`; null on empty / no `.jsonl`.
  - `windowFor` — default 200000; `[1m]` → 1000000.
  - `parseClaudeUsage` — sample JSONL → correct cumulative sums, last-turn context size, and
    pct; malformed-line skip; user-only lines ignored; empty → all-zero.
- **e2e (Playwright, hermetic):** launch with `TERMHALLA_CLAUDE_HOME=<temp>/.claude`; seed a
  transcript with known token totals under `projects/<encodeProjectDir(cwd)>/sess.jsonl` for
  a seeded terminal whose cwd is that dir; run the E stub `claude.cmd` so the session is
  detected → assert the chip shows the context `%`, open the popover → assert it shows the
  token breakdown. (The stub keeps the session "active"; the seeded transcript supplies the
  numbers.)

## 10. Non-goals (this sub-project)

- No Codex metrics yet (pluggable source; lands once its session/sqlite format is known).
- No cost ($), model name, or message/turn count display.
- No cross-session / today / per-project aggregate — active session only.
- No incremental transcript parsing (whole-file re-read, debounced).
- No writing to or controlling Claude — read-only.
