import { describe, it, expect } from 'vitest'
import { defaultShellId, firstTarget, chordPaneTarget, dispatchAddPane, type PaneActions } from '../../src/renderer/store/pane-ops'

const ws = (over: Record<string, unknown> = {}) =>
  ({ id: 'w', name: 'W', layout: null, panes: {}, ...over }) as never

describe('defaultShellId', () => {
  it('prefers the explicit pick', () => {
    expect(defaultShellId({ newTerminalShellId: 'pwsh', shells: [{ id: 'cmd' }] as never })).toBe('pwsh')
  })
  it('falls back to the first detected shell', () => {
    expect(defaultShellId({ newTerminalShellId: null, shells: [{ id: 'bash' }] as never })).toBe('bash')
  })
  it('falls back to cmd when nothing is available', () => {
    expect(defaultShellId({ newTerminalShellId: null, shells: [] })).toBe('cmd')
  })
})

describe('firstTarget', () => {
  it('is null for an empty layout', () => {
    expect(firstTarget(ws({ layout: null }))).toBeNull()
  })
  it('is the first pane id when a layout exists', () => {
    expect(firstTarget(ws({ layout: 'p1', panes: { p1: {}, p2: {} } }))).toBe('p1')
  })
})

describe('chordPaneTarget', () => {
  const w = ws({ layout: 'p1', panes: { p1: {}, p2: {} } })
  it('targets the focused pane when it belongs to the workspace', () => {
    expect(chordPaneTarget(w, 'p2')).toBe('p2')
  })
  it('falls back to the first pane before any click seeds focus (the Ctrl+Shift+M no-op)', () => {
    expect(chordPaneTarget(w, null)).toBe('p1')
  })
  it('falls back when the focused pane belongs to ANOTHER workspace (stale after tab switch)', () => {
    expect(chordPaneTarget(w, 'other-ws-pane')).toBe('p1')
  })
  it('is null for a missing or empty workspace', () => {
    expect(chordPaneTarget(undefined, 'p1')).toBeNull()
    expect(chordPaneTarget(ws({ layout: null }), null)).toBeNull()
  })
})

function harness(over: Partial<PaneActions> = {}) {
  const calls: unknown[][] = []
  const s: PaneActions = {
    workspaces: { w: ws({ layout: 'p1', panes: { p1: {} } }) },
    addTerminal: (...a) => calls.push(['terminal', ...a]),
    addEditor: (...a) => calls.push(['editor', ...a]),
    addExplorer: (...a) => calls.push(['explorer', ...a]),
    ...over
  }
  return { s, calls }
}

describe('dispatchAddPane', () => {
  it('adds a terminal split off the first pane', async () => {
    const { s, calls } = harness()
    await dispatchAddPane(s, 'w', 'terminal', async () => null)
    expect(calls).toEqual([['terminal', 'w', 'p1', 'row']])
  })
  it('adds an editor', async () => {
    const { s, calls } = harness()
    await dispatchAddPane(s, 'w', 'editor', async () => null)
    expect(calls).toEqual([['editor', 'w', 'p1', 'row']])
  })
  it('opens a folder before adding an explorer, using the chosen root', async () => {
    const { s, calls } = harness()
    await dispatchAddPane(s, 'w', 'explorer', async () => 'C:/proj')
    expect(calls).toEqual([['explorer', 'w', 'p1', 'row', 'C:/proj']])
  })
  it('does not add an explorer when the folder pick is cancelled', async () => {
    const { s, calls } = harness()
    await dispatchAddPane(s, 'w', 'explorer', async () => null)
    expect(calls).toEqual([])
  })
  it('is a no-op for a missing workspace (guards the latent crash)', async () => {
    const { s, calls } = harness()
    await dispatchAddPane(s, 'nope', 'terminal', async () => null)
    expect(calls).toEqual([])
  })
  it('targets null (first pane) when the workspace has no layout yet', async () => {
    const { s, calls } = harness({ workspaces: { w: ws({ layout: null, panes: {} }) } })
    await dispatchAddPane(s, 'w', 'terminal', async () => null)
    expect(calls).toEqual([['terminal', 'w', null, 'row']])
  })
})
