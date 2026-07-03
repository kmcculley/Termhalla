// LOOPBACK suite — feature 0011-orky-workspace-template (review → tests loopback per ESC-001,
// 2026-07-03). New pins added by the tests actor at the sanctioned loopback — FROZEN like the
// rest of the phase-4 suite (ADR-009); the implementer makes TEST-679 pass without editing it.
//
//   TEST-679 — FINDING-007 (ux): a PICKER-MEDIATED cockpit open (palette / templates-menu row →
//              the F11-labelled shared picker → pick) must LAND keyboard focus in the created
//              cockpit. At this harness's real seam that is a pane-focus request through the
//              terminal-registry for a pane of the NEW workspace (the commitPane/setActive
//              precedent: requestPaneFocus / refocusActivePane — WHICH pane is the fix's choice).
//              RED against the current implementation: the invoking chrome unmounts in the same
//              batched commit that mounts the picker, the CONV-020 restore collapses onto <body>,
//              and newOrkyWorkspace's success tail requests no focus — a keyboard user's next
//              keystrokes are silently swallowed (the exact class refocusActivePane exists to
//              prevent). CONV-046 permits gesture-mounted focus — the open IS the explicit
//              gesture. The rendered half is tests/e2e/orky-cockpit-loopback.spec.ts (TEST-683).
//   TEST-680..682 — FINDING-010 (LOW): REQ-003's acceptance requires cancel from EACH of the four
//              picker states to commit nothing; the frozen suite exercised only the member-list
//              state (TEST-656). These pin cancel from LOADING / FAILED / HELD-EMPTY: resolves
//              null, creates nothing (workspaces/order/activeId/quick.templates deep-equal),
//              reports nothing. GREEN against the current implementation by construction (every
//              close path routes through the single resolveOrkyCockpitPick(null)) — frozen here
//              as regression pins so the acceptance clause is exercised, not merely inherited.
import { describe, it, expect, vi } from 'vitest'

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
// Spy ONLY the pane-focus request seam; everything else in the registry stays real. The store's
// focus paths (commitPane, setActive→refocusActivePane, pane-close survivor focus) all route
// through this one function, so the pin is mechanism-tolerant between refocusActivePane and a
// direct requestPaneFocus on a chosen pane.
vi.mock('../../src/renderer/components/terminal-registry', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, requestPaneFocus: vi.fn() }
})

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mocked = Record<string, ReturnType<typeof vi.fn>>

/** A FRESH store module per test (vi.resetModules re-runs both mock factories), fold mode pinned
 *  through the ONE sanctioned platform signal (the TEST-432 discipline — never a `process` read). */
async function freshStore(platform = 'Win32'): Promise<{ useStore: any; api: Mocked; requestPaneFocus: ReturnType<typeof vi.fn> }> {
  vi.resetModules()
  vi.stubGlobal('navigator', { platform })
  const { useStore } = await import('../../src/renderer/store')
  const { api } = await import('../../src/renderer/api')
  const registry = await import('../../src/renderer/components/terminal-registry')
  return { useStore, api: api as unknown as Mocked, requestPaneFocus: registry.requestPaneFocus as unknown as ReturnType<typeof vi.fn> }
}

const R = 'C:\\Dev\\MixedCase\\Proj'

function seed(useStore: any, opts: { members?: string[] } = {}): void {
  useStore.setState({
    windowId: 'win-1',
    isMainWindow: true,
    shells: [{ id: 'pwsh', label: 'PowerShell 7', path: 'pwsh.exe', args: [] }],
    newTerminalShellId: 'pwsh'
  })
  useStore.setState((s: any) => ({ quick: { ...s.quick, toastsEnabled: true } }))
  if (opts.members) {
    useStore.getState().setRegistrySnapshot(
      opts.members.map(root => ({ root, source: 'persisted', status: null }))
    )
  }
}

const S = (useStore: any): any => useStore.getState()
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/** The FINDING-010 leg, identical across the three remaining picker states: open the F11 request,
 *  cancel it, and prove NOTHING was committed or reported — the same deep-equal invariants
 *  TEST-656 pins for the member-list state. */
async function expectCancelCommitsNothing(useStore: any, api: Mocked, label: string): Promise<void> {
  const before = {
    workspaces: clone(S(useStore).workspaces),
    order: [...S(useStore).order],
    activeId: S(useStore).activeId,
    templates: clone(S(useStore).quick.templates)
  }
  const reportsBefore = api.winReport.mock.calls.length
  const p = S(useStore).newOrkyWorkspace()
  expect(S(useStore).orkyCockpitPickOpen, `${label}: the one-shot request must open`).toBe(true)
  S(useStore).resolveOrkyCockpitPick(null)
  expect(await p, `${label}: cancel must resolve null`).toBeNull()
  expect(S(useStore).orkyCockpitPickOpen).toBe(false)
  expect(S(useStore).workspaces, `${label}: cancel must create no workspace`).toEqual(before.workspaces)
  expect(S(useStore).order).toEqual(before.order)
  expect(S(useStore).activeId).toBe(before.activeId)
  expect(S(useStore).quick.templates, `${label}: cancel must leave quick.templates deep-equal`).toEqual(before.templates)
  expect(api.winReport.mock.calls.length, `${label}: cancel must never report (REQ-002)`).toBe(reportsBefore)
}

describe('FINDING-007 — the picker-mediated cockpit open lands keyboard focus in the new cockpit (REQ-003 / REQ-005 focus clause, ESC-001 loopback)', () => {
  it('TEST-679 REQ-003 REQ-005 (FINDING-007) after resolveOrkyCockpitPick(member) settles a no-arg newOrkyWorkspace(), a pane-focus request was made for a pane of the NEW workspace — the gesture must not strand a keyboard user on <body> (the CONV-020 restore collapses there because the invoking chrome unmounted with the picker\'s open); CONV-046 sanctions gesture-mounted focus', async () => {
    const { useStore, requestPaneFocus } = await freshStore()
    seed(useStore, { members: [R] })

    const p = S(useStore).newOrkyWorkspace()
    expect(S(useStore).orkyCockpitPickOpen).toBe(true)
    S(useStore).resolveOrkyCockpitPick(R) // the shared picker yields the member's spelling
    const wsId = await p
    expect(typeof wsId).toBe('string')

    const paneIds = Object.keys(S(useStore).workspaces[wsId].panes)
    expect(paneIds).toHaveLength(2)
    const requested = requestPaneFocus.mock.calls.map(c => c[0] as string)
    expect(
      requested.some(id => paneIds.includes(id)),
      `the picker-mediated cockpit open must LAND keyboard focus in the created workspace — a pane-focus request through the registry seam for one of its panes (refocusActivePane() or requestPaneFocus(<new pane>); the choice of pane is the implementation's). Pane-focus requests actually seen: [${requested.join(', ') || 'none'}]`
    ).toBe(true)
  })
})

describe('FINDING-010 — cancel commits nothing from EVERY picker state, not only member-list (REQ-003 four-state cancel clause, ESC-001 loopback)', () => {
  it('TEST-680 REQ-003 cancel from the LOADING state (registrySnapshot === null && registryError === null): resolves null, creates nothing, reports nothing, quick.templates deep-equal', async () => {
    const { useStore, api } = await freshStore()
    seed(useStore) // no snapshot seeded — the loading state
    expect(S(useStore).registrySnapshot).toBeNull()
    expect(S(useStore).registryError).toBeNull()
    await expectCancelCommitsNothing(useStore, api, 'loading-state cancel')
  })

  it('TEST-681 REQ-003 cancel from the FAILED state (registrySnapshot === null && registryError !== null): resolves null, creates nothing, reports nothing, quick.templates deep-equal', async () => {
    const { useStore, api } = await freshStore()
    seed(useStore)
    useStore.setState({ registrySnapshot: null, registryError: 'boom-registry-EIO' })
    await expectCancelCommitsNothing(useStore, api, 'failed-state cancel')
  })

  it('TEST-682 REQ-003 cancel from the HELD-EMPTY state (a held [] snapshot): resolves null, creates nothing, reports nothing, quick.templates deep-equal', async () => {
    const { useStore, api } = await freshStore()
    seed(useStore)
    S(useStore).setRegistrySnapshot([])
    expect(S(useStore).registrySnapshot).toEqual([])
    await expectCancelCommitsNothing(useStore, api, 'held-empty cancel')
  })
})
