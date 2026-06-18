# Feature Batch (2026-06-17) — Review Follow-ups & Deferred Work

Autonomous batch of five roadmap features (brainstorm → spec → plan → subagent-driven
implementation + review → merge). **Four shipped to `main`; one deferred.** Specs/plans under
`docs/superpowers/specs/` and `docs/superpowers/plans/` dated `2026-06-17`.

| Feature | Status | Merge |
|---|---|---|
| 3 — Git status on pane chip | Merged | `1f87003` |
| 4 — Saved per-pane run commands | Merged | `c8d0bfc` |
| 6 — Per-project notepad | Merged | `c233ffb` |
| 2 — Searchable output history | Merged | `12b0278` |
| 1 — Pane hibernation | **Deferred** | — |

Full suite after the batch: **474 vitest + per-feature e2e green**.

## Deferred features

- **Feature 1 — Pane hibernation (sleep/wake).** Deferred by owner mid-brainstorm. Design explored
  (sleep = `readPaneSnapshot` → `teardownPanes` → `clearPaneRuntime` → mark `asleep`, keep the pane
  in the layout; wake = stash snapshot → `TerminalPane` remounts + re-spawns; persist the `asleep`
  flag so it restores dormant). Open decisions when revived: scrollback-persist-across-restart
  (dedicated store) vs same-session-only; SSH reconnect-on-wake vs disallow. Reuse the
  `stashSnapshot`/`consumeSnapshot` + serialize-before-dispose machinery; must NOT go through
  `closePane`/`teardownPanes` (they drop the persisted entry). See the
  [decision log](../decisions.md) entry. No branch.

## Per-feature deferred scope (v2 / non-goals)

### Feature 4 — run commands
- **On-success behavior (open-URL on exit 0)** deferred to v2 — reliably attributing a specific exit
  code to the command we sent is racy and shell-integration-dependent (cmd has no real exit signal).
- No per-command send-mode toggle (always keys + CR); no dedicated output drawer; no project (git-root)
  scope; no command reordering UI.

### Feature 6 — notepad
- Plain textarea only (no Monaco/markdown); one note per project (no titles/tabs); not indexed by
  search yet (could feed Feature 2); per-pane/per-workspace notes out of scope (per-project only).
- Known behavior: on a fresh launch no pane is focused, so the drawer shows its empty state until a
  pane is clicked.

### Feature 2 — searchable output history
- No per-command (OSC 133) segmentation — idle/size/exit segmenting only; no regex search in the UI
  (FTS5 MATCH only); no time-range filters; no cross-machine sync; relaunch uses the default shell at
  the hit's cwd (shell id not stored).

## Minor review findings carried (non-blocking; from per-chunk + final reviews)

- **Feature 3:** `sigOf` omits the derived `dirty` field (safe — its components are in the signature;
  cosmetic future-safety nit). `resolveGitRoot` returns a git forward-slash path on Windows (note for
  any future path comparison).
- **Feature 2:** `SearchService` re-`prepare()`s statements per `insertSegments` call (better-sqlite3
  caches by SQL, so functionally equivalent — could hoist to the constructor). `Indexer.dispose()`
  clears `buffers` but not `cwds`/`muted` (harmless at shutdown; defensive to clear). Indexer tick
  (500 ms) vs `SEGMENT_IDLE_MS` (1000 ms) ⇒ ~1.5× worst-case flush latency (intentional oversampling).
  e2e covers runtime-toggle mute but not the spawn-with-`historyMuted` path (verified correct by
  inspection; coverage-only gap).
