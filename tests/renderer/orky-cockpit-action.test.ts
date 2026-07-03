// FROZEN store-level suite — feature 0011-orky-workspace-template (phase 4 / TASK-002..005 —
// REQ-002, REQ-003 (action half), REQ-004, REQ-006).
//
// This suite drives the REAL renderer store (src/renderer/store.ts) in the node harness with the
// preload bridge mocked — deliberately NOT a slice-only harness, because the FINDING-001 loss
// class lives ACROSS the seams: newOrkyWorkspace / newWorkspaceFromTemplate must report the new
// workspace into main's authoritative windows[] (api.winReport), and applyAssignment — driven
// with that reported arrangement (main's echo) — must RETAIN the workspace instead of deleting it
// in the drop loop. A loader-only round-trip ("the file reloads when asked") can NOT catch the
// loss and is explicitly not what these tests accept (02-spec.md REQ-006).
//
// Chosen contract for the F11 one-shot picker request (prose in spec decision 7 / TASK-005 —
// frozen here, mirroring the shipped pickOrkyRoot/resolveOrkyRootPick naming):
//   State.orkyCockpitPickOpen: boolean                      // the App-level mount flag
//   State.resolveOrkyCockpitPick(root: string | null): void // settles the pending newOrkyWorkspace()
//   State.newOrkyWorkspace(root?: string): Promise<string | null>
//
// Runs RED today (2026-07-02): newOrkyWorkspace does not exist on the store, and the shipped
// newWorkspaceFromTemplate NEVER calls reportAssignment (TEST-661 fails on the live defect).
import { describe, it, expect, vi } from 'vitest'
import { AUTOSAVE_DEBOUNCE_MS } from '../../src/renderer/timing'

vi.mock('../../src/renderer/api', () => ({
  api: {
    winReport: vi.fn(),
    loadWorkspace: vi.fn(async () => null),
    saveWorkspace: vi.fn(async () => {}),
    saveQuick: vi.fn(async () => {}),
    notesSet: vi.fn(async () => {}),
    draftsSet: vi.fn(async () => {}),
    draftsDelete: vi.fn(async () => {}),
    registryDetail: vi.fn(async () => ({ ok: false })),
    termSnapshot: vi.fn()
  }
}))

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mocked = Record<string, ReturnType<typeof vi.fn>>

/** A FRESH store module per test (vi.resetModules re-runs the api factory too), with the fold
 *  mode pinned through the ONE sanctioned platform signal: caseFoldFromPlatform(navigator.platform)
 *  read at store composition (the TEST-432 discipline — never a `process` read). */
async function freshStore(platform = 'Win32'): Promise<{ useStore: any; api: Mocked }> {
  vi.resetModules()
  vi.stubGlobal('navigator', { platform })
  const { useStore } = await import('../../src/renderer/store')
  const { api } = await import('../../src/renderer/api')
  return { useStore, api: api as unknown as Mocked }
}

const R = 'C:\\Dev\\MixedCase\\Proj'

function seed(useStore: any, opts: { members?: string[] } = {}): void {
  useStore.setState({
    windowId: 'win-1',
    isMainWindow: true,
    shells: [{ id: 'pwsh', label: 'PowerShell 7', path: 'pwsh.exe', args: [] }],
    newTerminalShellId: 'pwsh'
  })
  // toasts render only when enabled; refusal copy is read through the chokepoint regardless of kind
  useStore.setState((s: any) => ({ quick: { ...s.quick, toastsEnabled: true } }))
  if (opts.members) {
    useStore.getState().setRegistrySnapshot(
      opts.members.map(root => ({ root, source: 'persisted', status: null }))
    )
  }
}

const S = (useStore: any): any => useStore.getState()
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const lastToast = (useStore: any): string => {
  const toasts = S(useStore).toasts as Array<{ text: string }>
  expect(toasts.length, 'a refusal must surface a toast').toBeGreaterThan(0)
  return toasts[toasts.length - 1].text
}
const cockpitShape = (useStore: any, wsId: string, root: string): void => {
  const ws = S(useStore).workspaces[wsId]
  expect(ws, `workspace ${wsId} must exist`).toBeDefined()
  const configs = Object.values(ws.panes).map((p: any) => p.config)
  expect(configs).toHaveLength(2)
  const orky = configs.find((c: any) => c.kind === 'orky') as any
  const term = configs.find((c: any) => c.kind === 'terminal') as any
  expect(orky).toEqual({ kind: 'orky', root })                       // byte-verbatim binding
  expect(Object.keys(term).sort()).toEqual(['cwd', 'kind', 'shellId'])
  expect(term).toEqual({ kind: 'terminal', shellId: 'pwsh', cwd: root }) // byte-verbatim cwd
  expect(ws.layout.direction).toBe('row')
  expect((ws.panes[ws.layout.first].config as any).kind).toBe('orky')
  expect((ws.panes[ws.layout.second].config as any).kind).toBe('terminal')
  expect('splitPercentage' in ws.layout).toBe(false)
}

describe('newOrkyWorkspace — registration matches newWorkspace IN FULL, incl. the report (REQ-002 / FINDING-001)', () => {
  it('TEST-653 REQ-002 a pre-selected open builds the cockpit through the template seam, appends order, activates, REPORTS the arrangement (winReport includes the new wsId), and the workspace SURVIVES applyAssignment driven with that reported arrangement — the round-trip that would have caught FINDING-001', async () => {
    const { useStore, api } = await freshStore()
    seed(useStore, { members: [R] })

    const wsId = await S(useStore).newOrkyWorkspace(R)
    expect(typeof wsId).toBe('string')
    cockpitShape(useStore, wsId, R)
    expect(S(useStore).workspaces[wsId].name).toBe('Orky: Proj')

    // registration IN FULL (the newWorkspace precedent, store.ts:274-280)
    const orderAfterOpen = [...S(useStore).order]
    expect(orderAfterOpen[orderAfterOpen.length - 1]).toBe(wsId)
    expect(S(useStore).activeId).toBe(wsId)

    // the LOAD-BEARING half: the arrangement was reported into main's windows[]
    expect(api.winReport, 'the success path must report the arrangement (FINDING-001)').toHaveBeenCalled()
    const rep = api.winReport.mock.calls[api.winReport.mock.calls.length - 1][0] as
      { windowId: string; workspaceIds: string[]; activeId: string | null }
    expect(rep.windowId).toBe('win-1')
    expect(rep.workspaceIds).toContain(wsId)
    expect(rep.activeId).toBe(wsId)

    // main's echo: applyAssignment with the REPORTED arrangement RETAINS the workspace — without
    // the report the drop loop (store.ts applyAssignment) silently DELETES it on the next push
    await S(useStore).applyAssignment({ windowId: 'win-1', isMain: true, workspaceIds: rep.workspaceIds, activeId: rep.activeId })
    expect(S(useStore).workspaces[wsId], 'the cockpit must survive the pushed assignment').toBeDefined()
    expect(S(useStore).order).toEqual(orderAfterOpen)
    cockpitShape(useStore, wsId, R) // panes intact, not torn down
  })

  it('TEST-654 REQ-002 REQ-006 two cockpit opens for the SAME root yield two distinct workspace ids with fully DISJOINT pane id sets, and the first workspace is deep-equal before/after the second open (fresh cockpit, never a rebind/mutation of the existing one)', async () => {
    const { useStore } = await freshStore()
    seed(useStore, { members: [R] })

    const ws1 = await S(useStore).newOrkyWorkspace(R)
    const snap1 = clone(S(useStore).workspaces[ws1])
    const ws2 = await S(useStore).newOrkyWorkspace(R)
    expect(typeof ws2).toBe('string')
    expect(ws2).not.toBe(ws1)
    cockpitShape(useStore, ws2, R)

    const ids1 = Object.keys(S(useStore).workspaces[ws1].panes)
    const ids2 = Object.keys(S(useStore).workspaces[ws2].panes)
    expect(ids1.filter(id => ids2.includes(id))).toEqual([]) // disjoint — the seam remapped fresh ids
    expect(S(useStore).workspaces[ws1]).toEqual(snap1)       // untouched by the second open
    // duplicate names are ALLOWED (the Workspace N precedent) — both carry the deterministic name
    expect(S(useStore).workspaces[ws2].name).toBe(S(useStore).workspaces[ws1].name)
  })

  it('TEST-655 REQ-002 REQ-006 a cockpit open schedules the AUTOSAVE (the cockpit workspace reaches api.saveWorkspace on the debounce) and never a quick-save — api.saveQuick sees ZERO calls from the open (scoped: no other quick-writing action runs in this test, CONV-051)', async () => {
    const { useStore, api } = await freshStore()
    seed(useStore, { members: [R] })
    vi.useFakeTimers()
    try {
      const wsId = await S(useStore).newOrkyWorkspace(R)
      const saveQuickBefore = api.saveQuick.mock.calls.length
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 100)
      const savedIds = api.saveWorkspace.mock.calls.map(c => (c[0] as { id: string }).id)
      expect(savedIds, 'the autosave must persist the cockpit workspace').toContain(wsId)
      expect(api.saveQuick.mock.calls.length, 'the cockpit flow must not write quick.json (no template auto-persist)').toBe(saveQuickBefore)
      expect(S(useStore).quick.templates).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('newOrkyWorkspace() with no argument — the F11-owned one-shot picker request (REQ-003)', () => {
  it('TEST-656 REQ-003 REQ-002 no-arg opens the F11 request flag (NOT the F9 pickOrkyRoot request); resolving with a member root builds that cockpit in ONE gesture; cancel resolves null, creates NOTHING (workspaces/order/templates deep-equal) and never reports', async () => {
    const { useStore, api } = await freshStore()
    const B = 'C:\\Dev\\Beta'
    seed(useStore, { members: [R, B] })

    const p = S(useStore).newOrkyWorkspace()
    expect(S(useStore).orkyCockpitPickOpen).toBe(true)
    expect(S(useStore).orkyRootPickOpen, 'F11 must NOT widen the shared F9 picker request').toBe(false)
    S(useStore).resolveOrkyCockpitPick(B)
    const wsId = await p
    expect(typeof wsId).toBe('string')
    expect(S(useStore).orkyCockpitPickOpen).toBe(false)
    cockpitShape(useStore, wsId, B) // pick → cockpit, no further prompt

    // cancel path: nothing created, nothing reported, templates untouched
    const before = {
      workspaces: clone(S(useStore).workspaces),
      order: [...S(useStore).order],
      activeId: S(useStore).activeId,
      templates: clone(S(useStore).quick.templates)
    }
    const reportsBefore = api.winReport.mock.calls.length
    const p2 = S(useStore).newOrkyWorkspace()
    expect(S(useStore).orkyCockpitPickOpen).toBe(true)
    S(useStore).resolveOrkyCockpitPick(null)
    expect(await p2).toBeNull()
    expect(S(useStore).orkyCockpitPickOpen).toBe(false)
    expect(S(useStore).workspaces).toEqual(before.workspaces)
    expect(S(useStore).order).toEqual(before.order)
    expect(S(useStore).activeId).toBe(before.activeId)
    expect(S(useStore).quick.templates).toEqual(before.templates)
    expect(api.winReport.mock.calls.length, 'cancel must never report (REQ-002)').toBe(reportsBefore)
  })
})

describe('newOrkyWorkspace(root) — membership-validated pre-selected path, four-state honesty (REQ-004)', () => {
  it('TEST-657 REQ-004 with caseFold (Win32): a case/slash/trailing-variant caller converges onto the AGGREGATE MEMBER\'s spelling — orky root and terminal cwd byte-equal to the tracked spelling, never the caller\'s variant — and no picker opens', async () => {
    const { useStore } = await freshStore('Win32') // caseFoldFromPlatform -> true
    seed(useStore, { members: [R] })
    const wsId = await S(useStore).newOrkyWorkspace('c:/dev/mixedcase/proj/')
    expect(typeof wsId).toBe('string')
    cockpitShape(useStore, wsId, R) // byte-equal to C:\Dev\MixedCase\Proj — the member's spelling
    expect(S(useStore).orkyCockpitPickOpen).toBe(false)
    expect(S(useStore).orkyRootPickOpen).toBe(false)
  })

  it('TEST-658 REQ-004 without caseFold (non-win platform): the case-variant is REFUSED (resolves null, creates nothing) while the exact spelling still opens — the fold mode is the injected platform derivation, not a hard-coded fold', async () => {
    const { useStore } = await freshStore('Linux x86_64') // caseFoldFromPlatform -> false
    seed(useStore, { members: [R] })
    const refused = await S(useStore).newOrkyWorkspace('c:\\dev\\mixedcase\\proj')
    expect(refused).toBeNull()
    expect(Object.keys(S(useStore).workspaces)).toHaveLength(0)
    const wsId = await S(useStore).newOrkyWorkspace(R)
    expect(typeof wsId).toBe('string')
    cockpitShape(useStore, wsId, R)
  })

  it('TEST-659 REQ-004 EQUALITY, never prefix/containment: with member C:\\dev\\Proj both C:\\dev\\ProjX and C:\\dev\\Proj\\sub are refused; a non-member call mutates NOTHING (workspaces, order, templates deep-equal), resolves null, reports nothing, and its toast NAMES the offending root and how roots become tracked', async () => {
    const { useStore, api } = await freshStore()
    const member = 'C:\\dev\\Proj'
    seed(useStore, { members: [member] })
    const before = {
      workspaces: clone(S(useStore).workspaces),
      order: [...S(useStore).order],
      templates: clone(S(useStore).quick.templates)
    }
    const reportsBefore = api.winReport.mock.calls.length

    for (const offender of ['C:\\dev\\ProjX', 'C:\\dev\\Proj\\sub']) {
      const out = await S(useStore).newOrkyWorkspace(offender)
      expect(out, `${offender} must be refused (equality, not prefix)`).toBeNull()
    }
    const out = await S(useStore).newOrkyWorkspace('C:\\dev\\Elsewhere')
    expect(out).toBeNull()
    const copy = lastToast(useStore)
    expect(copy).toContain('C:\\dev\\Elsewhere')   // names the offending root (CONV-001)
    expect(copy).toMatch(/track/i)                 // says how roots become tracked

    expect(S(useStore).workspaces).toEqual(before.workspaces)
    expect(S(useStore).order).toEqual(before.order)
    expect(S(useStore).quick.templates).toEqual(before.templates)
    expect(api.winReport.mock.calls.length, 'refusals never report (REQ-002)').toBe(reportsBefore)
  })

  it('TEST-660 REQ-004 four registry states, three PAIRWISE-DISTINCT refusal copies: loading is loading-honest (never "not tracked"); FAILED surfaces the held registryError VERBATIM and never the not-tracked copy; a held-empty snapshot rides the not-tracked branch; nothing is created and nothing reported in any refusal state', async () => {
    const { useStore, api } = await freshStore()
    seed(useStore) // NO snapshot seeded: registrySnapshot === null && registryError === null -> loading
    const reportsBefore = api.winReport.mock.calls.length

    // (2) LOADING
    expect(await S(useStore).newOrkyWorkspace('C:\\dev\\Proj')).toBeNull()
    const loadingCopy = lastToast(useStore)
    expect(loadingCopy).toMatch(/load/i)
    expect(loadingCopy).not.toMatch(/not\s+(currently\s+)?tracked/i) // a loading system is never "not tracked"

    // (3) FAILED registry — the held error text VERBATIM, never the not-tracked copy
    useStore.setState({ registrySnapshot: null, registryError: 'boom-registry-EIO' })
    expect(await S(useStore).newOrkyWorkspace('C:\\dev\\Proj')).toBeNull()
    const failedCopy = lastToast(useStore)
    expect(failedCopy).toContain('boom-registry-EIO')                 // CONV-001, verbatim
    expect(failedCopy).not.toMatch(/not\s+(currently\s+)?tracked/i)   // membership is UNKNOWN, not absent
    expect(failedCopy).not.toBe(loadingCopy)

    // (4) HELD EMPTY snapshot -> the no-match branch's copy (state 1's copy)
    S(useStore).setRegistrySnapshot([])
    expect(await S(useStore).newOrkyWorkspace('C:\\dev\\Proj')).toBeNull()
    const emptyCopy = lastToast(useStore)
    expect(emptyCopy).toContain('C:\\dev\\Proj')
    expect(emptyCopy).toMatch(/track/i)

    // (1) MEMBERS HELD, no match — same copy class as (4)
    S(useStore).setRegistrySnapshot([{ root: 'C:\\dev\\Other', source: 'persisted', status: null }])
    expect(await S(useStore).newOrkyWorkspace('C:\\dev\\Proj')).toBeNull()
    const notTrackedCopy = lastToast(useStore)
    expect(notTrackedCopy).toContain('C:\\dev\\Proj')
    expect(notTrackedCopy).toMatch(/track/i)

    // the three refusal copies are PAIRWISE distinct
    expect(loadingCopy).not.toBe(failedCopy)
    expect(loadingCopy).not.toBe(notTrackedCopy)
    expect(failedCopy).not.toBe(notTrackedCopy)

    // no refusal created or reported anything
    expect(Object.keys(S(useStore).workspaces)).toHaveLength(0)
    expect(api.winReport.mock.calls.length).toBe(reportsBefore)
  })
})

describe('the shared template-instantiation seam is REPAIRED — durable menu instantiation (REQ-006 / FINDING-001)', () => {
  it('TEST-661 REQ-006 newWorkspaceFromTemplate (the shipped menu path, pre-F11 templates included) REPORTS the new workspace — api.winReport called with workspaceIds INCLUDING the new wsId — and driving applyAssignment with that reported arrangement RETAINS the workspace with its orky root and terminal cwd byte-preserved', async () => {
    const { useStore, api } = await freshStore()
    seed(useStore)
    const tpl = {
      id: 'tpl-ck', name: 'CK',
      layout: { direction: 'row', first: 'a', second: 'b' },
      panes: {
        a: { paneId: 'a', config: { kind: 'orky', root: R } },
        b: { paneId: 'b', config: { kind: 'terminal', shellId: 'pwsh', cwd: R } }
      }
    }
    useStore.setState((s: any) => ({ quick: { ...s.quick, templates: [tpl] } }))
    const reportsBefore = api.winReport.mock.calls.length

    const wsId = S(useStore).newWorkspaceFromTemplate('tpl-ck', 'CK')
    expect(typeof wsId).toBe('string')
    expect(S(useStore).order[S(useStore).order.length - 1]).toBe(wsId)
    expect(S(useStore).activeId).toBe(wsId)

    // THE FINDING-001 pin — RED against the shipped implementation, which never reports here:
    expect(
      api.winReport.mock.calls.length,
      'newWorkspaceFromTemplate must report the arrangement (FINDING-001: without it the workspace is silently DELETED by the next pushed assignment and lost on quit→relaunch)'
    ).toBeGreaterThan(reportsBefore)
    const rep = api.winReport.mock.calls[api.winReport.mock.calls.length - 1][0] as
      { workspaceIds: string[]; activeId: string | null }
    expect(rep.workspaceIds).toContain(wsId)

    // main's echo retains the workspace — the previously-gapped boundary, round-tripped
    await S(useStore).applyAssignment({ windowId: 'win-1', isMain: true, workspaceIds: rep.workspaceIds, activeId: rep.activeId })
    cockpitShape(useStore, wsId, R)
  })

  it('TEST-662 REQ-006 open cockpit for R → saveTemplate("CK") → instantiate CK from quick.templates: TWO workspaces, each an orky pane (root R) + terminal (cwd R), with disjoint pane ids; quick.templates stays deep-equal across further cockpit opens AND cancels (the cockpit flow never writes templates)', async () => {
    const { useStore } = await freshStore()
    seed(useStore, { members: [R] })

    const ws1 = await S(useStore).newOrkyWorkspace(R)
    expect(S(useStore).quick.templates).toEqual([]) // the gesture created a WORKSPACE, no template
    S(useStore).saveTemplate('CK')                  // the user's EXPLICIT save gesture
    const templates = S(useStore).quick.templates
    expect(templates).toHaveLength(1)
    const savedTpl = clone(templates[0])

    const ws2 = S(useStore).newWorkspaceFromTemplate(savedTpl.id, 'CK')
    expect(typeof ws2).toBe('string')
    expect(ws2).not.toBe(ws1)
    cockpitShape(useStore, ws1, R)
    cockpitShape(useStore, ws2, R)
    const ids1 = Object.keys(S(useStore).workspaces[ws1].panes)
    const ids2 = Object.keys(S(useStore).workspaces[ws2].panes)
    expect(ids1.filter(id => ids2.includes(id))).toEqual([]) // fresh ids through the seam

    // any number of cockpit opens/cancels leaves quick.templates deep-equal
    await S(useStore).newOrkyWorkspace(R)
    const pending = S(useStore).newOrkyWorkspace()
    S(useStore).resolveOrkyCockpitPick(null)
    await pending
    expect(S(useStore).quick.templates).toEqual([savedTpl])
  })
})
