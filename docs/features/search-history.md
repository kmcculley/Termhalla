# Searchable Output History

> Full-text search across current and past terminal output, stored in a local SQLite FTS5 index, with reveal-in-pane and relaunch-at-cwd actions.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-17-searchable-output-history-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-17-searchable-output-history.md)

## What it does

Every byte that appears on a terminal screen is silently indexed in a local SQLite database as it streams. A **Search output history** modal (🔍 in the status bar, or **Ctrl+Shift+F**) lets the user type a free-text query and see ranked snippets from any session — current or past. Each hit shows the directory it came from. If the source pane is still open, a **Reveal** button focuses it; otherwise a **Relaunch** button opens a fresh terminal at the hit's cwd. A **Clear history** button wipes the index. A per-terminal 🔇/📖 mute toggle in the pane toolbar suppresses indexing for that pane.

## Data flow

```
pty.onData
    │
    ├── send(pty:data)        (xterm render in renderer)
    ├── recorder.data()       (session recording)
    └── indexer.data()        (output history)
            │ skip if pane muted
            │ stripAnsi(raw)
            ▼
       SegmentBuffer (per pane)
            │ flush on idle (~1 s) / size (8 KB) / pane exit
            ▼
       SearchService
            │ INSERT INTO segments + segments_fts
            │ prune oldest beyond cap
            ▼
       search.db  (SQLite WAL, under userData)

renderer SearchHistory modal
    │  search:query / search:stats / search:clear / search:setMuted
    ▼
    ipcMain.handle / ipcMain.on (register-search.ts)
    ▼
    SearchService / Indexer
```

On `search:query` the renderer sends a free-text string; `toMatchExpr` in `fts-query.ts` sanitizes it into a safe FTS5 MATCH expression (each whitespace-delimited token wrapped in double-quotes to neutralize FTS5 special characters); `segments_fts MATCH ?` returns ranked hits joined to the `segments` metadata table for `paneId`, `ts`, `cwd`, and a context snippet.

## Segmentation

Terminal output is not stored word-by-word or byte-by-byte. The `SegmentBuffer` accumulates ANSI-stripped text and emits a **segment** (a `{text, ts, cwd}` triple) when any of three conditions is met:

| Trigger | Threshold |
|---|---|
| Idle flush | ≥ 1 000 ms since the last data push (`flushDue`, called every 500 ms by the `Indexer` timer) |
| Size flush | Buffer reaches 8 192 bytes (immediate, from `push`) |
| Pane exit | `indexer.remove(id)` calls `buffer.end()` to flush the remainder |

Whitespace-only accumulations produce no segment — blank prompts and trailing newlines do not create index entries.

### cwd tagging

Each segment carries the cwd active at the moment it is flushed. `Indexer.setCwd` is called whenever the status engine emits a `pty:cwd` event and updates both the `cwds` map and the current `SegmentBuffer` for that pane, so the cwd on a segment reflects where the output was produced.

## Retention and clear

- **Cap:** 50 000 segments (configurable via `SEGMENT_CAP` in `prune-policy.ts`). Every `insertSegments` call checks `count(*) FROM segments` inside the same transaction; if the count exceeds the cap the oldest rows (by `ts`) are deleted from both `segments` and `segments_fts` before the transaction commits.
- **Clear history:** `search:clear` (the button in the modal footer) issues `DELETE FROM segments; DELETE FROM segments_fts` and returns updated stats so the UI reflects the empty state immediately.
- **WAL mode:** `PRAGMA journal_mode = WAL` is set on DB open, keeping read latency low while writes happen on the timer tick.

## On by default + per-terminal mute

Indexing is **on by default**: every terminal's output is indexed unless muted. A `historyMuted?: boolean` field on `TerminalConfig` (schema version 6, additive) persists the mute. On terminal mount, `TerminalPane` calls `api.searchSetMuted(paneId, !!config.historyMuted)` immediately after spawn so the `Indexer` respects the mute from the first byte. The 🔇/📖 toggle in `PaneToolbar` calls `updatePaneConfig` (persists) and `api.searchSetMuted` (immediate main-side effect) atomically.

`Indexer.setMuted(id, true)` discards the in-flight buffer for that pane — data already flushed to the DB is not retroactively removed, but no new segments accumulate until the pane is unmuted.

## Privacy boundary

- **Output only, never input.** The `Indexer` is a consumer on the `onData` fan-out (same hook as the recorder). It never touches the `pty:write` path. Keystrokes are never indexed.
- **Local index.** `search.db` lives under the Electron `userData` directory. It is never transmitted — no network calls, no telemetry.
- **Controls.** The user can mute any individual terminal (persisted), clear the full history at any time, or accept the retention cap (oldest 50k segments; oldest pruned automatically).
- **On-by-default note.** Because indexing is on by default, any text that appears on the terminal screen — including secrets echoed by commands like `cat ~/.env` or passwords entered in plain-text prompts — will be indexed until it is pruned by the retention cap or manually cleared. Mute a terminal before running commands that produce sensitive output.

## Reveal vs. relaunch

Each search hit provides one of two actions:

| State | Action |
|---|---|
| Source pane still open (paneId found in any workspace's pane map) | **Reveal** — `revealPaneFromSearch` switches to the source workspace, focuses the pane, and closes the modal |
| Source pane gone | **Relaunch** — `relaunchFromSearch` calls `launchDir(cwd)` (the quick-slice action) to open a new terminal at the hit's cwd in the active workspace, then closes the modal |

The determination is made in the renderer at click time, not at query time, so it reflects the live state of open panes.

## Native module + ABI testing split

`better-sqlite3` is a **native addon** built against Node's C++ ABI. Like `node-pty`, it must be compiled for Electron's specific ABI with `npx electron-rebuild -f -w better-sqlite3`. The compiled `.node` binary is excluded from the asar archive (`asarUnpack` in `electron-builder.yml`) so it can be loaded at runtime.

**Testing split (critical):** because the installed binary is compiled for Electron's ABI it cannot be loaded under vitest's Node. The split is:

| Module | Imports better-sqlite3? | Test coverage |
|---|---|---|
| `segment-buffer.ts`, `prune-policy.ts`, `fts-query.ts` | No (pure) | vitest unit tests |
| `search-service.ts`, `indexer.ts` | Yes (directly or transitively) | Playwright e2e only |

The e2e test (`tests/e2e/search-history.spec.ts`) is the real proof that better-sqlite3 loads under Electron's ABI, the index writes, FTS query works end-to-end, mute is respected, and the index persists across app restarts.

## Key files

| File | Responsibility |
|---|---|
| `src/main/search/segment-buffer.ts` | **Pure.** Per-pane output accumulator; emits segments on idle/size/exit; drops whitespace-only; tracks cwd |
| `src/main/search/prune-policy.ts` | **Pure.** `overage(count, cap)` — rows to delete; `SEGMENT_CAP` constant |
| `src/main/search/fts-query.ts` | **Pure.** `toMatchExpr(query)` — FTS5-safe MATCH expression |
| `src/main/search/search-service.ts` | better-sqlite3 wrapper: schema init, `insertSegments`, `query`, `stats`, `clear`, `close` |
| `src/main/search/indexer.ts` | Impure glue: per-pane `SegmentBuffer` + cwd/muted maps + shared idle-flush timer |
| `src/main/ipc/register-search.ts` | `search:*` IPC handlers; disposer flushes `Indexer` and closes DB on shutdown |
| `src/main/services.ts` | Constructs `SearchService(join(dir, 'search.db'))` in `buildServices` |
| `src/main/ipc/register-pty.ts` | Wires `indexer.data` / `indexer.setCwd` / `indexer.remove` into the onData fan-out |
| `src/shared/types.ts` | `SearchHit`, `SearchStats`; `historyMuted?` on `TerminalConfig`; `SCHEMA_VERSION = 6` |
| `src/shared/ipc-contract.ts` | `search:query/stats/clear/setMuted` channels + `TermhallaApi` methods |
| `src/renderer/store/search-slice.ts` | `setSearchOpen`, `revealPaneFromSearch`, `relaunchFromSearch` |
| `src/renderer/components/SearchHistory.tsx` | Modal: query input, ranked results, reveal/relaunch buttons, stats + clear footer |
| `src/renderer/components/PaneToolbar.tsx` | 🔇/📖 per-terminal mute toggle |
| `src/renderer/components/TerminalPane.tsx` | Syncs persisted `historyMuted` to main on terminal mount |
| `src/renderer/components/StatusBar.tsx` | 🔍 `search-toggle` button |
| `src/shared/keybindings.ts` | `toggle-search` command (Ctrl+Shift+F, General group) |
| `tests/main/segment-buffer.test.ts` | Unit: idle flush, size flush, `end()`, whitespace drop, cwd update |
| `tests/main/prune-policy.test.ts` | Unit: `overage` boundary conditions; `SEGMENT_CAP` sanity |
| `tests/main/fts-query.test.ts` | Unit: token quoting, quote-stripping, FTS5 special chars, blank input |
| `tests/renderer/search-slice.test.ts` | Unit: `setSearchOpen`; `revealPaneFromSearch` finds workspace; no-op on unknown pane |
| `tests/e2e/search-history.spec.ts` | E2E: index + find + reveal; mute blocks indexing; index persists across restart |

## Non-goals (v1)

- **No regex or wildcard search.** Queries are tokenized and ANDed; each token is quoted so FTS5 handles stemming. Phrase search (`"exact phrase"`) is not supported in v1 — the quoting strategy treats every token as a literal.
- **No per-workspace or per-session filtering.** All segments from all panes (across all workspaces) share one index; results are ranked by BM25 relevance, not filtered by workspace or time range.
- **No export.** The index is query-only from the UI; there is no CSV/JSON export.
- **No indexing of editor buffers.** Only PTY output is indexed; Monaco file content is not.
- **No cloud sync.** `search.db` is local to the machine.

## Related

- [Architecture](../architecture.md) — main/preload/renderer layering; the onData fan-out pipeline.
- [Decisions](../decisions.md) — pure core + thin impure shell; ABI testing split.
- [CWD awareness](cwd-awareness.md) — provides cwd updates consumed by `Indexer.setCwd`.
- [Session recording](recording.md) — the `recorder.data()` call that `indexer.data()` sits beside in the fan-out; same privacy boundary (output only).
- [Notepad](notepad.md) — another `userData` persistence file (`notes.json`); shares the pattern.
