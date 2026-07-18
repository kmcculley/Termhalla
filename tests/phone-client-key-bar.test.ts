// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-023 (accessory key bar): the key -> byte-sequence mapping is a PURE, DOM-free module.
// Contract set here for the implementer — src/phone-client/key-bar.ts exports:
//   createKeyBar(): {
//     press(key: string): string        // the bytes to emit ('' = nothing to emit)
//     isCtrlLatched(): boolean
//   }
// Keys: 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right' | 'ctrl' | any single character.
// 'ctrl' latches the modifier and applies it to the NEXT key only (Ctrl+letter -> 0x01..0x1a).
// The module must be total: unknown keys are a silent no-op, never a throw.
import { describe, it, expect } from 'vitest'
import { createKeyBar } from '../src/phone-client/key-bar'

describe('TEST-2665 REQ-023 key-bar byte mapping and the Ctrl latch', () => {
  it('maps the listed keys to their byte sequences', () => {
    const kb = createKeyBar()
    expect(kb.press('esc')).toBe('\x1b')
    expect(kb.press('tab')).toBe('\t')
    expect(kb.press('up')).toBe('\x1b[A')
    expect(kb.press('down')).toBe('\x1b[B')
    expect(kb.press('right')).toBe('\x1b[C')
    expect(kb.press('left')).toBe('\x1b[D')
  })

  it('passes a plain character through unmodified', () => {
    const kb = createKeyBar()
    expect(kb.press('a')).toBe('a')
    expect(kb.press('Z')).toBe('Z')
  })

  it('Ctrl latches, applies to exactly the next key, then clears', () => {
    const kb = createKeyBar()
    expect(kb.press('ctrl')).toBe('')          // the latch itself emits nothing
    expect(kb.isCtrlLatched()).toBe(true)
    expect(kb.press('c')).toBe('\x03')          // Ctrl+C
    expect(kb.isCtrlLatched()).toBe(false)      // one-shot
    expect(kb.press('c')).toBe('c')             // back to plain
  })

  it('covers the full Ctrl+letter range 0x01..0x1a, case-insensitively', () => {
    const kb = createKeyBar()
    kb.press('ctrl')
    expect(kb.press('a')).toBe('\x01')
    kb.press('ctrl')
    expect(kb.press('z')).toBe('\x1a')
    kb.press('ctrl')
    expect(kb.press('C')).toBe('\x03')
  })

  it('Ctrl+special keys still work through the latch (Ctrl does not eat them)', () => {
    const kb = createKeyBar()
    kb.press('ctrl')
    const out = kb.press('up')
    // no 0x01..0x1a control byte is fabricated for a non-letter; the key still functions
    expect(out.length).toBeGreaterThan(0)
    expect(kb.isCtrlLatched()).toBe(false)
  })

  it('malformed / unknown keys are a silent no-op, never a throw', () => {
    const kb = createKeyBar()
    for (const key of ['', 'meta', 'not-a-key', 'CTRLX']) {
      expect(() => kb.press(key)).not.toThrow()
      expect(kb.press(key)).toBe('')
    }
    // Ctrl + non-letter never fabricates a control byte
    kb.press('ctrl')
    const out = kb.press('1')
    expect(/[\x01-\x1a]/.test(out)).toBe(false)
  })
})
