import { describe, it, expect } from 'vitest'
import { StatusTracker } from '../../src/main/status/status-tracker'
import { DEFAULT_NEEDS_INPUT_PATTERNS, type NeedsInputConfig } from '../../src/main/status/needs-input'

const cfg = (over: Partial<NeedsInputConfig> = {}): NeedsInputConfig => ({
  enabled: true, quietMs: 10000, patterns: DEFAULT_NEEDS_INPUT_PATTERNS, heuristicIdleMs: 1500, ...over
})

describe('StatusTracker (with integration markers)', () => {
  it('starts idle', () => {
    expect(new StatusTracker(0, cfg()).status().state).toBe('idle')
  })
  it('A -> idle, C -> busy, A -> idle', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.onMarker('A', undefined, 1).state).toBe('idle')
    expect(t.onMarker('C', undefined, 2).state).toBe('busy')
    expect(t.onMarker('A', undefined, 3).state).toBe('idle')
  })
  it('D records lastExit applied at the next A', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 1)
    t.onMarker('D', 0, 2)
    expect(t.onMarker('A', undefined, 3)).toMatchObject({ state: 'idle', lastExit: 'success' })
    t.onMarker('C', undefined, 4)
    t.onMarker('D', 1, 5)
    expect(t.onMarker('A', undefined, 6)).toMatchObject({ state: 'idle', lastExit: 'failure' })
  })
  it('goes needs-input when busy, quiet past threshold, with a prompt tail; clears on new output', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    expect(t.tick(200).state).toBe('busy')
    expect(t.tick(11000).state).toBe('needs-input')
    expect(t.onOutput('y\r\n', 11500).state).toBe('busy')
  })
  it('ignores screen-redraw chunks: they do not reset the quiet timer or clear needs-input', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    expect(t.tick(11000).state).toBe('needs-input')
    // a PSReadLine-style repaint arrives — must NOT revert to busy nor reset quiet
    t.onOutput('\x1b[?25l\x1b[HOverwrite? [y/N] ', 11500)
    expect(t.tick(12000).state).toBe('needs-input')
  })
})

describe('StatusTracker (heuristic, no markers)', () => {
  it('output -> busy, then long quiet with prompt tail -> idle', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('compiling...', 0).state).toBe('busy')
    expect(t.tick(1000).state).toBe('busy')
    t.onOutput('\r\nPS C:\\> ', 1100)
    expect(t.tick(3000).state).toBe('idle')
  })
})
