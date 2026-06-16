import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/persistence/store'
import { createWorkspace, addFirstPane } from '@shared/workspace-model'
import { SCHEMA_VERSION, type TerminalConfig } from '@shared/types'

const term: TerminalConfig = { kind: 'terminal', shellId: 'cmd', cwd: 'C:\\' }
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-')) })

describe('WorkspaceStore', () => {
  it('saves and re-reads a workspace', async () => {
    const store = new WorkspaceStore(dir)
    const ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term, () => 'p1').workspace
    await store.saveWorkspace(ws)
    const loaded = await store.loadWorkspace('ws-1')
    expect(loaded).toEqual(ws)
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists saved workspace ids', async () => {
    const store = new WorkspaceStore(dir)
    await store.saveWorkspace(createWorkspace('A', () => 'ws-a'))
    await store.saveWorkspace(createWorkspace('B', () => 'ws-b'))
    expect((await store.listWorkspaceIds()).sort()).toEqual(['ws-a', 'ws-b'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips app-state (windows[])', async () => {
    const store = new WorkspaceStore(dir)
    const bounds = { width: 1200, height: 800, x: 0, y: 0, maximized: false }
    const state = { schemaVersion: SCHEMA_VERSION, windows: [{ workspaceIds: ['ws-1'], activeId: 'ws-1', bounds, isMain: true }] }
    await store.saveAppState(state)
    expect(await store.loadAppState()).toEqual(state)
    rmSync(dir, { recursive: true, force: true })
  })

  it('migrates a legacy single-window app-state on load', async () => {
    const store = new WorkspaceStore(dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'app-state.json'),
      JSON.stringify({ schemaVersion: 1, openWorkspaceIds: ['x'], activeWorkspaceId: 'x' }), 'utf8')
    const loaded = await store.loadAppState()
    expect(loaded?.windows).toHaveLength(1)
    expect(loaded?.windows[0]).toMatchObject({ workspaceIds: ['x'], activeId: 'x', isMain: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null for a missing workspace', async () => {
    const store = new WorkspaceStore(dir)
    expect(await store.loadWorkspace('nope')).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('degrades a corrupt workspace file to null instead of throwing', async () => {
    const store = new WorkspaceStore(dir)
    mkdirSync(join(dir, 'workspaces'), { recursive: true })
    writeFileSync(join(dir, 'workspaces', 'bad.json'), '{ not valid json', 'utf8')
    await expect(store.loadWorkspace('bad')).resolves.toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null for a structurally-invalid app-state', async () => {
    const store = new WorkspaceStore(dir)
    await store.saveAppState({ schemaVersion: SCHEMA_VERSION, windows: [] })
    writeFileSync(join(dir, 'app-state.json'), '{"noSchemaVersion":true}', 'utf8')
    await expect(store.loadAppState()).resolves.toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})
