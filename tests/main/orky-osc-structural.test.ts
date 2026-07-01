// Phase-4 structural/source-scan suite — feature 0014-orky-osc-heartbeat (REQ-002/004/012/013/014/017).
// FROZEN once the tests gate passes (ADR-009).
//
// REWRITTEN against the REAL ADR-026 wire contract (see tests/main/orky-osc-parser.test.ts's header for
// the full rationale) — the prior iteration's structural suite asserted facts about the superseded
// 8888/key=value implementation and is stale.
//
// These assertions pin facts about the SOURCE TEXT of the new/touched files rather than runtime
// behavior — the spec's acceptance criteria for REQ-002 ("a code/structure check confirms..."), REQ-004
// ("a source scan confirms no eval/Function..."), REQ-012/REQ-013 ("a code check confirms...") are all
// explicitly structural, not behavioral. Each file is read defensively (try/catch) so a missing module
// fails its OWN assertion clearly instead of crashing the whole suite file.
//
// Runs RED: `src/main/status/orky-osc-parser.ts` still implements the superseded 8888/key=value contract
// (no `scanOsc(buf, ORKY_OSC, ...)` call against the new `'\x1b]9999;'` prefix, no JSON-decode source
// shape this file's regexes expect to find).
//
// TEST-042/TEST-043 (added at doc-sync, covering REQ-015/REQ-016): the Gatekeeper CLI's mechanical
// `traceability` gate token requires every REQ-NNN found in `02-spec.md` to trace to at least one
// TEST-ID — there is no "documentation-only, exempt from unit test" allowance, regardless of what
// `02-spec.md`'s own Definition of Done says. REQ-015/REQ-016's acceptance criteria are concrete,
// file-content-checkable facts (specific literal strings/patterns in specific files), so they get real
// structural tests here, matching this file's established style (TEST-035's frozen-hash / TEST-037's
// cross-file content grep) rather than being left untested.
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
const TYPES_PATH = 'src/shared/types.ts'
const ORKY_STATUS_PATH = 'src/shared/orky-status.ts'
const SPEC_PATH = '.orky/features/0014-orky-osc-heartbeat/02-spec.md'
const FEATURE_DOC_PATH = 'docs/features/orky-osc-heartbeat.md'
const CLAUDE_MD_PATH = 'CLAUDE.md'
const CHANGELOG_PATH = 'CHANGELOG.md'

describe('OrkyOscParser source — reuses scanOsc, no reimplemented terminator-scan loop (REQ-002)', () => {
  it('TEST-005 REQ-002 imports and calls the shared scanOsc against the ADR-026 prefix — does not reimplement its scan loop', () => {
    const src = tryRead(PARSER_PATH)
    expect(src).not.toBeNull()
    expect(src!).toMatch(/import\s*\{\s*scanOsc\s*\}\s*from\s*['"]\.\/osc-scanner['"]/)
    expect((src!.match(/scanOsc\(/g) ?? []).length).toBeGreaterThanOrEqual(1)
    // no independent find-terminator loop (the thing REQ-002 forbids reimplementing)
    expect(src!).not.toMatch(/indexOf\(\s*['"]\\x07['"]/)
    expect(src!).not.toMatch(/indexOf\(\s*['"]\\x1b\\\\['"]/)
  })

  it('TEST-006 REQ-002 mirrors Osc133Parser/CwdParser\'s shape: a single buf field, push delegating to scanOsc', () => {
    const src = tryRead(PARSER_PATH)
    expect(src).not.toBeNull()
    // exactly one private carry-over field, same convention as Osc133Parser/CwdParser ("private buf = ''")
    expect((src!.match(/private\s+buf\s*=\s*['"]{2}/g) ?? []).length).toBe(1)
    expect(src!).toMatch(/push\s*\(\s*chunk\s*:\s*string\s*\)/)
  })
})

describe('Payload decode path — no eval/Function/dynamic interpretation (REQ-004)', () => {
  it('TEST-009 REQ-004 no eval / Function / new Function appears anywhere in the parser source', () => {
    const src = tryRead(PARSER_PATH)
    expect(src).not.toBeNull()
    expect(src!).not.toMatch(/\beval\s*\(/)
    expect(src!).not.toMatch(/\bnew\s+Function\s*\(/)
    expect(src!).not.toMatch(/[^.\w]Function\s*\(/) // bare `Function(...)` call (not `Number(...)` etc.)
  })
})

describe('No new pane-status type or orky:* IPC channel introduced — second SOURCE only (REQ-012)', () => {
  it('TEST-031 REQ-012 the ipc-contract defines exactly the 3 pre-existing orky:* channels — no new channel added', () => {
    const orkyChannelValues = Object.entries(CH)
      .filter(([key]) => /^orky[A-Z]/.test(key))
      .map(([, v]) => v)
      .sort()
    expect(orkyChannelValues).toEqual(['orky:status', 'orky:unwatch', 'orky:watch'])
    // belt-and-suspenders: no OTHER 'orky:' string literal anywhere in the contract value set
    const allOrkyLikeValues = Object.values(CH).filter(v => typeof v === 'string' && v.startsWith('orky:'))
    expect(allOrkyLikeValues.sort()).toEqual(['orky:status', 'orky:unwatch', 'orky:watch'])

    // no second pane-status-shaped interface forked alongside OrkyPaneStatus
    const typesSrc = tryRead(TYPES_PATH)
    expect(typesSrc).not.toBeNull()
    expect((typesSrc!.match(/interface\s+OrkyPaneStatus\b/g) ?? []).length).toBe(1)
    expect(typesSrc!).not.toMatch(/interface\s+OrkyStreamPaneStatus\b/)
    expect(typesSrc!).not.toMatch(/interface\s+OrkyHeartbeatPaneStatus\b/)
  })
})

describe('Coexistence with 0004: orky-tracker.ts untouched, stream parser starts no filesystem watch (REQ-013)', () => {
  it('TEST-035 REQ-013 src/main/orky/orky-tracker.ts is byte-for-byte unchanged by this feature (frozen baseline hash)', () => {
    // Golden hash captured from the pre-0014-re-plan tree (sha256 of the file's UTF-8 text). This
    // feature MUST NOT modify orky-tracker.ts's status derivation, duplicate its watch, or override its
    // output — the simplest structural guarantee of that is "the file's bytes did not change".
    const src = readFileSync(resolve(process.cwd(), 'src/main/orky/orky-tracker.ts'), 'utf8')
    const hash = createHash('sha256').update(src).digest('hex')
    expect(hash).toBe('aba940393d50df9e658c0930aadfd136287984f89e63713d423c3d45a93aa526')
  })

  it('TEST-036 REQ-013 the OSC heartbeat parser and the fs/stream bridge never import chokidar or node:fs — neither starts a .orky/ filesystem watch', () => {
    const parserSrc = tryRead(PARSER_PATH)
    expect(parserSrc).not.toBeNull()
    expect(parserSrc!).not.toMatch(/from\s*['"]chokidar['"]/)
    expect(parserSrc!).not.toMatch(/from\s*['"]node:fs/)
    expect(parserSrc!).not.toMatch(/require\(\s*['"]chokidar['"]\s*\)/)

    const bridgeSrc = tryRead(BRIDGE_PATH)
    if (bridgeSrc !== null) {
      expect(bridgeSrc).not.toMatch(/from\s*['"]chokidar['"]/)
      expect(bridgeSrc).not.toMatch(/from\s*['"]node:fs/)
    }
  })
})

describe('Synthetic-fixtures-only constraint: no live-process/network dependency in any 0014 test (REQ-014)', () => {
  const testFiles = [
    'tests/fixtures/orky-osc-fixtures.ts',
    'tests/main/orky-osc-parser.test.ts',
    'tests/shared/orky-heartbeat-status.test.ts'
  ]
  const FORBIDDEN = [/child_process/, /execFile/, /\bspawn\(/, /\bfetch\(/, /node:net/, /node:http/, /node:https/]

  it('TEST-037 REQ-014 no 0014 test/fixture file imports child_process/network APIs or spawns a process', () => {
    for (const rel of testFiles) {
      const src = tryRead(rel)
      expect(src, `expected ${rel} to exist`).not.toBeNull()
      for (const pattern of FORBIDDEN) {
        expect(src!, `${rel} must not match ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})

describe('No persistence, no writes, no schema bump (REQ-017)', () => {
  it('TEST-038 REQ-017 SCHEMA_VERSION is unchanged by this feature (it persists nothing)', () => {
    expect(SCHEMA_VERSION).toBe(7)
  })

  it('TEST-039 REQ-017 the parser, the heartbeat mapper, the StatusEngine wiring, and the fs/stream bridge expose no filesystem-write API', () => {
    const WRITE_API = /\bwriteFile(Sync)?\b|\bcreateWriteStream\b|\bfs\.write\b|\bappendFile(Sync)?\b/
    const parserSrc = tryRead(PARSER_PATH)
    expect(parserSrc).not.toBeNull()
    expect(parserSrc!).not.toMatch(WRITE_API)

    const orkyStatusSrc = tryRead(ORKY_STATUS_PATH)
    expect(orkyStatusSrc).not.toBeNull()
    expect(orkyStatusSrc!).not.toMatch(WRITE_API)

    const statusEngineSrc = tryRead(STATUS_ENGINE_PATH)
    expect(statusEngineSrc).not.toBeNull() // exists today; this feature only ADDS wiring to it
    expect(statusEngineSrc!).not.toMatch(WRITE_API)

    // the fs/stream combine bridge — not required to exist for this assertion to be meaningful, but if
    // it exists (it already does, from the prior implementation pass) it must not write either.
    const bridgeSrc = tryRead(BRIDGE_PATH)
    if (bridgeSrc !== null) expect(bridgeSrc).not.toMatch(WRITE_API)
  })
})

describe('Scope: Termhalla parser/renderer only; Orky-side emission is documented as REAL and shipped (REQ-015)', () => {
  it('TEST-042 REQ-015 spec + feature doc state the emission is real/shipped and opt-in, describe parser-only scope, and no in-repo source file references the separate Orky repo', () => {
    const specSrc = tryRead(SPEC_PATH)
    const docSrc = tryRead(FEATURE_DOC_PATH)
    expect(specSrc, `expected ${SPEC_PATH} to exist`).not.toBeNull()
    expect(docSrc, `expected ${FEATURE_DOC_PATH} to exist`).not.toBeNull()

    // states the emission is real/shipped, opt-in, and cites the upstream contract (ADR-026)
    expect(specSrc!).toMatch(/config\.heartbeat\.osc/)
    expect(docSrc!).toMatch(/config\.heartbeat\.osc/)
    expect(specSrc!).toMatch(/ADR-026/)
    expect(docSrc!).toMatch(/ADR-026/)

    // explicitly states the corrected framing — "no longer ... dark in production" — never a bare,
    // unqualified "is dark in production" / "is out of scope" claim about the CURRENT state. The gap
    // and the phrase itself may each be word-wrapped across a markdown line break, so match across
    // newlines ([\s\S]) rather than requiring a single physical line.
    expect(specSrc!).toMatch(/no longer[\s\S]{0,60}dark\s+in\s+production/i)
    expect(docSrc!).toMatch(/no longer[\s\S]{0,60}dark\s+in\s+production/i)

    // describes the parser-only scope (Termhalla builds the parser + renderer; it does not emit)
    expect(specSrc!).toMatch(/Termhalla-side only/)
    expect(docSrc!).toMatch(/parser\s*\+\s*renderer/i)

    // no file under this repo's own src/ writes to or references the separate C:/dev/Orky repo path —
    // the only cross-repo-touch check this suite can mechanically make (it cannot probe the other repo)
    const NO_OTHER_REPO = /C:[\\/]dev[\\/]Orky/
    const parserSrc = tryRead(PARSER_PATH)
    expect(parserSrc).not.toBeNull()
    expect(parserSrc!).not.toMatch(NO_OTHER_REPO)
    const orkyStatusSrc = tryRead(ORKY_STATUS_PATH)
    expect(orkyStatusSrc).not.toBeNull()
    expect(orkyStatusSrc!).not.toMatch(NO_OTHER_REPO)
    const bridgeSrc = tryRead(BRIDGE_PATH)
    if (bridgeSrc !== null) expect(bridgeSrc).not.toMatch(NO_OTHER_REPO)
  })
})

describe('Cross-repo contract documented prominently + drift caveat (REQ-016)', () => {
  it('TEST-043 REQ-016 the feature doc reproduces the exact ADR-026 contract, cites its source + upstream ADR, carries the drift caveat, is linked from CLAUDE.md, is mentioned in CHANGELOG [Unreleased], and neither carries the superseded 8888/orky= contract', () => {
    const docSrc = tryRead(FEATURE_DOC_PATH)
    expect(docSrc, `expected ${FEATURE_DOC_PATH} to exist`).not.toBeNull()

    // exact ADR-026 wire prefix, reproduced literally (as it appears in the doc's fenced code blocks)
    expect(docSrc!).toContain('\\x1b]9999;')

    // JSON payload schema table — every field name from the ADR-026 schema
    for (const field of ['v', 'feature', 'phase', 'gate', 'needsHuman', 'reason', 'action']) {
      expect(docSrc!, `expected the payload schema table to mention \`${field}\``).toMatch(
        new RegExp('`' + field + '`')
      )
    }

    // names the defining source file + cites Orky's upstream ADR-026
    expect(docSrc!).toContain('src/main/status/orky-osc-parser.ts')
    expect(docSrc!).toMatch(/ADR-026/)

    // parser-only scope + opt-in emission (REQ-015, restated in the doc)
    expect(docSrc!).toMatch(/parser\s*\+\s*renderer/i)
    expect(docSrc!).toMatch(/config\.heartbeat\.osc/)

    // cross-repo drift caveat
    expect(docSrc!).toMatch(/drift/i)
    expect(docSrc!).toMatch(/cross-repo/i)

    // CLAUDE.md's "Where things live" table links to the feature doc
    const claudeMdSrc = tryRead(CLAUDE_MD_PATH)
    expect(claudeMdSrc, `expected ${CLAUDE_MD_PATH} to exist`).not.toBeNull()
    expect(claudeMdSrc!).toMatch(/\[orky-osc-heartbeat\]\(docs\/features\/orky-osc-heartbeat\.md\)/)

    // CHANGELOG.md's [Unreleased] section mentions this feature
    const changelogSrc = tryRead(CHANGELOG_PATH)
    expect(changelogSrc, `expected ${CHANGELOG_PATH} to exist`).not.toBeNull()
    const unreleasedMatch = changelogSrc!.match(/## \[Unreleased\]([\s\S]*?)\n## \[/)
    expect(unreleasedMatch, 'expected an [Unreleased] section followed by another release heading').not.toBeNull()
    const unreleasedSection = unreleasedMatch![1]
    expect(unreleasedSection).toMatch(/OSC heartbeat/i)

    // no occurrence of the superseded 8888/key=value contract remains in the feature doc or CHANGELOG —
    // check the OLD literal contract markers, not the bare word "orky" (which legitimately appears
    // throughout this codebase)
    const SUPERSEDED = [/\]8888;orky=/, /orky=<body>/, /\b8888\b/]
    for (const pattern of SUPERSEDED) {
      expect(docSrc!, `${FEATURE_DOC_PATH} must not match ${pattern}`).not.toMatch(pattern)
      expect(changelogSrc!, `${CHANGELOG_PATH} must not match ${pattern}`).not.toMatch(pattern)
    }
  })
})
