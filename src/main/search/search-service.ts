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
