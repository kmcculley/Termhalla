import { describe, it, expect } from 'vitest'
import { migrateAppState } from '@shared/app-state-model'
import { SCHEMA_VERSION, type WindowState } from '@shared/types'

const bounds: WindowState = { width: 1200, height: 800, x: 0, y: 0, maximized: false }

describe('migrateAppState', () => {
  it('lifts a legacy single-window state into windows[0] (main)', () => {
    const legacy = { schemaVersion: 1, openWorkspaceIds: ['a', 'b'], activeWorkspaceId: 'b' }
    const out = migrateAppState(legacy, bounds)
    expect(out).toEqual({
      schemaVersion: SCHEMA_VERSION,
      windows: [{ workspaceIds: ['a', 'b'], activeId: 'b', bounds, isMain: true }]
    })
  })

  it('passes a current multi-window state through unchanged', () => {
    const cur = { schemaVersion: SCHEMA_VERSION, windows: [
      { workspaceIds: ['a'], activeId: 'a', bounds, isMain: true },
      { workspaceIds: ['b'], activeId: 'b', bounds, isMain: false }
    ] }
    expect(migrateAppState(cur, bounds)).toEqual(cur)
  })

  it('returns null for an unrecognizable blob', () => {
    expect(migrateAppState({ nonsense: true }, bounds)).toBeNull()
    expect(migrateAppState(null, bounds)).toBeNull()
  })

  it('rejects a future schema version', () => {
    expect(migrateAppState({ schemaVersion: SCHEMA_VERSION + 1, windows: [] }, bounds)).toBeNull()
  })
})
