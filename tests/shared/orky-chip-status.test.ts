// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / REQ-010 chip-status Orky variant).
// The 0003 `chip-status.ts` model is extended ADDITIVELY so the toolbar chip + minimized-tray chip can
// render an Orky run's state WITHOUT changing the existing `chipStatus` mapping for non-Orky panes.
//
// Chosen contract (the spec/plan left this as "an optional input OR a sibling export" — see 04-tests.md):
//   export function orkyChipStatus(orky: { kind: OrkyKind; needsHuman: boolean; failed: boolean })
//     : { kind: OrkyKind; needsInput: boolean; failed: boolean }
// i.e. a sibling export (so `chipStatus`'s signature/behavior is untouched). `needsInput` mirrors
// `needsHuman`; `kind`/`failed` pass through.
//
// Runs RED today: `orkyChipStatus` is not exported yet (it imports as `undefined` → call throws).
import { describe, it, expect } from 'vitest'
import { chipStatus, orkyChipStatus } from '@shared/chip-status'

describe('chip-status Orky variant (REQ-010)', () => {
  it('TEST-021 REQ-010 surfaces the Orky kind and maps needsHuman → needsInput', () => {
    const ni = orkyChipStatus({ kind: 'needs-input', needsHuman: true, failed: false } as never)
    expect(ni.kind).toBe('needs-input')
    expect(ni.needsInput).toBe(true)

    const busy = orkyChipStatus({ kind: 'busy', needsHuman: false, failed: false } as never)
    expect(busy.kind).toBe('busy')
    expect(busy.needsInput).toBe(false)

    const failed = orkyChipStatus({ kind: 'idle', needsHuman: false, failed: true } as never)
    expect(failed.failed).toBe(true)
  })

  it('TEST-021 REQ-010 leaves the existing non-Orky chipStatus mapping unchanged', () => {
    // additive guard: the 0003 contract for non-Orky panes must stay exactly as before
    expect(chipStatus({ state: 'needs-input', recording: false, ai: false }))
      .toEqual({ state: 'needs-input', needsInput: true, recording: false, ai: false })
    expect(chipStatus({ state: 'busy', recording: false, ai: false }).state).toBe('busy')
  })
})
