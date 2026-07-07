// 2026-07-06 quality-audit Group B #5: `scanOsc`'s carry-over is unbounded when a prefix appears
// but no terminator ever arrives (an accidental `cat` of a binary suffices — CwdParser's prefix is
// the bare `\x1b]`, so ANY unterminated OSC feeds it), growing per chunk forever AND rescanned per
// chunk (O(n^2)) inside StatusEngine.feed, the PTY hot path. This suite pins the explicit bounded
// ceiling layered on top of scanOsc in both parsers — the OrkyOscParser MAX_PENDING_BYTES
// precedent (REQ-006 there) — and that marker semantics are unchanged: no legal in-flight
// sequence is ever clipped, and the stream recovers cleanly after a drop.
import { describe, it, expect } from 'vitest'
import { Osc133Parser, MAX_PENDING_BYTES as OSC133_CAP } from '../../src/main/status/osc133-parser'
import { CwdParser, MAX_PENDING_BYTES as CWD_CAP } from '../../src/main/status/cwd-parser'

const ESC = '\x1b', BEL = '\x07'

// The internal carry-over is a private-in-TypeScript-only field, readable at runtime like any
// property (the orky-osc-parser.test.ts TEST-014 pattern).
const bufBytes = (p: object): number => Buffer.byteLength((p as { buf: string }).buf, 'utf8')

describe('Osc133Parser pending-buffer bound', () => {
  it('an unterminated marker prefix followed by endless output stays bounded', () => {
    const p = new Osc133Parser()
    expect(p.push(`${ESC}]133;`)).toEqual([]) // prefix, never terminated
    const chunk = 'x'.repeat(64 * 1024)
    const totalPushed = 32 * chunk.length // 2 MiB
    for (let i = 0; i < 32; i++) expect(p.push(chunk)).toEqual([])
    const retained = bufBytes(p)
    expect(retained).toBeLessThanOrEqual(OSC133_CAP)
    expect(retained).toBeLessThan(totalPushed) // the ceiling actually bit, not merely generous
  })

  it('recovers after a drop: a later complete marker still parses', () => {
    const p = new Osc133Parser()
    p.push(`${ESC}]133;` + 'y'.repeat(OSC133_CAP + 100)) // over-cap unterminated -> dropped
    expect(p.push(`${ESC}]133;D;0${BEL}`)).toEqual([{ kind: 'D', exit: 0 }])
  })

  it('the cap exceeds the longest legal marker, and a marker fed byte-by-byte still parses', () => {
    const longest = `${ESC}]133;D;-2147483648${ESC}\\`
    expect(OSC133_CAP).toBeGreaterThan(longest.length)
    const p = new Osc133Parser()
    const events: unknown[] = []
    for (const ch of longest) events.push(...p.push(ch))
    expect(events).toEqual([{ kind: 'D', exit: -2147483648 }])
  })
})

describe('CwdParser pending-buffer bound', () => {
  it('an unterminated OSC (any kind — the prefix is bare ESC]) stays bounded', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]0;some window title that never terminates `)).toBeNull()
    const chunk = 'z'.repeat(64 * 1024)
    const totalPushed = 32 * chunk.length
    for (let i = 0; i < 32; i++) expect(p.push(chunk)).toBeNull()
    const retained = bufBytes(p)
    expect(retained).toBeLessThanOrEqual(CWD_CAP)
    expect(retained).toBeLessThan(totalPushed)
  })

  it('recovers after a drop: a later cwd report still parses', () => {
    const p = new CwdParser()
    p.push(`${ESC}]` + 'q'.repeat(CWD_CAP + 100)) // over-cap unterminated -> dropped
    expect(p.push(`${ESC}]9;9;C:\\dev\\Termhalla${BEL}`)).toBe('C:\\dev\\Termhalla')
  })

  it('the cap comfortably exceeds a PATH_MAX-class cwd report, split across chunks', () => {
    const deep = 'C:\\' + Array.from({ length: 500 }, (_, i) => `d${i}`).join('\\') // ~2.5k chars
    const seq = `${ESC}]9;9;${deep}${BEL}`
    expect(CWD_CAP).toBeGreaterThan(Buffer.byteLength(seq, 'utf8'))
    const p = new CwdParser()
    let cwd: string | null = null
    for (let i = 0; i < seq.length; i += 7) {
      const got = p.push(seq.slice(i, i + 7))
      if (got !== null) cwd = got
    }
    expect(cwd).toBe(deep)
  })
})
