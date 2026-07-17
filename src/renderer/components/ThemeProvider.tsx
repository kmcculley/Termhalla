import { useEffect } from 'react'
import { useStore } from '../store'
import { mergeTheme, themeCssVars, DEFAULT_THEME, LIGHT_THEME } from '@shared/theme'
import { monaco } from '../editor/monaco-setup'

/** Defer the Monaco theme define/apply a tick past the CSS-var write so Monaco (which may still be
 *  initializing) is ready and reads the freshly-set colors. */
const MONACO_THEME_DEFER_MS = 150

export function ThemeProvider() {
  const quickTheme = useStore(s => s.quick.theme)
  // Follow the OS light/dark preference (QoL 2026-07-17): while enabled, an OS theme change (or
  // enabling the toggle) applies the matching built-in theme app-wide. Chromium mirrors the OS
  // into prefers-color-scheme, so no main-process nativeTheme plumbing is needed.
  const followSystem = useStore(s => s.quick.themeFollowSystem === true)
  useEffect(() => {
    if (!followSystem) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => useStore.getState().setTheme(mq.matches ? { ...DEFAULT_THEME } : { ...LIGHT_THEME })
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [followSystem])
  useEffect(() => {
    const theme = mergeTheme(quickTheme)
    const root = document.documentElement
    for (const [k, v] of Object.entries(themeCssVars(theme))) root.style.setProperty(k, v)
    const id = setTimeout(() => {
      try {
        monaco.editor.defineTheme('termhalla', { base: 'vs-dark', inherit: true, rules: [],
          colors: { 'editor.background': theme.windowBg, 'editor.foreground': theme.text } })
        monaco.editor.setTheme('termhalla')
      } catch { /* invalid color / not ready */ }
    }, MONACO_THEME_DEFER_MS)
    return () => clearTimeout(id)
  }, [quickTheme])
  return null
}
