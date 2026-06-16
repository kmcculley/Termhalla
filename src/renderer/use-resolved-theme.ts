import { useMemo } from 'react'
import { resolveTheme } from '@shared/theme'
import type { Theme } from '@shared/types'
import { useStore } from './store'

/** Resolve the effective theme for one pane (app default ← workspace override ← pane override),
 *  re-resolving only when one of those three inputs changes. Shared by EditorPane and
 *  TerminalPane, which previously duplicated this subscription + resolve verbatim. */
export function useResolvedPaneTheme(wsId: string, paneTheme?: Partial<Theme>): Theme {
  const appTheme = useStore(s => s.quick.theme)
  const wsTheme = useStore(s => s.workspaces[wsId]?.theme)
  return useMemo(() => resolveTheme(appTheme, wsTheme, paneTheme), [appTheme, wsTheme, paneTheme])
}
