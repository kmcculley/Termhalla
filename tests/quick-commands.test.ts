import { describe, it, expect } from 'vitest'
import { buildCommandItems, filterPaletteItems } from '../src/shared/quick'

describe('buildCommandItems', () => {
  it('returns command actions with non-empty search strings', () => {
    const cmds = buildCommandItems()
    const actions = cmds.map(c => c.kind === 'action' ? c.action : null)
    expect(actions).toEqual(expect.arrayContaining(['new-terminal', 'new-editor', 'new-explorer', 'new-workspace', 'broadcast', 'save-all', 'refresh-cloud']))
    for (const c of cmds) expect((c as { search: string }).search.length).toBeGreaterThan(0)
  })
  it('is filterable by query', () => {
    const hit = filterPaletteItems(buildCommandItems(), 'terminal')
    expect(hit.some(c => c.kind === 'action' && c.action === 'new-terminal')).toBe(true)
    expect(hit.some(c => c.kind === 'action' && c.action === 'refresh-cloud')).toBe(false)
  })
})
