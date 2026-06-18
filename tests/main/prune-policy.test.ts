import { describe, it, expect } from 'vitest'
import { overage, SEGMENT_CAP } from '../../src/main/search/prune-policy'

describe('overage', () => {
  it('is 0 at or below the cap', () => {
    expect(overage(0, 100)).toBe(0)
    expect(overage(100, 100)).toBe(0)
  })
  it('is the exact overage above the cap', () => {
    expect(overage(105, 100)).toBe(5)
  })
  it('exposes a sane default cap', () => {
    expect(SEGMENT_CAP).toBeGreaterThan(1000)
  })
})
