import type { Theme } from './types'

export const DEFAULT_THEME: Theme = {
  windowBg: '#1e1e1e',
  panelBg: '#1e1e1e',
  elevatedBg: '#252526',
  border: '#444444',
  text: '#eeeeee',
  textDim: '#aaaaaa',
  accent: '#1e88e5',
  statusBusy: '#1e88e5',
  statusNeedsInput: '#ff8f00',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 13,
  termBg: '#000000',
  termFg: '#ffffff',
  termFontFamily: "'Consolas', 'Cascadia Mono', monospace",
  termFontSize: 13
}

/** Fill any missing tokens from defaults (forward-compatible with older persisted themes). */
export function mergeTheme(partial: Partial<Theme> | undefined): Theme {
  return { ...DEFAULT_THEME, ...(partial ?? {}) }
}

/** UI design tokens as CSS custom properties (sizes get a px suffix). */
export function themeCssVars(t: Theme): Record<string, string> {
  return {
    '--bg': t.windowBg,
    '--panel': t.panelBg,
    '--elevated': t.elevatedBg,
    '--border': t.border,
    '--fg': t.text,
    '--fg-dim': t.textDim,
    '--accent': t.accent,
    '--status-busy': t.statusBusy,
    '--status-needs': t.statusNeedsInput,
    '--font': t.fontFamily,
    '--font-size': `${t.fontSize}px`,
    '--term-bg': t.termBg,
    '--term-fg': t.termFg,
    '--term-font': t.termFontFamily,
    '--term-font-size': `${t.termFontSize}px`
  }
}
