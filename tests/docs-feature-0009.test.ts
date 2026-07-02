// FROZEN doc-drift guard — feature 0009-native-orky-pane (phase 4 / REQ-021, doc-sync gate).
// REQ-021 requires: a feature doc under docs/features/ covering the pane kind, the binding model,
// the degraded states + re-bind, the registry:detail contract (bounds/retry/skipped-feature
// semantics) AND registry:rootChanged's role as the detail view's currency mechanism; a CLAUDE.md
// "Where things live" reference; a CHANGELOG [Unreleased] entry naming the pane kind AND the
// SCHEMA_VERSION v7→v8 bump; and no stale "three pane kinds" / "SCHEMA_VERSION is 7" claim in the
// living docs. Mirrors tests/docs-feature-0007.test.ts. Runs RED until doc-sync reconciles.
// AMENDED 2026-07-02 on the ESC-001 tests loopback: TEST-467 added — the amended REQ-008
// (FINDING-033) makes the accepted cross-FILE read-skew class + its notification-driven healing a
// MANDATORY part of the feature doc ("REQ-021's feature doc MUST record this property and its
// healing mechanism alongside the retry/skipped-feature semantics").
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

describe('TEST-441 REQ-021 docs traceability — feature 0009 native OrkyPane', () => {
  it('a feature doc covers the pane kind, the binding model, the degraded states, the detail contract and the rootChanged currency mechanism', () => {
    const doc = fileLower('docs/features/orky-pane.md')
    expect(doc).toContain('orky')
    expect(doc).toContain('registry:detail')
    expect(doc).toContain('registry:rootchanged')
    expect(doc).toMatch(/unbound/)
    expect(doc).toMatch(/re-?bind/)
    expect(doc).toMatch(/skipped|unreadable/)          // the surfaced-not-swallowed read semantics
    expect(doc).toMatch(/verbatim|case-preserved/)     // the binding model
  })

  it('CLAUDE.md references the feature doc (Where things live)', () => {
    expect(fileLower('CLAUDE.md')).toContain('orky-pane')
  })

  it('CHANGELOG [Unreleased] names the new pane kind AND the explicit v7→v8 schema bump', () => {
    const section = unreleasedSection()
    expect(section).toContain('orky pane')
    expect(section).toMatch(/pane kind/)
    // the EXPLICIT bump statement (7 → 8), not an incidental digit elsewhere in the section
    expect(section).toMatch(/v?7\s*(→|->|to)\s*v?8|schema[_ ]?version\s*(bumped to|is now|:)\s*8/)
  })

  it('no living doc still claims the pane kinds are exactly terminal/editor/explorer or that SCHEMA_VERSION is 7', () => {
    // the living docs REQ-021 pins (historical .orky feature artifacts are exempt by design)
    for (const rel of ['CLAUDE.md', 'docs/persistence.md']) {
      let src: string
      try { src = fileLower(rel) } catch { continue } // a doc that does not exist cannot be stale
      expect(src, `${rel} must not pin SCHEMA_VERSION at 7`).not.toMatch(/schema[_ ]?version[^.\n]{0,40}\bis 7\b|schema[_ ]?version = 7/)
      expect(src, `${rel} must not claim exactly three pane kinds`).not.toMatch(/exactly (three|3) pane kinds|kinds are (exactly )?terminal[,/ ]+editor[,/ ]+(and )?explorer/)
    }
  })
})

describe('TEST-467 REQ-021 REQ-008 (ESC-001 loopback, FINDING-033) accepted cross-file read-skew class documented', () => {
  it('the feature doc records that an ok:true payload is coherent per-FILE (not per-feature-across-files) and names the notification-driven healing that bounds the skew', () => {
    const doc = fileLower('docs/features/orky-pane.md')
    // the accepted staleness class itself…
    expect(doc, 'the doc must name the cross-file read-skew class REQ-008 accepts').toMatch(/cross-file|read[- ]skew|per-file.{0,80}coheren/)
    // …and its healing mechanism (each producer write → engine re-read → rootChanged → refetch)
    expect(doc, 'the doc must record the notification-driven healing bounding the skew').toMatch(/heal(s|ing|ed)?\b|notification cycle/)
  })
})
