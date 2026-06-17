import type { Theme, Workspace } from '@shared/types'
import { mergeTheme, resolveTheme } from '@shared/theme'
import type { ThemeScope } from '../store/types'

/** A theme-settings scope selection. Encoded as a string so it can back a plain `<select>`; the
 *  helpers below turn it into the structured `ThemeScope` / resolved `Theme` the cascade needs. */
export type Selection = 'app' | 'workspace' | `pane:${string}`

/** The pane id a selection targets, or null for app/workspace scopes. */
export function panePidOf(sel: string): string | null {
  return sel.startsWith('pane:') ? sel.slice(5) : null
}

/** The structured cascade scope a selection denotes. `activeId` backs the non-app scopes. */
export function selectionToScope(sel: string, activeId: string): ThemeScope {
  if (sel === 'app') return { kind: 'app' }
  if (sel === 'workspace') return { kind: 'workspace', wsId: activeId }
  return { kind: 'pane', wsId: activeId, paneId: sel.slice(5) }
}

/** The theme to display for a selection, resolving the cascade (app → workspace → pane) up to
 *  that scope's depth. */
export function resolvedForSelection(
  sel: string,
  quickTheme: Partial<Theme> | undefined,
  ws: Workspace | null
): Theme {
  if (sel === 'app') return mergeTheme(quickTheme)
  if (sel === 'workspace') return resolveTheme(quickTheme, ws?.theme, undefined)
  const pane = ws?.panes[sel.slice(5)]
  return resolveTheme(quickTheme, ws?.theme, pane?.config.theme)
}
