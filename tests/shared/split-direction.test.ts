// FROZEN test suite — feature 0002-pane-toolbar-split-control (phase 4).
// Pure-logic pins for the split before/after insertion and the direction→layout mapping.
// These reference `splitDirToLayout` (and `splitPane`'s new trailing `position` arg) which do not
// exist in the current code, so this file currently runs RED. Do NOT loosen these to make them pass
// — the implementer fits the code to the test, not the reverse (ADR-009).
import { describe, it, expect } from 'vitest'
import {
  createWorkspace, addFirstPane, splitPane, splitDirToLayout,
  serializeWorkspace, deserializeWorkspace
} from '@shared/workspace-model'
import { SCHEMA_VERSION, type TerminalConfig } from '@shared/types'

const term = (cwd = 'C:\\'): TerminalConfig => ({ kind: 'terminal', shellId: 'pwsh', cwd })

// TEST-001 — REQ-008/REQ-009: default-after regression pin. `splitPane` called with NO position arg
// must still produce today's `{ direction, first: target, second: new }` byte-for-byte, so every
// legacy call site (and the persisted MosaicNode shape) is unchanged.
describe('TEST-001 REQ-008 splitPane default position is "after" (regression pin)', () => {
  it('omitted position equals { direction, first: target, second: new }', () => {
    const ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    const r = splitPane(ws, 'p1', 'row', term('D:\\'), () => 'p2')
    expect(r.workspace.layout).toEqual({ direction: 'row', first: 'p1', second: 'p2' })
    expect(Object.keys(r.workspace.panes).sort()).toEqual(['p1', 'p2'])
  })
})

// TEST-002 — REQ-008/REQ-007: insert-before. `position: 'before'` makes the NEW pane the parent's
// `first` child and the target its `second`, while keeping the `{ direction, first, second }` shape.
describe('TEST-002 REQ-008 splitPane position "before" inserts the new pane as first', () => {
  it('before equals { direction, first: new, second: target }', () => {
    const ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    const r = splitPane(ws, 'p1', 'row', term('D:\\'), () => 'p2', 'before')
    expect(r.workspace.layout).toEqual({ direction: 'row', first: 'p2', second: 'p1' })
    expect(Object.keys(r.workspace.panes).sort()).toEqual(['p1', 'p2'])
  })
})

// TEST-003 — REQ-008: explicit `position: 'after'` matches the default (and today's output).
describe('TEST-003 REQ-008 splitPane explicit "after" matches default', () => {
  it('explicit after equals { direction, first: target, second: new }', () => {
    const ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    const r = splitPane(ws, 'p1', 'column', term('E:\\'), () => 'p2', 'after')
    expect(r.workspace.layout).toEqual({ direction: 'column', first: 'p1', second: 'p2' })
  })
})

// TEST-004 — REQ-008: `before` on a deep (non-root) leaf inserts the new pane as that subtree's
// `first`, leaves the rest of the tree untouched, keeps the persisted shape, and the
// serialize→deserialize round-trip + SCHEMA_VERSION are unchanged.
describe('TEST-004 REQ-008 splitPane "before" on a deep leaf preserves shape + round-trip', () => {
  it('inserts as the subtree first and round-trips unchanged', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    ws = splitPane(ws, 'p1', 'row', term(), () => 'p2').workspace            // {row, p1, p2}
    const r = splitPane(ws, 'p2', 'column', term('F:\\'), () => 'p3', 'before') // before-split the deep 'second'
    expect(r.workspace.layout).toEqual({
      direction: 'row',
      first: 'p1',
      second: { direction: 'column', first: 'p3', second: 'p2' }
    })
    expect(Object.keys(r.workspace.panes).sort()).toEqual(['p1', 'p2', 'p3'])
    const json = serializeWorkspace(r.workspace)
    expect(JSON.parse(json).schemaVersion).toBe(SCHEMA_VERSION)
    expect(deserializeWorkspace(json)).toEqual(r.workspace)
  })
})

// TEST-005 — REQ-005/REQ-007/REQ-008/REQ-009: the pure direction→layout mapping. All four UI
// directions map to orientation × position:
//   right → {row, after}, down → {column, after}, left → {row, before}, up → {column, before}.
describe('TEST-005 REQ-008 splitDirToLayout maps all four directions', () => {
  it('right → { row, after }', () => {
    expect(splitDirToLayout('right')).toEqual({ direction: 'row', position: 'after' })
  })
  it('down → { column, after }', () => {
    expect(splitDirToLayout('down')).toEqual({ direction: 'column', position: 'after' })
  })
  it('left → { row, before }', () => {
    expect(splitDirToLayout('left')).toEqual({ direction: 'row', position: 'before' })
  })
  it('up → { column, before }', () => {
    expect(splitDirToLayout('up')).toEqual({ direction: 'column', position: 'before' })
  })
})
