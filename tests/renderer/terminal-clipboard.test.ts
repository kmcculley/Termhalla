import { describe, it, expect, vi } from 'vitest'
import { clipboardKeyAction, handleClipboardKey, normalizeCopiedText } from '../../src/renderer/components/terminal-clipboard'

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
  it('ignores Alt+Ctrl+C', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, altKey: true, key: 'c' }), true)).toBeNull()
  })
  it('accepts Ctrl+Shift+C/V — the terminal-emulator convention (QoL 2026-07-17)', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, shiftKey: true, key: 'C' }), true)).toBe('copy')
    expect(clipboardKeyAction(ev({ ctrlKey: true, shiftKey: true, key: 'C' }), false)).toBeNull()
    expect(clipboardKeyAction(ev({ ctrlKey: true, shiftKey: true, key: 'V' }), false)).toBe('paste')
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

describe('normalizeCopiedText', () => {
  it('reflows a TUI-wrapped prose paragraph into one logical line', () => {
    // Three physical rows a TUI produced by soft-wrapping one paragraph at ~40 cols. The first two
    // rows are near-full (the next word would not have fit), the last is short (paragraph end).
    const input =
      'The quick brown fox jumps over the lazy\n' +
      'dog and then keeps running through the\n' +
      'forest.'
    expect(normalizeCopiedText(input)).toBe(
      'The quick brown fox jumps over the lazy dog and then keeps running through the forest.'
    )
  })

  it('keeps a real paragraph break when the wrapped run is interrupted by a short line', () => {
    // "...it ends here." is a short paragraph-final row → the next full row starts a NEW line.
    const input =
      'This first paragraph fills the width and\n' +
      'then it ends here.\n' +
      'A second paragraph also fills the row and\n' +
      'wraps once more before stopping.'
    expect(normalizeCopiedText(input)).toBe(
      'This first paragraph fills the width and then it ends here.\n' +
      'A second paragraph also fills the row and wraps once more before stopping.'
    )
  })

  it('does not join across a blank line (blank = hard paragraph break)', () => {
    const input =
      'This paragraph is wide enough to look like\n' +
      'wrapped prose across two rows.\n' +
      '\n' +
      'Second paragraph is also wide enough here\n' +
      'and wraps too.'
    expect(normalizeCopiedText(input)).toBe(
      'This paragraph is wide enough to look like wrapped prose across two rows.\n' +
      '\n' +
      'Second paragraph is also wide enough here and wraps too.'
    )
  })

  it('does not merge list items even when the preceding line is full', () => {
    const input =
      'Here are the items that you requested from\n' +
      '- first item\n' +
      '- second item'
    expect(normalizeCopiedText(input)).toBe(
      'Here are the items that you requested from\n' +
      '- first item\n' +
      '- second item'
    )
  })

  it('does not merge a numbered list', () => {
    const input =
      'The steps you need to follow are listed as\n' +
      '1. do the first thing\n' +
      '2. then the second thing'
    expect(normalizeCopiedText(input)).toBe(
      'The steps you need to follow are listed as\n' +
      '1. do the first thing\n' +
      '2. then the second thing'
    )
  })

  it('does not merge an indented (code / nested) continuation', () => {
    const input =
      'Run the following command in your shell to\n' +
      '    npm install --save-dev vitest'
    expect(normalizeCopiedText(input)).toBe(
      'Run the following command in your shell to\n' +
      '    npm install --save-dev vitest'
    )
  })

  it('leaves short uniform rows (file list / columns) untouched', () => {
    // contentWidth is well below the reflow floor → whole reflow pass is skipped.
    const input = 'file1.txt\nfile2.txt\nfile3.txt'
    expect(normalizeCopiedText(input)).toBe('file1.txt\nfile2.txt\nfile3.txt')
  })

  it('trims trailing whitespace from each row', () => {
    expect(normalizeCopiedText('hello world   \n  keep leading indent  ')).toBe(
      'hello world\n  keep leading indent'
    )
  })

  it('collapses blank-line runs and trims leading/trailing blanks', () => {
    const input = '\n\nfirst\n\n\n\nsecond\n\n'
    expect(normalizeCopiedText(input)).toBe('first\n\nsecond')
  })

  it('normalizes CRLF input to LF', () => {
    expect(normalizeCopiedText('a\r\nb')).toBe('a\nb')
  })

  it('leaves a single line unchanged', () => {
    expect(normalizeCopiedText('just one line')).toBe('just one line')
  })

  it('respects flags: reflow off leaves wrapped rows split', () => {
    const input =
      'The quick brown fox jumps over the lazy\n' +
      'dog and then keeps running through it.'
    expect(normalizeCopiedText(input, { reflow: false })).toBe(input)
  })

  it('respects flags: blankLines off preserves blank runs', () => {
    expect(normalizeCopiedText('a\n\n\nb', { reflow: false, blankLines: false })).toBe('a\n\n\nb')
  })
})
