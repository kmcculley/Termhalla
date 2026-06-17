import { describe, it, expect } from 'vitest'
import { stashSnapshot, consumeSnapshot } from '../src/renderer/components/terminal-registry'
import { beginPaneTransit, endPaneTransit, isPaneInTransit } from '../src/renderer/components/pane-transit'

describe('snapshot stash', () => {
  it('returns the stashed snapshot once then empties', () => {
    stashSnapshot('p1', 'ANSI-DATA')
    expect(consumeSnapshot('p1')).toBe('ANSI-DATA')
    expect(consumeSnapshot('p1')).toBe('')
  })
  it('returns empty string for an unknown pane', () => {
    expect(consumeSnapshot('nope')).toBe('')
  })
})

describe('pane transit', () => {
  it('tracks in-transit pane ids', () => {
    expect(isPaneInTransit('p2')).toBe(false)
    beginPaneTransit('p2')
    expect(isPaneInTransit('p2')).toBe(true)
    endPaneTransit('p2')
    expect(isPaneInTransit('p2')).toBe(false)
  })
})
