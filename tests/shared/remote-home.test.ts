// FROZEN test suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-001).
// REQ-001 (the WorkspaceHome pure model + normalizeWorkspaceHome coercion rules), REQ-017 (the
// remoteAllowedDomains derivation) and REQ-018 (the pure cross-home pane-move refusal predicate
// paneMoveRefusalReason — chosen contract: it lives beside the model in src/shared/remote-home.ts,
// returns null when the move is allowed and an actionable reason string when refused).
//
// Runs RED today: src/shared/remote-home.ts does not exist.
import { describe, it, expect } from 'vitest'
import {
  normalizeWorkspaceHome,
  remoteAllowedDomains,
  paneMoveRefusalReason,
  type WorkspaceHome
} from '@shared/remote-home'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'

const agentHome = (over: Partial<WorkspaceHome> = {}): WorkspaceHome =>
  ({ kind: 'agent', agentId: 'a-1', agentName: 'buildbox', ...over })

const state = (over: Partial<RemoteWorkspaceState> = {}): RemoteWorkspaceState => ({
  workspaceId: 'ws-1', agentId: 'a-1', agentName: 'buildbox',
  phase: 'connected', capabilities: ['pty', 'status'], ...over
})

describe('normalizeWorkspaceHome (REQ-001)', () => {
  it('TEST-2201 REQ-001 absent/undefined/null and non-object values normalize to undefined (local)', () => {
    for (const raw of [undefined, null, 'agent', 42, true, ['agent']]) {
      expect(normalizeWorkspaceHome(raw)).toBeUndefined()
    }
  })

  it('TEST-2202 REQ-001 a wrong-kind object is local; only kind "agent" is remote', () => {
    expect(normalizeWorkspaceHome({ kind: 'local' })).toBeUndefined()
    expect(normalizeWorkspaceHome({ kind: 'ssh', agentId: 'a', agentName: 'n' })).toBeUndefined()
    expect(normalizeWorkspaceHome({ agentId: 'a', agentName: 'n' })).toBeUndefined() // no kind
  })

  it('TEST-2203 REQ-001 a well-formed agent home passes through untouched (value-identical)', () => {
    const h = agentHome()
    expect(normalizeWorkspaceHome(h)).toEqual(h)
  })

  it('TEST-2204 REQ-001 kind "agent" with missing/empty/non-string ids is KEPT remote with fields coerced to "" — never silently local', () => {
    for (const raw of [
      { kind: 'agent' },
      { kind: 'agent', agentId: '', agentName: '' },
      { kind: 'agent', agentId: 7, agentName: null },
      { kind: 'agent', agentName: 'buildbox' }
    ]) {
      const n = normalizeWorkspaceHome(raw)
      expect(n, `input ${JSON.stringify(raw)} must stay remote`).toBeDefined()
      expect(n!.kind).toBe('agent')
      expect(typeof n!.agentId).toBe('string')
      expect(typeof n!.agentName).toBe('string')
    }
    const coerced = normalizeWorkspaceHome({ kind: 'agent', agentName: 'buildbox' })!
    expect(coerced.agentId).toBe('')
    expect(coerced.agentName).toBe('buildbox')
  })

  it('TEST-2205 REQ-001 unknown extra keys are stripped (nothing unexpected survives a round-trip)', () => {
    const n = normalizeWorkspaceHome({ kind: 'agent', agentId: 'a-1', agentName: 'n', password: 'x', extra: 1 })!
    expect(Object.keys(n).sort()).toEqual(['agentId', 'agentName', 'kind'])
  })

  it('TEST-2206 REQ-001 never throws on hostile input (CONV-002)', () => {
    const weird = Object.create(null) as Record<string, unknown>
    weird.kind = 'agent'
    for (const raw of [weird, Symbol('x') as unknown, () => 'agent', new Date()]) {
      expect(() => normalizeWorkspaceHome(raw)).not.toThrow()
    }
  })
})

describe('remoteAllowedDomains (REQ-017)', () => {
  it('TEST-2207 REQ-017 local workspace (no home) allows everything', () => {
    expect(remoteAllowedDomains(undefined, undefined)).toBe('all')
  })

  it('TEST-2276 REQ-017 remote + connected allows exactly the advertised capability set', () => {
    expect(remoteAllowedDomains(agentHome(), state({ capabilities: ['pty', 'status'] })))
      .toEqual(['pty', 'status'])
  })

  it('TEST-2208 REQ-017 remote + not-connected (no state / connecting / disconnected) allows only pty', () => {
    expect(remoteAllowedDomains(agentHome(), undefined)).toEqual(['pty'])
    expect(remoteAllowedDomains(agentHome(), state({ phase: 'connecting', capabilities: [] }))).toEqual(['pty'])
    expect(remoteAllowedDomains(agentHome(), state({ phase: 'disconnected', capabilities: [], reason: 'connection-lost' }))).toEqual(['pty'])
  })
})

describe('paneMoveRefusalReason (REQ-018)', () => {
  it('TEST-2209 REQ-018 local->local allowed; every cross-home / remote->remote combination is refused with an actionable reason', () => {
    expect(paneMoveRefusalReason(undefined, undefined)).toBeNull()
    const combos: Array<[WorkspaceHome | undefined, WorkspaceHome | undefined]> = [
      [undefined, agentHome()],                                   // local -> remote
      [agentHome(), undefined],                                   // remote -> local
      [agentHome(), agentHome()],                                 // remote A -> remote A (other ws)
      [agentHome(), agentHome({ agentId: 'a-2', agentName: 'other' })] // remote A -> remote B
    ]
    for (const [from, to] of combos) {
      const reason = paneMoveRefusalReason(from, to)
      expect(reason, `move ${from?.agentId ?? 'local'} -> ${to?.agentId ?? 'local'} must be refused`).toBeTypeOf('string')
      expect(reason!.length).toBeGreaterThan(20) // actionable, never a bare "error" (CONV-001)
    }
  })
})
