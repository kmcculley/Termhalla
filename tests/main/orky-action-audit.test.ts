// FROZEN unit suite — feature 0007-orky-action-dispatch (phase 4 / TASK-005, REQ-013).
// Targets `src/main/orky/orky-action-audit.ts` — the append-only `orky-actions.jsonl` writer under
// Electron `userData`. Mirrors `OrkyRegistryStore`'s "normalize + never throw" discipline for the
// best-effort-never-fails contract, but is explicitly NOT atomic-rewrite (fs.appendFile only — REQ-013
// forbids a rewrite that could truncate the log).
//
// Chosen contract (an INJECTABLE append function, matching `atomic-write.ts`'s `AtomicFs` injection
// pattern — see tests/main/atomic-write.test.ts's `failingCommitFs()` — rather than `vi.spyOn`'ing a
// built-in `node:fs/promises` export, which is brittle under esbuild's ESM/CJS interop):
//   type AppendFn = (file: string, line: string) => Promise<void>
//   interface OrkyActionAuditRecord {
//     ts: number; windowId: number | null; action: string; projectRoot: string; feature?: string
//     argsSummary: Record<string, unknown>; ok: boolean; path: 'feedback' | 'gatekeeper' | null
//     dispatched: boolean; errorKind?: string; exitCode?: number | null
//   }
//   class OrkyActionAuditLog {
//     constructor(baseDir: string, appendFn?: AppendFn)   // appendFn defaults to a real fs.appendFile-backed writer
//     append(record: OrkyActionAuditRecord): Promise<void>   // NEVER throws/rejects
//   }
//   The file lives at join(baseDir, 'orky-actions.jsonl') — one JSON object per line.
//
// Runs RED today: `src/main/orky/orky-action-audit.ts` does not exist yet (module-not-found).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrkyActionAuditLog, type OrkyActionAuditRecord } from '../../src/main/orky/orky-action-audit'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks() })

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'orky-audit-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}

function record(overrides: Partial<OrkyActionAuditRecord> = {}): OrkyActionAuditRecord {
  return {
    ts: 1_700_000_000_000,
    windowId: 7,
    action: 'recordHumanGate',
    projectRoot: 'C:/proj/a',
    feature: 'f1',
    argsSummary: { gate: 'human-review', verdict: 'pass' },
    ok: true,
    path: 'gatekeeper',
    dispatched: true,
    exitCode: 0,
    ...overrides
  }
}

function readLines(dir: string): unknown[] {
  const file = join(dir, 'orky-actions.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

describe('OrkyActionAuditLog.append — one JSON line per call, in order (REQ-013)', () => {
  it('TEST-218 REQ-013 append() writes exactly one JSON-parseable line under userData/orky-actions.jsonl matching the record', async () => {
    const dir = tmpDir()
    const log = new OrkyActionAuditLog(dir)
    await log.append(record())
    const lines = readLines(dir)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'recordHumanGate', ok: true, path: 'gatekeeper', dispatched: true })
  })

  it('TEST-219 REQ-013 two sequential appends produce two lines in CALL order, both intact', async () => {
    const dir = tmpDir()
    const log = new OrkyActionAuditLog(dir)
    await log.append(record({ action: 'driveStatus', dispatched: false }))
    await log.append(record({ action: 'submitWork', dispatched: true }))
    const lines = readLines(dir) as Array<{ action: string }>
    expect(lines.map(l => l.action)).toEqual(['driveStatus', 'submitWork'])
  })

  it('TEST-220 REQ-013 a null windowId (a rejected/attributable-but-unowned call) round-trips as null, not dropped/coerced', async () => {
    const dir = tmpDir()
    const log = new OrkyActionAuditLog(dir)
    await log.append(record({ windowId: null }))
    const lines = readLines(dir) as Array<{ windowId: number | null }>
    expect(lines[0].windowId).toBeNull()
  })

  it('TEST-221 REQ-013 the default appendFn actually writes fs.appendFile-style (a fresh file grows by exactly one line per call; no rewrite/truncation of prior lines)', async () => {
    const dir = tmpDir()
    const log = new OrkyActionAuditLog(dir)
    await log.append(record({ action: 'a' }))
    const afterFirst = readFileSync(join(dir, 'orky-actions.jsonl'), 'utf8')
    await log.append(record({ action: 'b' }))
    const afterSecond = readFileSync(join(dir, 'orky-actions.jsonl'), 'utf8')
    expect(afterSecond.startsWith(afterFirst)).toBe(true) // pure append, prior bytes untouched
  })
})

describe('OrkyActionAuditLog.append — best-effort, never fails the caller (REQ-013)', () => {
  it('TEST-222 REQ-013 an injected failing appendFn is logged (console.error) but append() still RESOLVES (never throws/rejects), and the caller\'s own result is unaffected', async () => {
    const dir = tmpDir()
    const failingAppend = vi.fn(() => Promise.reject(new Error('disk full')))
    const log = new OrkyActionAuditLog(dir, failingAppend)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(log.append(record())).resolves.toBeUndefined()
    expect(failingAppend).toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
  })
})

describe('OrkyActionAuditLog — no cap/rotation/truncation (CONV-003)', () => {
  it('TEST-223 REQ-013 appending 50 records sequentially leaves all 50 lines present, none dropped/capped', async () => {
    const dir = tmpDir()
    const log = new OrkyActionAuditLog(dir)
    for (let i = 0; i < 50; i++) await log.append(record({ action: `action-${i}` }))
    const lines = readLines(dir) as Array<{ action: string }>
    expect(lines).toHaveLength(50)
    expect(lines[0].action).toBe('action-0')
    expect(lines[49].action).toBe('action-49')
  })
})
