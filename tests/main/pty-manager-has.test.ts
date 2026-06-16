import { describe, it, expect, vi } from 'vitest'
import { PtyManager } from '../../src/main/pty/pty-manager'

describe('PtyManager.has', () => {
  it('is false for a pane that was never spawned', () => {
    const mgr = new PtyManager(vi.fn(), vi.fn(), {} as never, '/tmp')
    expect(mgr.has('nope')).toBe(false)
  })
})
