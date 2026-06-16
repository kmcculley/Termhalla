import { describe, it, expect } from 'vitest'
import {
  windowOf, undock, redock, decideDrop,
  type CoreState, type Strip
} from '../../src/main/window-manager-core'

const base: CoreState = { windows: [
  { id: 'main', isMain: true, workspaceIds: ['a', 'b'], activeId: 'b' },
  { id: 'w2', isMain: false, workspaceIds: ['c'], activeId: 'c' }
] }

describe('windowOf', () => {
  it('finds the window hosting a workspace', () => {
    expect(windowOf(base, 'a')).toBe('main')
    expect(windowOf(base, 'c')).toBe('w2')
    expect(windowOf(base, 'zzz')).toBeNull()
  })
})

describe('undock', () => {
  it('moves the workspace into a fresh window and fixes the source active tab', () => {
    const next = undock(base, 'b', 'w3')
    expect(windowOf(next, 'b')).toBe('w3')
    const main = next.windows.find(w => w.id === 'main')!
    expect(main.workspaceIds).toEqual(['a'])
    expect(main.activeId).toBe('a')
    const w3 = next.windows.find(w => w.id === 'w3')!
    expect(w3).toMatchObject({ isMain: false, workspaceIds: ['b'], activeId: 'b' })
  })
})

describe('redock', () => {
  it('appends to the target and makes it active', () => {
    const { state, closedWindowId } = redock(base, 'c', 'main')
    const main = state.windows.find(w => w.id === 'main')!
    expect(main.workspaceIds).toEqual(['a', 'b', 'c'])
    expect(main.activeId).toBe('c')
    expect(closedWindowId).toBe('w2')
    expect(state.windows.find(w => w.id === 'w2')).toBeUndefined()
  })

  it('never removes the main window even when emptied', () => {
    const start: CoreState = { windows: [
      { id: 'main', isMain: true, workspaceIds: ['a'], activeId: 'a' },
      { id: 'w2', isMain: false, workspaceIds: ['b'], activeId: 'b' }
    ] }
    const { state, closedWindowId } = redock(start, 'a', 'w2')
    expect(state.windows.find(w => w.id === 'main')!.workspaceIds).toEqual([])
    expect(closedWindowId).toBeNull()
  })
})

describe('decideDrop', () => {
  const strips: Strip[] = [
    { windowId: 'main', x: 0, y: 0, width: 800, height: 36 },
    { windowId: 'w2', x: 900, y: 0, width: 400, height: 36 }
  ]
  it('undocks when the cursor is over no strip', () => {
    expect(decideDrop({ x: 500, y: 500 }, 'main', strips)).toEqual({ action: 'undock' })
  })
  it('re-docks when over another window strip', () => {
    expect(decideDrop({ x: 950, y: 10 }, 'main', strips)).toEqual({ action: 'redock', targetWindowId: 'w2' })
  })
  it('is a no-op when dropped back on its own strip', () => {
    expect(decideDrop({ x: 100, y: 10 }, 'main', strips)).toEqual({ action: 'none' })
  })
})
