// FROZEN doc-drift guard — feature 0011-orky-workspace-template (phase 4, doc-sync gate — the
// CONV-008 discipline; mirrors tests/docs-feature-0009/0010/0012.test.ts). F11 has no dedicated
// docs REQ, so this suite pins the documentation consequences of REQ-003 (the new single-gesture
// entry points must be discoverable in the docs tree) and REQ-006 (the FINDING-001 durability
// repair is a user-facing behavior change ALL templates inherit — it must be recorded, and the
// templates doc must stop being silent about the built-in cockpit row).
//
// Runs RED today (2026-07-02, verified): docs/features/orky-workspace-template.md does not exist;
// docs/features/workspace-templates.md contains no /orky/i; CHANGELOG's [Unreleased] and CLAUDE.md
// contain no 'cockpit'.
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

describe('TEST-672 REQ-003 REQ-006 docs traceability — feature 0011 per-project Orky workspace template', () => {
  it('a feature doc covers the cockpit: the generated orky+terminal row layout, all three entry points (palette, templates menu, decision queue), the no-auto-run posture, saveability via the normal template gesture, and the reportAssignment durability repair', () => {
    const doc = fileLower('docs/features/orky-workspace-template.md')
    expect(doc).toContain('cockpit')
    expect(doc).toContain('orky pane')
    expect(doc).toContain('terminal')
    expect(doc).toMatch(/palette/)
    expect(doc).toMatch(/templates? menu/)
    expect(doc).toMatch(/decision queue/)
    expect(doc).toMatch(/no (auto-?run|command is (auto-?)?typed)|plain shell/) // D4's confirmed posture
    expect(doc).toContain('workspacefromtemplate')          // instantiation rides the ONE shipped seam
    expect(doc).toMatch(/savetemplate|save.*as a template/) // D3: saving stays the user's explicit gesture
    // the FINDING-001 repair, named: newWorkspaceFromTemplate now reports the arrangement
    expect(doc).toContain('newworkspacefromtemplate')
    expect(doc).toMatch(/reportassignment|window arrangement|windows\[\]/)
    expect(doc).toMatch(/silently (lost|deleted)|surviv/)
  })

  it('the shipped workspace-templates doc stops being silent about the built-in row (CONV-008): it names the Orky cockpit row (or points at the feature doc) so the menu description matches the rendered menu', () => {
    const doc = fileLower('docs/features/workspace-templates.md')
    expect(doc).toMatch(/orky/)
    expect(doc).toMatch(/cockpit|built-?in/)
  })

  it('CLAUDE.md references the feature doc (Where things live)', () => {
    expect(fileLower('CLAUDE.md')).toContain('orky-workspace-template')
  })

  it('CHANGELOG [Unreleased] names the cockpit workspace gesture AND the template-instantiation durability fix (the repair every pre-F11 template inherits)', () => {
    const s = unreleasedSection()
    expect(s).toContain('cockpit')
    expect(s).toMatch(/orky/)
    expect(s).toMatch(/workspace/)
    // the durability fix is stated as a FIX to the shipped menu path, not buried as a feature detail
    expect(s).toMatch(/template/)
    expect(s).toMatch(/surviv|silently (lost|deleted)|arrangement|reportassignment/)
  })
})
