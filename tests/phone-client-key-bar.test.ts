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

// ---------------------------------------------------------------------------------------------
// v2 loopback addition (ESC-001; FINDING-033) — REQ-023: the Ctrl latch MUST compose with
// SOFT-KEYBOARD input. Contract amendment — createKeyBar() additionally exposes:
//   transformTyped(data: string): string
//     // routes a term.onData datum through the latch: with the latch armed, a single-letter
//     // datum becomes its control byte (Ctrl+C by tapping Ctrl then typing 'c' on the iOS
//     // keyboard) and the latch clears; unlatched or non-single-letter data passes through
//     // unchanged (no control byte is fabricated for pastes/multi-byte input).
import { describe as describeV2, it as itV2, expect as expectV2 } from 'vitest'
import { createKeyBar as createKeyBarV2 } from '../src/phone-client/key-bar'
import { readFileSync as readFileSyncV2 } from 'node:fs'
import { resolve as resolveV2 } from 'node:path'

describeV2('TEST-2725 REQ-023 the Ctrl latch composes with typed (term.onData) input', () => {
  itV2('latch + typed letter yields the control byte and clears the latch (Ctrl then c -> \\x03)', () => {
    const kb = createKeyBarV2()
    kb.press('ctrl')
    expectV2(kb.transformTyped('c')).toBe('\x03')
    expectV2(kb.isCtrlLatched(), 'the latch is one-shot over typed input too').toBe(false)
    expectV2(kb.transformTyped('c'), 'unlatched typed input passes through').toBe('c')
  })

  itV2('covers the letter range case-insensitively through the typed path', () => {
    const kb = createKeyBarV2()
    kb.press('ctrl')
    expectV2(kb.transformTyped('a')).toBe('\x01')
    kb.press('ctrl')
    expectV2(kb.transformTyped('Z')).toBe('\x1a')
  })

  itV2('non-letter and multi-character data never fabricate a control byte', () => {
    const kb = createKeyBarV2()
    kb.press('ctrl')
    expectV2(kb.transformTyped('hello')).toBe('hello')
    kb.press('ctrl')
    expectV2(kb.transformTyped('1')).toBe('1')
    expectV2(kb.transformTyped('')).toBe('')
  })

  itV2('terminal-view routes term.onData through the latch (structural — the wiring half)', () => {
    const src = readFileSyncV2(resolveV2(process.cwd(), 'src/phone-client/terminal-view.ts'), 'utf8')
    expectV2(src, 'typed soft-keyboard input must pass transformTyped before send').toMatch(/transformTyped/)
  })
})
