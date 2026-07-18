import { describe, it, expect } from 'vitest'
import {
  createPaneHookRegistry,
  registerSerializer, unregisterSerializer, readPaneSnapshot,
  registerClearer, unregisterClearer, clearPane,
  paneDirtyCount
} from '../../src/renderer/components/terminal-registry'

/** The generic factory behind the seven per-pane hook registries (quality audit finding 29). The
 *  exported register/unregister/invoke surfaces are unchanged — this pins the shared internals plus
 *  a sample of each invoke-wrapper flavor (fallback-value vs ran/not-ran) through the public API. */

describe('createPaneHookRegistry', () => {
  it('get returns undefined for a pane that never registered', () => {
    const reg = createPaneHookRegistry<() => number>()
    expect(reg.get('absent')).toBeUndefined()
  })

  it('register/get round-trips per pane id, independently across panes', () => {
    const reg = createPaneHookRegistry<() => string>()
    reg.register('a', () => 'A')
    reg.register('b', () => 'B')
    expect(reg.get('a')?.()).toBe('A')
    expect(reg.get('b')?.()).toBe('B')
  })

  it('re-register replaces the previous hook (a remount overwrites its predecessor)', () => {
    const reg = createPaneHookRegistry<() => string>()
    reg.register('a', () => 'old')
    reg.register('a', () => 'new')
    expect(reg.get('a')?.()).toBe('new')
  })

  it('unregister removes only that pane, and is a safe no-op when absent', () => {
    const reg = createPaneHookRegistry<() => string>()
    reg.register('a', () => 'A')
    reg.register('b', () => 'B')
    reg.unregister('a')
    expect(reg.get('a')).toBeUndefined()
    expect(reg.get('b')?.()).toBe('B')
    expect(() => reg.unregister('never-registered')).not.toThrow()
  })

  it('each factory call yields an independent registry (no shared map)', () => {
    const one = createPaneHookRegistry<() => string>()
    const two = createPaneHookRegistry<() => string>()
    one.register('a', () => 'one')
    expect(two.get('a')).toBeUndefined()
  })
})

describe('registry invoke wrappers keep their bespoke contracts', () => {
  it('readPaneSnapshot falls back to the empty string for an unmounted pane', () => {
    expect(readPaneSnapshot('absent')).toBe('')
    registerSerializer('snap-1', () => 'ansi-bytes')
    expect(readPaneSnapshot('snap-1')).toBe('ansi-bytes')
    unregisterSerializer('snap-1')
    expect(readPaneSnapshot('snap-1')).toBe('')
  })

  it('paneDirtyCount falls back to 0 for a pane with no dirty check', () => {
    expect(paneDirtyCount('absent')).toBe(0)
  })

  it('clearPane reports ran/not-ran instead of a fallback value', () => {
    expect(clearPane('absent')).toBe(false)
    let n = 0
    registerClearer('clear-1', () => { n++ })
    expect(clearPane('clear-1')).toBe(true)
    expect(n).toBe(1)
    unregisterClearer('clear-1')
    expect(clearPane('clear-1')).toBe(false)
  })
})
