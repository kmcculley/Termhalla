// QoL batch 2026-07-17: keyboard directional pane focus (mod+alt+arrows). The geometry pick is
// pure — the dispatcher measures the visible tiles' rects and this chooses the neighbor.
import { describe, it, expect } from 'vitest'
import { directionalPaneTarget, type PaneRect } from '../../src/renderer/components/pane-nav'

//  ┌───────┬───────┐
//  │   a   │   b   │
//  ├───────┼───────┤
//  │   c   │   d   │
//  └───────┴───────┘
const grid: PaneRect[] = [
  { id: 'a', left: 0, top: 0, width: 100, height: 100 },
  { id: 'b', left: 100, top: 0, width: 100, height: 100 },
  { id: 'c', left: 0, top: 100, width: 100, height: 100 },
  { id: 'd', left: 100, top: 100, width: 100, height: 100 }
]

describe('directionalPaneTarget', () => {
  it('picks the straight neighbor in each direction', () => {
    expect(directionalPaneTarget('right', 'a', grid)).toBe('b')
    expect(directionalPaneTarget('down', 'a', grid)).toBe('c')
    expect(directionalPaneTarget('left', 'b', grid)).toBe('a')
    expect(directionalPaneTarget('up', 'd', grid)).toBe('b')
  })
  it('returns null at an edge (no wrap)', () => {
    expect(directionalPaneTarget('left', 'a', grid)).toBeNull()
    expect(directionalPaneTarget('up', 'b', grid)).toBeNull()
  })
  it('prefers the aligned neighbor over a nearer diagonal one', () => {
    // e sits right of a but vertically offset; b is straight right — b must win.
    const rects: PaneRect[] = [
      { id: 'a', left: 0, top: 0, width: 100, height: 100 },
      { id: 'b', left: 120, top: 0, width: 100, height: 100 },
      { id: 'e', left: 105, top: 90, width: 100, height: 100 }
    ]
    expect(directionalPaneTarget('right', 'a', rects)).toBe('b')
  })
  it('handles unknown source / single pane', () => {
    expect(directionalPaneTarget('right', 'ghost', grid)).toBeNull()
    expect(directionalPaneTarget('right', 'a', [grid[0]])).toBeNull()
  })
})
