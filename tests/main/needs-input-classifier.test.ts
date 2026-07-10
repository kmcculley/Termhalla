// Feature 0025-cursor-home-output-suppression — REQ-009: the pure classification seam
// exported from src/main/status/needs-input.ts is TOTAL (never throws on any string) and
// distinguishes the spec's three observable chunk classes (02-spec.md, Vocabulary):
//   (i)   no printable content              -> isPureControl true
//   (ii)  repaint chunk WITH printable text -> isPureControl false, isRepaintChunk true
//   (iii) real output                       -> isPureControl false, isRepaintChunk false
// Shape per 03-plan.md (resolves concept OQ6): `isPureControl` drops its CURSOR_HOME_RE
// early-return and becomes pure "no printable content" detection; the NEW exported
// `isRepaintChunk` carries the start-anchored repaint axis (both home forms `\x1b[H` /
// `\x1b[1;1H`, optional `\x1b[?25l`/`\x1b[?25h` prefixes).
// This file is intentionally RED at the tests phase: `isRepaintChunk` does not exist yet.
import { describe, it, expect } from 'vitest'
import { isPureControl, isRepaintChunk } from '../../src/main/status/needs-input'

// The exact REQ-009 enumeration plus malformed-escape hardening inputs.
const VECTORS = [
  '',                                   // empty string
  '\x1b[2J',                            // ANSI-only
  '   \r\n',                            // whitespace-only
  'cleared \x1b[Hmid',                  // home MID-chunk -> real output (anchoring preserved)
  '\x1b[H\x1b[K\r\n',                   // home-prefixed WITHOUT printable content (class i)
  '\x1b[Hreal text',                    // home-prefixed WITH printable content (class ii)
  'hello',                              // plain text (class iii)
  '\x1b[',                              // truncated escape (totality hardening)
  '\x1b[?25l\x1b[H',                    // prefixed home, control-only
  '\x1b[?25l\x1b[1;1HOverwrite? [y/N] ',// prefixed 1;1H form with printable prompt
  '\x1b[?25h\x1b[Hframe',               // ?25h prefix variant
  '\x1b[1;1H'                           // bare 1;1H form
]

describe('needs-input classifier contract (0025, REQ-009)', () => {
  it('TEST-2521 REQ-009 both classifier exports are total: no enumerated or malformed input throws', () => {
    for (const v of VECTORS) {
      expect(() => isPureControl(v), JSON.stringify(v)).not.toThrow()
      expect(() => isRepaintChunk(v), JSON.stringify(v)).not.toThrow()
    }
  })

  it('TEST-2522 REQ-009 class (i) — no printable content: empty, ANSI-only, whitespace-only, home-prefixed control-only', () => {
    expect(isPureControl('')).toBe(true)               // '' classifies as "no printable content"
    expect(isPureControl('\x1b[2J')).toBe(true)        // ANSI-only
    expect(isPureControl('   \r\n')).toBe(true)        // whitespace-only
    expect(isPureControl('\x1b[H\x1b[K\r\n')).toBe(true) // home-prefixed, stripped content only ws/control
    expect(isPureControl('\x1b[?25l\x1b[H')).toBe(true)
  })

  it('TEST-2523 REQ-009 isRepaintChunk: start-anchored home detection, both home forms, optional cursor show/hide prefixes', () => {
    expect(isRepaintChunk('\x1b[Hreal text')).toBe(true)
    expect(isRepaintChunk('\x1b[1;1H')).toBe(true)
    expect(isRepaintChunk('\x1b[?25l\x1b[1;1HOverwrite? [y/N] ')).toBe(true)
    expect(isRepaintChunk('\x1b[?25h\x1b[Hframe')).toBe(true)
    expect(isRepaintChunk('\x1b[H\x1b[K\r\n')).toBe(true)
    expect(isRepaintChunk('cleared \x1b[Hmid')).toBe(false) // home NOT at start — anchoring preserved
    expect(isRepaintChunk('hello')).toBe(false)
    expect(isRepaintChunk('')).toBe(false)
    expect(isRepaintChunk('\x1b[2J')).toBe(false)
  })

  it('TEST-2524 REQ-009/REQ-010 class (ii) — a home-prefixed chunk WITH printable text is no longer "pure control"', () => {
    // The 0025 amendment of baseline REQ-007 / CHAR-001 (baseline KNOWN BUG #4): a redraw
    // that CARRIES printable text is admissible text — StatusTracker admits it to the
    // needs-input tail, while `isRepaintChunk` keeps it away from the quiet timer/state.
    expect(isPureControl('\x1b[Hreal text')).toBe(false)
    expect(isRepaintChunk('\x1b[Hreal text')).toBe(true)
    expect(isPureControl('\x1b[?25l\x1b[1;1HOverwrite? [y/N] ')).toBe(false)
    expect(isRepaintChunk('\x1b[?25l\x1b[1;1HOverwrite? [y/N] ')).toBe(true)
  })

  it('TEST-2525 REQ-009 class (iii) — real output: plain text, and a home sequence mid-chunk', () => {
    expect(isPureControl('hello')).toBe(false)
    expect(isRepaintChunk('hello')).toBe(false)
    expect(isPureControl('cleared \x1b[Hmid')).toBe(false)
    expect(isRepaintChunk('cleared \x1b[Hmid')).toBe(false)
  })
})
