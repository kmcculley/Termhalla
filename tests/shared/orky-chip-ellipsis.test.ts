// The Orky chip's ellipsis discipline (FINDING-UX-004). The chip is a fixed-max-width button and
// used to END-ellipsize its whole label, so a long feature slug swallowed the actionable tail
// (`phase · gate N/M · ●k open`) while the least actionable part — the slug — always survived.
// The fix is structural, not textual: `splitChipLabel` separates the slug from the tail so the
// render can shrink-clip the SLUG span while the tail span never shrinks. The label string itself
// is unchanged (TEST-016's pins stay byte-identical).
import { describe, it, expect } from 'vitest'
import { splitChipLabel } from '../../src/renderer/components/pane-status'

describe('splitChipLabel', () => {
  it('splits the chip feature slug from the actionable tail', () => {
    expect(splitChipLabel('auth · implement · 5/8 · ●2 open', 'auth')).toEqual({
      slug: 'auth', tail: ' · implement · 5/8 · ●2 open'
    })
  })
  it('handles a slug that is itself the whole label (no tail)', () => {
    expect(splitChipLabel('auth', 'auth')).toEqual({ slug: 'auth', tail: '' })
  })
  it('falls back to the whole label when it does not start with the chip feature', () => {
    expect(splitChipLabel('something else', 'auth')).toEqual({ slug: 'something else', tail: '' })
  })
  it('falls back for a null chip feature', () => {
    expect(splitChipLabel('auth · spec · 1/8', null)).toEqual({ slug: 'auth · spec · 1/8', tail: '' })
  })
  it('never mistakes a slug-PREFIXED feature for the slug (splits only at the separator)', () => {
    expect(splitChipLabel('auth-ui · spec · 1/8', 'auth')).toEqual({ slug: 'auth-ui · spec · 1/8', tail: '' })
  })
})
