// The pane title's ambient-state prefixes. They ride the title TEXT (paint-only — the toolbar
// box never changes size; the 🔔 needs-input bell established the pattern). ⏺ marks an active
// recording: since Record moved into the right-click menu (feature 0002), a session could record
// to disk indefinitely with ZERO on-screen cue (FINDING-DEV-001/UX-006) — the title glyph is the
// restored at-a-glance indicator.
import { describe, it, expect } from 'vitest'
import { paneTitle } from '../../src/renderer/components/pane-status'

describe('paneTitle', () => {
  it('is the bare name with nothing active', () => {
    expect(paneTitle('build', { needsInput: false, recording: false })).toBe('build')
  })
  it('prefixes the needs-input bell (existing behavior, unchanged)', () => {
    expect(paneTitle('build', { needsInput: true, recording: false })).toBe('🔔 build')
  })
  it('prefixes the recording glyph — the at-a-glance cue Record lost when it moved into the menu', () => {
    expect(paneTitle('build', { needsInput: false, recording: true })).toBe('⏺ build')
  })
  it('stacks both, recording first (ambient state, then attention state)', () => {
    expect(paneTitle('build', { needsInput: true, recording: true })).toBe('⏺ 🔔 build')
  })
})
