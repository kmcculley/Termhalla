import type { Theme } from './types'
import { readableOn } from './contrast'

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

/** Built-in light theme (QoL 2026-07-17): light mode used to mean hand-editing 11 color pickers.
 *  One click in Appearance (or follow-system) applies this whole set. */
export const LIGHT_THEME: Theme = {
  windowBg: '#f3f3f3',
  panelBg: '#ececec',
  elevatedBg: '#ffffff',
  border: '#c8c8c8',
  text: '#1f1f1f',
  textDim: '#616161',
  accent: '#0066bf',
  statusBusy: '#0066bf',
  statusNeedsInput: '#b25e00',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 13,
  termBg: '#ffffff',
  termFg: '#1f1f1f',
  termFontFamily: "'Consolas', 'Cascadia Mono', monospace",
  termFontSize: 13
}

/** Fill any missing tokens from defaults (forward-compatible with older persisted themes). */
export function mergeTheme(partial: Partial<Theme> | undefined): Theme {
  return { ...DEFAULT_THEME, ...(partial ?? {}) }
}

/** UI design tokens as CSS custom properties (sizes get a px suffix). Driven by the SAME
 *  exhaustiveness-checked `VAR_OF` map as `themeCssVarsPartial` — the token→var mapping exists
 *  exactly once — plus the derived readable text colors:
 *  - `--on-busy` / `--on-needs` for the saturated alert bars (luminance-adaptive);
 *  - `--fg-on-elevated` for elevated surfaces (menus, modals, Settings), so a light theme's light
 *    elevated bg gets dark text instead of staying light-on-light. */
export function themeCssVars(t: Theme): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(VAR_OF) as (keyof Theme)[]) {
    out[VAR_OF[k]] = SIZE_KEYS.has(k) ? `${t[k]}px` : String(t[k])
  }
  out['--on-busy'] = readableOn(t.statusBusy)
  out['--on-needs'] = readableOn(t.statusNeedsInput)
  out['--fg-on-elevated'] = readableOn(t.elevatedBg)
  return out
}

/** Effective theme for a pane: app < workspace < pane overrides. */
export function resolveTheme(app: Partial<Theme> | undefined, ws: Partial<Theme> | undefined, pane: Partial<Theme> | undefined): Theme {
  return mergeTheme({ ...(app ?? {}), ...(ws ?? {}), ...(pane ?? {}) })
}

const VAR_OF: Record<keyof Theme, string> = {
  windowBg: '--bg', panelBg: '--panel', elevatedBg: '--elevated', border: '--border',
  text: '--fg', textDim: '--fg-dim', accent: '--accent', statusBusy: '--status-busy',
  statusNeedsInput: '--status-needs', fontFamily: '--font', fontSize: '--font-size',
  termBg: '--term-bg', termFg: '--term-fg', termFontFamily: '--term-font', termFontSize: '--term-font-size'
}
const SIZE_KEYS = new Set<keyof Theme>(['fontSize', 'termFontSize'])

/** CSS variables for only the tokens present in a partial theme (override layers). */
export function themeCssVarsPartial(partial: Partial<Theme>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(partial) as (keyof Theme)[]) {
    const v = partial[k]
    if (v === undefined) continue
    out[VAR_OF[k]] = SIZE_KEYS.has(k) ? `${v}px` : String(v)
  }
  // Recompute the readable alert-text color for whichever alert color this scope overrides,
  // so per-workspace/pane alert-color overrides stay legible.
  if (partial.statusBusy !== undefined) out['--on-busy'] = readableOn(partial.statusBusy)
  if (partial.statusNeedsInput !== undefined) out['--on-needs'] = readableOn(partial.statusNeedsInput)
  if (partial.elevatedBg !== undefined) out['--fg-on-elevated'] = readableOn(partial.elevatedBg)
  return out
}
