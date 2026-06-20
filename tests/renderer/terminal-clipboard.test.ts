import { describe, it, expect, vi } from 'vitest'
import { clipboardKeyAction, handleClipboardKey } from '../../src/renderer/components/terminal-clipboard'

type KE = Parameters<typeof clipboardKeyAction>[0]
const ev = (over: Partial<KE>): KE => ({
  type: 'keydown', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: 'a', ...over
})

describe('clipboardKeyAction', () => {
  it('Ctrl+C with a selection -> copy', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'c' }), true)).toBe('copy')
  })
  it('Ctrl+C with no selection -> null (so ^C passes through)', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'c' }), false)).toBeNull()
  })
  it('Ctrl+V -> paste (regardless of selection)', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'v' }), false)).toBe('paste')
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'v' }), true)).toBe('paste')
  })
  it('Cmd+V (metaKey) -> paste', () => {
    expect(clipboardKeyAction(ev({ metaKey: true, key: 'v' }), false)).toBe('paste')
  })
  it('matches C/V case-insensitively', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'C' }), true)).toBe('copy')
  })
  it('ignores non-keydown events', () => {
    expect(clipboardKeyAction(ev({ type: 'keyup', ctrlKey: true, key: 'c' }), true)).toBeNull()
  })
  it('ignores Alt+Ctrl+C and Ctrl+Shift+C/V', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, altKey: true, key: 'c' }), true)).toBeNull()
    expect(clipboardKeyAction(ev({ ctrlKey: true, shiftKey: true, key: 'c' }), true)).toBeNull()
    expect(clipboardKeyAction(ev({ ctrlKey: true, shiftKey: true, key: 'v' }), false)).toBeNull()
  })
  it('ignores plain c/v without a modifier', () => {
    expect(clipboardKeyAction(ev({ key: 'c' }), true)).toBeNull()
    expect(clipboardKeyAction(ev({ key: 'v' }), false)).toBeNull()
  })
})

describe('handleClipboardKey', () => {
  const handlers = () => ({ copy: vi.fn(), paste: vi.fn() })
  const evp = (over: Partial<KE>) => ({ ...ev(over), preventDefault: vi.fn() })

  it('Ctrl+V: preventDefault, calls paste, returns false (xterm ignores it)', () => {
    const e = evp({ ctrlKey: true, key: 'v' })
    const h = handlers()
    const consumed = handleClipboardKey(e, false, h)
    expect(consumed).toBe(false)
    // preventDefault is the fix: without it the browser fires a native paste event that xterm's
    // own listener handles too -> the clipboard is pasted twice.
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(h.paste).toHaveBeenCalledTimes(1)
    expect(h.copy).not.toHaveBeenCalled()
  })

  it('Ctrl+C with a selection: preventDefault, calls copy, returns false', () => {
    const e = evp({ ctrlKey: true, key: 'c' })
    const h = handlers()
    const consumed = handleClipboardKey(e, true, h)
    expect(consumed).toBe(false)
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(h.copy).toHaveBeenCalledTimes(1)
    expect(h.paste).not.toHaveBeenCalled()
  })

  it('Ctrl+C with no selection: no preventDefault, returns true (^C passes through to the PTY)', () => {
    const e = evp({ ctrlKey: true, key: 'c' })
    const h = handlers()
    const consumed = handleClipboardKey(e, false, h)
    expect(consumed).toBe(true)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(h.copy).not.toHaveBeenCalled()
    expect(h.paste).not.toHaveBeenCalled()
  })

  it('a non-clipboard key: no preventDefault, returns true', () => {
    const e = evp({ ctrlKey: true, key: 'a' })
    const h = handlers()
    expect(handleClipboardKey(e, true, h)).toBe(true)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})
