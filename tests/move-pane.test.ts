import { describe, it, expect } from 'vitest'
import { movePane } from '@shared/workspace-model'
import type { Workspace, PaneNode } from '@shared/types'

const term = (id: string): PaneNode => ({ paneId: id, config: { kind: 'terminal', shellId: 'pwsh', cwd: '' } })

function ws(id: string, layout: Workspace['layout'], panes: PaneNode[]): Workspace {
  return { id, name: id, layout, panes: Object.fromEntries(panes.map(p => [p.paneId, p])) }
}

describe('movePane', () => {
  it('moves a pane into an empty target as the sole pane', () => {
    const from = ws('A', 'a', [term('a')])
    const to = ws('B', null, [])
    const r = movePane(from, to, 'a')
    expect(r.from.layout).toBe(null)
    expect(r.from.panes.a).toBeUndefined()
    expect(r.to.layout).toBe('a')
    expect(r.to.panes.a).toEqual(term('a'))
  })

  it('splits the target to the right when it already has panes', () => {
    const from = ws('A', { direction: 'row', first: 'a', second: 'a2' }, [term('a'), term('a2')])
    const to = ws('B', 'b', [term('b')])
    const r = movePane(from, to, 'a')
    expect(r.from.layout).toBe('a2')
    expect(r.to.layout).toEqual({ direction: 'row', first: 'b', second: 'a' })
    expect(r.to.panes.a).toEqual(term('a'))
  })

  it('is a no-op when the source does not hold the pane', () => {
    const from = ws('A', 'a', [term('a')])
    const to = ws('B', null, [])
    const r = movePane(from, to, 'zzz')
    expect(r.from).toBe(from)
    expect(r.to).toBe(to)
  })
})
