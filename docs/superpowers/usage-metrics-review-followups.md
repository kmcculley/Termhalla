# Claude Usage Metrics — Review Follow-ups (deferred)

Sub-project F (`2026-06-15-termhalla-claude-usage-metrics`) merged to `main`
(`abf2c54`). Two bugs surfaced when testing against a real session and were
**fixed** on branch `fix/usage-and-workspace-switch` (`98b2fbb`); the deferred
backlog from the original spec is restated below.

## Post-merge fixes (98b2fbb)

- **Stale/empty transcript binding — chip stuck at `0%`, zero tokens.**
  `UsageTracker` resolved the newest `.jsonl` **once** and watched that single
  frozen path. A project dir can hold stale, assistant-less session stubs (e.g.
  `C--dev-scratch` had two ~2 KB stubs with zero assistant turns); if one was
  newest when the session was detected, the watcher bound to it and never
  re-resolved, and a single-file watch can't notice a newer session file appear.
  **Fix:** watch the project **directory** (`depth: 0`) and re-resolve the newest
  transcript on every `.jsonl` add/change.

- **Wrong context window — 200k reported for a 1M session.**
  Key finding: **the `[1m]` suffix is never written to transcripts.** They record
  the canonical model id (`claude-opus-4-8`); the `[1m]` flag lives only in the
  Claude settings model alias (e.g. `"model": "opus[1m]"`). `windowFor`'s check
  against the transcript model could therefore never detect 1M.
  **Fix:** new `model-alias.ts` resolves the alias from project
  `.claude/settings.local.json` → `.claude/settings.json` → global
  `~/.claude/settings.json` and `windowFor` checks it; plus an auto-bump to 1M
  when observed context exceeds 200k (never report >100%).

## Still deferred (from spec §10)

- **Codex usage metrics** — pluggable source, once its `~/.codex` session/sqlite
  format is reverse-engineered.
- **Cost ($), model name, message/turn count** display — not shown.
- **Cross-session / today / per-project aggregate** — active session only.
- **Incremental transcript parsing** — the whole file is re-read on each change
  (debounced). Acceptable for v1; on a 15 MB transcript this is a full read per
  debounce. Offset-based incremental parsing is the noted optimization.

## Notes

- The numerator (`contextTokens` = last assistant turn's
  `input + cache_read + cache_creation`) matches Claude Code's own `/context`
  total exactly on real data (verified: 29,826 ≈ "29.8k").
- The model alias is read once at watch-start; a mid-session `/model` change that
  rewrites settings is not picked up until the watch is re-established. Rare; defer.
