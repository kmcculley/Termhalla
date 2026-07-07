// FROZEN unit suite — feature 0011-orky-workspace-template (phase 4 / TASK-002 — REQ-006, REQ-007).
// The sanctioned shared-seam repair (resolved decision 9 / FINDING-001), pinned at the slice seam:
// SliceDeps gains reportAssignment: () => void (kept OFF public State — the FINDING-008/TEST-619
// discipline), createQuickSlice destructures it, and newWorkspaceFromTemplate's SUCCESS path calls
// it exactly once, AFTER scheduleAutosave(). The !tpl fallback routes to newWorkspace — which
// already reports itself — so the slice must NOT double-report there.
//
// Headless harness (the quick-slice.test.ts pattern — no ../api import needed).
// Runs RED today (2026-07-02): the shipped createQuickSlice ignores the injected dep entirely
// (quick-slice.ts:31-38 never reports), so the spy sees zero calls.
//
// AMENDED 2026-07-07 (quality audit Group C #8): the raw reportAssignment SliceDeps dep was
// superseded by the shared registration ritual (workspace-registration.ts) — the harness now wires
// the REAL makeRegisterWorkspace over the same spies, so every behavioral assertion below
// (register + autosave + report-exactly-once ordering, no double-report on the !tpl fallback) is
// pinned unchanged at the new seam.
import { describe, it, expect, vi } from 'vitest'
import { createQuickSlice } from '../../src/renderer/store/quick-slice'
import { makeRegisterWorkspace } from '../../src/renderer/store/workspace-registration'

/* eslint-disable @typescript-eslint/no-explicit-any */
const R = 'C:\\Dev\\MixedCase\\Proj'
const TPL = {
  id: 'tpl-1', name: 'CK',
  layout: { direction: 'row', first: 'a', second: 'b' },
  panes: {
    a: { paneId: 'a', config: { kind: 'orky', root: R } },
    b: { paneId: 'b', config: { kind: 'terminal', shellId: 'pwsh', cwd: R } }
  }
}

function harness() {
  let state: any = {
    quick: { templates: [TPL], connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [], themePresets: [] },
    workspaces: {}, order: [], activeId: null,
    newWorkspace: vi.fn(() => 'ws-fallback')
  }
  const set = (fn: any) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  const get = () => state
  const scheduleAutosave = vi.fn()
  const scheduleQuickSave = vi.fn()
  const scheduleNotesSave = vi.fn()
  const commitPane = vi.fn()
  const reportAssignment = vi.fn()
  const registerWorkspace = makeRegisterWorkspace({ set, scheduleAutosave, reportAssignment })
  const slice = createQuickSlice({ set, get, scheduleAutosave, scheduleQuickSave, scheduleNotesSave, commitPane, registerWorkspace } as any)
  return { slice: slice as any, get, scheduleAutosave, scheduleQuickSave, reportAssignment }
}

describe('newWorkspaceFromTemplate reports the new workspace (REQ-006 / decision 9)', () => {
  it('TEST-663 REQ-006 REQ-007 the success path calls the SliceDeps-injected reportAssignment exactly ONCE, after scheduleAutosave; the !tpl fallback routes to newWorkspace WITHOUT a second report from the slice; saveTemplate/deleteTemplate never report', () => {
    const h = harness()

    // success path: instantiate → register → autosave → REPORT (the FINDING-001 repair)
    const id = h.slice.newWorkspaceFromTemplate('tpl-1', 'CK')
    expect(typeof id).toBe('string')
    expect(h.get().order).toContain(id)
    expect(h.get().activeId).toBe(id)
    expect(h.scheduleAutosave).toHaveBeenCalledTimes(1)
    expect(
      h.reportAssignment,
      'FINDING-001: newWorkspaceFromTemplate must report the new workspace into main\'s windows[] — today it never does, so a menu-instantiated workspace is silently lost on the next pushed assignment'
    ).toHaveBeenCalledTimes(1)
    // ordering: the report follows the autosave scheduling (spec: after scheduleAutosave(),
    // before return) — invocationCallOrder is vitest's cross-spy sequence
    expect(h.reportAssignment.mock.invocationCallOrder[0])
      .toBeGreaterThan(h.scheduleAutosave.mock.invocationCallOrder[0])
    // no quick-save rides the instantiation (templates change only via explicit save/delete)
    expect(h.scheduleQuickSave).not.toHaveBeenCalled()

    // the !tpl fallback: newWorkspace already reports itself (store.ts newWorkspace) — the slice
    // must not add a SECOND report (a double-report would echo the arrangement twice)
    h.slice.newWorkspaceFromTemplate('missing-id', 'X')
    expect(h.get().newWorkspace).toHaveBeenCalledWith('X')
    expect(h.reportAssignment).toHaveBeenCalledTimes(1)

    // template CRUD gestures change quick.json, not the window arrangement — never a report
    h.slice.deleteTemplate('tpl-1')
    h.slice.saveTemplate('NoActiveWs') // no active workspace: returns early
    expect(h.reportAssignment).toHaveBeenCalledTimes(1)
  })
})
