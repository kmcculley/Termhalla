// FROZEN doc-drift guard — feature 0012-quick-capture-inbox (phase 4 — REQ-011's CONV-008 half,
// doc-sync gate). REQ-011/TASK-011 require: a feature doc under docs/features/ covering the capture
// flow (chord/palette invocation, picker→form sequencing, the openOrkyCapture(root?) entry point F10
// later calls, result-honesty keying, the F7 `submit`-path grounding); a CLAUDE.md "Where things
// live" reference; a CHANGELOG [Unreleased] entry naming the quick-capture modal AND the F7
// emit→submit dispatcher amendment; the now-false ipc-contract.ts "no renderer UI consumes these
// yet" claim retired (naming F12 as the first, submitWork-only consumer); and the orkyAction
// no-consumer claim class swept repo-wide with EXACTLY ONE allowlisted survivor — the still-TRUE
// registry-mutation line in .orky/baseline/architecture.md (FINDING-006: byte-unchanged, never a
// forced falsifying edit). Mirrors tests/docs-feature-0009.test.ts.
//
// Runs RED until TASK-011/doc-sync reconciles (the feature doc does not exist; ipc-contract.ts still
// carries the stale claim). The orky-action-dispatch.md submit-path assertions are GREEN already —
// the tests phase itself retired that emit-flow prose (TASK-002, CONV-019) — and stay as regression
// pins.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

function unreleasedSection(): string {
  const changelog = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf('## [Unreleased]')
  expect(start, 'CHANGELOG.md must have an [Unreleased] section').toBeGreaterThanOrEqual(0)
  const rest = changelog.slice(start + '## [Unreleased]'.length)
  const nextHeading = rest.search(/\n## \[/)
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).toLowerCase()
}
const fileLower = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8').toLowerCase()

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

describe('TEST-502 REQ-011 docs traceability — feature 0012 quick-capture inbox', () => {
  it('a feature doc covers the capture flow: invocation, picker→form sequencing, the openOrkyCapture entry point, result honesty, and the submit-path grounding', () => {
    const doc = fileLower('docs/features/quick-capture-inbox.md')
    expect(doc).toContain('capture')
    expect(doc).toMatch(/mod\+shift\+u|ctrl\+shift\+u/)     // the rebindable default chord
    expect(doc).toContain('openorkycapture')                // the ONE entry point (F10's future call)
    expect(doc).toContain('picker')                         // the picker-first sequencing
    expect(doc).toContain('orkysubmitwork')                 // D2: exclusively F7's dispatch
    expect(doc).toContain('feedback submit')                // the REQ-013 grounding
    expect(doc).toContain('inbox')
    expect(doc).toContain('triage')                         // the D5 honesty framing
    expect(doc).toMatch(/feedback-disabled|disabled/)       // the distinct non-dispatch outcome
  })

  it('CLAUDE.md references the feature doc (Where things live)', () => {
    expect(fileLower('CLAUDE.md')).toContain('quick-capture')
  })

  it('CHANGELOG [Unreleased] names the quick-capture modal AND the F7 emit→submit dispatcher amendment', () => {
    const s = unreleasedSection()
    expect(s).toContain('capture')
    expect(s).toMatch(/work item|inbox/)
    // the explicit dispatcher amendment statement, not an incidental word
    expect(s).toContain('feedback submit')
    expect(s).toMatch(/emit\s*(→|->|to)\s*submit|instead of .*emit|replaces? .*emit|from .*emit/)
  })
})

describe('TEST-503 REQ-011 stale-claim retirement (CONV-008, FINDING-006 scope guard)', () => {
  it('ipc-contract.ts no longer claims "no renderer UI consumes these yet" and instead names feature 0012 as the first (submitWork-only) consumer', () => {
    const contract = readFileSync(resolve(process.cwd(), 'src/shared/ipc-contract.ts'), 'utf8')
    expect(contract).not.toContain('no renderer UI consumes these yet')
    expect(contract).toMatch(/0012|quick-capture/i)         // the retiring feature is NAMED
    expect(contract).toMatch(/first .*consumer/i)
    expect(contract.toLowerCase()).toContain('submitwork')  // scope: submitWork only
  })

  it('orky-action-dispatch.md no longer pairs submitWork with `feedback emit` — the table and mechanism prose describe the submit/local-inbox path (retired at the tests phase, TASK-002; regression pin)', () => {
    const doc = fileLower('docs/features/orky-action-dispatch.md')
    expect(doc).toContain('feedback submit')
    expect(doc).toMatch(/local[- ]inbox/)
    // the four-actions table row must not route submitWork through emit
    expect(doc).not.toMatch(/\| submit a work item \|[^\n]*feedback emit/)
    // resolveEscalation legitimately KEEPS its emit path — only the submitWork pairing is retired
    expect(doc).toContain('feedback emit --type decision')
  })

  it('the allowlisted registry-mutation claim in .orky/baseline/architecture.md stays byte-unchanged — it is TRUE after F12 (F12 never touches the mutation surface) and must never be force-falsified', () => {
    const arch = readFileSync(resolve(process.cwd(), '.orky/baseline/architecture.md'), 'utf8')
    expect(arch).toContain('(`registry:addRoot`/`removeRoot`) still has no renderer consumer')
  })

  it('repo sweep: the "no renderer UI consumes | no renderer consumer" claim class survives ONLY as the allowlisted registry-mutation line (src/**, docs/**, CLAUDE.md, .orky/baseline/**)', () => {
    const roots = [resolve(process.cwd(), 'src'), resolve(process.cwd(), 'docs'), resolve(process.cwd(), '.orky/baseline')]
    const files = roots.flatMap(walk).concat([resolve(process.cwd(), 'CLAUDE.md')])
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const line of src.split('\n')) {
        if (!/no renderer UI consumes|no renderer consumer/.test(line)) continue
        // the ONE allowlisted survivor: the still-true registry-mutation claim (FINDING-006)
        const allowlisted = f.replace(/\\/g, '/').endsWith('.orky/baseline/architecture.md')
          && line.includes('registry:addRoot')
        if (!allowlisted) offenders.push(`${f}: ${line.trim()}`)
      }
    }
    expect(offenders, `stale no-consumer claims:\n${offenders.join('\n')}`).toEqual([])
  })
})
