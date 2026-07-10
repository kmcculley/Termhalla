// Feature 0025-cursor-home-output-suppression — REQ-008: the regression-(b) oscillation
// nets stay in place, UNMODIFIED in their load-bearing parts. `npm test` can verify their
// presence and frozen pin names (this file); the actual green e2e run —
//   npm run build && npx playwright test tests/e2e/marker-less-pane.spec.ts   (workers: 1)
// with the spec file + tests/fixtures/fake-remote-shell.mjs byte-unchanged, plus green
// tests/e2e/status.spec.ts — is OUTSIDE the gate profile and must be witnessed and recorded
// before the review gate closes (CONV-052), per the REQ.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8')

describe('TEST-2541 REQ-008 the scenario-(b) nets exist with their frozen pins intact', () => {
  it('the two unit repaint pins are still present under their exact names', () => {
    const tracker = read('tests/main/status-tracker.test.ts')
    expect(tracker).toContain("it('a screen repaint does NOT resurrect busy on a marker-less pane (busy<->idle oscillation)'")
    expect(tracker).toContain("it('ignores screen-redraw chunks: they do not reset the quiet timer or clear needs-input'")
  })
  it('the e2e net and its fixture are still present (TEST-QA11 marker-less oscillation spec)', () => {
    expect(read('tests/e2e/marker-less-pane.spec.ts')).toContain('TEST-QA11')
    expect(existsSync(resolve(root, 'tests/fixtures/fake-remote-shell.mjs'))).toBe(true)
  })
  it('the paint-only status-chrome nets are still present (no chrome/CSS change in 0025)', () => {
    expect(existsSync(resolve(root, 'tests/e2e/status.spec.ts'))).toBe(true)
    expect(existsSync(resolve(root, 'tests/renderer/pane-status-css.test.ts'))).toBe(true)
  })
})
