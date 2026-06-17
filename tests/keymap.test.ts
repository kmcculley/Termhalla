import { describe, it, expect } from 'vitest'
import { matchShortcut } from '../src/shared/keymap'

const ev = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) =>
  ({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, ...over })

describe('matchShortcut', () => {
  it('Ctrl+K toggles the palette', () => {
    expect(matchShortcut(ev({ key: 'k', ctrlKey: true }))).toEqual({ type: 'toggle-palette' })
  })
  it('Meta+K also toggles the palette (mac parity)', () => {
    expect(matchShortcut(ev({ key: 'K', metaKey: true }))).toEqual({ type: 'toggle-palette' })
  })
  it('Ctrl+Shift+Enter toggles broadcast', () => {
    expect(matchShortcut(ev({ key: 'Enter', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'toggle-broadcast' })
  })
  it('Ctrl+Shift+T is new-terminal', () => {
    expect(matchShortcut(ev({ key: 'T', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'new-terminal' })
  })
  it('Ctrl+Shift+W is close-workspace', () => {
    expect(matchShortcut(ev({ key: 'W', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'close-workspace' })
  })
  it('Ctrl+Tab is next, Ctrl+Shift+Tab is prev', () => {
    expect(matchShortcut(ev({ key: 'Tab', ctrlKey: true }))).toEqual({ type: 'next-workspace' })
    expect(matchShortcut(ev({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'prev-workspace' })
  })
  it('Ctrl+3 jumps to 0-based index 2', () => {
    expect(matchShortcut(ev({ key: '3', ctrlKey: true }))).toEqual({ type: 'jump-workspace', index: 2 })
  })
  it('plain Tab and unmodified keys do not match', () => {
    expect(matchShortcut(ev({ key: 'Tab' }))).toBeNull()
    expect(matchShortcut(ev({ key: 't', ctrlKey: true }))).toBeNull() // no shift
    expect(matchShortcut(ev({ key: 'k' }))).toBeNull()
  })
})
