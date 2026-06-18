import { describe, it, expect } from 'vitest'
import { remapPaneIds, templateFromWorkspace, workspaceFromTemplate } from '../../src/shared/workspace-model'
import type { Workspace } from '../../src/shared/types'

const ws = {
  id: 'w1', name: 'Src',
  layout: { direction: 'row', first: 'a', second: 'b' },
  panes: {
    a: { paneId: 'a', config: { kind: 'terminal', shellId: 's', cwd: 'C:\\x' } },
    b: { paneId: 'b', config: { kind: 'editor', files: ['C:\\f.ts'] } }
  }
} as unknown as Workspace

let n = 0
const uuid = () => `new-${n++}`

describe('remapPaneIds', () => {
  it('assigns fresh ids in the layout tree and panes map', () => {
    n = 0
    const r = remapPaneIds(ws.layout, ws.panes, uuid)
    const leaves = [(r.layout as { first: string }).first, (r.layout as { second: string }).second]
    expect(leaves.sort()).toEqual(['new-0', 'new-1'])
    expect(Object.keys(r.panes).sort()).toEqual(['new-0', 'new-1'])
    for (const id of Object.keys(r.panes)) expect(r.panes[id].paneId).toBe(id)
  })
  it('passes through a blank workspace', () => {
    const r = remapPaneIds(null, {}, uuid)
    expect(r).toEqual({ layout: null, panes: {} })
  })
})

describe('templateFromWorkspace / workspaceFromTemplate', () => {
  it('captures then re-instantiates with fresh ids and given name', () => {
    n = 0
    const tpl = templateFromWorkspace(ws, 't1', 'My Template')
    expect(tpl).toMatchObject({ id: 't1', name: 'My Template' })
    const out = workspaceFromTemplate(tpl, 'w2', 'Copy', uuid)
    expect(out.id).toBe('w2')
    expect(out.name).toBe('Copy')
    expect(Object.keys(out.panes)).toHaveLength(2)
    expect(Object.keys(out.panes)).not.toContain('a')
  })
  it('templateFromWorkspace deep-copies (later workspace edits do not mutate the template)', () => {
    const tpl = templateFromWorkspace(ws, 't1', 'T')
    ;(ws.panes.a.config as { cwd: string }).cwd = 'MUTATED'
    expect((tpl.panes.a.config as { cwd: string }).cwd).toBe('C:\\x')
    ;(ws.panes.a.config as { cwd: string }).cwd = 'C:\\x'
  })
  it('captures and restores the workspace-level theme override', () => {
    const themed = { ...ws, theme: { windowBg: '#abcdef' } } as unknown as Workspace
    const tpl = templateFromWorkspace(themed, 't1', 'T')
    expect(tpl.theme).toEqual({ windowBg: '#abcdef' })
    const out = workspaceFromTemplate(tpl, 'w2', 'Copy', uuid)
    expect(out.theme).toEqual({ windowBg: '#abcdef' })
  })
  it('captures and restores workspace-scoped run commands (deep copy)', () => {
    const cmds = [{ id: 'rc1', label: 'Build', command: 'npm run build' }]
    const withCmds = { ...ws, runCommands: cmds } as unknown as Workspace
    const tpl = templateFromWorkspace(withCmds, 't1', 'T')
    expect(tpl.runCommands).toEqual(cmds)
    const out = workspaceFromTemplate(tpl, 'w2', 'Copy', uuid)
    expect(out.runCommands).toEqual(cmds)
    // must be a deep copy, not the same array reference
    expect(out.runCommands).not.toBe(cmds)
    expect(out.runCommands).not.toBe(tpl.runCommands)
  })
  it('round-trips a workspace with no run commands without adding the field', () => {
    const tpl = templateFromWorkspace(ws, 't1', 'T')
    expect(tpl.runCommands).toBeUndefined()
    const out = workspaceFromTemplate(tpl, 'w2', 'Copy', uuid)
    expect(out.runCommands).toBeUndefined()
  })
})
