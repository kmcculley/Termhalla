import { describe, it, expect } from 'vitest'
import {
  createWorkspace, addFirstPane, splitPane, removePane,
  serializeWorkspace, deserializeWorkspace
} from '@shared/workspace-model'
import type { TerminalConfig } from '@shared/types'

const term = (cwd = 'C:\\'): TerminalConfig => ({ kind: 'terminal', shellId: 'pwsh', cwd })

describe('workspace-model', () => {
  it('creates an empty named workspace', () => {
    const ws = createWorkspace('Work', () => 'ws-1')
    expect(ws).toMatchObject({ id: 'ws-1', name: 'Work', layout: null, panes: {} })
  })

  it('adds the first pane as the root leaf', () => {
    let ws = createWorkspace('W', () => 'ws-1')
    const r = addFirstPane(ws, term(), () => 'p1')
    expect(r.paneId).toBe('p1')
    expect(r.workspace.layout).toBe('p1')
    expect(r.workspace.panes['p1'].config.cwd).toBe('C:\\')
  })

  it('splits a pane, replacing the leaf with a parent of both panes', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    const r = splitPane(ws, 'p1', 'row', term('D:\\'), () => 'p2')
    expect(r.workspace.layout).toEqual({ direction: 'row', first: 'p1', second: 'p2' })
    expect(Object.keys(r.workspace.panes).sort()).toEqual(['p1', 'p2'])
  })

  it('removes a pane and collapses its parent', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    ws = splitPane(ws, 'p1', 'row', term(), () => 'p2').workspace
    const after = removePane(ws, 'p1')
    expect(after.layout).toBe('p2')
    expect(after.panes['p1']).toBeUndefined()
  })

  it('removing the last pane yields an empty layout', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    const after = removePane(ws, 'p1')
    expect(after.layout).toBeNull()
    expect(after.panes).toEqual({})
  })

  it('serialize → deserialize round-trips and stamps schema version', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    ws = splitPane(ws, 'p1', 'column', term('E:\\'), () => 'p2').workspace
    const json = serializeWorkspace(ws)
    expect(JSON.parse(json).schemaVersion).toBe(1)
    expect(deserializeWorkspace(json)).toEqual(ws)
  })

  it('rejects malformed workspace json', () => {
    expect(() => deserializeWorkspace('{"nope":true}')).toThrow()
  })

  it('splits a non-root leaf deep in a nested tree', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    ws = splitPane(ws, 'p1', 'row', term(), () => 'p2').workspace      // layout: {row, p1, p2}
    const r = splitPane(ws, 'p2', 'column', term('F:\\'), () => 'p3')  // split the deeper 'second' leaf
    expect(r.workspace.layout).toEqual({
      direction: 'row',
      first: 'p1',
      second: { direction: 'column', first: 'p2', second: 'p3' }
    })
    expect(Object.keys(r.workspace.panes).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('removes a middle pane from a 3-pane tree and collapses correctly', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    ws = splitPane(ws, 'p1', 'row', term(), () => 'p2').workspace
    ws = splitPane(ws, 'p2', 'column', term(), () => 'p3').workspace   // {row, p1, {column, p2, p3}}
    const after = removePane(ws, 'p2')
    expect(after.layout).toEqual({ direction: 'row', first: 'p1', second: 'p3' })
    expect(after.panes['p2']).toBeUndefined()
    expect(Object.keys(after.panes).sort()).toEqual(['p1', 'p3'])
  })

  it('rejects a workspace from a newer schema version', () => {
    const json = JSON.stringify({
      schemaVersion: 999,
      workspace: { id: 'x', name: 'n', layout: null, panes: {} }
    })
    expect(() => deserializeWorkspace(json)).toThrow()
  })
})
