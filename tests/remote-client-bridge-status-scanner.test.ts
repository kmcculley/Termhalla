// 2026-07-17 whole-project quality audit, finding 31: the daemon connect leg used to accumulate
// raw bridge stderr unboundedly (and full-rescan it per chunk while a handshake failure was
// pending) in the privileged Electron main process. `createBridgeStatusScanner` is the bounded,
// incremental replacement: same parse semantics as `parseBridgeStatus` applied streamwise —
// completed lines scanned once through the same tolerant parser and discarded, the trailing
// partial line scan-eligible and retained bounded, the FIRST valid status line latched (after
// which nothing accumulates at all).
import { describe, it, expect } from 'vitest'
import {
  parseBridgeStatus, createBridgeStatusScanner, BRIDGE_STATUS_WINDOW_CHARS
} from '../src/remote-client/bridge-status'

const VALID_LINE = 'TERMHALLA_BRIDGE_V1 {"spawned":true,"daemonVersion":"1.2.3","daemonProto":1,"daemonPid":4711}'
const VALID = { spawned: true, daemonVersion: '1.2.3', daemonProto: 1, daemonPid: 4711 }
const OTHER_LINE = 'TERMHALLA_BRIDGE_V1 {"spawned":false,"daemonVersion":"9.9.9","daemonProto":2,"daemonPid":7}'

const scanAll = (chunks: string[], windowChars?: number) => {
  const s = windowChars === undefined ? createBridgeStatusScanner() : createBridgeStatusScanner(windowChars)
  for (const c of chunks) s.push(c)
  return s.status()
}

describe('the incremental scanner matches parseBridgeStatus on the pinned single-shot vectors', () => {
  const vectors = [
    `${VALID_LINE}\n`,
    'TERMHALLA_BRIDGE_V1 {"spawned":false,"daemonVersion":null,"daemonProto":null,"daemonPid":null}\n',
    // Diagnostics before AND after the line (the FINDING-017 raw-stderr shape).
    `bridge: attaching to a daemon running backend "fake" while --pty=node-pty was requested\n${OTHER_LINE}\nbridge: piping\n`,
    '',
    'plain diagnostics only\nno sentinel here',
    'TERMHALLA_BRIDGE_V1 not-json{{{',
    'TERMHALLA_BRIDGE_V1 {"spawned":"yes","daemonVersion":1,"daemonProto":"x","daemonPid":"x"}',
    'TERMHALLA_BRIDGE_V1 {}',
    // The pre-revision-2 THREE-field shape is malformed ⇒ null.
    'TERMHALLA_BRIDGE_V1 {"spawned":true,"daemonVersion":"1.2.3","daemonPid":4711}'
  ]

  it('one chunk in ⇒ the exact parseBridgeStatus result out, for every vector', () => {
    for (const v of vectors) {
      expect(scanAll([v]), JSON.stringify(v.slice(0, 60))).toEqual(parseBridgeStatus(v))
    }
  })

  it('the same vectors byte-split into many chunks parse identically', () => {
    for (const v of vectors) {
      const chunks: string[] = []
      for (let i = 0; i < v.length; i += 7) chunks.push(v.slice(i, i + 7))
      expect(scanAll(chunks), JSON.stringify(v.slice(0, 60))).toEqual(parseBridgeStatus(v))
    }
  })
})

describe('streamwise semantics', () => {
  it('a status line split mid-JSON across chunks parses once complete', () => {
    const s = createBridgeStatusScanner()
    s.push('TERMHALLA_BRIDGE_V1 {"spawned":true,"daemonVer')
    expect(s.status()).toBeNull()
    s.push('sion":"1.2.3","daemonProto":1,"daemonPid":4711}\n')
    expect(s.status()).toEqual(VALID)
  })

  it('the trailing partial line is scan-eligible: the JSON can land before its newline (parseBridgeStatus parity)', () => {
    const s = createBridgeStatusScanner()
    s.push(`diag first\n${VALID_LINE}`) // no trailing newline yet
    expect(s.status(), 'parseBridgeStatus treats the tail as a line — so does the scanner').toEqual(VALID)
  })

  it('a malformed prefixed line keeps scanning; the first VALID line wins and then latches', () => {
    const s = createBridgeStatusScanner()
    s.push('TERMHALLA_BRIDGE_V1 not-json{{{\n')
    expect(s.status()).toBeNull()
    s.push(`${VALID_LINE}\n`)
    expect(s.status()).toEqual(VALID)
    // Latched: a later (different) valid line and later garbage change nothing.
    s.push(`${OTHER_LINE}\n`)
    s.push('x'.repeat(1000))
    expect(s.status()).toEqual(VALID)
  })

  it('never throws on non-string input (the parseBridgeStatus tolerance posture)', () => {
    const s = createBridgeStatusScanner()
    expect(() => s.push(undefined as unknown as string)).not.toThrow()
    expect(s.status()).toBeNull()
  })
})

describe('the accumulation is genuinely bounded', () => {
  it('a partial line longer than the window is head-truncated (the bound is applied)', () => {
    // With a tiny window, a status line whose head scrolls out of the window before its newline
    // arrives cannot parse — proving retention is bounded (the old unbounded raw accumulation
    // would have parsed it).
    const r = scanAll(['TERMHALLA_BRIDGE_V1 {"spawned":true,', '"daemonVersion":"1.2.3","daemonProto":1,"daemonPid":4711}\n'], 10)
    expect(r).toBeNull()
  })

  it('the default window is generous against a real status line yet far below the probe cap', () => {
    expect(BRIDGE_STATUS_WINDOW_CHARS).toBeGreaterThan(VALID_LINE.length * 4)
    expect(BRIDGE_STATUS_WINDOW_CHARS).toBeLessThanOrEqual(65536)
    // A noisy remote streaming far past the window still cannot defeat a later real status line
    // that starts at a line boundary.
    const s = createBridgeStatusScanner()
    for (let i = 0; i < 100; i++) s.push('n'.repeat(BRIDGE_STATUS_WINDOW_CHARS)) // one endless line
    s.push(`\n${VALID_LINE}\n`)
    expect(s.status()).toEqual(VALID)
  })
})
