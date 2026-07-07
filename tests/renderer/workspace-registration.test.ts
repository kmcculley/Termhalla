// 2026-07-06 quality audit, Group C #8: the workspace-registration ritual (set record + append to
// order + make active + scheduleAutosave + reportAssignment) was copy-pasted across newWorkspace /
// newOrkyWorkspace / newRemoteWorkspace / newWorkspaceFromTemplate, overlapping adoptWorkspace.
// Omitting the report already shipped a real data-loss bug once (0011 FINDING-001: an unreported
// workspace is silently deleted by the next pushed assignment). This suite pins the ONE shared
// implementation every registration site now routes through.
//
// Headless harness (the quick-slice.test.ts pattern — no ../api import).
import { describe, it, expect, vi } from 'vitest'
import type { Workspace } from '../../src/shared/types'
import { registerWorkspacePatch, makeRegisterWorkspace } from '../../src/renderer/store/workspace-registration'

const ws = (id: string, extra: Partial<Workspace> = {}): Workspace =>
  ({ id, name: id, layout: null, panes: {}, ...extra })

const empty = () => ({
  workspaces: {} as Record<string, Workspace>,
  order: [] as string[],
  activeId: null as string | null,
  minimized: {} as Record<string, string[]>,
  maximized: {} as Record<string, string>,
})

describe('registerWorkspacePatch (the pure state transition)', () => {
  it('adds the record, appends to order, and makes the workspace active', () => {
    const s = { ...empty(), workspaces: { a: ws('a') }, order: ['a'], activeId: 'a' }
    const p = registerWorkspacePatch(s, ws('b'))
    expect(p.workspaces.b).toEqual(ws('b'))
    expect(p.workspaces.a).toEqual(ws('a'))
    expect(p.order).toEqual(['a', 'b'])
    expect(p.activeId).toBe('b')
  })

  it('does not duplicate an id already present in order (the adoptWorkspace re-adopt case)', () => {
    const s = { ...empty(), workspaces: { a: ws('a') }, order: ['a'], activeId: 'a' }
    const p = registerWorkspacePatch(s, ws('a', { name: 'renamed' }))
    expect(p.order).toEqual(['a'])
    expect(p.workspaces.a.name).toBe('renamed')
    expect(p.activeId).toBe('a')
  })

  it('derives persisted view-state (minimized/maximized) into the runtime maps, clearing stale keys', () => {
    const s = { ...empty(), minimized: { a: ['p9'] }, maximized: { a: 'p9' } }
    const withState = registerWorkspacePatch(s, ws('a', { minimized: ['p1', 'p2'], maximized: 'p3' }))
    expect(withState.minimized.a).toEqual(['p1', 'p2'])
    expect(withState.maximized.a).toBe('p3')
    // A record WITHOUT view-state clears any stale runtime entry (exactly what adoptWorkspace did).
    const cleared = registerWorkspacePatch(s, ws('a'))
    expect(cleared.minimized.a).toBeUndefined()
    expect(cleared.maximized.a).toBeUndefined()
  })

  it('never mutates the input state', () => {
    const s = { ...empty(), workspaces: { a: ws('a') }, order: ['a'], activeId: 'a' as string | null }
    const frozen = JSON.parse(JSON.stringify(s))
    registerWorkspacePatch(s, ws('b', { minimized: ['x'], maximized: 'x' }))
    expect(s).toEqual(frozen)
  })
})

describe('makeRegisterWorkspace (the full ritual)', () => {
  it('applies the patch, then schedules the autosave, then reports the arrangement — exactly once each', () => {
    let state: ReturnType<typeof empty> = empty()
    const set = vi.fn((fn: (s: typeof state) => Partial<typeof state>) => { state = { ...state, ...fn(state) } })
    const scheduleAutosave = vi.fn()
    const reportAssignment = vi.fn()
    const register = makeRegisterWorkspace({ set, scheduleAutosave, reportAssignment })

    register(ws('w1'))
    expect(state.workspaces.w1).toBeDefined()
    expect(state.order).toEqual(['w1'])
    expect(state.activeId).toBe('w1')
    expect(scheduleAutosave).toHaveBeenCalledTimes(1)
    // 0011 FINDING-001: the arrangement report is the load-bearing step — an unreported workspace
    // is silently lost to the next pushed assignment. It must follow the autosave scheduling.
    expect(reportAssignment).toHaveBeenCalledTimes(1)
    expect(reportAssignment.mock.invocationCallOrder[0])
      .toBeGreaterThan(scheduleAutosave.mock.invocationCallOrder[0])
  })
})
