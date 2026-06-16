import { describe, it, expect } from 'vitest'
import { clipboardKeyAction } from '../../src/renderer/components/terminal-clipboard'

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
