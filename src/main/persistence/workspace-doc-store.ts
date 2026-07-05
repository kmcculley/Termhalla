import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteSync } from './atomic-write'

type DocPaths = Record<string, string>

/** Keep only string→string entries (a hand-edited/corrupt file must never inject a non-string path). */
function sanitize(value: unknown): DocPaths {
  const out: DocPaths = {}
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v
    }
  }
  return out
}

/** Remembers which portable `.thws` file each workspace was opened-from / last saved-as, keyed by
 *  workspace id, in `workspace-docs.json` under userData. This is what lets File ▸ Save overwrite
 *  the bound document (instead of re-prompting) across relaunches. Pure config — a filesystem path,
 *  never a secret. Best-effort like NotesStore/DraftStore: a failed read/write never throws into a
 *  save path (the internal per-workspace record is still the durable source of truth). */
export class WorkspaceDocStore {
  private map: DocPaths = {}

  constructor(private readonly baseDir: string) {}

  private file() { return join(this.baseDir, 'workspace-docs.json') }

  async load(): Promise<DocPaths> {
    try { this.map = sanitize(JSON.parse(await readFile(this.file(), 'utf8'))) }
    catch { this.map = {} }
    return this.map
  }

  all(): DocPaths { return { ...this.map } }

  set(workspaceId: string, path: string): void {
    if (!workspaceId || !path) return
    if (this.map[workspaceId] === path) return
    this.map[workspaceId] = path
    this.flush()
  }

  clear(workspaceId: string): void {
    if (!(workspaceId in this.map)) return
    delete this.map[workspaceId]
    this.flush()
  }

  /** Synchronous write for shutdown; best-effort. */
  flush(): void {
    try { atomicWriteSync(this.file(), JSON.stringify(this.map)) }
    catch { /* best-effort on teardown */ }
  }
}
