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

  /** Set (or, when text is empty/whitespace-only, delete) a project's note. */
  set(key: string, text: string): void {
    if (text.trim() === '') { if (!(key in this.map)) return; delete this.map[key] }
    else this.map[key] = text
    this.flush()
  }

  /** Synchronous write for shutdown (win 'close'); best-effort. */
  flush(): void {
    try { atomicWriteSync(this.file(), JSON.stringify(this.map)) }
    catch { /* best-effort on teardown */ }
  }

}
