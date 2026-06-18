# Searchable Terminal Output History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-text search across current and past terminal output (SQLite FTS5), with reveal-in-pane / relaunch, on by default with a per-terminal mute.

**Architecture:** A main-side `SearchService` (better-sqlite3 + FTS5) fed by an `Indexer` consumer on the `onData` fan-out. Output is ANSI-stripped and buffered per pane into "segments" (flush on idle/size/exit), tagged with cwd, indexed, and pruned to a cap. A `SearchHistory` modal queries via `search:*` invoke IPC.

**Tech Stack:** Electron, TypeScript, React, zustand, better-sqlite3 (native), vitest, Playwright.

## Global Constraints

- **Path alias:** `@shared/...`.
- **Native module testing split (CRITICAL):** the installed `better-sqlite3` is built for Electron's ABI, so it CANNOT load under vitest's Node. Therefore: the ONLY file that imports `better-sqlite3` is `search-service.ts` (and `indexer.ts` which imports it transitively) — these are **never** imported by a vitest test; they are validated by e2e. ALL real logic is in pure modules unit-tested under vitest: `segment-buffer.ts`, `prune-policy.ts`, `fts-query.ts` (no better-sqlite3 import, directly or transitively).
- **`noUnusedLocals`/`noUnusedParameters` = true.**
- **`execFile`/long-lived resources abortable/closable:** the DB handle is closed on shutdown via the disposer wired into `wm.onAllWindowsClosed`.
- **ANSI strip before indexing:** reuse `stripAnsi` from `src/main/status/needs-input.ts`.
- **Privacy:** index OUTPUT ONLY, never input/keystrokes.
- **Persistence versioned:** `SCHEMA_VERSION` 5→6 (additive `historyMuted?`); `migrate` is identity for `<= SCHEMA_VERSION`, no migration code needed.
- **Keybinding:** `toggle-search` default Ctrl+Shift+F — verified free.
- **e2e is `workers: 1`; `npm run build` before `npm run e2e`.**

---

## Task 1: Add better-sqlite3 (native) + rebuild + asarUnpack

**Files:**
- Modify: `package.json` (dependency), `electron-builder.yml` (asarUnpack)

- [ ] **Step 1: Install the dependency**

Run: `npm install better-sqlite3 && npm install -D @types/better-sqlite3`

- [ ] **Step 2: Rebuild it for Electron's ABI**

Run: `npx electron-rebuild -f -w better-sqlite3`
Expected: rebuild succeeds (compiles the native binding for Electron's ABI). If it fails for missing build tools, that's the same toolchain `node-pty` already needs — see README → Native modules.

- [ ] **Step 3: Unpack the native binary from the asar**

In `electron-builder.yml`, extend `asarUnpack`:
```yaml
asarUnpack:
  - "**/node_modules/node-pty/**"
  - "**/node_modules/better-sqlite3/**"
  - "**/node_modules/bindings/**"
  - "**/node_modules/file-uri-to-path/**"
```
(`bindings`/`file-uri-to-path` are better-sqlite3's runtime deps for locating the `.node` file.)

- [ ] **Step 4: Verify build + typecheck**

Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds (electron-vite externalizes deps via `externalizeDepsPlugin`, so better-sqlite3 stays external/required at runtime, not bundled).

NOTE: better-sqlite3 actually LOADING under Electron is proven at Task 5 (app launch smoke) and Task 9 (e2e). It cannot be smoke-tested under vitest (ABI mismatch) — do not write a vitest test that imports it.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json electron-builder.yml
git commit -m "build(search): add better-sqlite3 (native) + rebuild + asarUnpack"
```

---

## Task 2: `segment-buffer.ts` (pure)

**Files:**
- Create: `src/main/search/segment-buffer.ts`
- Test: `tests/main/segment-buffer.test.ts`

**Interfaces:**
- Produces: `interface Segment { text: string; ts: number; cwd: string }`; `class SegmentBuffer` with `setCwd(cwd)`, `push(stripped, now): Segment | null`, `flushDue(now): Segment | null`, `end(): Segment | null`. Constants `SEGMENT_IDLE_MS = 1000`, `SEGMENT_MAX_BYTES = 8192`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/segment-buffer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SegmentBuffer, SEGMENT_MAX_BYTES } from '../../src/main/search/segment-buffer'

describe('SegmentBuffer', () => {
  it('flushes on idle and carries cwd + start ts', () => {
    const b = new SegmentBuffer('/proj')
    expect(b.push('hello ', 1000)).toBeNull()
    expect(b.push('world', 1100)).toBeNull()
    expect(b.flushDue(1500)).toBeNull()              // < idle
    const seg = b.flushDue(2200)                      // >= 1000ms since last push (1100)
    expect(seg).toEqual({ text: 'hello world', ts: 1000, cwd: '/proj' })
    expect(b.flushDue(9999)).toBeNull()               // buffer now empty
  })

  it('flushes immediately when size threshold is crossed', () => {
    const b = new SegmentBuffer('')
    const big = 'x'.repeat(SEGMENT_MAX_BYTES + 1)
    const seg = b.push(big, 50)
    expect(seg).not.toBeNull()
    expect(seg!.text.length).toBe(SEGMENT_MAX_BYTES + 1)
  })

  it('end() flushes the remainder, then nothing', () => {
    const b = new SegmentBuffer('/d')
    b.push('tail', 10)
    expect(b.end()).toEqual({ text: 'tail', ts: 10, cwd: '/d' })
    expect(b.end()).toBeNull()
  })

  it('drops empty/whitespace-only segments', () => {
    const b = new SegmentBuffer('')
    b.push('   \r\n', 1)
    expect(b.flushDue(5000)).toBeNull()
    expect(b.end()).toBeNull()
  })

  it('setCwd updates the cwd carried by the next segment', () => {
    const b = new SegmentBuffer('/a')
    b.push('x', 1)
    b.setCwd('/b')
    expect(b.end()).toEqual({ text: 'x', ts: 1, cwd: '/b' })
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run tests/main/segment-buffer.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `src/main/search/segment-buffer.ts`:
```ts
export interface Segment { text: string; ts: number; cwd: string }

export const SEGMENT_IDLE_MS = 1000
export const SEGMENT_MAX_BYTES = 8192

/** Pure per-pane output accumulator. The caller passes ANSI-stripped text. Emits a Segment when the
 *  buffer crosses the size threshold (push), has been idle long enough (flushDue), or the pane ends
 *  (end). Whitespace-only buffers produce no segment. No I/O, no timers. */
export class SegmentBuffer {
  private buf = ''
  private startTs = 0
  private lastTs = 0

  constructor(private cwd: string = '') {}

  setCwd(cwd: string): void { this.cwd = cwd }

  push(stripped: string, now: number): Segment | null {
    if (!this.buf) this.startTs = now
    this.buf += stripped
    this.lastTs = now
    return this.buf.length >= SEGMENT_MAX_BYTES ? this.take() : null
  }

  flushDue(now: number): Segment | null {
    return this.buf && now - this.lastTs >= SEGMENT_IDLE_MS ? this.take() : null
  }

  end(): Segment | null { return this.buf ? this.take() : null }

  private take(): Segment | null {
    const text = this.buf.trim()
    const ts = this.startTs
    this.buf = ''
    return text ? { text, ts, cwd: this.cwd } : null
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run tests/main/segment-buffer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/search/segment-buffer.ts tests/main/segment-buffer.test.ts
git commit -m "feat(search): pure per-pane segment buffer (idle/size/end flush)"
```

---

## Task 3: `prune-policy.ts` + `fts-query.ts` (pure)

**Files:**
- Create: `src/main/search/prune-policy.ts`, `src/main/search/fts-query.ts`
- Test: `tests/main/prune-policy.test.ts`, `tests/main/fts-query.test.ts`

**Interfaces:**
- Produces: `overage(count: number, cap: number): number`; `SEGMENT_CAP = 50000`; `toMatchExpr(query: string): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/prune-policy.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { overage, SEGMENT_CAP } from '../../src/main/search/prune-policy'

describe('overage', () => {
  it('is 0 at or below the cap', () => {
    expect(overage(0, 100)).toBe(0)
    expect(overage(100, 100)).toBe(0)
  })
  it('is the exact overage above the cap', () => {
    expect(overage(105, 100)).toBe(5)
  })
  it('exposes a sane default cap', () => {
    expect(SEGMENT_CAP).toBeGreaterThan(1000)
  })
})
```

Create `tests/main/fts-query.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toMatchExpr } from '../../src/main/search/fts-query'

describe('toMatchExpr', () => {
  it('quotes each token and ANDs them (implicit)', () => {
    expect(toMatchExpr('npm test')).toBe('"npm" "test"')
  })
  it('strips embedded double-quotes so the MATCH never has a syntax error', () => {
    expect(toMatchExpr('say "hi"')).toBe('"say" "hi"')
  })
  it('neutralizes FTS5 special chars by quoting', () => {
    // ( ) * : ^ - become literal inside double quotes
    expect(toMatchExpr('foo(bar)*')).toBe('"foo(bar)*"')
  })
  it('returns empty string for blank/whitespace input', () => {
    expect(toMatchExpr('   ')).toBe('')
    expect(toMatchExpr('')).toBe('')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/main/prune-policy.test.ts tests/main/fts-query.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `src/main/search/prune-policy.ts`:
```ts
/** Default max number of indexed segments before oldest are pruned. */
export const SEGMENT_CAP = 50000

/** How many oldest rows to delete to bring `count` back to `cap` (0 when within cap). */
export function overage(count: number, cap: number): number {
  return Math.max(0, count - cap)
}
```

Create `src/main/search/fts-query.ts`:
```ts
/** Turn a user's free-text query into a safe FTS5 MATCH expression. Each whitespace-delimited
 *  token is wrapped in double quotes (with embedded quotes stripped), so FTS5 special characters
 *  ( ) * : ^ - " become literal and can never produce a MATCH syntax error. Tokens are implicitly
 *  ANDed. Blank input returns '' (the caller treats '' as "no results"). */
export function toMatchExpr(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ''
  return tokens.map(t => `"${t.replace(/"/g, '')}"`).filter(t => t !== '""').join(' ')
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run tests/main/prune-policy.test.ts tests/main/fts-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/search/prune-policy.ts src/main/search/fts-query.ts tests/main/prune-policy.test.ts tests/main/fts-query.test.ts
git commit -m "feat(search): pure prune-policy + FTS5 query sanitizer"
```

---

## Task 4: types + `SearchService` (better-sqlite3)

**Files:**
- Modify: `src/shared/types.ts` (SearchHit/SearchStats, `historyMuted?`, SCHEMA_VERSION 6)
- Create: `src/main/search/search-service.ts`

**Interfaces:**
- Consumes: `Segment` (Task 2); `overage`/`SEGMENT_CAP` (Task 3); `toMatchExpr` (Task 3).
- Produces: `class SearchService` with `insertSegments(rows: Array<Segment & { paneId: string }>): void`, `query(q: string, limit?: number): SearchHit[]`, `stats(): SearchStats`, `clear(): void`, `close(): void`.

- [ ] **Step 1: Add the types**

In `src/shared/types.ts`:
```ts
export interface SearchHit {
  id: number
  paneId: string
  ts: number
  cwd: string
  snippet: string
}
export interface SearchStats {
  segments: number
  oldest: number | null
}
```
Add to `TerminalConfig`: `historyMuted?: boolean   // absent = indexed`.
Bump: `export const SCHEMA_VERSION = 6`.

- [ ] **Step 2: Implement `SearchService`** (no unit test — e2e-validated; ABI prevents vitest)

Create `src/main/search/search-service.ts`:
```ts
import Database from 'better-sqlite3'
import type { Segment } from './segment-buffer'
import type { SearchHit, SearchStats } from '@shared/types'
import { overage, SEGMENT_CAP } from './prune-policy'
import { toMatchExpr } from './fts-query'

type Row = Segment & { paneId: string }

/** SQLite (better-sqlite3) FTS5 index of terminal output segments. Thin: all decisions live in the
 *  pure modules (segment-buffer / prune-policy / fts-query). If the native module or DB fails to
 *  open, the service runs DISABLED (queries empty, inserts dropped) so the app never crashes. */
export class SearchService {
  private db: Database.Database | null = null

  constructor(dbPath: string, private readonly cap = SEGMENT_CAP) {
    try {
      const db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      db.exec(`
        CREATE TABLE IF NOT EXISTS segments(
          id INTEGER PRIMARY KEY, paneId TEXT NOT NULL, ts INTEGER NOT NULL, cwd TEXT NOT NULL DEFAULT ''
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(text);
        CREATE INDEX IF NOT EXISTS idx_segments_ts ON segments(ts);
      `)
      this.db = db
    } catch (e) {
      this.db = null
      console.error('[search] disabled — failed to open index:', (e as Error).message)
    }
  }

  insertSegments(rows: Row[]): void {
    const db = this.db; if (!db || rows.length === 0) return
    const insMeta = db.prepare('INSERT INTO segments(paneId, ts, cwd) VALUES (?, ?, ?)')
    const insText = db.prepare('INSERT INTO segments_fts(rowid, text) VALUES (?, ?)')
    const tx = db.transaction((items: Row[]) => {
      for (const r of items) {
        const info = insMeta.run(r.paneId, r.ts, r.cwd)
        insText.run(info.lastInsertRowid as number, r.text)
      }
      const count = (db.prepare('SELECT count(*) AS n FROM segments').get() as { n: number }).n
      const drop = overage(count, this.cap)
      if (drop > 0) {
        const ids = db.prepare('SELECT id FROM segments ORDER BY ts ASC LIMIT ?').all(drop) as { id: number }[]
        const delMeta = db.prepare('DELETE FROM segments WHERE id = ?')
        const delText = db.prepare('DELETE FROM segments_fts WHERE rowid = ?')
        for (const { id } of ids) { delMeta.run(id); delText.run(id) }
      }
    })
    try { tx(rows) } catch (e) { console.error('[search] insert failed:', (e as Error).message) }
  }

  query(q: string, limit = 50): SearchHit[] {
    const db = this.db; if (!db) return []
    const match = toMatchExpr(q)
    if (!match) return []
    try {
      const rows = db.prepare(`
        SELECT s.id AS id, s.paneId AS paneId, s.ts AS ts, s.cwd AS cwd,
               snippet(segments_fts, 0, '[', ']', '…', 12) AS snippet
        FROM segments_fts JOIN segments s ON s.id = segments_fts.rowid
        WHERE segments_fts MATCH ? ORDER BY bm25(segments_fts) LIMIT ?
      `).all(match, limit) as SearchHit[]
      return rows
    } catch (e) { console.error('[search] query failed:', (e as Error).message); return [] }
  }

  stats(): SearchStats {
    const db = this.db; if (!db) return { segments: 0, oldest: null }
    try {
      const n = (db.prepare('SELECT count(*) AS n FROM segments').get() as { n: number }).n
      const o = (db.prepare('SELECT min(ts) AS o FROM segments').get() as { o: number | null }).o
      return { segments: n, oldest: o ?? null }
    } catch { return { segments: 0, oldest: null } }
  }

  clear(): void {
    const db = this.db; if (!db) return
    try { db.exec('DELETE FROM segments; DELETE FROM segments_fts;') } catch { /* best-effort */ }
  }

  close(): void { try { this.db?.close() } catch { /* ignore */ } this.db = null }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/shared/types.ts src/main/search/search-service.ts
git commit -m "feat(search): SearchService (better-sqlite3 FTS5) + types, schema 5->6"
```

---

## Task 5: `Indexer` + services + register-pty wiring (+ app-launch smoke)

**Files:**
- Create: `src/main/search/indexer.ts`
- Modify: `src/main/services.ts` (construct `SearchService`, add to `Services`)
- Modify: `src/main/ipc/register.ts` (construct `Indexer`, pass to registerPty, dispose)
- Modify: `src/main/ipc/register-pty.ts` (wire `indexer.data` into onData; `setCwd`/`remove` on cwd/exit)

**Interfaces:**
- Consumes: `SearchService` (Task 4); `SegmentBuffer` (Task 2); `stripAnsi` (`../status/needs-input`).
- Produces: `class Indexer` with `data(id, raw)`, `setCwd(id, cwd)`, `setMuted(id, muted)`, `remove(id)`, `dispose()`.

- [ ] **Step 1: Implement `Indexer`** (e2e-validated; imports SearchService → not unit-tested)

Create `src/main/search/indexer.ts`:
```ts
import { stripAnsi } from '../status/needs-input'
import { SegmentBuffer } from './segment-buffer'
import type { SearchService } from './search-service'

/** Owns a per-pane SegmentBuffer + cwd/muted maps; feeds flushed segments to SearchService. One
 *  shared low-frequency timer flushes idle buffers; size-flush is immediate; pane exit flushes the
 *  remainder. Muted panes drop all data. */
export class Indexer {
  private buffers = new Map<string, SegmentBuffer>()
  private cwds = new Map<string, string>()
  private muted = new Set<string>()
  private timer: ReturnType<typeof setInterval>

  constructor(private readonly svc: SearchService, private readonly now: () => number = () => Date.now()) {
    this.timer = setInterval(() => this.tick(), 500)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  setCwd(id: string, cwd: string): void { this.cwds.set(id, cwd); this.buffers.get(id)?.setCwd(cwd) }

  setMuted(id: string, muted: boolean): void {
    if (muted) { this.muted.add(id); this.buffers.delete(id) } else this.muted.delete(id)
  }

  data(id: string, raw: string): void {
    if (this.muted.has(id)) return
    let b = this.buffers.get(id)
    if (!b) { b = new SegmentBuffer(this.cwds.get(id) ?? ''); this.buffers.set(id, b) }
    const seg = b.push(stripAnsi(raw), this.now())
    if (seg) this.svc.insertSegments([{ paneId: id, ...seg }])
  }

  remove(id: string): void {
    const seg = this.buffers.get(id)?.end()
    if (seg) this.svc.insertSegments([{ paneId: id, ...seg }])
    this.buffers.delete(id); this.cwds.delete(id); this.muted.delete(id)
  }

  dispose(): void {
    clearInterval(this.timer)
    for (const [id, b] of this.buffers) { const seg = b.end(); if (seg) this.svc.insertSegments([{ paneId: id, ...seg }]) }
    this.buffers.clear()
  }

  private tick(): void {
    const t = this.now()
    const out: Array<{ paneId: string; text: string; ts: number; cwd: string }> = []
    for (const [id, b] of this.buffers) { const seg = b.flushDue(t); if (seg) out.push({ paneId: id, ...seg }) }
    if (out.length) this.svc.insertSegments(out)
  }
}
```

- [ ] **Step 2: Construct `SearchService` in services**

In `src/main/services.ts`:

Add imports:
```ts
import { SearchService } from './search/search-service'
```

Add to the `Services` interface: `searchService: SearchService`.

In `buildServices()`, construct it (after `scriptDir`):
```ts
  const searchService = new SearchService(join(dir, 'search.db'))
```
and include `searchService` in the returned object.

- [ ] **Step 3: Construct `Indexer` and wire it (register.ts)**

In `src/main/ipc/register.ts`:

Add imports:
```ts
import { Indexer } from '../search/indexer'
import { registerSearch } from './register-search'   // created in Task 6
```

Destructure `searchService` from services:
```ts
  const { store, quick, shells, recorder, envVault, scriptDir, dir, searchService } = services
```

Construct the indexer and pass it to `registerPty` (extend the deps object):
```ts
  const indexer = new Indexer(searchService)
  const pty = registerPty(win, {
    shells, recorder, envVault, scriptDir, send, indexer,
    claimPane: (id, sender) => wm.claimPane(id, sender),
    replayInto: (id) => wm.replayInto(id),
    onCwd: (id, cwd) => { void git.setCwd(id, cwd) },
    onCommandDone: (id) => git.onCommandDone(id),
    onPaneGone: (id) => git.removePane(id)
  })
```

Add the search registrar + disposer (Task 6 creates `registerSearch`; for now add the line so wiring is complete):
```ts
  const disposeSearch = registerSearch({ searchService, indexer, send })
```
and add `disposeSearch` to the `disposers` array.

- [ ] **Step 4: Wire the indexer into register-pty**

In `src/main/ipc/register-pty.ts`:

Add to the deps type:
```ts
    indexer: import('../search/indexer').Indexer
```

Add `indexer.data` to the onData fan-out (the PtyManager construction):
```ts
  const pty = new PtyManager(
    (id, data) => { send(CH.ptyData, id, data); recorder.data(id, data); deps.indexer.data(id, data) },
    (id, code) => { send(CH.ptyExit, id, code); tracker.unregister(id); ai.unregister(id); recorder.stop(id); send(CH.recState, id, { recording: false, file: null }); deps.onPaneGone?.(id); deps.indexer.remove(id) },
    engine, scriptDir
  )
```

Add `indexer.setCwd` to the engine cwd callback:
```ts
    (id, cwd) => { send(CH.ptyCwd, id, cwd); deps.onCwd?.(id, cwd); deps.indexer.setCwd(id, cwd) },
```

Add `indexer.remove` to the `ptyKill` handler:
```ts
  ipcMain.on(CH.ptyKill, (_e, id: string) => { pty.kill(id); tracker.unregister(id); ai.unregister(id); deps.onPaneGone?.(id); deps.indexer.remove(id) })
```

- [ ] **Step 5: Typecheck, build, and app-launch smoke (proves better-sqlite3 loads under Electron)**

Run: `npm run typecheck` → clean (note: `registerSearch` must exist — if doing tasks in order, stub it minimally or do Task 6 first; recommended: do Task 6 immediately after this step before building).

After Task 6 is in place (so `registerSearch` exists), run:
Run: `npm run build` → succeeds.
Run: `npm run e2e -- cwd` → the existing cwd spec passes, proving the app LAUNCHES with `SearchService` constructed in the main process (i.e. better-sqlite3 loaded under Electron's ABI). If the app fails to launch, the native rebuild (Task 1) is wrong — fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/main/search/indexer.ts src/main/services.ts src/main/ipc/register.ts src/main/ipc/register-pty.ts
git commit -m "feat(search): Indexer wired into onData fan-out + DB lifecycle"
```

---

## Task 6: IPC (contract, preload, register-search) + store mute sync

**Files:**
- Modify: `src/shared/ipc-contract.ts` (channels + `TermhallaApi`)
- Modify: `src/preload/index.ts` (expose)
- Create: `src/main/ipc/register-search.ts`

**Interfaces:**
- Consumes: `SearchService` + `Indexer`.
- Produces: `CH.searchQuery/searchStats/searchClear/searchSetMuted`; `TermhallaApi.searchQuery/searchStats/searchClear/searchSetMuted`; `registerSearch(deps): Disposer`.

- [ ] **Step 1: Contract**

In `src/shared/ipc-contract.ts`:

Import `SearchHit, SearchStats` in the types import.

Add to `CH`:
```ts
  searchQuery: 'search:query',
  searchStats: 'search:stats',
  searchClear: 'search:clear',
  searchSetMuted: 'search:setMuted',
```

Add to `TermhallaApi`:
```ts
  searchQuery(q: string): Promise<SearchHit[]>
  searchStats(): Promise<SearchStats>
  searchClear(): Promise<SearchStats>
  searchSetMuted(paneId: string, muted: boolean): void
```

- [ ] **Step 2: Preload**

In `src/preload/index.ts`:
```ts
  searchQuery: (q) => ipcRenderer.invoke(CH.searchQuery, q),
  searchStats: () => ipcRenderer.invoke(CH.searchStats),
  searchClear: () => ipcRenderer.invoke(CH.searchClear),
  searchSetMuted: (paneId, muted) => ipcRenderer.send(CH.searchSetMuted, paneId, muted),
```

- [ ] **Step 3: Registrar**

Create `src/main/ipc/register-search.ts`:
```ts
import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { SearchService } from '../search/search-service'
import type { Indexer } from '../search/indexer'
import type { Disposer } from './types'

/** Search IPC: query/stats/clear (invoke, request→response) + setMuted (send). Returns a disposer
 *  that flushes pending segments (indexer.dispose) and closes the DB on shutdown. */
export function registerSearch(deps: { searchService: SearchService; indexer: Indexer }): Disposer {
  const { searchService, indexer } = deps
  ipcMain.handle(CH.searchQuery, (_e, q: string) => searchService.query(q))
  ipcMain.handle(CH.searchStats, () => searchService.stats())
  ipcMain.handle(CH.searchClear, () => { searchService.clear(); return searchService.stats() })
  ipcMain.on(CH.searchSetMuted, (_e, paneId: string, muted: boolean) => indexer.setMuted(paneId, muted))
  return () => { indexer.dispose(); searchService.close() }
}
```
(NOTE: `registerSearch`'s deps drop `send` — it isn't needed. Update the Task 5 `registerSearch({ searchService, indexer, send })` call to `registerSearch({ searchService, indexer })`.)

- [ ] **Step 4: Typecheck + build + commit**

Run: `npm run typecheck` → clean. Run: `npm run build` → succeeds.

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/register-search.ts src/main/ipc/register.ts
git commit -m "feat(search): search:* IPC (query/stats/clear/setMuted)"
```

---

## Task 7: renderer store actions + keybinding + statusbar + App mount

**Files:**
- Modify: `src/renderer/store/types.ts` (state + actions)
- Create: `src/renderer/store/search-slice.ts`
- Modify: `src/renderer/store.ts` (compose + initial state)
- Modify: `src/shared/keybindings.ts` (`toggle-search`)
- Modify: `src/renderer/App.tsx` (mount + keydown)
- Modify: `src/renderer/components/StatusBar.tsx` (🔍 button)
- Test: `tests/renderer/search-slice.test.ts`

**Interfaces:**
- Produces: state `searchOpen: boolean`; actions `setSearchOpen`, `revealPaneFromSearch(paneId)`, `relaunchFromSearch(cwd)`.

- [ ] **Step 1: Write the failing slice test**

Create `tests/renderer/search-slice.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/renderer/api', () => ({ api: {} }))
import { createSearchSlice } from '../../src/renderer/store/search-slice'

function harness(initial: any = {}) {
  let state: any = { searchOpen: false, activeId: null, focusedPaneId: null, workspaces: {}, ...initial }
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  const slice = createSearchSlice({ set, get } as any)
  return { slice, get, set: (p: any) => set(p) }
}

describe('search slice', () => {
  it('setSearchOpen toggles the modal', () => {
    const { slice, get } = harness()
    slice.setSearchOpen(true)
    expect(get().searchOpen).toBe(true)
  })
  it('revealPaneFromSearch activates the pane\'s workspace + focuses it', () => {
    const setActive = vi.fn(); const setFocusedPane = vi.fn()
    const { slice } = harness({
      workspaces: { w1: { id: 'w1', panes: { p1: { paneId: 'p1', config: { kind: 'terminal' } } } } },
      setActive, setFocusedPane
    })
    slice.revealPaneFromSearch('p1')
    expect(setActive).toHaveBeenCalledWith('w1')
    expect(setFocusedPane).toHaveBeenCalledWith('p1')
  })
  it('revealPaneFromSearch no-ops for an unknown pane', () => {
    const setActive = vi.fn()
    const { slice } = harness({ setActive })
    slice.revealPaneFromSearch('ghost')
    expect(setActive).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run tests/renderer/search-slice.test.ts` → FAIL (module missing).

- [ ] **Step 3: Create the slice**

Create `src/renderer/store/search-slice.ts`:
```ts
import { firstTarget } from './pane-ops'
import { defaultShellId } from './pane-ops'
import type { State, SliceDeps } from './types'

type SearchSlice = Pick<State, 'setSearchOpen' | 'revealPaneFromSearch' | 'relaunchFromSearch'>

/** Search-history UI state + the two result actions: reveal (focus the source pane if it still
 *  exists) and relaunch (open a fresh terminal at the hit's cwd). */
export function createSearchSlice({ set, get }: SliceDeps): SearchSlice {
  return {
    setSearchOpen: (open) => set({ searchOpen: open }),

    revealPaneFromSearch: (paneId) => {
      const s = get()
      const wsId = Object.keys(s.workspaces).find(id => s.workspaces[id]?.panes[paneId])
      if (!wsId) return
      s.setActive(wsId)
      s.setFocusedPane(paneId)
      set({ searchOpen: false })
    },

    relaunchFromSearch: (cwd) => {
      const s = get()
      const wsId = s.activeId
      if (!wsId) return
      const ws = s.workspaces[wsId]
      s.commitPaneTerminal(wsId, cwd, firstTarget(ws))   // see note
      set({ searchOpen: false })
    }
  }
}
```
NOTE on `relaunchFromSearch`: `commitPane` is a store-internal closure, not a `State` action, so the slice can't call it. Instead, reuse the existing public `addTerminal`-style path. Implement relaunch as: read `defaultShellId(s)`, then call the existing store action that opens a terminal with a cwd. The cleanest existing public action is `launchDir(cwd)` (quick-slice) which does exactly "open a terminal at a dir in the active workspace". **Replace the `relaunchFromSearch` body with:**
```ts
    relaunchFromSearch: (cwd) => {
      get().launchDir(cwd)
      set({ searchOpen: false })
    }
```
(Drop the now-unused `firstTarget`/`defaultShellId` imports.) Confirm `launchDir` exists on `State` (it does — quick-slice). This keeps the slice free of store-internal closures.

- [ ] **Step 4: State + deps types**

In `src/renderer/store/types.ts`, add to `State`:
```ts
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  revealPaneFromSearch: (paneId: string) => void
  relaunchFromSearch: (cwd: string) => void
```

- [ ] **Step 5: Compose + initial state**

In `src/renderer/store.ts`: import `createSearchSlice`; add `searchOpen: false` to initial state; add `...createSearchSlice(deps),` to the slice block.

- [ ] **Step 6: Keybinding**

In `src/shared/keybindings.ts`: add `'toggle-search'` to `CommandId` (and the `Shortcut` union if present); add to `COMMANDS`:
```ts
  { id: 'toggle-search', label: 'Search output history', category: 'General', defaultChord: c(true, true, 'f'), tip: 'search terminal output history' },
```

- [ ] **Step 7: App mount + keydown**

In `src/renderer/App.tsx`: import `SearchHistory` (Task 8); mount `<SearchHistory />` near the other global overlays (after `<CommandPalette />`); add keydown case:
```ts
        case 'toggle-search': s.setSearchOpen(!s.searchOpen); break
```

- [ ] **Step 8: StatusBar button**

In `src/renderer/components/StatusBar.tsx`, add next to the notes 📝 button (after the spacer):
```tsx
      <button data-testid="search-toggle" type="button" title="Search output history (Ctrl+Shift+F)"
        onClick={() => useStore.getState().setSearchOpen(true)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--fg-dim, #aaa)', padding: 0 }}>🔍</button>
```

- [ ] **Step 9: Run slice test + typecheck**

Run: `npx vitest run tests/renderer/search-slice.test.ts` → PASS.
Run: `npm run typecheck` → clean (NOTE: `SearchHistory` import resolves once Task 8 creates it; do Task 8 before typecheck/build, or temporarily comment the import+mount).

- [ ] **Step 10: Commit** (after Task 8 if needed for a clean typecheck)

```bash
git add src/renderer/store/search-slice.ts src/renderer/store/types.ts src/renderer/store.ts src/shared/keybindings.ts src/renderer/App.tsx src/renderer/components/StatusBar.tsx tests/renderer/search-slice.test.ts
git commit -m "feat(search): store actions, toggle-search keybinding, statusbar button"
```

---

## Task 8: `SearchHistory` modal + per-terminal mute toggle

**Files:**
- Create: `src/renderer/components/SearchHistory.tsx`
- Modify: `src/renderer/components/PaneToolbar.tsx` (mute toggle)
- Modify: `src/renderer/components/TerminalPane.tsx` (sync persisted mute → main on mount)

**Interfaces:**
- Consumes: `api.searchQuery/searchStats/searchClear/searchSetMuted`; `revealPaneFromSearch`/`relaunchFromSearch`/`setSearchOpen`; `updatePaneConfig`.

- [ ] **Step 1: Create the modal**

Create `src/renderer/components/SearchHistory.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import type { SearchHit, SearchStats } from '@shared/types'
import { Modal, Z } from './Modal'

function baseName(p: string): string { const a = p.split(/[\\/]/).filter(Boolean); return a[a.length - 1] ?? p }
function paneExists(workspaces: Record<string, { panes: Record<string, unknown> }>, paneId: string): boolean {
  return Object.values(workspaces).some(ws => paneId in ws.panes)
}

export function SearchHistory() {
  const open = useStore(s => s.searchOpen)
  const setOpen = useStore(s => s.setSearchOpen)
  const reveal = useStore(s => s.revealPaneFromSearch)
  const relaunch = useStore(s => s.relaunchFromSearch)
  const workspaces = useStore(s => s.workspaces)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [stats, setStats] = useState<SearchStats>({ segments: 0, oldest: null })

  useEffect(() => { if (open) void api.searchStats().then(setStats) }, [open])
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { void api.searchQuery(q).then(setHits) }, 200)
    return () => clearTimeout(t)
  }, [q, open])

  if (!open) return null
  return (
    <Modal onClose={() => setOpen(false)} align="top" z={Z.palette}
      backdropTestId="search-backdrop" cardTestId="search-history" card={{ width: 640, maxHeight: '70vh', gap: 0 }}>
      <input data-testid="search-input" autoFocus value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search terminal output…"
        style={{ padding: 10, border: 'none', borderBottom: '1px solid var(--border, #444)', background: 'transparent', color: 'var(--fg, #eee)', fontSize: 14 }} />
      <div style={{ overflowY: 'auto' }}>
        {hits.length === 0 && q.trim() !== '' && <div style={{ padding: 10, color: 'var(--fg-dim, #aaa)' }}>No matches.</div>}
        {hits.map((h, i) => (
          <div key={h.id} data-testid={`search-result-${i}`}
            style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #333)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 11, color: 'var(--fg-dim, #aaa)', display: 'flex', gap: 8 }}>
              <span>{h.cwd ? baseName(h.cwd) : '—'}</span>
              <span style={{ flex: 1 }} />
              {paneExists(workspaces, h.paneId)
                ? <button data-testid={`search-reveal-${i}`} onClick={() => reveal(h.paneId)}>Reveal</button>
                : <button data-testid={`search-relaunch-${i}`} onClick={() => relaunch(h.cwd)}>Relaunch</button>}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{h.snippet}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border, #444)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--fg-dim, #aaa)' }}>
        <span data-testid="search-stats">{stats.segments} segments{stats.oldest ? ` · oldest ${new Date(stats.oldest).toLocaleDateString()}` : ''}</span>
        <span style={{ flex: 1 }} />
        <button data-testid="search-clear" onClick={() => { void api.searchClear().then(setStats); setHits([]) }}>Clear history</button>
      </div>
    </Modal>
  )
}
```
(If `Z` or `Modal`'s `align`/`z` props differ, mirror `CommandPalette.tsx`'s `Modal` usage exactly.)

- [ ] **Step 2: Per-terminal mute toggle in the toolbar**

In `src/renderer/components/PaneToolbar.tsx`, the toolbar needs the pane's `historyMuted` and a toggle. The component currently receives `wsId`/`paneId`/`isTerminal`/etc. Add the mute button inside the `isTerminal` block; read the muted flag via the store and toggle both config + main:
```tsx
          <button type="button" data-testid={`history-mute-${paneId}`}
            title={historyMuted ? 'Output history muted — click to index' : 'Indexing output history — click to mute'}
            onClick={() => {
              const next = !historyMuted
              updatePaneConfig(wsId, paneId, { historyMuted: next || undefined })
              api.searchSetMuted(paneId, next)
            }}>{historyMuted ? '🔇' : '📖'}</button>
```
Add the needed reads at the top of `PaneToolbar` (it already imports `useStore`/`api`):
```tsx
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const historyMuted = useStore(s => {
    const cfg = s.workspaces[wsId]?.panes[paneId]?.config
    return cfg?.kind === 'terminal' ? !!cfg.historyMuted : false
  })
```

- [ ] **Step 3: Sync persisted mute → main on terminal mount**

In `src/renderer/components/TerminalPane.tsx`, after the spawn call in the mount effect, sync the persisted mute so the indexer respects it from the first byte:
```ts
    api.searchSetMuted(paneId, !!config.historyMuted)
```
(Place it right after the `api.ptySpawn({...})` call. It's idempotent and cheap.)

- [ ] **Step 4: Typecheck + build + commit**

Run: `npm run typecheck` → clean. Run: `npm run build` → succeeds.

```bash
git add src/renderer/components/SearchHistory.tsx src/renderer/components/PaneToolbar.tsx src/renderer/components/TerminalPane.tsx
git commit -m "feat(search): SearchHistory modal + per-terminal history mute"
```

---

## Task 9: End-to-end test

**Files:**
- Create: `tests/e2e/search-history.spec.ts`

- [ ] **Step 1: Build**

Run: `npm run build` → success.

- [ ] **Step 2: Write the e2e**

Create `tests/e2e/search-history.spec.ts`:
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('indexes output, finds it, reveals the pane, respects mute, and persists', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-search-'))
  const launch = () => electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo idx-marker-7788')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('idx-marker-7788', { timeout: 15_000 })
  await win.waitForTimeout(1500)   // allow idle-flush + index write

  // Search finds it.
  await win.getByTestId('search-toggle').click()
  await win.getByTestId('search-input').fill('idx-marker-7788')
  await expect(win.getByTestId('search-result-0')).toContainText('idx-marker-7788', { timeout: 15_000 })
  // Reveal closes the modal (source pane exists).
  await win.getByTestId('search-reveal-0').click()
  await expect(win.getByTestId('search-history')).toHaveCount(0)

  // Mute the terminal, emit a second marker → not indexed.
  await win.locator('[data-testid^="history-mute-"]').first().click()
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo muted-marker-3311')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('muted-marker-3311', { timeout: 15_000 })
  await win.waitForTimeout(1500)
  await win.getByTestId('search-toggle').click()
  await win.getByTestId('search-input').fill('muted-marker-3311')
  await win.waitForTimeout(800)
  await expect(win.getByTestId('search-result-0')).toHaveCount(0)
  await win.keyboard.press('Escape')

  // Persist across relaunch: the first marker is still findable.
  const pid1 = app.process().pid; if (pid1) killTree(pid1)
  app = await launch(); win = await app.firstWindow()
  await win.getByTestId('search-toggle').click()
  await win.getByTestId('search-input').fill('idx-marker-7788')
  await expect(win.getByTestId('search-result-0')).toContainText('idx-marker-7788', { timeout: 20_000 })

  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})
```

- [ ] **Step 3: Run the e2e**

Run: `npm run e2e -- search-history`
Expected: PASS. This is the real proof that better-sqlite3 loads under Electron, the index writes, FTS query works, mute works, and the index persists. If the result never appears, check: native rebuild (Task 1), the onData wiring (Task 5), and that `search.db` is created under the temp userData dir.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/search-history.spec.ts
git commit -m "test(search): e2e index/find/reveal/mute/persist"
```

---

## Task 10: Docs

**Files:**
- Create: `docs/features/search-history.md`
- Modify: `CHANGELOG.md`, `CLAUDE.md` (Where things live + a native-module note), `docs/architecture.md` (persistence table: `search.db`; native modules note), `README.md` (native modules: add better-sqlite3 alongside node-pty)

- [ ] **Step 1: Feature doc**

Create `docs/features/search-history.md`: data flow (onData → Indexer → SegmentBuffer → SearchService FTS5; search:* IPC → SearchHistory), segmentation (idle/size/exit), cwd tagging, retention cap + clear, the on-by-default + per-terminal mute model, the privacy boundary (output-only, local, controls), reveal vs relaunch, the native-module + ABI-testing note (SearchService e2e-only; pure modules unit-tested), and non-goals. Match an existing `docs/features/*.md`.

- [ ] **Step 2: CHANGELOG + CLAUDE.md + architecture.md + README**

- CHANGELOG entry.
- CLAUDE.md "Where things live" row:
  `| Output search history | \`src/main/search/\` | [search-history](docs/features/search-history.md) |`
  and a one-line note under native modules that better-sqlite3 (like node-pty) needs electron-rebuild + asarUnpack.
- `docs/architecture.md`: add `search.db` to the persistence table; note better-sqlite3 as a second native module.
- `README.md` native-modules section: add better-sqlite3 next to node-pty (electron-rebuild required).

- [ ] **Step 3: Commit**

```bash
git add docs/features/search-history.md CHANGELOG.md CLAUDE.md docs/architecture.md README.md
git commit -m "docs(search): document searchable output history + native-module note"
```

---

## Self-Review

**Spec coverage:**
- better-sqlite3 FTS5 index fed from onData → Tasks 1,4,5. ✓
- ANSI-stripped segment buffering (idle/size/exit) → Task 2 (pure) + Task 5 (Indexer strips). ✓
- cwd tagging via onCwd → Task 5. ✓
- Retention cap + prune + clear + stats → Task 3 (pure) + Task 4 (SearchService). ✓
- On-by-default + per-terminal mute (persisted `historyMuted`, schema 6) → Tasks 4,6,8. ✓
- search:* invoke IPC → Task 6. ✓
- SearchHistory modal (Ctrl+Shift+F + 🔍), reveal/relaunch → Tasks 7,8. ✓
- Privacy: output-only (input never touched — the Indexer only consumes onData, not ptyWrite) → inherent; documented Task 10. ✓
- Native-module testing split (SearchService/Indexer e2e-only; segment-buffer/prune/fts pure unit) → enforced throughout; Global Constraints. ✓
- Tests: unit (segment-buffer, prune-policy, fts-query, search-slice) + e2e → Tasks 2,3,7,9. ✓

**Placeholder scan:** none. The two ordering notes (Task 5↔6 `registerSearch` existence; Task 7↔8 `SearchHistory` import) are explicit sequencing guidance with concrete resolutions, not placeholders. The `relaunchFromSearch` note resolves to the `launchDir` implementation explicitly.

**Type consistency:** `SearchHit`/`SearchStats` fields match across types.ts, SearchService SQL aliases (`id/paneId/ts/cwd/snippet`), IPC, and the UI. `Segment` (`text/ts/cwd`) matches between segment-buffer, Indexer (`{paneId, ...seg}`), and SearchService `Row`. Method names `query/stats/clear/close/insertSegments` and `data/setCwd/setMuted/remove/dispose` match across service/indexer/registrar/register-pty. Channels `searchQuery/searchStats/searchClear/searchSetMuted` match across contract/preload/registrar/UI. Test ids (`search-toggle/search-input/search-result-N/search-reveal-N/search-relaunch-N/search-stats/search-clear/history-mute-<id>/search-history`) match between Tasks 7,8,9.

**Sequencing note for the executor:** Tasks 5 and 6 are mutually referential (register.ts calls `registerSearch`; registerSearch is created in 6). Implement Task 5's code then Task 6 before running the build/e2e smoke at the end of Task 5/Task 6. Likewise Task 7's `SearchHistory` import resolves when Task 8 lands — do 7 then 8, typecheck/build after 8. The per-task commits still happen in order; only the build/typecheck gates that need both sit at the later task.
