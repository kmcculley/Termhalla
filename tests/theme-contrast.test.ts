import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, themeCssVars, themeCssVarsPartial } from '../src/shared/theme'
import { contrastRatio, readableOn } from '../src/shared/contrast'

const t = DEFAULT_THEME

describe('default theme readability (WCAG AA)', () => {
  it('body + dim text clear 4.5:1 on both backgrounds', () => {
    for (const bg of [t.windowBg, t.elevatedBg]) {
      expect(contrastRatio(t.text, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(t.textDim, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('adaptive alert-bar text is readable (needs 4.5, busy 3.0 bold-title)', () => {
    expect(contrastRatio(readableOn(t.statusNeedsInput), t.statusNeedsInput)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(readableOn(t.statusBusy), t.statusBusy)).toBeGreaterThanOrEqual(3.0)
  })
  it('themeCssVars exposes the derived on-colors', () => {
    const v = themeCssVars(t)
    expect(v['--on-busy']).toBe(readableOn(t.statusBusy))
    expect(v['--on-needs']).toBe(readableOn(t.statusNeedsInput))
  })
  it('themeCssVarsPartial emits an on-color only when its status color is overridden', () => {
    expect(themeCssVarsPartial({ statusNeedsInput: '#ffffff' })['--on-needs']).toBe('#182026')
    expect('--on-needs' in themeCssVarsPartial({ accent: '#123456' })).toBe(false)
  })
})
