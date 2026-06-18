import { describe, it, expect } from 'vitest'
import {
  registerFocuser, unregisterFocuser, focusPane, requestPaneFocus,
  registerRedrawer, unregisterRedrawer, redrawPane
} from '../../src/renderer/components/terminal-registry'

describe('pane redraw registry', () => {
  it('redrawPane returns false when no redrawer is registered', () => {
    expect(redrawPane('absent')).toBe(false)
  })
  it('redrawPane invokes the registered redrawer and returns true', () => {
    let n = 0
    registerRedrawer('r1', () => { n++ })
    expect(redrawPane('r1')).toBe(true)
    expect(n).toBe(1)
    unregisterRedrawer('r1')
    expect(redrawPane('r1')).toBe(false)
  })
})

describe('pane focus registry', () => {
  it('focusPane returns false when no focuser is registered', () => {
    expect(focusPane('absent')).toBe(false)
  })

  it('focusPane invokes the registered focuser and returns whether focus landed', () => {
    let n = 0
    registerFocuser('p1', () => { n++; return true })
    expect(focusPane('p1')).toBe(true)
    expect(n).toBe(1)
    unregisterFocuser('p1')
    expect(focusPane('p1')).toBe(false)
  })

  it('requestPaneFocus focuses immediately when the focuser lands first try', () => {
    let n = 0
    registerFocuser('p2', () => { n++; return true })
    const schedule = () => { throw new Error('should not retry') }
    requestPaneFocus('p2', schedule)
    expect(n).toBe(1)
    unregisterFocuser('p2')
  })

  it('requestPaneFocus retries across frames until a freshly-mounted pane registers', () => {
    // A just-created pane mounts after the React commit, so its focuser is not yet present
    // when the create action fires. requestPaneFocus must retry, then succeed once it appears.
    const pending: Array<() => void> = []
    const schedule = (cb: () => void) => { pending.push(cb) }
    let n = 0
    requestPaneFocus('p3', schedule)
    expect(n).toBe(0)                 // nothing to focus yet
    expect(pending.length).toBe(1)   // a retry was scheduled
    registerFocuser('p3', () => { n++; return true })
    pending.shift()!()               // run the scheduled retry
    expect(n).toBe(1)                 // now it focuses
    unregisterFocuser('p3')
  })

  it('requestPaneFocus retries until focus actually lands (pane hidden then shown)', () => {
    // The focuser exists but focus() is a no-op while the pane is hidden (workspace mid-switch):
    // it reports false, so requestPaneFocus keeps retrying until the pane is visible and focus sticks.
    const pending: Array<() => void> = []
    const schedule = (cb: () => void) => { pending.push(cb) }
    let landed = false
    let calls = 0
    registerFocuser('p4', () => { calls++; return landed })
    requestPaneFocus('p4', schedule)
    expect(calls).toBe(1)            // tried once, did not land
    expect(pending.length).toBe(1)  // retry scheduled
    landed = true
    pending.shift()!()              // now visible: focus lands
    expect(calls).toBe(2)
    expect(pending.length).toBe(0)  // no further retries once it landed
    unregisterFocuser('p4')
  })

  it('requestPaneFocus is a no-op for an empty pane id', () => {
    const schedule = () => { throw new Error('should not schedule') }
    expect(() => requestPaneFocus('', schedule)).not.toThrow()
  })
})
