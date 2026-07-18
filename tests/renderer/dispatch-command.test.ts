// 2026-07-17 whole-project quality audit, Finding 28: the command→action dispatch was duplicated
// between CommandPalette.activate and App.tsx's chord switch (~12 pane-scoped and window-chrome
// commands kept in agreement only by convention). dispatchCommand (store/pane-ops.ts — api-free,
// injected actions, the op.ts/pane-ops.ts testability pattern) is now the ONE implementation both
// callers consume. The single GENUINE divergence — the chord redraws the focused pane exactly
// (even '' / a stale id), the palette redraws the chord target — is a parameter, never silently
// homogenized. Commands whose call-site shapes are pinned by frozen suites (capture-orky-work
// TEST-495, toggle-orky-queue TEST-329/360) stay at their original sites and are NOT dispatched
// here.
import { describe, it, expect } from 'vitest'
import { dispatchCommand, type CommandActions, type PaneRegistryFns } from '../../src/renderer/store/pane-ops'
import { DEFAULT_THEME } from '@shared/theme'

const ws = (over: Record<string, unknown> = {}) =>
  ({ id: 'w', name: 'W', layout: 'p1', panes: { p1: {}, p2: {} }, ...over }) as never

function harness(over: Partial<CommandActions> = {}) {
  const calls: unknown[][] = []
  const rec = (name: string) => (...a: unknown[]) => { calls.push([name, ...a]) }
  const s: CommandActions = {
    activeId: 'w',
    focusedPaneId: null,
    workspaces: { w: ws() },
    minimized: {},
    notesOpen: false,
    addPaneOfKind: rec('addPaneOfKind'),
    closePane: rec('closePane'),
    toggleMaximize: rec('toggleMaximize'),
    toggleMinimize: rec('toggleMinimize'),
    restorePane: rec('restorePane'),
    setNotesOpen: rec('setNotesOpen'),
    openSettings: rec('openSettings'),
    setTheme: rec('setTheme'),
    ...over
  }
  const reg: PaneRegistryFns = {
    clearPane: rec('clearPane'),
    redrawPane: rec('redrawPane'),
    openPaneFind: rec('openPaneFind')
  }
  return { s, reg, calls }
}
const chord = { redrawTarget: 'chord' } as const
const focused = { redrawTarget: 'focused' } as const

describe('dispatchCommand — unknown / guard behavior', () => {
  it('an unknown id is a no-op and reports unhandled', () => {
    const { s, reg, calls } = harness()
    expect(dispatchCommand('jump-workspace', s, reg, chord)).toBe(false)
    expect(dispatchCommand('definitely-not-a-command', s, reg, chord)).toBe(false)
    expect(calls).toEqual([])
  })
  it('a pane-scoped command with no active workspace is a handled no-op', () => {
    const { s, reg, calls } = harness({ activeId: null })
    for (const id of ['close-pane', 'toggle-maximize-pane', 'toggle-minimize-pane', 'clear-terminal', 'find-in-terminal', 'restore-last-minimized', 'new-terminal']) {
      expect(dispatchCommand(id, s, reg, chord), `${id} must report handled`).toBe(true)
    }
    expect(calls).toEqual([])
  })
})

describe('dispatchCommand — pane-scoped commands target the chord pane (focused, else first)', () => {
  it('close-pane targets the focused pane when it belongs to the workspace', () => {
    const { s, reg, calls } = harness({ focusedPaneId: 'p2' })
    expect(dispatchCommand('close-pane', s, reg, chord)).toBe(true)
    expect(calls).toEqual([['closePane', 'w', 'p2']])
  })
  it('close-pane falls back to the first pane before any click seeds focus', () => {
    const { s, reg, calls } = harness()
    dispatchCommand('close-pane', s, reg, chord)
    expect(calls).toEqual([['closePane', 'w', 'p1']])
  })
  it('toggle-maximize-pane / toggle-minimize-pane dispatch to the store toggles', () => {
    const { s, reg, calls } = harness({ focusedPaneId: 'p2' })
    dispatchCommand('toggle-maximize-pane', s, reg, chord)
    dispatchCommand('toggle-minimize-pane', s, reg, chord)
    expect(calls).toEqual([['toggleMaximize', 'w', 'p2'], ['toggleMinimize', 'w', 'p2']])
  })
  it('clear-terminal / find-in-terminal route through the injected registry fns', () => {
    const { s, reg, calls } = harness({ focusedPaneId: 'p2' })
    dispatchCommand('clear-terminal', s, reg, chord)
    dispatchCommand('find-in-terminal', s, reg, chord)
    expect(calls).toEqual([['clearPane', 'p2'], ['openPaneFind', 'p2']])
  })
  it('restore-last-minimized restores the LAST minimized pane, no-ops on an empty tray', () => {
    const { s, reg, calls } = harness({ minimized: { w: ['a', 'b'] } })
    dispatchCommand('restore-last-minimized', s, reg, chord)
    expect(calls).toEqual([['restorePane', 'w', 'b']])
    const empty = harness({ minimized: {} })
    expect(dispatchCommand('restore-last-minimized', empty.s, empty.reg, chord)).toBe(true)
    expect(empty.calls).toEqual([])
  })
})

describe('dispatchCommand — the redraw-target divergence is a parameter (never homogenized)', () => {
  it("'focused' redraws exactly the focused pane id — '' when none, even a stale cross-workspace id (the chord's shipped behavior)", () => {
    const none = harness()
    dispatchCommand('redraw-terminal', none.s, none.reg, focused)
    expect(none.calls).toEqual([['redrawPane', '']])
    const stale = harness({ focusedPaneId: 'other-ws-pane' })
    dispatchCommand('redraw-terminal', stale.s, stale.reg, focused)
    expect(stale.calls).toEqual([['redrawPane', 'other-ws-pane']])
  })
  it("'chord' redraws the chord target — first-pane fallback, silent no-op without one (the palette's shipped behavior)", () => {
    const fallback = harness({ focusedPaneId: 'other-ws-pane' })
    dispatchCommand('redraw-terminal', fallback.s, fallback.reg, chord)
    expect(fallback.calls).toEqual([['redrawPane', 'p1']])
    const noneWs = harness({ activeId: null })
    dispatchCommand('redraw-terminal', noneWs.s, noneWs.reg, chord)
    expect(noneWs.calls).toEqual([])
  })
})

describe('dispatchCommand — window-chrome and workspace commands', () => {
  it('toggle-notes flips the current value and needs no active workspace', () => {
    const { s, reg, calls } = harness({ activeId: null, notesOpen: true })
    expect(dispatchCommand('toggle-notes', s, reg, chord)).toBe(true)
    expect(calls).toEqual([['setNotesOpen', false]])
  })
  it('open-settings opens at the general section', () => {
    const { s, reg, calls } = harness()
    dispatchCommand('open-settings', s, reg, chord)
    expect(calls).toEqual([['openSettings', { section: 'general' }]])
  })
  it('font-zoom-reset restores the default terminal font size', () => {
    const { s, reg, calls } = harness()
    dispatchCommand('font-zoom-reset', s, reg, chord)
    expect(calls).toEqual([['setTheme', { termFontSize: DEFAULT_THEME.termFontSize }]])
  })
  it('new-terminal adds a terminal pane to the active workspace', () => {
    const { s, reg, calls } = harness()
    dispatchCommand('new-terminal', s, reg, chord)
    expect(calls).toEqual([['addPaneOfKind', 'w', 'terminal']])
  })
})
