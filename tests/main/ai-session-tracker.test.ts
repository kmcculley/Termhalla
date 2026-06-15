import { describe, it, expect, vi } from 'vitest'
import { AiSessionTracker } from '../../src/main/ai/ai-session-tracker'
import type { ProcInfo } from '@shared/types'

const claudeInfo: ProcInfo = {
  foreground: 'node',
  tree: [{ pid: 2, ppid: 1, name: 'node', command: 'node ...\\claude-code\\cli.js', depth: 0 }]
}
const plainInfo: ProcInfo = {
  foreground: 'node', tree: [{ pid: 2, ppid: 1, name: 'node', command: 'npm run dev', depth: 0 }]
}

describe('AiSessionTracker', () => {
  it('sets an AI session when claude is detected, and dedups', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.onProcs('a', claudeInfo)
    t.onProcs('a', claudeInfo)   // same -> no second emit
    expect(onAi).toHaveBeenCalledTimes(1)
    expect(onAi).toHaveBeenCalledWith('a', { tool: 'claude', label: 'Claude' })
  })

  it('does not set or clear on a non-AI snapshot or a null (idle) snapshot', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.onProcs('a', plainInfo)
    t.onProcs('a', null)
    expect(onAi).not.toHaveBeenCalled()
  })

  it('persists through a busy->idle (null) sequence and clears only on command-done', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.onProcs('a', claudeInfo)   // set
    t.onProcs('a', null)         // idle clear from C -> must NOT clear the AI flag
    expect(onAi).toHaveBeenCalledTimes(1)
    t.commandDone('a')           // shell command (claude) ended -> clear
    expect(onAi).toHaveBeenCalledTimes(2)
    expect(onAi).toHaveBeenLastCalledWith('a', null)
  })

  it('clears on unregister', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.onProcs('a', claudeInfo)
    t.unregister('a')
    expect(onAi).toHaveBeenLastCalledWith('a', null)
  })

  it('commandDone/unregister on an unknown id is a no-op', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.commandDone('x'); t.unregister('x')
    expect(onAi).not.toHaveBeenCalled()
  })
})
