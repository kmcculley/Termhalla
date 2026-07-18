import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteSync } from './atomic-write'

type NotesMap = Record<string, string>

/** Keep only string-valued entries. */
function sanitize(value: unknown): NotesMap {
  const out: NotesMap = {}
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  return out
}

/** Persists per-project notepad text to notes.json in userData, keyed by project key (git root or
 *  cwd). Writes are best-effort and never throw into the editing path; mirrors DraftStore. */
export class NotesStore {
  private map: NotesMap = {}

  constructor(private readonly baseDir: string) {}

  private file() { return join(this.baseDir, 'notes.json') }

  async load(): Promise<NotesMap> {
    try { this.map = sanitize(JSON.parse(await readFile(this.file(), 'utf8'))) }
    catch { this.map = {} }
    return this.map
  }

  /** Set (or, when text is empty/whitespace-only, delete) a project's note. Returns whether the
   *  change reached disk — the renderer keeps a failed key dirty and retries on the next flush
   *  instead of silently losing the note (2026-07-17 audit, Finding 6). */
  set(key: string, text: string): boolean {
    if (text.trim() === '') { if (!(key in this.map)) return true; delete this.map[key] }
    else this.map[key] = text
    return this.write()
  }

  /** Synchronous write for shutdown (win 'close'); best-effort. */
  flush(): void {
    this.write()
  }

  private write(): boolean {
    try { atomicWriteSync(this.file(), JSON.stringify(this.map)); return true }
    catch { return false }
  }

}
