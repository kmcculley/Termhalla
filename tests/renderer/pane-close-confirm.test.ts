// QoL batch 2026-07-17: closing a pane used to kill silently — a terminal running a build/AI
// session died with zero warning (while close-WORKSPACE confirmed), and closing an editor pane
// bypassed the per-tab dirty confirm AND deleted the hot-exit drafts. The decision of *whether*
// a close needs a confirm (and its copy) is pure and lives in pane-ops; store.closePane gates on it.
import { describe, it, expect } from 'vitest'
import { paneCloseConfirmText, busyPaneCount } from '../../src/renderer/store/pane-ops'
import type { Workspace } from '@shared/types'

describe('paneCloseConfirmText', () => {
  it('an idle terminal (no foreground child, no AI session) needs no confirm', () => {
    expect(paneCloseConfirmText({ kind: 'terminal', dirtyCount: 0 })).toBeNull()
  })
  it('a terminal with a foreground process warns with the process name', () => {
    const text = paneCloseConfirmText({ kind: 'terminal', dirtyCount: 0, foreground: 'npm' })
    expect(text).toContain('npm')
    expect(text).toMatch(/close/i)
  })
  it('an AI session takes precedence over the raw foreground name', () => {
    const text = paneCloseConfirmText({ kind: 'terminal', dirtyCount: 0, foreground: 'node', aiLabel: 'Claude' })
    expect(text).toContain('Claude')
  })
  it('an editor with dirty tabs warns with the count', () => {
    const text = paneCloseConfirmText({ kind: 'editor', dirtyCount: 2 })
    expect(text).toContain('2')
    expect(text).toMatch(/unsaved/i)
  })
  it('a clean editor needs no confirm', () => {
    expect(paneCloseConfirmText({ kind: 'editor', dirtyCount: 0 })).toBeNull()
  })
  it('explorer/orky panes never confirm', () => {
    expect(paneCloseConfirmText({ kind: 'explorer', dirtyCount: 0 })).toBeNull()
    expect(paneCloseConfirmText({ kind: 'orky', dirtyCount: 0 })).toBeNull()
  })
})

describe('busyPaneCount', () => {
  const ws = {
    id: 'w1', name: 'w', layout: 'p1',
    panes: {
      p1: { paneId: 'p1', config: { kind: 'terminal', shellId: 'cmd', cwd: '' } },
      p2: { paneId: 'p2', config: { kind: 'terminal', shellId: 'cmd', cwd: '' } },
      p3: { paneId: 'p3', config: { kind: 'editor', files: [] } }
    }
  } as unknown as Workspace

  it('counts terminals with a foreground process or AI session; ignores idle shells and editors', () => {
    expect(busyPaneCount(ws, { p1: { tree: [], foreground: 'npm' } } as never, {})).toBe(1)
    expect(busyPaneCount(ws, {}, { p2: { tool: 'claude', label: 'Claude' } } as never)).toBe(1)
    expect(busyPaneCount(ws, {}, {})).toBe(0)
  })
})
