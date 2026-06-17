import { describe, it, expect } from 'vitest'
import { relativeLuminance, contrastRatio, readableOn } from '../src/shared/contrast'

describe('contrast', () => {
  it('relativeLuminance: black 0, white 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
  it('contrastRatio: white/black is 21, symmetric', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })
  it('parses 3-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1)
  })
  it('readableOn: dark text on bright bars, light text on dark bg', () => {
    expect(readableOn('#ff8f00')).toBe('#182026') // orange → dark
    expect(readableOn('#1e88e5')).toBe('#182026') // busy blue → dark
    expect(readableOn('#1e1e1e')).toBe('#ffffff') // near-black → white
  })
  it('readableOn honors custom dark/light tokens', () => {
    expect(readableOn('#ffffff', 'D', 'L')).toBe('D')
    expect(readableOn('#000000', 'D', 'L')).toBe('L')
  })
})
