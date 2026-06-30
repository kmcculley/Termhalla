import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from './atomic-write'

interface OnDiskShape { version?: unknown; roots?: unknown }

/** Coerce an untrusted/partial `roots` value into a well-formed, normalized list: non-string entries
 *  dropped, duplicates collapsed, codepoint-sorted. Used on both load (corrupt/partial file) and save
 *  (caller-supplied list) — mirrors `quick-store.ts`'s `normalizeQuick`. Entries are treated as OPAQUE
 *  strings here (no `path.resolve`/`path.normalize`) — path resolution against the real filesystem is
 *  `validateRegistryRoot`'s job, upstream of this store; the store itself is a dumb, deterministic list
 *  normalizer. */
function normalizeRoots(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : []
  const strings = arr.filter((v): v is string => typeof v === 'string')
  return [...new Set(strings)].sort()
}

/** The new, SELF-versioned persisted root list (`orky-registry.json` under Electron `userData`, REQ-013).
 *  Mirrors `QuickStore`'s normalize-on-load / normalize-on-write / atomic-write pattern exactly. The
 *  embedded `version: 1` is THIS file's own forward-migration counter — the global `SCHEMA_VERSION` (the
 *  app-state/workspace migration chain) is NOT touched; this file is not part of that chain. A
 *  missing/corrupt/partial file loads as an empty list, never throws (CONV-002). */
export class OrkyRegistryStore {
  constructor(private readonly baseDir: string) {}

  private file(): string { return join(this.baseDir, 'orky-registry.json') }

  async load(): Promise<string[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file(), 'utf8')) as OnDiskShape
      return normalizeRoots(parsed?.roots)
    } catch {
      return []
    }
  }

  async save(roots: string[]): Promise<void> {
    const normalized = normalizeRoots(roots)
    // Atomic (temp-then-rename, mirroring quick-store.ts): a killed write must not truncate
    // orky-registry.json into a corrupt one that silently loads as an empty list.
    await atomicWrite(this.file(), JSON.stringify({ version: 1, roots: normalized }, null, 2))
  }
}
