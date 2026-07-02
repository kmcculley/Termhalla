// FROZEN unit suite — feature 0003-pane-minimize-restore (phase 4 / TASK-001 persistence + migration).
// Pins the persisted view-state contract: SCHEMA_VERSION bump 6->7, an explicit v6->v7 migration that
// loses no pane data, dangling-ref pruning, malformed-input tolerance, no silent capping, and the
// security guarantee that only paneId refs/flags are written. Runs RED today: SCHEMA_VERSION is 6 and
// a v7 fixture trips the "newer than supported" guard.
import { describe, it, expect } from 'vitest'
import { serializeWorkspace, deserializeWorkspace } from '@shared/workspace-model'
import { SCHEMA_VERSION, type Workspace, type PaneNode, type MosaicNode } from '@shared/types'

type VS = Workspace & { minimized?: string[]; maximized?: string | null }
const term = (id: string): PaneNode => ({ paneId: id, config: { kind: 'terminal', shellId: 'pwsh', cwd: '' } })
function ws(
  layout: MosaicNode | null,
  ids: string[],
  extra: Partial<{ minimized: string[]; maximized: string | null }> = {}
): VS {
  return { id: 'w', name: 'W', layout, panes: Object.fromEntries(ids.map(i => [i, term(i)])), ...extra }
}
const fixture = (version: number, w: object): string => JSON.stringify({ schemaVersion: version, workspace: w })
const mins = (w: Workspace): string[] => (w as VS).minimized ?? []
const maxd = (w: Workspace): string | null => (w as VS).maximized ?? null

describe('schema bump + migration (REQ-009)', () => {
  // SUPERSEDED point-in-time pin (CONV-019): 0003 bumped 6→7 (historical fact); feature
  // 0009-native-orky-pane (REQ-003) sanctions the 7→8 bump, so the value pin is re-pinned at the
  // current constant in the SAME change as F9's suite (see
  // .orky/features/0009-native-orky-pane/04-tests.md). 0003's real invariant — the v6→v7
  // view-state migration semantics below — is untouched.
  it('TEST-001 REQ-009 SCHEMA_VERSION is the current persisted schema version (0003 bumped 6→7; re-pinned at 8 by 0009 REQ-003)', () => {
    expect(SCHEMA_VERSION).toBe(8)
  })

  it('TEST-002 REQ-009 a prior-version record (no view-state) loads with empty view-state and no data loss', () => {
    for (const v of [3, 6]) {
      const w = deserializeWorkspace(fixture(v, { id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') } }))
      expect(w.panes['p1']).toBeDefined() // pane data preserved (no silent drop)
      expect(mins(w)).toEqual([])
      expect(maxd(w)).toBeNull()
    }
  })

  it('TEST-003 REQ-009 a dangling view-state paneId is pruned on load; the rest is retained', () => {
    const w = deserializeWorkspace(fixture(7, {
      id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') },
      minimized: ['p1', 'ghost'], maximized: 'ghost2'
    }))
    expect(mins(w)).toEqual(['p1']) // 'ghost' not in panes -> dropped
    expect(maxd(w)).toBeNull()      // 'ghost2' not in panes -> dropped
  })

  it('TEST-004 REQ-009 malformed view-state deserializes to empty, not a throw (CONV-002)', () => {
    let w!: Workspace
    expect(() => {
      w = deserializeWorkspace(fixture(7, {
        id: 'w', name: 'W', layout: 'p1', panes: { p1: term('p1') },
        minimized: 'not-an-array', maximized: { bad: true }
      }))
    }).not.toThrow()
    expect(mins(w)).toEqual([])
    expect(maxd(w)).toBeNull()
  })

  it('TEST-005 REQ-009 no silent cap: every minimized pane is retained (CONV-003 / DF2)', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`)
    const panes = Object.fromEntries(ids.map(i => [i, term(i)]))
    const w = deserializeWorkspace(fixture(7, { id: 'w', name: 'W', layout: 'p0', panes, minimized: ids }))
    expect(mins(w)).toHaveLength(30)
  })
})

describe('round-trip persistence (REQ-007 / REQ-008)', () => {
  it('TEST-006 REQ-007 a minimized flag round-trips through serialize -> deserialize', () => {
    const back = deserializeWorkspace(serializeWorkspace(ws('p2', ['p1', 'p2'], { minimized: ['p1'] })))
    expect(mins(back)).toEqual(['p1'])
  })

  it('TEST-007 REQ-008 a maximized flag round-trips through serialize -> deserialize', () => {
    const back = deserializeWorkspace(serializeWorkspace(ws('p1', ['p1'], { maximized: 'p1' })))
    expect(maxd(back)).toBe('p1')
  })
})

describe('no content/secrets persisted (REQ-016)', () => {
  it('TEST-008 REQ-016 persisted view-state holds only paneId refs/flags — no scrollback/output/secrets', () => {
    const json = serializeWorkspace(ws('p1', ['p1', 'p2'], { minimized: ['p2'], maximized: 'p1' }))
    const parsed = JSON.parse(json).workspace as VS
    expect(Array.isArray(parsed.minimized)).toBe(true)
    for (const id of parsed.minimized ?? []) expect(typeof id).toBe('string')
    expect(typeof parsed.maximized === 'string' || parsed.maximized === null).toBe(true)
    for (const banned of ['scrollback', 'transcript', 'secret', 'output']) {
      expect(json.toLowerCase()).not.toContain(banned)
    }
  })
})

// ── Loop-back 2 (from review) ───────────────────────────────────────────────────────────────────
// FINDING-CODEX-002 (contract): normalizeViewState prunes dangling refs but does NOT enforce REQ-010
// mutual exclusion on the LOAD path — a persisted record with the same valid pane id in BOTH fields
// loads with both intact. TASK-014 must clear `maximized` when it also appears in `minimized`
// (minimize wins — the same precedence `minimizePane` uses), so runtime and load paths agree.
describe('load-path mutual exclusion (REQ-010 / REQ-009)', () => {
  it('TEST-039 REQ-010 a v7 record with the same pane id in BOTH minimized and maximized loads mutual-exclusive (minimize wins)', () => {
    const w = deserializeWorkspace(fixture(7, {
      id: 'w', name: 'W', layout: 'p2', panes: { p1: term('p1'), p2: term('p2') },
      minimized: ['p1'], maximized: 'p1' // SAME valid pane in both — incoherent on disk
    }))
    expect(mins(w)).toContain('p1') // minimize wins — the pane stays minimized
    expect(maxd(w)).toBeNull()      // …and its maximize is cleared (never both for one pane)
  })

  it('TEST-039 REQ-010 a DIFFERENT maximized pane is preserved (only the same-pane conflict is normalized)', () => {
    const w = deserializeWorkspace(fixture(7, {
      id: 'w', name: 'W', layout: 'p2', panes: { p1: term('p1'), p2: term('p2') },
      minimized: ['p1'], maximized: 'p2' // distinct panes may coexist (REQ-010)
    }))
    expect(mins(w)).toEqual(['p1'])
    expect(maxd(w)).toBe('p2')
  })
})
