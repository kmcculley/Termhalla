import { describe, it, expect } from 'vitest'
import { nextFontSize, FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../src/shared/font-zoom'

describe('nextFontSize', () => {
  it('increases by one step when scrolling up (negative deltaY)', () => {
    expect(nextFontSize(13, -100)).toBe(14)
  })
  it('decreases by one step when scrolling down (positive deltaY)', () => {
    expect(nextFontSize(13, 100)).toBe(12)
  })
  it('does not change on a zero-delta wheel event', () => {
    expect(nextFontSize(13, 0)).toBe(13)
  })
  it('clamps at the maximum', () => {
    expect(nextFontSize(FONT_SIZE_MAX, -100)).toBe(FONT_SIZE_MAX)
  })
  it('clamps at the minimum', () => {
    expect(nextFontSize(FONT_SIZE_MIN, 100)).toBe(FONT_SIZE_MIN)
  })
})
