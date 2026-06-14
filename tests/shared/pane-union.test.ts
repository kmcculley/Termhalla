import { describe, it, expect } from 'vitest'
import { createWorkspace, addFirstPane, serializeWorkspace, deserializeWorkspace } from '@shared/workspace-model'
import type { EditorConfig, ExplorerConfig } from '@shared/types'

describe('pane union persistence', () => {
  it('round-trips an editor pane config', () => {
    const cfg: EditorConfig = { kind: 'editor', files: ['C:\\a.ts', 'C:\\b.ts'], activePath: 'C:\\b.ts' }
    const ws = addFirstPane(createWorkspace('W', () => 'w'), cfg, () => 'p').workspace
    expect(deserializeWorkspace(serializeWorkspace(ws))).toEqual(ws)
  })
  it('round-trips an explorer pane config', () => {
    const cfg: ExplorerConfig = { kind: 'explorer', root: 'C:\\proj' }
    const ws = addFirstPane(createWorkspace('W', () => 'w'), cfg, () => 'p').workspace
    expect(deserializeWorkspace(serializeWorkspace(ws))).toEqual(ws)
  })
  it('still loads a v2 terminal-only workspace file', () => {
    const v2 = JSON.stringify({
      schemaVersion: 2,
      workspace: { id: 'x', name: 'n', layout: 'p1',
        panes: { p1: { paneId: 'p1', config: { kind: 'terminal', shellId: 'cmd', cwd: '' } } } }
    })
    expect(deserializeWorkspace(v2).panes.p1.config.kind).toBe('terminal')
  })
})
