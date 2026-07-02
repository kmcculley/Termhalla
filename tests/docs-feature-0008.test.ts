// FROZEN doc-drift guard — feature 0008-queue-answer-resume-actions (phase 4 — REQ-013's doc half,
// doc-sync gate). REQ-013/TASK-011 require: a feature doc under docs/features/ covering the
// answer/preview/resume-in-terminal flow (the escalation identity binding + submit-time
// re-verification, the shared cross-instance single-flight gate, the F10-reusable
// OrkyEntryTarget/useOrkyEntryActions/OrkyEntryActions seam, the honesty classes); a CLAUDE.md
// reference; a CHANGELOG [Unreleased] entry; and the ADDITIVE ipc-contract.ts consumer-comment
// amendment — ONLY the stale "the other three actions remain consumer-less until F8/F10" clause is
// replaced, while 0012's pinned first-consumer sentence stays byte-intact (frozen TEST-503,
// tests/docs-feature-0012.test.ts, pins that sentence AND repo-sweeps the no-consumer claim class;
// this suite must stay compatible with it byte-unchanged). Mirrors tests/docs-feature-0012.test.ts.
//
// Runs RED until TASK-011/doc-sync reconciles (the feature doc does not exist; ipc-contract.ts
// still carries the consumer-less clause).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function unreleasedSection(): string {
  const changelog = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8')
  const start = changelog.indexOf('## [Unreleased]')
  expect(start, 'CHANGELOG.md must have an [Unreleased] section').toBeGreaterThanOrEqual(0)
  const rest = changelog.slice(start + '## [Unreleased]'.length)
  const nextHeading = rest.search(/\n## \[/)
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).toLowerCase()
}
const fileLower = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8').toLowerCase()

describe('TEST-613 REQ-013 docs traceability — feature 0008 queue answer + resume actions', () => {
  it('a feature doc covers the answer/preview/resume flow: escalation identity binding + re-verification, the shared single-flight gate, the F10-reuse seam, the two-part honest resume, and the failure-honesty classes', () => {
    const doc = fileLower('docs/features/queue-answer-resume-actions.md')
    expect(doc).toContain('answer')
    expect(doc).toContain('escalation')
    expect(doc).toMatch(/identity|bound|re-?verif/)          // REQ-003's binding + verification
    expect(doc).toContain('single-flight')                   // REQ-007's shared gate
    expect(doc).toContain('orkyentrytarget')                 // the F10-reusable seam (D5/REQ-011)
    expect(doc).toContain('useorkyentryactions')
    expect(doc).toMatch(/f10|orky ?pane/)                    // named next consumer
    expect(doc).toContain('resolveescalation')               // the three F7 bridges consumed
    expect(doc).toContain('recordhumangate')
    expect(doc).toContain('drivestatus')
    expect(doc).toMatch(/next[- ]action|preview/)            // resume part 1: read-only preview
    expect(doc).toContain('/orky:resume')                    // resume part 2: the terminal launch
    expect(doc).toMatch(/terminal|session/)
    expect(doc).not.toMatch(/auto-?run|headless(ly)? driv/)  // the FINDING-005 honesty posture
    expect(doc).toContain('indeterminate')                   // REQ-009's honesty classes
    expect(doc).toMatch(/cli-unparseable/)                   // the FINDING-006 reclassification
    expect(doc).toMatch(/feedback-disabled|disabled/)
  })

  it('CLAUDE.md references the feature doc (Where things live)', () => {
    expect(fileLower('CLAUDE.md')).toContain('queue-answer-resume')
  })

  it('CHANGELOG [Unreleased] names the answer/preview/resume actions on decision-queue entries', () => {
    const s = unreleasedSection()
    expect(s).toContain('answer')
    expect(s).toMatch(/resume/)
    expect(s).toMatch(/decision[- ]queue|queue entr/)
  })
})

describe('TEST-614 REQ-013 the ipc-contract consumer comment — ADDITIVE amendment only (CONV-008, frozen TEST-503 compatibility)', () => {
  it('the orkyAction consumer comment no longer claims the three actions are consumer-less, names feature 0008 as their consumer (and F10 as the next reuse) — while the 0012 first-consumer sentence TEST-503 pins survives intact', () => {
    const contract = readFileSync(resolve(process.cwd(), 'src/shared/ipc-contract.ts'), 'utf8')
    // scope the pins to the CONSUMER COMMENT region (between the orkyAction banner and the first
    // method declaration), not the whole file — the method names below it would match vacuously.
    const start = contract.indexOf('orkyAction:* (feature 0007)')
    const end = contract.indexOf('orkyResolveEscalation(req')
    expect(start, 'the orkyAction consumer comment must exist').toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const comment = contract.slice(start, end)
    // the stale clause is retired…
    expect(comment).not.toContain('remain consumer-less')
    expect(comment).not.toMatch(/consumer-?less until F8\/F10/i)
    // …replaced by 0008's own consumer note naming the three actions and the next reuse…
    expect(comment).toMatch(/0008|queue-answer|entry-actions/i)
    expect(comment).toMatch(/resolveEscalation/i)
    expect(comment).toMatch(/recordHumanGate/i)
    expect(comment).toMatch(/driveStatus/i)
    expect(comment).toMatch(/F10/)
    // …while 0012's pinned first-consumer sentence stays (frozen TEST-503: :69-75) and no phrasing
    // the TEST-503 repo sweep bans is introduced.
    expect(comment).toMatch(/0012|quick-capture/i)
    expect(comment).toMatch(/first .*consumer/i)
    expect(comment.toLowerCase()).toContain('submitwork')
    expect(comment).not.toMatch(/no renderer UI consumes|no renderer consumer/)
  })
})
