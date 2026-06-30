// Phase-4 structural/source-scan suite — feature 0014-orky-osc-heartbeat (REQ-002/004/008/009/010/013).
// FROZEN once the tests gate passes (ADR-009).
//
// These assertions pin facts about the SOURCE TEXT of the new/touched files rather than runtime
// behavior — the spec's acceptance criteria for REQ-002 ("a code/structure check confirms..."), REQ-004
// ("a source scan confirms no eval/Function..."), REQ-008/009 ("a code check confirms...") are all
// explicitly structural, not behavioral. Each file is read defensively (try/catch) so a missing module
// fails its OWN assertion clearly instead of crashing the whole suite file.
//
// Runs RED: `src/main/status/orky-osc-parser.ts` does not exist yet, so every assertion that reads it
// fails (`src` is null).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { CH } from '../../src/shared/ipc-contract'
import { SCHEMA_VERSION } from '../../src/shared/types'

function tryRead(relPath: string): string | null {
  try { return readFileSync(resolve(process.cwd(), relPath), 'utf8') } catch { return null }
}

const PARSER_PATH = 'src/main/status/orky-osc-parser.ts'
const STATUS_ENGINE_PATH = 'src/main/status/status-engine.ts'
const BRIDGE_PATH = 'src/main/orky/orky-stream-status.ts'

describe('OrkyOscParser source — reuses scanOsc, no reimplemented terminator-scan loop (REQ-002)', () => {
  it('TEST-022 REQ-002 imports and calls the shared scanOsc — does not reimplement its scan loop', () => {
    const src = tryRead(PARSER_PATH)
    expect(src).not.toBeNull()
    expect(src!).toMatch(/import\s*\{\s*scanOsc\s*\}\s*from\s*['"]\.\/osc-scanner['"]/)
    expect((src!.match(/scanOsc\(/g) ?? []).length).toBeGreaterThanOrEqual(1)
    // no independent find-terminator loop (the thing REQ-002 forbids reimplementing)
    expect(src!).not.toMatch(/indexOf\(\s*['"]\\x07['"]/)
    expect(src!).not.toMatch(/indexOf\(\s*['"]\\x1b\\\\['"]/)
  })

  it('TEST-023 REQ-002 mirrors Osc133Parser/CwdParser\'s shape: a single buf field, push delegating to scanOsc', () => {
    const src = tryRead(PARSER_PATH)
    expect(src).not.toBeNull()
    // exactly one private carry-over field, same convention as Osc133Parser/CwdParser ("private buf = ''")
    expect((src!.match(/private\s+buf\s*=\s*['"]{2}/g) ?? []).length).toBe(1)
    expect(src!).toMatch(/push\s*\(\s*chunk\s*:\s*string\s*\)/)
  })
})

describe('Body decode path — no eval/Function/dynamic interpretation (REQ-004)', () => {
  it('TEST-024 REQ-004 no eval / Function / new Function appears anywhere in the parser source', () => {
    const src = tryRead(PARSER_PATH)
    expect(src).not.toBeNull()
    expect(src!).not.toMatch(/\beval\s*\(/)
    expect(src!).not.toMatch(/\bnew\s+Function\s*\(/)
    expect(src!).not.toMatch(/[^.\w]Function\s*\(/) // bare `Function(...)` call (not `Number(...)` etc.)
  })
})

describe('OrkyHeartbeat references the shared OrkyPhase/OrkyReason types — no forked literal unions (REQ-008)', () => {
  it('TEST-025 REQ-008 imports OrkyPhase/OrkyReason from @shared/types rather than redefining them locally', () => {
    const src = tryRead(PARSER_PATH)
    expect(src).not.toBeNull()
    expect(src!).toMatch(/import[^;]*\bOrkyPhase\b[^;]*from\s*['"]@shared\/types['"]/)
    expect(src!).toMatch(/import[^;]*\bOrkyReason\b[^;]*from\s*['"]@shared\/types['"]/)
    // must NOT redefine its own literal-union type aliases for these names
    expect(src!).not.toMatch(/type\s+OrkyPhase\s*=/)
    expect(src!).not.toMatch(/type\s+OrkyReason\s*=/)
  })
})

describe('No new pane-status type or orky:* IPC channel introduced (REQ-008)', () => {
  it('TEST-026 REQ-008 the ipc-contract defines exactly the 3 pre-existing orky:* channels — no new channel added', () => {
    const orkyChannelValues = Object.entries(CH)
      .filter(([key]) => /^orky[A-Z]/.test(key))
      .map(([, v]) => v)
      .sort()
    expect(orkyChannelValues).toEqual(['orky:status', 'orky:unwatch', 'orky:watch'])
    // belt-and-suspenders: no OTHER 'orky:' string literal anywhere in the contract value set
    const allOrkyLikeValues = Object.values(CH).filter(v => typeof v === 'string' && v.startsWith('orky:'))
    expect(allOrkyLikeValues.sort()).toEqual(['orky:status', 'orky:unwatch', 'orky:watch'])
  })
})

describe('Coexistence with 0004: orky-tracker.ts untouched, stream parser starts no filesystem watch (REQ-009)', () => {
  it('TEST-027 REQ-009 src/main/orky/orky-tracker.ts is byte-for-byte unchanged by this feature (frozen baseline hash)', () => {
    // Golden hash captured from the pre-0014 tree (sha256 of the file's UTF-8 text). This feature MUST
    // NOT modify orky-tracker.ts's status derivation, duplicate its watch, or override its output — the
    // simplest structural guarantee of that is "the file's bytes did not change".
    const src = readFileSync(resolve(process.cwd(), 'src/main/orky/orky-tracker.ts'), 'utf8')
    const hash = createHash('sha256').update(src).digest('hex')
    expect(hash).toBe('aba940393d50df9e658c0930aadfd136287984f89e63713d423c3d45a93aa526')
  })

  it('TEST-028 REQ-009 the OSC heartbeat parser never imports chokidar or node:fs — it starts no .orky/ filesystem watch', () => {
    const src = tryRead(PARSER_PATH)
    expect(src).not.toBeNull()
    expect(src!).not.toMatch(/from\s*['"]chokidar['"]/)
    expect(src!).not.toMatch(/from\s*['"]node:fs/)
    expect(src!).not.toMatch(/require\(\s*['"]chokidar['"]\s*\)/)
  })
})

describe('Synthetic-fixtures-only constraint: no live-process/network dependency in any 0014 test (REQ-010)', () => {
  const testFiles = [
    'tests/fixtures/orky-osc-fixtures.ts',
    'tests/main/orky-osc-parser.test.ts',
    'tests/shared/orky-heartbeat-status.test.ts'
  ]
  const FORBIDDEN = [/child_process/, /execFile/, /\bspawn\(/, /\bfetch\(/, /node:net/, /node:http/, /node:https/]

  it('TEST-029 REQ-010 no 0014 test file imports child_process/network APIs or spawns a process', () => {
    for (const rel of testFiles) {
      const src = tryRead(rel)
      expect(src, `expected ${rel} to exist`).not.toBeNull()
      for (const pattern of FORBIDDEN) {
        expect(src!, `${rel} must not match ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})

describe('No persistence, no writes, no schema bump (REQ-013)', () => {
  it('TEST-030 REQ-013 SCHEMA_VERSION is unchanged by this feature (it persists nothing)', () => {
    expect(SCHEMA_VERSION).toBe(7)
  })

  it('TEST-031 REQ-013 the parser, the StatusEngine wiring, and the fs/stream bridge expose no filesystem-write API', () => {
    const WRITE_API = /\bwriteFile(Sync)?\b|\bcreateWriteStream\b|\bfs\.write\b|\bappendFile(Sync)?\b/
    const parserSrc = tryRead(PARSER_PATH)
    expect(parserSrc).not.toBeNull()
    expect(parserSrc!).not.toMatch(WRITE_API)

    const statusEngineSrc = tryRead(STATUS_ENGINE_PATH)
    expect(statusEngineSrc).not.toBeNull() // exists today; this feature only ADDS wiring to it
    expect(statusEngineSrc!).not.toMatch(WRITE_API)

    // the new fs/stream combine bridge (TASK-007) — not required to exist for this assertion to be
    // meaningful, but if it exists it must not write either.
    const bridgeSrc = tryRead(BRIDGE_PATH)
    if (bridgeSrc !== null) expect(bridgeSrc).not.toMatch(WRITE_API)
  })
})
