import { describe, it, expect } from 'vitest'
import {
  chordKey, parseChordKey, formatChord, eventToChord, resolveBindings, matchShortcut,
  findConflict, isValidRebind, nextTipIndex, DEFAULT_BINDINGS, COMMANDS, TIP_COMMANDS, type Chord
} from '../src/shared/keybindings'

const ev = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) =>
  ({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, ...over })
const ch = (mod: boolean, shift: boolean, key: string): Chord => ({ mod, shift, key })

describe('chordKey / parseChordKey', () => {
  it('round-trips', () => {
    expect(chordKey(ch(true, true, 't'))).toBe('mod+shift+t')
    expect(chordKey(ch(true, false, ','))).toBe('mod+,')
    expect(parseChordKey('mod+shift+t')).toEqual(ch(true, true, 't'))
    expect(parseChordKey('mod+,')).toEqual(ch(true, false, ','))
  })
  it('returns null for empty', () => { expect(parseChordKey('')).toBeNull() })
})

describe('formatChord', () => {
  it('renders human labels', () => {
    expect(formatChord(ch(true, true, 't'))).toBe('Ctrl+Shift+T')
    expect(formatChord(ch(true, false, 'enter'))).toBe('Ctrl+Enter')
    expect(formatChord(ch(true, false, ','))).toBe('Ctrl+,')
  })
})

describe('eventToChord', () => {
  it('treats Meta as mod and lowercases the key', () => {
    expect(eventToChord(ev({ key: 'K', metaKey: true, shiftKey: true }))).toEqual(ch(true, true, 'k'))
  })
})

describe('resolveBindings', () => {
  it('returns defaults when no overrides', () => {
    expect(resolveBindings(undefined)).toEqual(DEFAULT_BINDINGS)
  })
  it('applies a valid override and ignores unknown ids', () => {
    const r = resolveBindings({ 'new-terminal': 'mod+shift+n', 'bogus-id': 'mod+x' })
    expect(r['new-terminal']).toEqual(ch(true, true, 'n'))
  })
  it("'none' unbinds a command", () => {
    const r = resolveBindings({ 'new-terminal': 'none' })
    expect(r['new-terminal']).toBeUndefined()
  })
})

describe('matchShortcut with overrides', () => {
  it('matches a rebound chord and not the old default', () => {
    const bindings = resolveBindings({ 'new-terminal': 'mod+shift+n' })
    expect(matchShortcut(ev({ key: 'n', ctrlKey: true, shiftKey: true }), bindings)).toEqual({ type: 'new-terminal' })
    expect(matchShortcut(ev({ key: 't', ctrlKey: true, shiftKey: true }), bindings)).toBeNull()
  })
  it('Ctrl+1-9 jump is reserved regardless of bindings', () => {
    expect(matchShortcut(ev({ key: '3', ctrlKey: true }), DEFAULT_BINDINGS)).toEqual({ type: 'jump-workspace', index: 2 })
  })
})

describe('findConflict', () => {
  it('finds another command on the same chord, honoring exceptId', () => {
    expect(findConflict(DEFAULT_BINDINGS, ch(true, false, 'k'), 'new-terminal')).toBe('toggle-palette')
    expect(findConflict(DEFAULT_BINDINGS, ch(true, false, 'k'), 'toggle-palette')).toBeNull()
  })
})

describe('isValidRebind', () => {
  it('requires Ctrl/Meta, a real key, and not a reserved digit', () => {
    expect(isValidRebind(ch(true, true, 'n'))).toBe(true)
    expect(isValidRebind(ch(false, true, 'n'))).toBe(false)
    expect(isValidRebind(ch(true, false, '3'))).toBe(false)
    expect(isValidRebind(ch(true, false, 'control'))).toBe(false)
  })
})

describe('nextTipIndex', () => {
  it('wraps', () => {
    expect(nextTipIndex(0, 3)).toBe(1)
    expect(nextTipIndex(2, 3)).toBe(0)
    expect(nextTipIndex(0, 0)).toBe(0)
  })
})

describe('registry invariants', () => {
  it('every TIP command exists and has a tip phrase', () => {
    for (const id of TIP_COMMANDS) {
      const cmd = COMMANDS.find(c => c.id === id)
      expect(cmd, id).toBeTruthy()
      expect(cmd!.tip, id).toBeTruthy()
    }
  })
})
