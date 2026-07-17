import { describe, it, expect } from 'vitest'
import { buildCommandItems, filterPaletteItems } from '../src/shared/quick'

describe('buildCommandItems', () => {
  it('returns command actions with non-empty search strings', () => {
    const cmds = buildCommandItems()
    const actions = cmds.map(c => c.kind === 'action' ? c.action : null)
    expect(actions).toEqual(expect.arrayContaining(['new-terminal', 'new-editor', 'new-explorer', 'new-workspace', 'broadcast', 'save-all', 'refresh-cloud', 'settings']))
    for (const c of cmds) expect((c as { search: string }).search.length).toBeGreaterThan(0)
  })
  it('is filterable by query', () => {
    const hit = filterPaletteItems(buildCommandItems(), 'terminal')
    expect(hit.some(c => c.kind === 'action' && c.action === 'new-terminal')).toBe(true)
    expect(hit.some(c => c.kind === 'action' && c.action === 'refresh-cloud')).toBe(false)
  })
  it('surfaces the settings command', () => {
    const hit = filterPaletteItems(buildCommandItems(), 'settings')
    expect(hit.some(c => c.kind === 'action' && c.action === 'settings')).toBe(true)
  })
  it('includes the QoL pane/view commands (2026-07-17)', () => {
    const actions = buildCommandItems().map(c => c.kind === 'action' ? c.action : null)
    expect(actions).toEqual(expect.arrayContaining([
      'close-pane', 'maximize-pane', 'minimize-pane', 'restore-last-minimized',
      'clear-terminal', 'find-in-terminal', 'redraw-terminal', 'font-zoom-reset',
      'toggle-notes', 'search-history'
    ]))
  })
  it('subsequence fallback finds abbreviated queries, ranked below substring hits', () => {
    const hit = filterPaletteItems(buildCommandItems(), 'nterm')
    expect(hit.some(c => c.kind === 'action' && c.action === 'new-terminal')).toBe(true)
    // substring matches still rank first
    const both = filterPaletteItems(buildCommandItems(), 'clear')
    expect(both[0]).toMatchObject({ action: 'clear-terminal' })
  })
})
