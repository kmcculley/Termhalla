import { describe, it, expect } from 'vitest'
import { clampWindowState, DEFAULT_WINDOW_STATE } from '../../src/main/window-state'
import type { WindowState } from '@shared/types'

const display = { x: 0, y: 0, width: 1920, height: 1080 }

describe('clampWindowState', () => {
  it('returns defaults when state is undefined', () => {
    expect(clampWindowState(undefined, [display])).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('keeps a fully on-screen window unchanged', () => {
    const s: WindowState = { x: 100, y: 100, width: 800, height: 600, maximized: false }
    expect(clampWindowState(s, [display])).toEqual(s)
  })

  it('recenters a window that is off all displays', () => {
    const s: WindowState = { x: 9000, y: 9000, width: 800, height: 600, maximized: false }
    const r = clampWindowState(s, [display])
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.width).toBe(800)
  })

  it('preserves the maximized flag', () => {
    const s: WindowState = { x: 0, y: 0, width: 800, height: 600, maximized: true }
    expect(clampWindowState(s, [display]).maximized).toBe(true)
  })
})
