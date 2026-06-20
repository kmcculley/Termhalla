import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EditorDraft } from '@shared/types'
import { atomicWrite, atomicWriteSync } from './atomic-write'

type DraftMap = Record<string, EditorDraft>

/** Drop any entry that is not a well-formed { content: string, baseline: string }. */
function sanitize(value: unknown): DraftMap {
  const out: DraftMap = {}
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const e = v as Partial<EditorDraft>
      if (e && typeof e.content === 'string' && typeof e.baseline === 'string') {
        out[k] = { content: e.content, baseline: e.baseline }
      }
    }
  }
  return out
}

/** Persists unsaved editor buffers (hot-exit) to editor-drafts.json in userData.
 *  Writes are best-effort and never throw into the editing path. */
export class DraftStore {
  private map: DraftMap = {}

  constructor(private readonly baseDir: string) {}

  private file() { return join(this.baseDir, 'editor-drafts.json') }

  async load(): Promise<DraftMap> {
    try { this.map = sanitize(JSON.parse(await readFile(this.file(), 'utf8'))) }
    catch { this.map = {} }
    return this.map
  }

  set(key: string, draft: EditorDraft): void {
    this.map[key] = { content: draft.content, baseline: draft.baseline }
    void this.persist()
  }

  delete(key: string): void {
    if (!(key in this.map)) return
    delete this.map[key]
    void this.persist()
  }

  /** Synchronous write for shutdown (win 'close'); best-effort. */
  flush(): void {
    try { atomicWriteSync(this.file(), JSON.stringify(this.map)) }
    catch { /* best-effort on teardown */ }
  }

  private async persist(): Promise<void> {
    try { await atomicWrite(this.file(), JSON.stringify(this.map)) }
    catch { /* best-effort */ }
  }
}
