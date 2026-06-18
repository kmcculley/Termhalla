# Searchable terminal output history — design

**Date:** 2026-06-17
**Feature:** Roadmap feature 2 — index terminal output in the main process so the user can
full-text search across current and past sessions, then reveal or relaunch the source session.

## Goal

Turn the write-only terminal output stream into a queryable recall tool. Output is indexed (SQLite
FTS5) as it streams, keyed by pane with timestamp and cwd context; a search surface returns ranked
hits with context and offers "reveal in pane" (if the source pane still exists) or "relaunch"
(open a new terminal at the hit's cwd). On by default, with a per-terminal mute.

**Privacy boundary (explicit):** indexes terminal **output only — never keystrokes/input**
(matching the recording feature's stance). The index is a local file under `userData`, never
transmitted. Controls: per-terminal mute, a clear-history action, and a retention cap.

## Architecture

A main-side `SearchService` (better-sqlite3 + FTS5) owns the index, fed by a new `Indexer`
consumer added to the `onData` fan-out in `register-pty.ts`, beside `recorder.data(...)`.

```
pty.onData ─▶ send(pty:data)  +  recorder.data()  +  indexer.data()
                                                       │ skip if pane muted
                                                       │ strip ANSI, buffer per pane (pure segment-buffer)
                                                       │ flush a segment on idle(~1s) / size(8KB) / pane exit
                                                       ▼
                                            SearchService (better-sqlite3 + FTS5, WAL)
                                              segments(id, paneId, ts, cwd) + segments_fts(text)
                                              prune oldest beyond cap (pure prune-policy)
   search:query / search:stats / search:clear / search:setMuted ◀── renderer SearchHistory modal
```

### Native module: better-sqlite3

Added like `node-pty`: `electron-rebuild` for Electron's ABI + an `asarUnpack` entry in
`electron-builder.yml`. **De-risked first:** plan Task 1 is solely "add the dependency, rebuild for
Electron, and prove it loads in the running app" before any feature code.

**Testing consequence:** the installed `better-sqlite3` is built for Electron's ABI, so it cannot
load under vitest's Node (the same reason `node-pty` is never unit-tested). Therefore:
- `SearchService` (the ONLY better-sqlite3 importer) is kept thin and **e2e-tested only**.
- All real logic lives in **pure modules unit-tested under vitest** (no better-sqlite3 import):
  `segment-buffer.ts`, `prune-policy.ts`, `fts-query.ts`.

### New files

| File | Purpose |
|---|---|
| `src/main/search/segment-buffer.ts` | **Pure.** Per-pane output buffering → emits segments on idle/size/exit; ANSI-stripped; carries cwd; drops muted panes. |
| `src/main/search/prune-policy.ts` | **Pure.** Given current row count + cap, how many oldest rows to delete. |
| `src/main/search/fts-query.ts` | **Pure.** Sanitize a user query string into a safe FTS5 MATCH expression. |
| `src/main/search/search-service.ts` | better-sqlite3 wrapper: schema, `insertSegments`, `query`, `stats`, `clear`, `close`. Thin. |
| `src/main/search/indexer.ts` | Impure glue: owns a `SegmentBuffer` per pane + cwd/muted maps + flush timers; calls `SearchService.insertSegments`. |
| `src/main/ipc/register-search.ts` | `search:query`/`search:stats` (invoke), `search:clear`/`search:setMuted` (send); returns a disposer that flushes + closes. |
| `src/renderer/components/SearchHistory.tsx` | The search modal. |
| `tests/main/segment-buffer.test.ts`, `prune-policy.test.ts`, `fts-query.test.ts` | Unit tests. |
| `tests/e2e/search-history.spec.ts` | End-to-end. |

### Touched files

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `SearchHit`/`SearchStats`; add `historyMuted?: boolean` to `TerminalConfig`; bump `SCHEMA_VERSION` 5→6. |
| `src/shared/ipc-contract.ts` | `search:query`/`search:stats`/`search:clear`/`search:setMuted` + `TermhallaApi` methods. |
| `src/preload/index.ts` | Expose the four search methods. |
| `src/main/services.ts` | Construct `SearchService` (+ `Indexer`?) — see note; add to `Services`. |
| `src/main/ipc/register-pty.ts` | Add `indexer.data(id, data)` to the onData fan-out; forward cwd + pane-exit to the indexer; register/flush on exit. |
| `src/main/ipc/register.ts` | Compose `registerSearch`; add its disposer. |
| `src/renderer/store.ts` / `store/types.ts` | `revealPaneFromSearch(paneId)` + `relaunchFromSearch(cwd)` actions; search-modal open state. |
| `src/renderer/App.tsx` | Mount `SearchHistory`; dispatch `toggle-search` (Ctrl+Shift+F). |
| `src/renderer/components/StatusBar.tsx` | A 🔍 `search-toggle` button (mirrors the notepad 📝). |
| `src/shared/keybindings.ts` | `toggle-search` command (Ctrl+Shift+F — verified free). |
| `src/renderer/components/PaneToolbar.tsx` | A per-terminal history-mute toggle (🔇/📖) — see UI. |
| `package.json` | Add `better-sqlite3` (+ `@types/better-sqlite3`). |
| `electron-builder.yml` | `asarUnpack` better-sqlite3. |

**Services note:** `SearchService` is constructed in `buildServices()` (opens the DB). The `Indexer`
needs the `SearchService` and is constructed where the onData wiring lives (`register-pty.ts`),
taking the service as a dep — keeping construction next to its single call site. The service is
added to `Services`; the indexer is local to register-pty.

## Data model

```ts
// src/shared/types.ts
export interface SearchHit {
  id: number
  paneId: string
  ts: number          // flush time (ms)
  cwd: string
  snippet: string     // FTS5 snippet() with the match marked
}
export interface SearchStats {
  segments: number
  oldest: number | null   // ts of oldest segment, or null when empty
}
// TerminalConfig gains: historyMuted?: boolean   // absent = indexed
export const SCHEMA_VERSION = 6   // was 5
```

```sql
-- search.db (WAL)
CREATE TABLE IF NOT EXISTS segments(
  id INTEGER PRIMARY KEY,
  paneId TEXT NOT NULL,
  ts INTEGER NOT NULL,
  cwd TEXT NOT NULL DEFAULT ''
);
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(text);  -- rowid pairs with segments.id
CREATE INDEX IF NOT EXISTS idx_segments_ts ON segments(ts);
```

A **segment** is one flush of consecutive output (not per-line, not whole-session). Insert writes
both tables in one transaction (`segments` row, then `segments_fts(rowid, text)`).

## Indexing, cwd, mute & retention

- **`segment-buffer.ts` (pure):** `class SegmentBuffer` (or pure functions) accumulating
  ANSI-stripped chunks per pane; `push(chunk, now)` returns a segment to flush when size ≥ 8 KB,
  else null; `flushDue(now)` returns a segment when ≥ ~1 s since last output; `end()` flushes the
  remainder. Each emitted segment = `{ text, ts, cwd }`. Empty/whitespace-only segments are dropped.
- **cwd:** the `Indexer` tracks each pane's latest cwd from the engine `onCwd` signal (already
  forwarded to the git service as a `register-pty` hook — forward to the indexer too). The segment
  is tagged with the cwd current at flush.
- **mute:** `Indexer` holds a muted `Set<paneId>`; `setMuted(paneId, muted)` updates it; muted
  panes drop incoming data and don't buffer/flush. The renderer calls `search:setMuted` on terminal
  mount (reading persisted `config.historyMuted`) and on toggle.
- **flush timing:** the `Indexer` runs a single low-frequency interval (~500 ms, `unref`'d) calling
  `flushDue(now)` for each active buffer, plus immediate flush on size and on pane exit. Inserts are
  batched per tick in one transaction.
- **retention:** after each insert batch, `prune-policy.ts` computes how many oldest rows exceed the
  cap (default **50,000** segments) and `SearchService` deletes them (segments + fts) in the same
  transaction. `search:stats` returns `{ segments, oldest }`; `search:clear` truncates both tables.

## Search UI & actions

A dedicated **`SearchHistory`** modal (`Modal`, portaled), opened by **Ctrl+Shift+F** and a
status-bar 🔍 button (`search-toggle`, mirroring the notepad's 📝 toggle — avoids coupling into the
command-palette items module; a palette entry is a later follow-up):
- Input `search-input` → debounced `api.searchQuery(q)` (q → `fts-query.ts` → safe MATCH; bm25 rank).
- Each result `search-result-<i>`: cwd basename + relative time, the `snippet()` with the match
  highlighted, and a source indicator (pane open vs gone).
- **Reveal** (`search-reveal-<i>`): if `paneId` still exists in some workspace →
  `revealPaneFromSearch(paneId)` = `setActive(wsId)` + `setFocusedPane(paneId)`.
- **Relaunch** (`search-relaunch-<i>`): open a new terminal at the hit's `cwd` via `commitPane`
  (default shell). Shown when the source pane no longer exists; also always available as a fallback.
- Footer: `N segments · oldest <date>` (from `search:stats`) + a **Clear history** button
  (`search-clear`). Surfaces what's retained so the cap/clear isn't silent.

**Mute toggle** in `PaneToolbar`: a small button (`history-mute-<paneId>`) toggling
`config.historyMuted` via `updatePaneConfig` + `api.searchSetMuted`. Icon reflects state
(indexed vs muted). Tooltip explains "Exclude this terminal from search history."

## Error handling & edges

- better-sqlite3 fails to load / DB open error → `SearchService` enters a no-op disabled mode
  (query returns `[]`, stats `{segments:0,oldest:null}`, inserts dropped); the app never crashes and
  the rest of the terminal works. Logged once.
- A pane exits → flush its buffer, then drop its buffer/cwd/muted entries.
- Reveal when the pane is gone (closed or different session) → fall back to Relaunch.
- Huge single bursts → size-flush at 8 KB bounds segment size and memory.
- Muted pane → nothing indexed; its buffer is never created.

## Testing

### Unit (vitest, no better-sqlite3)
- `segment-buffer.test.ts` — flush on size, flush on idle, end() flushes remainder, ANSI stripped,
  cwd carried, empty dropped, muted-pane path produces nothing.
- `prune-policy.test.ts` — below cap → 0; above cap → exact overage; boundary.
- `fts-query.test.ts` — plain words → quoted/AND MATCH; special chars (`"`, `*`, `(`) sanitized so
  no FTS syntax error; empty query → no match / handled.

### E2E (Playwright, real app + real better-sqlite3)
1. Type a unique marker, wait for flush, open search (Ctrl+Shift+F), query it → ranked hit visible.
2. Click Reveal → the source terminal's pane is focused.
3. Mute a terminal, type a second marker, search → NOT found.
4. Relaunch from a hit → a new terminal opens at the hit's cwd.
5. Relaunch the app → the index persists (the first marker is still findable).

## Non-goals (v1)

- No per-command segmentation via OSC 133 (idle/size segmenting only) — could refine later.
- No regex search in the UI (FTS5 MATCH only); no time-range filters.
- No cross-machine sync; index is local.
- No indexing of input/keystrokes — ever (privacy boundary).
- No storing shell id for relaunch (relaunch uses the default shell at the hit's cwd).
