// FROZEN unit suite — feature 0003-pane-minimize-restore (phase 4 / TASK-002 pure reducers).
// Pins the OBSERVABLE behaviour of the pure view-state reducers the store wires up. These run RED
// today: `minimizePane`/`restorePane`/`computeVisibleLayout` are not yet exported from
// `@shared/workspace-model`, and `movePane`/`removePane` do not yet prune view-state. The reducers
// must live in (or be re-exported from) `@shared/workspace-model` so this import resolves.
import { describe, it, expect } from 'vitest'
import { minimizePane, restorePane, computeVisibleLayout, movePane, removePane } from '@shared/workspace-model'
import type { Workspace, PaneNode, MosaicNode } from '@shared/types'

// The persisted view-state fields TASK-001 adds to Workspace. Declared locally so this test
// type-checks cleanly once they exist, and reads them tolerantly before then.
type VS = Workspace & { minimized?: string[]; maximized?: string | null }

const term = (id: string): PaneNode => ({ paneId: id, config: { kind: 'terminal', shellId: 'pwsh', cwd: '' } })

function ws(
  layout: MosaicNode | null,
  ids: string[],
  extra: Partial<{ minimized: string[]; maximized: string | null }> = {}
): VS {
  return { id: 'w', name: 'W', layout, panes: Object.fromEntries(ids.map(i => [i, term(i)])), ...extra }
}
const mins = (w: Workspace): string[] => (w as VS).minimized ?? []
const maxd = (w: Workspace): string | null => (w as VS).maximized ?? null

describe('minimize reflow + visible layout (REQ-002 / REQ-011)', () => {
  it('TEST-009 REQ-002 minimizing a pane reflows: the sibling fills the freed space and the pane stays alive', () => {
    const w = ws({ direction: 'row', first: 'a', second: 'b' }, ['a', 'b'])
    const r = minimizePane(w, 'b')
    expect(mins(r)).toContain('b')
    // The visible layout drops the minimized leaf so the sibling occupies the whole area —
    // true reflow, not a blank gap.
    expect(computeVisibleLayout(r)).toBe('a')
    // The pane is NOT torn down — it stays in `panes` (kept-mounted off-layout).
    expect(r.panes['b']).toBeDefined()
  })

  it('TEST-010 REQ-002/REQ-011 computeVisibleLayout is null when every pane is minimized', () => {
    let r = minimizePane(ws({ direction: 'row', first: 'a', second: 'b' }, ['a', 'b']), 'a')
    r = minimizePane(r, 'b')
    expect(computeVisibleLayout(r)).toBeNull()
  })
})

describe('restore placement (REQ-006)', () => {
  it('TEST-011 REQ-006 restoring into a non-empty layout splits the pane to the right (new second)', () => {
    const w = ws('a', ['a', 'b'], { minimized: ['b'] }) // 'a' visible, 'b' minimized
    const r = restorePane(w, 'b')
    expect(mins(r)).not.toContain('b')
    expect(computeVisibleLayout(r)).toEqual({ direction: 'row', first: 'a', second: 'b' })
  })

  it('TEST-012 REQ-006 restoring into an empty visible layout makes the pane the sole leaf', () => {
    const w = ws(null, ['a'], { minimized: ['a'] }) // all-minimized branch
    const r = restorePane(w, 'a')
    expect(mins(r)).not.toContain('a')
    expect(computeVisibleLayout(r)).toBe('a')
  })
})

describe('minimize vs maximize precedence (REQ-010)', () => {
  it('TEST-013 REQ-010 minimizing the maximized pane clears its maximize (mutual exclusion)', () => {
    const w = ws({ direction: 'row', first: 'a', second: 'b' }, ['a', 'b'], { maximized: 'a' })
    const r = minimizePane(w, 'a')
    expect(maxd(r)).toBeNull()
    expect(mins(r)).toContain('a')
  })

  it('TEST-014 REQ-010 a minimized pane and a DIFFERENT maximized pane coexist', () => {
    const w = ws({ direction: 'row', first: 'a', second: 'b' }, ['a', 'b'], { maximized: 'a' })
    const r = minimizePane(w, 'b')
    expect(maxd(r)).toBe('a')
    expect(mins(r)).toContain('b')
  })
})

describe('idempotent / total operations (REQ-017)', () => {
  it('TEST-015 REQ-017 minimizing twice yields a single entry (idempotent, no duplicate chip)', () => {
    const once = minimizePane(ws({ direction: 'row', first: 'a', second: 'b' }, ['a', 'b']), 'b')
    const twice = minimizePane(once, 'b')
    expect(mins(twice).filter(id => id === 'b')).toEqual(['b'])
  })

  it('TEST-016 REQ-017 restore on a non-minimized pane and ops on unknown ids are no-ops (unchanged ref)', () => {
    const w = ws('a', ['a'], { minimized: [] })
    expect(restorePane(w, 'a')).toBe(w)    // not minimized -> unchanged
    expect(restorePane(w, 'zzz')).toBe(w)  // unknown -> unchanged
    expect(minimizePane(w, 'zzz')).toBe(w) // unknown -> unchanged
  })

  it('TEST-017 REQ-017 removePane (closePane path) drops the closed pane from view-state — no orphan', () => {
    const w = ws({ direction: 'row', first: 'a', second: 'b' }, ['a', 'b'], { minimized: ['b'], maximized: 'b' })
    const r = removePane(w, 'b')
    expect(mins(r)).not.toContain('b')
    expect(maxd(r)).toBeNull()
    expect(r.panes['b']).toBeUndefined()
  })
})

describe('cross-workspace move clears the minimized flag (REQ-015)', () => {
  it('TEST-018 REQ-015 moving a minimized pane drops its flag in the source and lands visible in the destination', () => {
    const from = ws({ direction: 'row', first: 'a', second: 'x' }, ['a', 'x'], { minimized: ['a', 'x'] })
    const to = ws(null, [], { minimized: [] })
    const r = movePane(from, to, 'a')
    expect(mins(r.from)).toEqual(['x']) // 'a' dropped, 'x' retained — other entries intact
    expect(mins(r.to)).not.toContain('a') // appears in the destination's VISIBLE layout
    expect(r.to.panes['a']).toBeDefined()
  })
})
