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

  // A malformed persisted entry must never crash startup (window-manager dereferences each entry
  // before any window exists — a throw is a crash-loop until app-state.json is hand-deleted).
  it('drops non-object windows[] entries instead of passing them through', () => {
    const out = migrateAppState({ schemaVersion: SCHEMA_VERSION, windows: [null, 'junk', 7] }, bounds)
    expect(out).toEqual({ schemaVersion: SCHEMA_VERSION, windows: [] })
  })

  it('keeps well-formed entries while dropping malformed siblings', () => {
    const good = { workspaceIds: ['a'], activeId: 'a', bounds, isMain: true }
    const out = migrateAppState({ schemaVersion: SCHEMA_VERSION, windows: [null, good] }, bounds)
    expect(out).toEqual({ schemaVersion: SCHEMA_VERSION, windows: [good] })
  })

  it('coerces junk fields on a windows[] entry to safe defaults', () => {
    const out = migrateAppState({
      schemaVersion: SCHEMA_VERSION,
      windows: [{ workspaceIds: ['a', 5, null], activeId: 42, bounds: 'nope', isMain: 'yes' }]
    }, bounds)
    expect(out).toEqual({
      schemaVersion: SCHEMA_VERSION,
      windows: [{ workspaceIds: ['a'], activeId: null, bounds, isMain: false }]
    })
  })

  it('falls back to fallbackBounds when bounds lack numeric width/height', () => {
    const out = migrateAppState({
      schemaVersion: SCHEMA_VERSION,
      windows: [{ workspaceIds: [], activeId: null, bounds: { width: 100 }, isMain: true }]
    }, bounds)
    expect(out).toEqual({
      schemaVersion: SCHEMA_VERSION,
      windows: [{ workspaceIds: [], activeId: null, bounds, isMain: true }]
    })
  })

  it('normalizes the legacy shape too (non-string ids dropped, junk activeId nulled)', () => {
    const out = migrateAppState(
      { schemaVersion: 1, openWorkspaceIds: ['a', null, 3], activeWorkspaceId: 9 }, bounds)
    expect(out).toEqual({
      schemaVersion: SCHEMA_VERSION,
      windows: [{ workspaceIds: ['a'], activeId: null, bounds, isMain: true }]
    })
  })
})
