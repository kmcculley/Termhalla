import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrkyActionPath } from '@shared/types'

/**
 * The append-only `orky-actions.jsonl` writer under Electron `userData` (feature 0007, TASK-005,
 * REQ-013). Mirrors `OrkyRegistryStore`'s "normalize + never throw" discipline for the
 * best-effort-never-fails contract, but is explicitly NOT atomic-rewrite (`fs.appendFile` only — a
 * rewrite could truncate the log, which REQ-013 forbids). No cap/rotation/truncation (CONV-003) — a
 * future feature may add one with a stated, tested policy; this module does not.
 *
 * The append function is INJECTABLE (mirrors `atomic-write.ts`'s `AtomicFs` dependency-injection
 * pattern) rather than `vi.spyOn`'ing a built-in `node:fs/promises` export.
 */

export type AppendFn = (file: string, line: string) => Promise<void>

export interface OrkyActionAuditRecord {
  ts: number
  windowId: number | null
  action: string
  projectRoot: string
  feature?: string
  argsSummary: Record<string, unknown>
  ok: boolean
  path: OrkyActionPath
  dispatched: boolean
  errorKind?: string
  exitCode?: number | null
}

const defaultAppend: AppendFn = (file, line) => appendFile(file, line, 'utf8')

export class OrkyActionAuditLog {
  private readonly file: string

  constructor(baseDir: string, private readonly appendFn: AppendFn = defaultAppend) {
    this.file = join(baseDir, 'orky-actions.jsonl')
  }

  /** Appends one JSON-parseable line per call, in CALL order. Best-effort: an append failure is
   *  logged (`console.error`) but NEVER thrown/rejected into the caller — a disk-full audit-log write
   *  can never fail or alter the caller's returned `OrkyActionResult` (REQ-013). */
  async append(record: OrkyActionAuditRecord): Promise<void> {
    const line = JSON.stringify(record) + '\n'
    try {
      await this.appendFn(this.file, line)
    } catch (err) {
      console.error('[orky-action-audit] failed to append audit record:', err)
    }
  }
}
