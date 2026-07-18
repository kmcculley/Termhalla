// 2026-07-17 whole-project quality audit, Finding 26 (regression guard, written GREEN before the
// refactor): the `splitDir ? splitDirToLayout(splitDir) : { direction: dir, position: 'after' }`
// derivation was copy-pasted across addTerminal/addEditor/addExplorer/addOrky. It is now folded
// into commitPane (options-object signature); this pins the derived layout semantics through the
// public add* actions so the fold stays behavior-preserving.
//
// Real-store harness with the preload bridge mocked (the orky-cockpit-action.test.ts pattern).
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/renderer/api', () => ({
  api: {
    winReport: vi.fn(),
    loadWorkspace: vi.fn(async () => null),
    saveWorkspace: vi.fn(async () => {}),
    saveQuick: vi.fn(async () => {}),
    notesSet: vi.fn(async () => {}),
    termSnapshot: vi.fn(),
    ptyTransitBegin: vi.fn(),
    registryDetail: vi.fn(async () => ({ ok: false }))
  }
}))

/* eslint-disable @typescript-eslint/no-explicit-any */
async function freshStore(): Promise<{ useStore: any }> {
  vi.resetModules()
  vi.clearAllMocks()   // spy instances survive resetModules — drop call history between tests
  vi.stubGlobal('navigator', { platform: 'Win32' })
  const { useStore } = await import('../../src/renderer/store')
  return { useStore }
}

const S = (useStore: any): any => useStore.getState()

async function seeded(): Promise<{ useStore: any; wsId: string }> {
  const { useStore } = await freshStore()
  useStore.setState({
    windowId: 'win-1', isMainWindow: true,
    shells: [{ id: 'pwsh', label: 'PowerShell 7', path: 'pwsh.exe', args: [] }],
    newTerminalShellId: 'pwsh'
  })
  const wsId = S(useStore).newWorkspace('W')
  return { useStore, wsId }
}

describe('commitPane layout derivation through the public add* actions', () => {
  it('no splitDir: the caller\'s dir applies with position after (target first, new pane second)', async () => {
    const { useStore, wsId } = await seeded()
    const p1 = S(useStore).addTerminal(wsId, null, 'row')
    expect(S(useStore).workspaces[wsId].layout).toBe(p1)   // first pane fills the empty layout

    const p2 = S(useStore).addTerminal(wsId, p1, 'column')
    const lay = S(useStore).workspaces[wsId].layout
    expect(lay.direction).toBe('column')
    expect(lay.first).toBe(p1)
    expect(lay.second).toBe(p2)
  })

  it('splitDir overrides dir AND position: \'left\' yields a row split with the NEW pane first', async () => {
    const { useStore, wsId } = await seeded()
    const p1 = S(useStore).addTerminal(wsId, null, 'row')
    const p2 = S(useStore).addTerminal(wsId, p1, 'column', 'left')
    const lay = S(useStore).workspaces[wsId].layout
    expect(lay.direction).toBe('row')      // splitDir wins over the passed 'column'
    expect(lay.first).toBe(p2)             // 'left' = before
    expect(lay.second).toBe(p1)
  })

  it('splitDir \'down\' yields a column split with the new pane second; addEditor marks lastEditorPaneId', async () => {
    const { useStore, wsId } = await seeded()
    const p1 = S(useStore).addTerminal(wsId, null, 'row')
    const pEd = S(useStore).addEditor(wsId, p1, 'row', 'down')
    const lay = S(useStore).workspaces[wsId].layout
    expect(lay.direction).toBe('column')
    expect(lay.first).toBe(p1)
    expect(lay.second).toBe(pEd)
    expect(S(useStore).lastEditorPaneId).toBe(pEd)
    expect(S(useStore).workspaces[wsId].panes[pEd].config.kind).toBe('editor')
  })

  it('addExplorer and addOrky thread their root verbatim through the shared commit', async () => {
    const { useStore, wsId } = await seeded()
    const p1 = S(useStore).addTerminal(wsId, null, 'row')
    const pEx = S(useStore).addExplorer(wsId, p1, 'row', 'C:\\repo')
    expect(S(useStore).workspaces[wsId].panes[pEx].config).toEqual({ kind: 'explorer', root: 'C:\\repo' })
    const pOr = S(useStore).addOrky(wsId, p1, 'row', 'C:\\proj')
    expect(S(useStore).workspaces[wsId].panes[pOr].config).toEqual({ kind: 'orky', root: 'C:\\proj' })
  })

  it('a new pane commit clears the workspace\'s maximize so the fresh pane is visible', async () => {
    const { useStore, wsId } = await seeded()
    const p1 = S(useStore).addTerminal(wsId, null, 'row')
    S(useStore).toggleMaximize(wsId, p1)
    expect(S(useStore).maximized[wsId]).toBe(p1)
    S(useStore).addTerminal(wsId, p1, 'row')
    expect(S(useStore).maximized[wsId]).toBeUndefined()
  })
})
