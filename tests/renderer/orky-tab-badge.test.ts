// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / REQ-009, REQ-016 tab-badge roll-up).
// A workspace tab lights its needs-you badge when ANY Orky pane has a `needsHuman` feature, folded
// through the SAME `workspaceBadgeState` aggregation and the SAME `resolveAlerts(cfg.alerts).tabBadge`
// opt-in that gates terminal needs-input. A non-Orky pane (or one with only idle/busy/done features)
// contributes nothing.
//
// Chosen contract (the spec extends the existing signature — see 04-tests.md):
//   workspaceBadgeState(ws, statuses, aiSessions, orky?: Record<string, OrkyPaneStatus>)
// The 4th arg is the per-pane Orky status map; existing 3-arg callers are unaffected.
//
// Runs RED today: the current `workspaceBadgeState` ignores any 4th argument, so an Orky `needsHuman`
// pane is NOT folded into `needs` (TEST-022 first assertion fails). The file imports fine.
import { describe, it, expect } from 'vitest'
import { workspaceBadgeState } from '../../src/renderer/components/tab-badge'
import type { Workspace } from '@shared/types'

const term = (over: Record<string, unknown> = {}) => ({ config: { kind: 'terminal', shellId: 'cmd', cwd: '', ...over } })
const ws = (panes: Record<string, unknown>) => ({ id: 'w', name: 'W', layout: 'x', panes } as unknown as Workspace)

describe('workspaceBadgeState — Orky roll-up + opt-in (REQ-009 / REQ-016)', () => {
  it('TEST-022 REQ-009 folds an Orky pane with a needsHuman feature into the needs count (opt-in on)', () => {
    const s = workspaceBadgeState(
      ws({ p1: term() }),
      { p1: { state: 'busy' } } as never,
      {},
      { p1: { needsHuman: true } } as never
    )
    expect(s.needs).toBeGreaterThanOrEqual(1) // an Orky needs-you pane contributes like a terminal needs-input pane
  })

  it('TEST-022 REQ-009 an Orky pane with only idle/busy/done features contributes no needs', () => {
    const s = workspaceBadgeState(
      ws({ p1: term() }),
      { p1: { state: 'busy' } } as never,
      {},
      { p1: { needsHuman: false } } as never
    )
    expect(s.needs).toBe(0)
  })

  it('TEST-023 REQ-009/REQ-016 the Orky needs contribution respects the tabBadge opt-in', () => {
    const s = workspaceBadgeState(
      ws({ p1: term({ alerts: { tabBadge: false } }) }),
      { p1: { state: 'idle' } } as never,
      {},
      { p1: { needsHuman: true } } as never
    )
    expect(s.needs).toBe(0) // opt-in OFF suppresses the badge summary (border/chip handled elsewhere — REQ-016)
  })
})
