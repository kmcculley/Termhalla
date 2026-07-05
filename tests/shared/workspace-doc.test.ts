import { describe, it, expect } from 'vitest'
import { importWorkspaceDoc, defaultDocName, WORKSPACE_DOC_EXT } from '@shared/workspace-doc'
import { serializeWorkspace } from '@shared/workspace-model'
import { SCHEMA_VERSION, type Workspace } from '@shared/types'

// A deterministic uuid generator for stable assertions.
const gen = () => { let n = 0; return () => `nid-${++n}` }

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'orig-ws',
    name: 'My Project',
    layout: { direction: 'row', first: 'p1', second: 'p2' },
    panes: {
      p1: { paneId: 'p1', config: { kind: 'terminal', shellId: 'pwsh', cwd: 'C:/dev/app', resumeAi: 'claude', connectionId: 'c1', launch: { command: 'ssh', args: ['user@host'], title: 'ssh' } } },
      p2: { paneId: 'p2', config: { kind: 'editor', files: ['C:/dev/app/README.md'], activePath: 'C:/dev/app/README.md' } }
    },
    ...overrides
  }
}

describe('defaultDocName', () => {
  it('appends the .thws extension and sanitizes illegal characters', () => {
    expect(defaultDocName('My Project')).toBe(`My Project.${WORKSPACE_DOC_EXT}`)
    expect(defaultDocName('a/b:c*?')).toBe(`a-b-c-.${WORKSPACE_DOC_EXT}`)
  })
  it('falls back to "workspace" for a blank name', () => {
    expect(defaultDocName('   ')).toBe(`workspace.${WORKSPACE_DOC_EXT}`)
    expect(defaultDocName('')).toBe(`workspace.${WORKSPACE_DOC_EXT}`)
  })
})

describe('importWorkspaceDoc', () => {
  it('mints a fresh workspace id and re-keys every pane (no id overlap with the source)', () => {
    const json = serializeWorkspace(ws())
    const out = importWorkspaceDoc(json, 'new-ws', gen())
    expect(out.id).toBe('new-ws')
    // No original pane id survives.
    expect(Object.keys(out.panes)).toEqual(['nid-1', 'nid-2'])
    expect(out.panes.p1).toBeUndefined()
    // Layout leaves were rewritten to the new ids.
    expect(out.layout).toEqual({ direction: 'row', first: 'nid-1', second: 'nid-2' })
  })

  it('preserves per-pane reconnection config (cwd, ssh launch, resumeAi) verbatim', () => {
    const json = serializeWorkspace(ws())
    const out = importWorkspaceDoc(json, 'new-ws', gen())
    const term = out.panes['nid-1'].config
    expect(term).toMatchObject({
      kind: 'terminal', shellId: 'pwsh', cwd: 'C:/dev/app', resumeAi: 'claude',
      connectionId: 'c1', launch: { command: 'ssh', args: ['user@host'], title: 'ssh' }
    })
  })

  it('preserves the workspace name, theme, runCommands and home', () => {
    const json = serializeWorkspace(ws({
      theme: { accent: '#f00' },
      runCommands: [{ id: 'r1', label: 'build', command: 'npm run build' }],
      home: { kind: 'agent', agentId: 'a1', agentName: 'box' }
    }))
    const out = importWorkspaceDoc(json, 'new-ws', gen())
    expect(out.name).toBe('My Project')
    expect(out.theme).toEqual({ accent: '#f00' })
    expect(out.runCommands).toEqual([{ id: 'r1', label: 'build', command: 'npm run build' }])
    expect(out.home).toEqual({ kind: 'agent', agentId: 'a1', agentName: 'box' })
  })

  it('remaps minimized/maximized view-state references through the new ids', () => {
    const json = serializeWorkspace(ws({ minimized: ['p2'], maximized: undefined }))
    const out = importWorkspaceDoc(json, 'new-ws', gen())
    // p2 was the second pane -> nid-2.
    expect(out.minimized).toEqual(['nid-2'])
    expect(out.maximized).toBeUndefined()
  })

  it('produces independent deep copies (mutating the result never touches shared state)', () => {
    const json = serializeWorkspace(ws({ theme: { accent: '#f00' } }))
    const next = gen()
    const a = importWorkspaceDoc(json, 'ws-a', next)
    const b = importWorkspaceDoc(json, 'ws-b', next)
    ;(a.theme as { accent: string }).accent = '#0f0'
    expect((b.theme as { accent: string }).accent).toBe('#f00')
    expect(Object.keys(a.panes)).not.toEqual(Object.keys(b.panes)) // fresh ids each import
  })

  it('rejects invalid JSON and a newer schema (delegates to deserializeWorkspace)', () => {
    expect(() => importWorkspaceDoc('not json', 'x', gen())).toThrow(/not valid JSON/i)
    const newer = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, workspace: ws() })
    expect(() => importWorkspaceDoc(newer, 'x', gen())).toThrow(/newer than supported/i)
  })
})
