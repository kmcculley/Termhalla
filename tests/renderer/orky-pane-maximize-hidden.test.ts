import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Feature 0009, FINDING-035 loopback (coordinator-applied, reviewer-specified pin).
// The renderer has THREE keep-mounted-but-hidden hosts (amended REQ-010): minimized,
// inactive-workspace, and MAXIMIZED-OVER — a sibling's maximize hides every other tile
// via .ws-max visibility:hidden WITHOUT unmounting it (index.css), so a bound OrkyPane
// maximized-over must count as hidden or it sustains invisible fetch loops.
const paneTile = () => readFileSync(resolve('src/renderer/components/PaneTile.tssx'.replace('tssx', 'tsx')), 'utf8')

describe('OrkyPane maximized-over hidden threading (REQ-010 / FINDING-035)', () => {
  it('TEST-468 REQ-010 PaneTile derives maximized-over state (value-stable, self-excluded) and threads it into OrkyPane hidden', () => {
    const src = paneTile()
    // The selector: maximized[wsId] set to some OTHER pane id ⇒ this tile is maximized-over.
    expect(src).toMatch(/maximized\[wsId\]/)
    expect(src).toMatch(/!==\s*paneId/)
    // The mount threads BOTH hidden halves PaneTile owns: workspace inactivity OR maximized-over.
    expect(src).toMatch(/hidden=\{wsInactive\s*\|\|\s*maximizedOver\}/)
  })
})
