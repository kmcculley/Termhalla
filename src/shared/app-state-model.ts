import { SCHEMA_VERSION, type AppState, type WindowState, type WindowLayout } from './types'

/** Normalize any persisted app-state blob to the current multi-window AppState.
 *  `fallbackBounds` seeds the main window's bounds when lifting a legacy state
 *  (legacy bounds lived in window-state.json). Returns null for junk / future versions.
 *  Entries are normalized per-field (the `normalizeViewState` posture one file over): a
 *  malformed windows[] entry is dropped, never blind-cast — the consumer dereferences each
 *  entry before any window exists, so a throw there is a startup crash-loop until
 *  app-state.json is hand-deleted. */
export function migrateAppState(raw: unknown, fallbackBounds: WindowState): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.schemaVersion !== 'number') return null
  if (o.schemaVersion > SCHEMA_VERSION) return null

  if (Array.isArray(o.windows)) {
    const windows = o.windows
      .map(w => normalizeWindowLayout(w, fallbackBounds))
      .filter((w): w is WindowLayout => w !== null)
    return { schemaVersion: SCHEMA_VERSION, windows }
  }
  if (Array.isArray(o.openWorkspaceIds)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      windows: [{
        workspaceIds: stringIds(o.openWorkspaceIds),
        activeId: typeof o.activeWorkspaceId === 'string' ? o.activeWorkspaceId : null,
        bounds: fallbackBounds,
        isMain: true
      }]
    }
  }
  return null
}

function normalizeWindowLayout(entry: unknown, fallbackBounds: WindowState): WindowLayout | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const e = entry as Record<string, unknown>
  return {
    workspaceIds: Array.isArray(e.workspaceIds) ? stringIds(e.workspaceIds) : [],
    activeId: typeof e.activeId === 'string' ? e.activeId : null,
    bounds: normalizeBounds(e.bounds, fallbackBounds),
    isMain: e.isMain === true
  }
}

function normalizeBounds(b: unknown, fallback: WindowState): WindowState {
  if (!b || typeof b !== 'object') return { ...fallback }
  const o = b as Record<string, unknown>
  if (!isFiniteNumber(o.width) || !isFiniteNumber(o.height)) return { ...fallback }
  return {
    width: o.width, height: o.height,
    ...(isFiniteNumber(o.x) ? { x: o.x } : {}),
    ...(isFiniteNumber(o.y) ? { y: o.y } : {}),
    maximized: o.maximized === true
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const stringIds = (arr: unknown[]): string[] => arr.filter((x): x is string => typeof x === 'string')
