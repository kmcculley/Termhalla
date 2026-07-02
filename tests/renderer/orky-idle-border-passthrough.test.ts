// Hardening suite — Orky idle roll-up must not mask the byte-derived border/failure treatment.
// `orkyPaneStatus([])` returns a NON-null idle roll-up (`chipFeature: null`) whenever a project has no
// popover-eligible features (src/shared/orky-status.ts), and PaneTile previously keyed the border
// precedence on the roll-up merely being PRESENT — so a terminal sitting in an idle Orky project lost
// its real busy/needs-input border and its `lastExit: 'failure'` treatment while the chip correctly hid
// itself (PaneToolbar gates on `orky.chipFeature`). The precedence now keys on the SAME `chipFeature`
// condition the chip uses, via the pure `paneBorderStatus` helper (src/renderer/components/
// pane-status.ts — extracted the way `tab-badge.ts` extracts the badge aggregation, since the node
// vitest harness has no jsdom to render PaneTile itself).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { paneBorderStatus } from '../../src/renderer/components/pane-status'
import { orkyPaneStatus } from '@shared/orky-status'
import type { OrkyFeatureStatus } from '@shared/types'

/** The REAL idle roll-up shape — built through the shipped mapper, not hand-forged, so this suite
 *  fails if `orkyPaneStatus([])` ever stops producing the `chipFeature: null` idle shape it does today. */
const idleRollup = orkyPaneStatus([])

const feat = (over: Partial<OrkyFeatureStatus> = {}): OrkyFeatureStatus => ({
  feature: 'auth', kind: 'busy', phase: 'implement', gateN: 5, gateM: 8, openBlocking: 0,
  needsHuman: false, failed: false, reason: null, lastActivityAt: 0, detail: 'auth: implement in progress',
  ...over
})

describe('paneBorderStatus — idle Orky roll-up falls through to the byte status (chip-condition parity)', () => {
  it('an idle Orky roll-up (kind idle, chipFeature null) over a BUSY terminal shows the busy border', () => {
    expect(idleRollup.chipFeature).toBeNull() // sanity: this IS the non-null idle shape the bug keyed on
    expect(paneBorderStatus(idleRollup, 'busy', undefined)).toEqual({ state: 'busy', failed: false })
    expect(paneBorderStatus(idleRollup, 'needs-input', undefined)).toEqual({ state: 'needs-input', failed: false })
  })

  it('an idle Orky roll-up + lastExit failure shows the failure treatment', () => {
    expect(paneBorderStatus(idleRollup, 'idle', 'failure')).toEqual({ state: 'idle', failed: true })
  })

  it('a non-idle Orky status with chipFeature set still takes precedence over the byte status', () => {
    const needsInput = orkyPaneStatus([feat({ kind: 'needs-input', needsHuman: true, reason: 'human-review' })])
    expect(needsInput.chipFeature).toBe('auth') // sanity: a chip-bearing roll-up
    expect(paneBorderStatus(needsInput, 'busy', 'failure')).toEqual({ state: 'needs-input', failed: false })

    const failedRun = orkyPaneStatus([feat({ failed: true, kind: 'idle' })])
    expect(paneBorderStatus(failedRun, 'busy', undefined)).toEqual({ state: 'idle', failed: true })
  })

  it('a cleared (absent) Orky status still falls through to the byte status, unchanged behavior', () => {
    expect(paneBorderStatus(undefined, 'busy', 'failure')).toEqual({ state: 'busy', failed: true })
  })
})

describe('PaneTile source — delegates the precedence to paneBorderStatus (the tested logic is the shipped logic)', () => {
  it('composes state/failed via paneBorderStatus and no longer keys on the roll-up merely being present', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/renderer/components/PaneTile.tsx'), 'utf8')
    expect(src).toMatch(/paneBorderStatus\(\s*orky\s*,/)
    // the old presence-keyed ternaries must be gone
    expect(src).not.toMatch(/orky\s*\?\s*ORKY_KIND_TO_TERM/)
    expect(src).not.toMatch(/orky\s*\?\s*orky\.failed/)
  })
})
