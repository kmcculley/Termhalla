import { useEffect } from 'react'
import { useStore } from '../store'
import { mergeTheme, themeCssVars } from '@shared/theme'
import { monaco } from '../editor/monaco-setup'

export function ThemeProvider() {
  const quickTheme = useStore(s => s.quick.theme)
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
    }, 150)
    return () => clearTimeout(id)
  }, [quickTheme])
  return null
}
