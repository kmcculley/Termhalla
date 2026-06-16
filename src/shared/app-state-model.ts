import { SCHEMA_VERSION, type AppState, type WindowState, type WindowLayout } from './types'

/** Normalize any persisted app-state blob to the current multi-window AppState.
 *  `fallbackBounds` seeds the main window's bounds when lifting a legacy state
 *  (legacy bounds lived in window-state.json). Returns null for junk / future versions. */
export function migrateAppState(raw: unknown, fallbackBounds: WindowState): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.schemaVersion !== 'number') return null
  if (o.schemaVersion > SCHEMA_VERSION) return null

  if (Array.isArray(o.windows)) {
    return { schemaVersion: SCHEMA_VERSION, windows: o.windows as WindowLayout[] }
  }
  if (Array.isArray(o.openWorkspaceIds)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      windows: [{
        workspaceIds: o.openWorkspaceIds as string[],
        activeId: (o.activeWorkspaceId as string | null) ?? null,
        bounds: fallbackBounds,
        isMain: true
      }]
    }
  }
  return null
}
