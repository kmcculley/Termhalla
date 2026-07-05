// FROZEN test suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-002).
// REQ-002 (SCHEMA_VERSION 8→9 + the documented-identity v<9 migration case) and REQ-001's
// application points: normalizeWorkspaceHome runs at EVERY deserialization path of the persisted
// shape (deserializeWorkspace AND workspaceFromTemplate — CONV-026).
//
// CONV-022 note: TEST-2210 pins the constant AT 9 as THIS feature's own sanctioned bump (the 0009
// REQ-003 precedent). A later feature that legitimately bumps it amends this pin atomically at ITS
// tests phase (CONV-019).
//
// Runs RED today: SCHEMA_VERSION is 8 and Workspace has no home field.
import { describe, it, expect } from 'vitest'
import { SCHEMA_VERSION, type Workspace, type WorkspaceTemplate } from '@shared/types'
import { deserializeWorkspace, serializeWorkspace, workspaceFromTemplate } from '@shared/workspace-model'

const term = (id: string) => ({ paneId: id, config: { kind: 'terminal' as const, shellId: 'sh', cwd: 'C:/x' } })

const fixture = (schemaVersion: number, workspace: Record<string, unknown>): string =>
  JSON.stringify({ schemaVersion, workspace })

const V6 = fixture(6, { id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') } })
const V7 = fixture(7, {
  id: 'w', name: 'W', layout: { direction: 'row', first: 'p1', second: 'p2' },
  panes: { p1: term('p1'), p2: term('p2') }, minimized: ['p2'], maximized: null
})
const V8 = fixture(8, { id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') }, minimized: [], maximized: null })
const V9_REMOTE = fixture(9, {
  id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') }, minimized: [], maximized: null,
  home: { kind: 'agent', agentId: 'a-1', agentName: 'buildbox' }
})

describe('SCHEMA_VERSION 8→9 (REQ-002)', () => {
  it('TEST-2210 REQ-002 SCHEMA_VERSION is 9 (this feature\'s sanctioned bump — the persisted workspace home)', () => {
    expect(SCHEMA_VERSION).toBe(9)
  })

  it('TEST-2211 REQ-002 v6/v7/v8 fixtures deserialize with all panes + view-state preserved and NO home (local)', () => {
    for (const [f, wsName] of [[V6, 'v6'], [V7, 'v7'], [V8, 'v8']] as const) {
      const w = deserializeWorkspace(f)
      expect(w.panes['p1'], `${wsName} pane preserved`).toBeDefined()
      expect(w.home, `${wsName} must not grow a home`).toBeUndefined()
    }
    const w7 = deserializeWorkspace(V7)
    expect(w7.minimized).toEqual(['p2']) // pre-existing view-state semantics byte-for-byte
  })

  it('TEST-2212 REQ-002 REQ-001 a v9 record with a well-formed home round-trips byte-identically (serialize→deserialize fixpoint)', () => {
    const parsed = deserializeWorkspace(V9_REMOTE)
    expect(parsed.home).toEqual({ kind: 'agent', agentId: 'a-1', agentName: 'buildbox' })
    const s1 = serializeWorkspace(parsed)
    expect(JSON.parse(s1).schemaVersion).toBe(9)
    const s2 = serializeWorkspace(deserializeWorkspace(s1))
    expect(s2).toBe(s1)
  })

  it('TEST-2213 REQ-002 migration is idempotent and deterministic for v6/v7/v8/v9 fixtures', () => {
    for (const f of [V6, V7, V8, V9_REMOTE]) {
      const once = deserializeWorkspace(f)
      expect(deserializeWorkspace(f)).toEqual(once) // deterministic
      expect(deserializeWorkspace(serializeWorkspace(once))).toEqual(once) // idempotent
    }
  })

  it('TEST-2214 REQ-002 a NEWER (v10) file is rejected with the actionable newer-than-supported error', () => {
    const v10 = fixture(10, { id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') } })
    expect(() => deserializeWorkspace(v10)).toThrow(/newer than supported/i)
  })

  it('TEST-2215 REQ-001 a malformed agent home in a v9 file is coerced (kept remote, ids -> "") — never silently local, never a throw', () => {
    const bad = fixture(9, {
      id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') },
      home: { kind: 'agent', agentId: 42 }
    })
    const w = deserializeWorkspace(bad)
    expect(w.home).toBeDefined()
    expect(w.home!.kind).toBe('agent')
    expect(w.home!.agentId).toBe('')
  })

  it('TEST-2216 REQ-001 a wrong-kind home in a v9 file loads as local (dropped), and unknown home keys are stripped', () => {
    const wrongKind = fixture(9, {
      id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') }, home: { kind: 'ssh', agentId: 'a' }
    })
    expect(deserializeWorkspace(wrongKind).home).toBeUndefined()
    const extras = fixture(9, {
      id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') },
      home: { kind: 'agent', agentId: 'a-1', agentName: 'n', secret: 'x' }
    })
    const w = deserializeWorkspace(extras)
    expect(Object.keys(w.home as object).sort()).toEqual(['agentId', 'agentName', 'kind'])
  })

  it('TEST-2217 REQ-001 workspaceFromTemplate normalizes a malformed template home through the SAME rules (CONV-026)', () => {
    const tpl = {
      id: 't1', name: 'T', layout: 'p1', panes: { p1: term('p1') },
      home: { kind: 'agent', agentId: 42, secret: 'x' }
    } as unknown as WorkspaceTemplate
    let n = 0
    const ws: Workspace = workspaceFromTemplate(tpl, 'ws-new', 'T', () => `id-${n++}`)
    expect(ws.home).toBeDefined()
    expect(ws.home!.kind).toBe('agent')
    expect(ws.home!.agentId).toBe('')
    expect(Object.keys(ws.home as object).sort()).toEqual(['agentId', 'agentName', 'kind'])
  })
})
