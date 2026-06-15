# Claude Usage Metrics

> Live context-window % on a Claude session's chip plus a token breakdown in its popover, parsed read-only from the on-disk transcript.

**Status:** Shipped (with post-launch fixes) · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-claude-usage-metrics-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-claude-usage-metrics.md) · **Follow-ups:** [review follow-ups](../superpowers/usage-metrics-review-followups.md)

## What it does

For a terminal pane running a detected **Claude Code** session (from the AI-session-awareness feature, "E"), Termhalla surfaces live usage:

- **Chip headline** — the context-window percentage is appended to the AI chip: `✨ Claude 78%` (just `✨ Claude` until metrics arrive).
- **Popover detail** — a usage section at the top of the existing process popover shows the context line (`156k / 200k · 78%`) and a token breakdown: input / output / cache-read / cache-creation.

Claude-only for now, behind a pure parse layer so Codex can be added later. Everything is read-only and runtime-only — nothing is persisted, and Claude is never written to or controlled.

## How it works

The data path is `cwd → encoded project dir → newest .jsonl transcript → parsed metrics → IPC → store → chip/popover`.

**Pure core** (no I/O, unit-tested):
- `project-dir.ts:encodeProjectDir` — replaces every non-alphanumeric char with `-`, matching Claude's project-dir naming (`C:\dev\scratch` → `C--dev-scratch`, `my.app two` → `my-app-two`). Case preserved.
- `project-dir.ts:pickNewestTranscript` — the `.jsonl` entry with the greatest `mtimeMs`, or `null` (ignores non-`.jsonl`).
- `parse-usage.ts:parseClaudeUsage(jsonl, alias='')` — splits on newlines (handles CRLF), `JSON.parse`s each line (malformed/blank/non-assistant lines skipped). Sums `input`/`output`/`cacheRead`/`cacheCreation` across assistant turns; `contextTokens` is the **last** assistant turn's input + cacheRead + cacheCreation. `contextWindow = windowFor(model, alias)`, then auto-bumps to 1M if `contextTokens` already exceeds it; `contextPct = round(contextTokens / contextWindow * 100)`.
- `parse-usage.ts:windowFor(model, alias='')` — returns `1_000_000` when **either** the transcript model **or** the settings alias contains `[1m]`, else `200000`.
- `model-alias.ts:readModelAlias(cwd, claudeHome)` — reads the `model` field from the first of project `.claude/settings.local.json` → project `.claude/settings.json` → global `<claudeHome>/settings.json`. Key finding: the `[1m]` suffix is **never written to transcripts** (they record the canonical id, e.g. `claude-opus-4-8`); it lives only in this settings alias (e.g. `"opus[1m]"`), so the alias is the only source that can flag a 1M session.

**Watch layer** — `usage-tracker.ts:UsageTracker` (impure: chokidar + fs):
- `watch(id, cwd)` resolves the project **directory** (`<claudeHome>/projects/<encodeProjectDir(cwd)>`), reads the model alias once, parses immediately, then chokidar-watches the directory (`depth: 0`). On every `.jsonl` add/change it re-resolves the newest transcript and re-parses, debounced ~750ms, emitting `UsageMetrics` via the `onMetrics` callback.
- `claudeHome` defaults to `~/.claude`, overridable via `TERMHALLA_CLAUDE_HOME`.
- `unwatch(id)` / `dispose()` stop watches; `unwatch` emits `null` (chip drops the %).
- Uses a session-identity race pattern: `watch` claims its slot before any `await`, and each async step bails if `this.sessions.get(id)` is no longer its own `sess`, so a concurrent watch/unwatch supersedes cleanly.

**Channels** (`shared/ipc-contract.ts`, wired in `main/ipc/register.ts`):
- `usage:watch` (renderer → main, `(id, cwd)`) → `UsageTracker.watch`.
- `usage:unwatch` (renderer → main, `(id)`) → `UsageTracker.unwatch`.
- `usage:metrics` (main → renderer event, `(id, UsageMetrics | null)`) — `register.ts` constructs the tracker with `(id, m) => safeSend(CH.usageMetrics, id, m)` and calls `usage.dispose()` on window close.

**Renderer**:
- `UsageWatcher.tsx` reconciles desired watches from `aiSessions[id].tool === 'claude' && cwds[id]`, using a `useRef` map to avoid redundant IPC; it `usageWatch`/`usageUnwatch` on diffs and releases all watches on unmount.
- `store.ts` holds `usage: Record<string, UsageMetrics>`; `setUsage(id, m | null)` sets or deletes (on null); `closePane` drops the `usage` entry alongside the other per-pane maps and calls `api.usageUnwatch`.
- `App` subscribes to `onUsageMetrics → setUsage` and mounts `<UsageWatcher />`.
- `WorkspaceView.tsx` reads `usage`, builds the chip text (`✨ ${label}${usage ? ` ${contextPct}%` : ''}`), and renders the popover usage section (gated on `aiSession && usage`) with a compact `fmtTokens` formatter (`1234` → `1.2k`, `156000` → `156k`).

## Key files

| File | Responsibility |
|---|---|
| `src/main/usage/project-dir.ts` | `encodeProjectDir`, `pickNewestTranscript` (pure) |
| `src/main/usage/parse-usage.ts` | `windowFor`, `parseClaudeUsage` (pure) |
| `src/main/usage/model-alias.ts` | `readModelAlias` — resolves the `[1m]` flag from settings |
| `src/main/usage/usage-tracker.ts` | `UsageTracker` — directory watch + debounced re-resolve/re-parse |
| `src/shared/types.ts` | `UsageMetrics` interface |
| `src/shared/ipc-contract.ts` | `usage:watch` / `usage:unwatch` / `usage:metrics` + API methods |
| `src/main/ipc/register.ts` | Constructs and wires `UsageTracker` to the channels |
| `src/renderer/components/UsageWatcher.tsx` | Reconciles watches from `aiSessions` + `cwds` |
| `src/renderer/store.ts` | `usage` map, `setUsage`, `closePane` cleanup |
| `src/renderer/components/WorkspaceView.tsx` | Chip `%` headline + popover token breakdown |

## Behaviors & edge cases

- **Directory re-resolve fixes stale-stub binding.** The tracker watches the project directory and re-resolves the newest `.jsonl` on each event, not a single frozen path. A project dir can hold stale, assistant-less session stubs; binding to one as a fixed file left the chip stuck at `0%` and a single-file watch couldn't notice a newer session file appear. (Post-launch fix.)
- **1M window comes from the settings alias, with auto-bump.** Because transcripts omit `[1m]`, `windowFor` checks the settings alias too; and `parseClaudeUsage` bumps the window to 1M whenever observed `contextTokens` exceeds 200k, so the chip never reports >100% even when the alias is unknown. (Post-launch fix.)
- **Read-only / no secrets.** Only transcript and settings files are read; nothing is written, and no metrics are persisted. Settings reads take only the `model` field.
- **Whole-file re-read.** The full transcript is re-read and re-parsed on each (debounced) change — acceptable for v1; offset-based incremental parsing is deferred.
- **`TERMHALLA_CLAUDE_HOME` override.** Defaults to `~/.claude`; the env var redirects the Claude home (used for hermetic e2e seeding).
- **Graceful nulls.** No project dir / no `.jsonl` / unreadable file → emit `null` (chip stays `✨ Claude`). A transcript with no assistant turns → all-zero metrics (`contextPct 0`). One malformed JSONL line never fails the parse.
- **Alias read once.** The model alias is read at watch-start; a mid-session `/model` change isn't picked up until the watch is re-established. Rare; deferred.

## Testing

- `tests/main/usage-core.test.ts` (vitest, real) — covers `encodeProjectDir` (non-alphanumeric → `-`), `pickNewestTranscript` (max mtime; null on empty / no `.jsonl`), `windowFor` (200k default; 1M from model or alias `[1m]`), and `parseClaudeUsage` (cumulative sums, last-turn context, pct; alias-driven 1M; auto-bump above 200k; CRLF handling; missing/null fields → 0; empty → all-zero).
- `tests/main/usage-tracker.test.ts` (vitest, real, fs-backed) — covers the stale-binding fix (re-resolves to a newer `live.jsonl` written after watch-start) and the 1M window resolved from a `settings.json` model alias.
- `tests/e2e/usage.spec.ts` (Playwright, hermetic) — launches with `TERMHALLA_CLAUDE_HOME` at a temp dir, `cd`s a terminal into a temp cwd, reads back the cwd Termhalla reports, seeds a transcript with known totals under the encoded project dir, runs a stub `claude.cmd` so the session is detected, then asserts the chip shows `75%` and the popover shows the `220` input total.

## Related

- [Architecture](../architecture.md)
- [Decisions](../decisions.md)
- [AI session awareness](ai-session-awareness.md) — feature E; this is its "deep state" follow-up
