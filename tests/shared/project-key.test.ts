import { describe, it, expect } from 'vitest'
import { resolveProjectKey } from '../../src/shared/project-key'
import type { GitStatus, Workspace } from '../../src/shared/types'

const git = (root: string): GitStatus => ({ root, branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: false })

function state(over: Partial<{ gitStatus: Record<string, GitStatus>; cwds: Record<string, string>; workspaces: Record<string, Workspace> }> = {}) {
  return { gitStatus: {}, cwds: {}, workspaces: {}, ...over }
}

describe('resolveProjectKey', () => {
  it('prefers the git root', () => {
    const s = state({ gitStatus: { p1: git('/repo') }, cwds: { p1: '/repo/sub' } })
    expect(resolveProjectKey(s, 'p1')).toBe('/repo')
  })
  it('falls back to the live cwd when no git status', () => {
    const s = state({ cwds: { p1: '/some/dir' } })
    expect(resolveProjectKey(s, 'p1')).toBe('/some/dir')
  })
  it('falls back to the persisted terminal cwd when no live cwd', () => {
    const ws: Workspace = { id: 'w', name: 'W', layout: 'p1', panes: { p1: { paneId: 'p1', config: { kind: 'terminal', shellId: 'sh', cwd: '/persisted' } } } } as unknown as Workspace
    expect(resolveProjectKey(state({ workspaces: { w: ws } }), 'p1')).toBe('/persisted')
  })
  it('returns empty string for no pane / no project', () => {
    expect(resolveProjectKey(state(), null)).toBe('')
    expect(resolveProjectKey(state(), 'ghost')).toBe('')
  })
})
