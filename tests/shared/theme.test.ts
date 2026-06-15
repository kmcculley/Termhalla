import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, mergeTheme, themeCssVars } from '../../src/shared/theme'

describe('mergeTheme', () => {
  it('returns defaults for undefined', () => {
    expect(mergeTheme(undefined)).toEqual(DEFAULT_THEME)
  })
  it('overrides only provided tokens', () => {
    const t = mergeTheme({ windowBg: '#123456', fontSize: 16 })
    expect(t.windowBg).toBe('#123456')
    expect(t.fontSize).toBe(16)
    expect(t.panelBg).toBe(DEFAULT_THEME.panelBg)
  })
})

describe('themeCssVars', () => {
  it('maps tokens to CSS variables with px on sizes', () => {
    const v = themeCssVars(DEFAULT_THEME)
    expect(v['--bg']).toBe(DEFAULT_THEME.windowBg)
    expect(v['--panel']).toBe(DEFAULT_THEME.panelBg)
    expect(v['--font-size']).toBe(`${DEFAULT_THEME.fontSize}px`)
    expect(v['--term-font-size']).toBe(`${DEFAULT_THEME.termFontSize}px`)
    expect(v['--accent']).toBe(DEFAULT_THEME.accent)
  })
})
