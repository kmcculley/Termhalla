// FROZEN unit suite — feature 0009-native-orky-pane (phase 4 / TASK-012, REQ-004 / REQ-001).
// `dispatchAddPane`'s 'orky' branch: an injected, API-FREE root-picker callback (the exact pattern
// the explorer branch uses with `openFolder` — CONV-006, ONE callback, no primary+override pair).
//
// Chosen contract (freezing the plan's TASK-012 prose):
//   dispatchAddPane(s, wsId, kind, openFolder, pickOrkyRoot?: () => Promise<string | null>)
//   PaneActions gains addOrky(wsId, target, dir: MosaicDirection, root: string, splitDir?) —
//   mirroring addExplorer's shape exactly; selection commits with the picked root VERBATIM,
//   cancel (null) commits nothing, and the orky path never consults openFolder.
//
// Runs RED today: dispatchAddPane has no 'orky' branch (the kind falls into the explorer/else arm,
// so the injected picker is never consulted and addOrky is never called).
import { describe, it, expect, vi } from 'vitest'
import { dispatchAddPane, type PaneKind } from '../../src/renderer/store/pane-ops'
import type { Workspace } from '@shared/types'

function actions() {
  const ws: Workspace = {
    id: 'w', name: 'W', layout: 'p1',
    panes: { p1: { paneId: 'p1', config: { kind: 'terminal', shellId: 'pwsh', cwd: '' } } }
  }
  return {
    workspaces: { w: ws },
    addTerminal: vi.fn(),
    addEditor: vi.fn(),
    addExplorer: vi.fn(),
    addOrky: vi.fn()
  }
}

describe('dispatchAddPane — the orky branch (REQ-004)', () => {
  it('TEST-440 REQ-004 REQ-001 selection commits addOrky with the picked root VERBATIM (case-preserved); cancel commits nothing; openFolder is never consulted on the orky path', async () => {
    // selection
    const s1 = actions()
    const openFolder = vi.fn(async () => '/never')
    const pick = vi.fn(async () => 'C:\\Dev\\MixedCase\\Proj')
    await dispatchAddPane(s1 as never, 'w', 'orky' as PaneKind, openFolder, pick as never)
    expect(pick).toHaveBeenCalledTimes(1)
    expect(openFolder).not.toHaveBeenCalled() // one callback, no primary+override pair (CONV-006)
    expect(s1.addOrky).toHaveBeenCalledTimes(1)
    const call = s1.addOrky.mock.calls[0]
    expect(call[0]).toBe('w')
    expect(call[1]).toBe('p1')                 // splits off the first existing pane (explorer parity)
    expect(call[2]).toBe('row')
    expect(call[3]).toBe('C:\\Dev\\MixedCase\\Proj') // byte-equal, never re-cased/re-resolved (REQ-005)
    expect(s1.addExplorer).not.toHaveBeenCalled()
    expect(s1.addTerminal).not.toHaveBeenCalled()

    // cancel: the picker resolves null → NOTHING commits
    const s2 = actions()
    const cancel = vi.fn(async () => null)
    await dispatchAddPane(s2 as never, 'w', 'orky' as PaneKind, openFolder, cancel as never)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(s2.addOrky).not.toHaveBeenCalled()
    expect(s2.addExplorer).not.toHaveBeenCalled()

    // the existing kinds are untouched: explorer still routes through openFolder, never the picker
    const s3 = actions()
    const pickSpy = vi.fn(async () => 'C:\\X')
    const folder = vi.fn(async () => 'C:\\FolderPick')
    await dispatchAddPane(s3 as never, 'w', 'explorer', folder, pickSpy as never)
    expect(folder).toHaveBeenCalledTimes(1)
    expect(pickSpy).not.toHaveBeenCalled()
    expect(s3.addExplorer).toHaveBeenCalledWith('w', 'p1', 'row', 'C:\\FolderPick')
    expect(s3.addOrky).not.toHaveBeenCalled()
  })
})
