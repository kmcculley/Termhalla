import { describe, it, expect } from 'vitest'
import {
  computeIdleFallback, computeNeedsInput, looksLikePrompt, stripAnsi, isPureControl,
  DEFAULT_NEEDS_INPUT_PATTERNS, type NeedsInputConfig
} from '../../src/main/status/needs-input'

const cfg = (over: Partial<NeedsInputConfig> = {}): NeedsInputConfig => ({
  enabled: true, quietMs: 10000, patterns: DEFAULT_NEEDS_INPUT_PATTERNS,
  heuristicIdleMs: 1500, heuristicIdleHardMs: 5000, ...over
})

describe('computeIdleFallback', () => {
  it('stays busy before the soft idle threshold', () => {
    expect(computeIdleFallback(1000, 'PS C:\\> ', false, cfg())).toBe(false)
  })
  it('fast path: no markers + recognized prompt past the soft threshold -> idle', () => {
    expect(computeIdleFallback(2000, 'PS C:\\> ', false, cfg())).toBe(true)
  })
  it('never pre-empts a genuine input prompt (stays busy -> needs-input handles it)', () => {
    expect(computeIdleFallback(6000, 'Overwrite? [y/N] ', false, cfg())).toBe(false)
  })
  it('slow path: sustained silence at a prompt with markers latched -> idle (nested shell)', () => {
    expect(computeIdleFallback(2000, 'C:\\>', true, cfg())).toBe(false)
    expect(computeIdleFallback(6000, 'C:\\>', true, cfg())).toBe(true)
  })
  it('slow path: sustained silence with no markers and an unrecognized prompt -> idle', () => {
    expect(computeIdleFallback(2000, 'no prompt char', false, cfg())).toBe(false)
    expect(computeIdleFallback(6000, 'no prompt char', false, cfg())).toBe(true)
  })
  it('keeps an integration command busy when its output is not a prompt', () => {
    expect(computeIdleFallback(8000, 'still compiling...', true, cfg())).toBe(false)
  })

  describe('AI session (aiActive)', () => {
    const aiTail = 'Claude Code ready\r\n? for shortcuts'  // TUI tail: markers latched, not a shell prompt
    it('idles after sustained silence despite markers and a non-prompt tail', () => {
      expect(computeIdleFallback(2000, aiTail, true, cfg(), true)).toBe(false)  // < hard threshold -> still working
      expect(computeIdleFallback(6000, aiTail, true, cfg(), true)).toBe(true)   // sustained silence -> awaiting
    })
    it('does NOT idle the same case when aiActive is false (the bug it fixes)', () => {
      expect(computeIdleFallback(6000, aiTail, true, cfg(), false)).toBe(false)
    })
    it('still defers a genuine input prompt to needs-input (no idle)', () => {
      expect(computeIdleFallback(12000, 'Continue? [y/N] ', true, cfg(), true)).toBe(false)
    })
    it('stays busy when the agent working indicator was seen recently, despite silence', () => {
      // aiActive, sustained silence, but aiWorkingRecent=true -> NOT idle (working blocked on a tool).
      expect(computeIdleFallback(9000, aiTail, true, cfg(), true, true)).toBe(false)
      // once the indicator goes stale (aiWorkingRecent=false), silence -> idle (awaiting).
      expect(computeIdleFallback(9000, aiTail, true, cfg(), true, false)).toBe(true)
    })
  })
})

describe('computeNeedsInput', () => {
  it('fires when quiet past threshold AND tail matches a y/N prompt', () => {
    expect(computeNeedsInput(11000, 'Overwrite? [y/N] ', cfg())).toBe(true)
  })
  it('fires on a password prompt', () => {
    expect(computeNeedsInput(12000, 'Enter password: ', cfg())).toBe(true)
  })
  it('does NOT fire before the quiet threshold (slow-but-chatty command)', () => {
    expect(computeNeedsInput(2000, 'Continue? [y/N] ', cfg())).toBe(false)
  })
  it('does NOT fire when the tail is just progress output', () => {
    expect(computeNeedsInput(15000, 'Building project... 42%', cfg())).toBe(false)
  })
  it('does NOT fire when disabled', () => {
    expect(computeNeedsInput(99000, 'Overwrite? [y/N] ', cfg({ enabled: false }))).toBe(false)
  })
  it('matches only the last line of the tail', () => {
    expect(computeNeedsInput(11000, 'compiled ok\nProceed? [y/N] ', cfg())).toBe(true)
    expect(computeNeedsInput(11000, 'Proceed? [y/N] \nnevermind, more logs', cfg())).toBe(false)
  })
})

describe('looksLikePrompt', () => {
  it('recognises a typical shell prompt tail', () => {
    expect(looksLikePrompt('PS C:\\Users\\kevin> ')).toBe(true)
    expect(looksLikePrompt('user@host:~$ ')).toBe(true)
  })
  it('rejects ordinary output', () => {
    expect(looksLikePrompt('still working on it')).toBe(false)
  })
})

describe('stripAnsi', () => {
  it('removes CSI color codes leaving printable text', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello')
  })
  it('removes cursor-home and erase sequences', () => {
    expect(stripAnsi('\x1b[H\x1b[2Kdone')).toBe('done')
  })
})

describe('isPureControl', () => {
  it('is true for an ANSI-only / whitespace chunk', () => {
    expect(isPureControl('\x1b[2K\r\n')).toBe(true)
    expect(isPureControl('   \r\n')).toBe(true)
  })
  it('is true for a chunk that BEGINS with a screen-redraw (cursor-home)', () => {
    expect(isPureControl('\x1b[?25l\x1b[HPS C:\\> ')).toBe(true)
    expect(isPureControl('\x1b[Hrepainted prompt')).toBe(true)
  })
  it('is FALSE for ordinary output that merely CONTAINS a cursor-home mid-stream', () => {
    expect(isPureControl('Building...\x1b[Hmore')).toBe(false)
  })
  it('is false for normal printable output', () => {
    expect(isPureControl('compiling project')).toBe(false)
  })
})
