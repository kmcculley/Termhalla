import { describe, it, expect, afterEach } from 'vitest'
import {
  isEditableChromeFocus, requestPaneFocus, registerFocuser, unregisterFocuser,
  type FocusOwnerLike
} from '../../src/renderer/components/terminal-registry'

/** requestPaneFocus must never steal keyboard focus from an editable CHROME control (workspace
 *  rename input, dialog fields). Pane-owned editables (xterm's helper textarea, Monaco's input)
 *  live under `.ws-mosaic` and must NOT suppress refocus — switching workspaces away from a
 *  focused terminal still has to move focus. */

const chromeInput: FocusOwnerLike = { tagName: 'INPUT', closest: () => null }
const paneTextarea: FocusOwnerLike = {
  tagName: 'TEXTAREA',
  closest: (sel: string) => (sel === '.ws-mosaic' ? {} : null)
}
const body: FocusOwnerLike = { tagName: 'BODY', closest: () => null }

describe('isEditableChromeFocus', () => {
  it('is false for nothing focused / non-editables', () => {
    expect(isEditableChromeFocus(null)).toBe(false)
    expect(isEditableChromeFocus(undefined)).toBe(false)
    expect(isEditableChromeFocus(body)).toBe(false)
    expect(isEditableChromeFocus({ tagName: 'BUTTON', closest: () => null })).toBe(false)
  })

  it('is true for a text field outside any pane body (chrome)', () => {
    expect(isEditableChromeFocus(chromeInput)).toBe(true)
    expect(isEditableChromeFocus({ tagName: 'TEXTAREA', closest: () => null })).toBe(true)
    expect(isEditableChromeFocus({ tagName: 'DIV', isContentEditable: true, closest: () => null })).toBe(true)
  })

  it('is false for pane-owned editables (inside .ws-mosaic — xterm/Monaco textareas)', () => {
    expect(isEditableChromeFocus(paneTextarea)).toBe(false)
  })
})

describe('requestPaneFocus focus-steal guard', () => {
  const paneId = 'pane-focus-guard-test'
  afterEach(() => unregisterFocuser(paneId))

  /** Synchronous scheduler: runs retries immediately, capped by the loop's own retry counter. */
  const syncSchedule = (cb: () => void) => cb()

  it('retries while focus is not in a chrome editable', () => {
    let calls = 0
    registerFocuser(paneId, () => { calls++; return calls >= 3 })
    requestPaneFocus(paneId, syncSchedule, () => body)
    expect(calls).toBe(3)
  })

  it('never calls the focuser while a chrome editable owns focus', () => {
    let calls = 0
    registerFocuser(paneId, () => { calls++; return false })
    requestPaneFocus(paneId, syncSchedule, () => chromeInput)
    expect(calls).toBe(0)
  })

  it('stops retrying when a chrome editable takes focus mid-loop (e.g. a rename opens)', () => {
    let calls = 0
    let active: FocusOwnerLike = body
    registerFocuser(paneId, () => { calls++; active = chromeInput; return false })
    requestPaneFocus(paneId, syncSchedule, () => active)
    expect(calls).toBe(1)
  })

  it('still refocuses when a PANE editable owns focus (workspace switch away from a terminal)', () => {
    let calls = 0
    registerFocuser(paneId, () => { calls++; return true })
    requestPaneFocus(paneId, syncSchedule, () => paneTextarea)
    expect(calls).toBe(1)
  })
})
