// FROZEN structural suite — feature 0006-decision-queue-panel (phase 4 / REQ-002/REQ-007/REQ-014).
// The status-bar toggle affordance + live badge, pinned by source-scan (node-env harness, no jsdom —
// 03-plan.md "Testability constraint"). Rendered behavior (badge live while the drawer is closed,
// aria-expanded sync) is asserted end-to-end in tests/e2e/decision-queue.spec.ts.
// Runs RED: StatusBar.tsx carries no orky-queue-toggle yet.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const statusBar = () => readFileSync(resolve(process.cwd(), 'src/renderer/components/StatusBar.tsx'), 'utf8')

describe('StatusBar — orky-queue-toggle (REQ-002/REQ-014)', () => {
  it('TEST-354 REQ-002 REQ-014 a real button with the pinned testid, aria-expanded, and a setQueueOpen toggle', () => {
    const src = statusBar()
    expect(src).toContain('data-testid="orky-queue-toggle"')
    expect(src).toContain('aria-expanded')
    expect(src).toContain('setQueueOpen')
    expect(src).toContain('type="button"')
    // The existing sibling affordances stay (the toggle joins the search/notes family, replaces nothing).
    expect(src).toContain('data-testid="search-toggle"')
    expect(src).toContain('data-testid="notes-toggle"')
  })

  it('TEST-355 REQ-002 any displayed chord derives from resolveBindings — never a hard-coded chord literal (CONV-005)', () => {
    const src = statusBar()
    expect(src).not.toContain('Ctrl+Shift+O')
    expect(src).toContain('toggle-orky-queue')
    expect(src).toContain('resolveBindings')
    expect(src).toContain('formatChord')
  })
})

describe('StatusBar — badge count = list count, one selector (REQ-007)', () => {
  it('TEST-356 REQ-007 the badge reads the shared queueCount selector, never a second count, and renders only when > 0', () => {
    const src = statusBar()
    expect(src).toContain('queueCount')
    // No duplicate counting logic: the badge must not rebuild or recount the queue itself.
    expect(src).not.toContain('buildDecisionQueue')
    expect(src).not.toMatch(/decisionQueueCount\s*\(/)
    // No numeric badge at 0 / while loading or errored (count is 0 in both, TEST-340).
    expect(src).toMatch(/>\s*0/)
  })
})
