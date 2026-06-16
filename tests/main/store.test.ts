import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/persistence/store'
import { createWorkspace, addFirstPane } from '@shared/workspace-model'
import type { TerminalConfig } from '@shared/types'

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

  it('round-trips app-state', async () => {
    const store = new WorkspaceStore(dir)
    const state = { schemaVersion: 1, openWorkspaceIds: ['ws-1'], activeWorkspaceId: 'ws-1' }
    await store.saveAppState(state)
    expect(await store.loadAppState()).toEqual(state)
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
    await store.saveAppState({ schemaVersion: 1, openWorkspaceIds: [], activeWorkspaceId: null })
    writeFileSync(join(dir, 'app-state.json'), '{"openWorkspaceIds":"oops"}', 'utf8')
    await expect(store.loadAppState()).resolves.toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})
