// 2026-07-17 whole-project quality audit, Finding 25: the view-state map manipulation was
// duplicated across four sites and had ALREADY drifted — the remove-pane-from-minimized block
// appeared verbatim in movePaneToWorkspace and closePane, and the derive-view-state-from-record
// conditional differed between applyAssignment (`Array.isArray(ws.minimized) && ws.minimized.length`)
// and registerWorkspacePatch (`ws.minimized?.length`). These pin the ONE extracted pair of helpers
// (store/view-state.ts, api-free) that all four sites now share, unified on the Array.isArray
// variant (safer against a corrupt record).
//
// Headless harness (the workspace-registration.test.ts pattern — no ../api import).
import { describe, it, expect } from 'vitest'
import type { Workspace } from '../../src/shared/types'
import { removeFromMinimized, deriveViewStateInto } from '../../src/renderer/store/view-state'
import { registerWorkspacePatch } from '../../src/renderer/store/workspace-registration'

const ws = (id: string, extra: Partial<Workspace> = {}): Workspace =>
  ({ id, name: id, layout: null, panes: {}, ...extra })

describe('removeFromMinimized (the shared remove-pane-from-minimized transition)', () => {
  it('removes the pane from the workspace list and keeps the other entries', () => {
    const out = removeFromMinimized({ w1: ['p1', 'p2'], w2: ['p9'] }, 'w1', 'p1')
    expect(out).toEqual({ w1: ['p2'], w2: ['p9'] })
  })

  it('deletes the workspace key entirely when the last minimized pane is removed (no empty-array residue)', () => {
    const out = removeFromMinimized({ w1: ['p1'], w2: ['p9'] }, 'w1', 'p1')
    expect(out).toEqual({ w2: ['p9'] })
    expect('w1' in out).toBe(false)
  })

  it('is a no-op (equal map) for an unknown workspace or a pane not in the list', () => {
    expect(removeFromMinimized({ w1: ['p1'] }, 'w-ghost', 'p1')).toEqual({ w1: ['p1'] })
    expect(removeFromMinimized({ w1: ['p1'] }, 'w1', 'p-ghost')).toEqual({ w1: ['p1'] })
  })

  it('never mutates the input map (callers hand it live store state)', () => {
    const input = { w1: ['p1', 'p2'] }
    const frozen = JSON.parse(JSON.stringify(input))
    removeFromMinimized(input, 'w1', 'p1')
    expect(input).toEqual(frozen)
  })
})

describe('deriveViewStateInto (the shared derive-view-state-from-record fold)', () => {
  it('sets the runtime entries from a record carrying view-state', () => {
    const minimized: Record<string, string[]> = {}
    const maximized: Record<string, string> = {}
    deriveViewStateInto(minimized, maximized, ws('a', { minimized: ['p1', 'p2'], maximized: 'p3' }))
    expect(minimized).toEqual({ a: ['p1', 'p2'] })
    expect(maximized).toEqual({ a: 'p3' })
  })

  it('clears stale runtime entries when the record carries none (the re-adopt case)', () => {
    const minimized: Record<string, string[]> = { a: ['p9'] }
    const maximized: Record<string, string> = { a: 'p9' }
    deriveViewStateInto(minimized, maximized, ws('a'))
    expect(minimized).toEqual({})
    expect(maximized).toEqual({})
  })

  it('treats an empty minimized array as absent (clears, never stores [])', () => {
    const minimized: Record<string, string[]> = { a: ['p9'] }
    deriveViewStateInto(minimized, {}, ws('a', { minimized: [] }))
    expect(minimized).toEqual({})
  })

  it('guards against a corrupt record: a non-array truthy `minimized` and a non-string `maximized` are treated as absent (the Array.isArray unification)', () => {
    const minimized: Record<string, string[]> = { a: ['p9'] }
    const maximized: Record<string, string> = { a: 'p9' }
    // `'p1p2'?.length` is truthy — the old registerWorkspacePatch variant would have stored the
    // string into the string[] map; the unified helper must clear instead.
    deriveViewStateInto(minimized, maximized, ws('a', { minimized: 'p1p2', maximized: 42 } as unknown as Partial<Workspace>))
    expect(minimized).toEqual({})
    expect(maximized).toEqual({})
  })
})

describe('the two derive call sites behave identically after unification', () => {
  const records: Workspace[] = [
    ws('a', { minimized: ['p1'], maximized: 'p2' }),
    ws('a'),
    ws('a', { minimized: [] }),
    ws('a', { minimized: 'corrupt', maximized: { bad: true } } as unknown as Partial<Workspace>)
  ]

  it('registerWorkspacePatch derives exactly what deriveViewStateInto derives, record for record', () => {
    for (const rec of records) {
      const patch = registerWorkspacePatch(
        { workspaces: {}, order: [], activeId: null, minimized: { a: ['stale'] }, maximized: { a: 'stale' } },
        rec
      )
      const minimized: Record<string, string[]> = { a: ['stale'] }
      const maximized: Record<string, string> = { a: 'stale' }
      deriveViewStateInto(minimized, maximized, rec)
      expect(patch.minimized, `minimized for ${JSON.stringify(rec.minimized)}`).toEqual(minimized)
      expect(patch.maximized, `maximized for ${JSON.stringify(rec.maximized)}`).toEqual(maximized)
    }
  })
})
