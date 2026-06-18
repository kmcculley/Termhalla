import { describe, it, expect } from 'vitest'
import { applyResumeAi } from '../../src/renderer/store/pane-ops'
import type { Workspace, AiSession } from '@shared/types'

function ws(panes: Workspace['panes']): Workspace {
  return { id: 'w', name: 'W', layout: null, panes }
}
const term = (extra: Record<string, unknown> = {}) => ({ kind: 'terminal' as const, shellId: 's', cwd: '', ...extra })
const claude: AiSession = { tool: 'claude', label: 'Claude' }

describe('applyResumeAi', () => {
  it('stamps resumeAi on terminal panes that currently run an AI session', () => {
    const out = applyResumeAi(ws({
      p1: { paneId: 'p1', config: term() },
      p2: { paneId: 'p2', config: { kind: 'editor', files: [] } }
    }), { p1: claude })
    expect((out.panes.p1.config as { resumeAi?: string }).resumeAi).toBe('claude')
    // non-terminal panes are untouched
    expect(out.panes.p2.config).toEqual({ kind: 'editor', files: [] })
  })

  it('clears a stale resumeAi when the pane no longer runs an AI session', () => {
    const out = applyResumeAi(ws({
      p1: { paneId: 'p1', config: term({ resumeAi: 'claude' }) }
    }), {})
    expect((out.panes.p1.config as { resumeAi?: string }).resumeAi).toBeUndefined()
  })

  it('returns the same workspace object when nothing changed', () => {
    const w = ws({ p1: { paneId: 'p1', config: term() } })
    expect(applyResumeAi(w, {})).toBe(w)
  })
})
