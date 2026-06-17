import { describe, it, expect } from 'vitest'
import { workspaceBadgeState, formatBadge } from '../../src/renderer/components/tab-badge'
import type { Workspace } from '@shared/types'

const term = (over: Record<string, unknown> = {}) => ({ config: { kind: 'terminal', shellId: 'cmd', cwd: '', ...over } })
const ws = (panes: Record<string, unknown>) => ({ id: 'w', name: 'W', layout: 'x', panes } as unknown as Workspace)

describe('workspaceBadgeState', () => {
  it('counts needs-input panes that opted into the tab badge', () => {
    const s = workspaceBadgeState(ws({ p1: term(), p2: term() }), { p1: { state: 'needs-input' }, p2: { state: 'busy' } } as never, {})
    expect(s).toEqual({ needs: 1, busy: true, ai: false, aiAwaiting: false })
  })
  it('ignores panes whose alerts disable the tab badge', () => {
    const s = workspaceBadgeState(ws({ p1: term({ alerts: { tabBadge: false } }) }), { p1: { state: 'needs-input' } } as never, {})
    expect(s).toEqual({ needs: 0, busy: false, ai: false, aiAwaiting: false })
  })
  it('flags an AI session and whether it is awaiting input', () => {
    const working = workspaceBadgeState(ws({ p1: term() }), { p1: { state: 'busy' } } as never, { p1: {} } as never)
    expect(working).toMatchObject({ ai: true, aiAwaiting: false })
    const awaiting = workspaceBadgeState(ws({ p1: term() }), { p1: { state: 'idle' } } as never, { p1: {} } as never)
    expect(awaiting).toMatchObject({ ai: true, aiAwaiting: true })
  })
  it('skips non-terminal panes', () => {
    const s = workspaceBadgeState(ws({ e1: { config: { kind: 'editor', files: [] } } }), {}, {})
    expect(s).toEqual({ needs: 0, busy: false, ai: false, aiAwaiting: false })
  })
})

describe('formatBadge', () => {
  it('is empty when nothing is active', () => {
    expect(formatBadge({ needs: 0, busy: false, ai: false, aiAwaiting: false })).toBe('')
  })
  it('shows a needs-input bell with the count, prefixed by the AI sparkle', () => {
    expect(formatBadge({ needs: 2, busy: true, ai: true, aiAwaiting: false })).toBe(' ✨ 🔔2')
  })
  it('shows a busy dot when busy but nothing needs input', () => {
    expect(formatBadge({ needs: 0, busy: true, ai: false, aiAwaiting: false })).toBe(' •')
  })
  it('shows the awaiting sparkle alone when the AI is idle', () => {
    expect(formatBadge({ needs: 0, busy: false, ai: true, aiAwaiting: true })).toBe(' ✨⏳')
  })
})
