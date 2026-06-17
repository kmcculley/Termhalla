import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, mergeTheme, themeCssVars } from '../../src/shared/theme'
import { resolveTheme, themeCssVarsPartial } from '../../src/shared/theme'
import { readableOn } from '../../src/shared/contrast'

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
  it('derives --fg-on-elevated from the elevated background luminance', () => {
    const v = themeCssVars(DEFAULT_THEME)
    expect(v['--fg-on-elevated']).toBe(readableOn(DEFAULT_THEME.elevatedBg))
  })
})

describe('resolveTheme', () => {
  it('layers app < workspace < pane', () => {
    const r = resolveTheme({ windowBg: '#111111', panelBg: '#222222' }, { panelBg: '#333333' }, { termBg: '#444444' })
    expect(r.windowBg).toBe('#111111')
    expect(r.panelBg).toBe('#333333')
    expect(r.termBg).toBe('#444444')
    expect(r.text).toBe(DEFAULT_THEME.text)
  })
  it('handles all-undefined', () => {
    expect(resolveTheme(undefined, undefined, undefined)).toEqual(DEFAULT_THEME)
  })
})

describe('themeCssVarsPartial', () => {
  it('maps only present tokens (px on sizes)', () => {
    const v = themeCssVarsPartial({ panelBg: '#abcdef', fontSize: 18 })
    expect(v).toEqual({ '--panel': '#abcdef', '--font-size': '18px' })
  })
  it('recomputes --fg-on-elevated only when elevatedBg is overridden', () => {
    expect(themeCssVarsPartial({ panelBg: '#abcdef' })['--fg-on-elevated']).toBeUndefined()
    const light = themeCssVarsPartial({ elevatedBg: '#f5f5f5' })
    expect(light['--elevated']).toBe('#f5f5f5')
    expect(light['--fg-on-elevated']).toBe(readableOn('#f5f5f5'))
  })
})
