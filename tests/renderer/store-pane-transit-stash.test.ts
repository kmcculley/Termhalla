// 2026-07-17 whole-project quality audit, Finding 5: the pane-transit stash (terminal snapshot /
// editor draft flush / explorer view-state) was triplicated across minimize, restore and the
// same-window cross-workspace move — and had DRIFTED: movePaneToWorkspace omitted the explorer
// branch, so a cross-workspace move silently lost an explorer pane's expanded folders + scroll
// (ExplorerPane consumes any stash on mount; movePaneToNewWorkspace inherited the gap). The three
// sites now share ONE stashPaneForTransit helper.
//
// These also PIN the sanctioned asymmetry (CLAUDE.md): minimize/restore arm the main-side transit
// buffer (api.ptyTransitBegin — the source unmounts before the destination mounts, so gap-window
// pty:data must be buffered), while the same-window cross-workspace move is ONE synchronous React
// commit and must NOT arm it ("Don't add a transit buffer here thinking it's a missing piece").
//
// Real-store harness with the preload bridge mocked (the orky-cockpit-action.test.ts pattern).
import { describe, it, expect, vi } from 'vitest'
import type { Workspace } from '../../src/shared/types'

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
type Mocked = Record<string, ReturnType<typeof vi.fn>>

async function freshStore(): Promise<{
  useStore: any
  api: Mocked
  terminalRegistry: typeof import('../../src/renderer/components/terminal-registry')
  explorerRegistry: typeof import('../../src/renderer/components/explorer-registry')
}> {
  vi.resetModules()
  vi.clearAllMocks()   // spy instances survive resetModules — drop call history between tests
  vi.stubGlobal('navigator', { platform: 'Win32' })
  const { useStore } = await import('../../src/renderer/store')
  const { api } = await import('../../src/renderer/api')
  const terminalRegistry = await import('../../src/renderer/components/terminal-registry')
  const explorerRegistry = await import('../../src/renderer/components/explorer-registry')
  return { useStore, api: api as unknown as Mocked, terminalRegistry, explorerRegistry }
}

const S = (useStore: any): any => useStore.getState()

const term = (paneId: string) => ({ paneId, config: { kind: 'terminal' as const, shellId: 'pwsh', cwd: '' } })
const expl = (paneId: string) => ({ paneId, config: { kind: 'explorer' as const, root: 'C:\\repo' } })

function seed(useStore: any): void {
  const w1: Workspace = {
    id: 'w1', name: 'W1',
    layout: { direction: 'row', first: 'pE', second: 'pT' } as any,
    panes: { pE: expl('pE'), pT: term('pT') } as any
  }
  const w2: Workspace = { id: 'w2', name: 'W2', layout: 'pX' as any, panes: { pX: term('pX') } as any }
  useStore.setState({ windowId: 'win-1', isMainWindow: true, workspaces: { w1, w2 }, order: ['w1', 'w2'], activeId: 'w1' })
}

describe('cross-workspace move — the drifted explorer branch (Finding 5)', () => {
  it('movePaneToWorkspace stashes a moved EXPLORER pane\'s view-state so the remount rehydrates it', async () => {
    const { useStore, explorerRegistry } = await freshStore()
    seed(useStore)
    explorerRegistry.registerExplorerState('pE', () => ({ expanded: ['C:\\repo', 'C:\\repo\\src'], scroll: 42 }))

    S(useStore).movePaneToWorkspace('pE', 'w1', 'w2')
    expect(S(useStore).workspaces.w2.panes.pE, 'the pane moved').toBeDefined()
    expect(
      explorerRegistry.consumeExplorerState('pE'),
      'the move must stash the explorer state exactly like minimize/restore do (the drifted branch)'
    ).toEqual({ expanded: ['C:\\repo', 'C:\\repo\\src'], scroll: 42 })
  })

  it('movePaneToWorkspace stashes a moved TERMINAL\'s snapshot but must NOT arm the main-side transit buffer (the sanctioned asymmetry)', async () => {
    const { useStore, api, terminalRegistry } = await freshStore()
    seed(useStore)
    terminalRegistry.registerSerializer('pT', () => 'SNAP-T')

    S(useStore).movePaneToWorkspace('pT', 'w1', 'w2')
    expect(terminalRegistry.consumeSnapshot('pT')).toBe('SNAP-T')
    expect(
      api.ptyTransitBegin,
      'the same-window cross-workspace move is ONE synchronous commit — no main-side transit buffer (CLAUDE.md)'
    ).not.toHaveBeenCalled()
  })
})

describe('minimize / restore — the main-side transit buffer stays armed (the asymmetry\'s other half)', () => {
  it('toggleMinimize on a terminal arms api.ptyTransitBegin AND stashes the snapshot; restorePane arms it again', async () => {
    const { useStore, api, terminalRegistry } = await freshStore()
    seed(useStore)
    terminalRegistry.registerSerializer('pT', () => 'SNAP-MIN')

    S(useStore).toggleMinimize('w1', 'pT')
    expect(api.ptyTransitBegin).toHaveBeenCalledTimes(1)
    expect(api.ptyTransitBegin).toHaveBeenCalledWith('pT')
    expect(terminalRegistry.consumeSnapshot('pT')).toBe('SNAP-MIN')
    expect(S(useStore).minimized.w1).toEqual(['pT'])

    S(useStore).restorePane('w1', 'pT')
    expect(api.ptyTransitBegin).toHaveBeenCalledTimes(2)
    expect(S(useStore).minimized.w1).toBeUndefined()
  })

  it('toggleMinimize on an explorer stashes its view-state and never touches the pty transit buffer', async () => {
    const { useStore, api, explorerRegistry } = await freshStore()
    seed(useStore)
    explorerRegistry.registerExplorerState('pE', () => ({ expanded: ['C:\\repo'], scroll: 7 }))

    S(useStore).toggleMinimize('w1', 'pE')
    expect(explorerRegistry.consumeExplorerState('pE')).toEqual({ expanded: ['C:\\repo'], scroll: 7 })
    expect(api.ptyTransitBegin).not.toHaveBeenCalled()
  })
})
