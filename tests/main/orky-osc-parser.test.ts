// Phase-4 unit suite — feature 0014-orky-osc-heartbeat (REQ-001/003/004/005). FROZEN once the tests
// gate passes (ADR-009): the implementer makes these pass without editing them.
//
// Behavioral coverage of `OrkyOscParser`/`decodeHeartbeat` (the bounded body grammar is exercised only
// through the public `push()` API — `decodeHeartbeat` itself is not exported, per 02-spec.md's "Public
// interface" section). Every marker byte string is built from `tests/fixtures/orky-osc-fixtures.ts`
// (REQ-010: synthetic/golden bytes only — no live Orky process, network, or `.orky/` tree anywhere in
// this file).
//
// Runs RED: `src/main/status/orky-osc-parser.ts` does not exist yet.
import { describe, it, expect } from 'vitest'
import { OrkyOscParser } from '../../src/main/status/orky-osc-parser'
import {
  buildOrkyMarker, buildOrkyMarkerFromPairs, wrapOrkyBody,
  WORKED_EXAMPLE_FIELDS, WORKED_EXAMPLE_MARKER, WORKED_EXAMPLE_HEARTBEAT
} from '../fixtures/orky-osc-fixtures'

const ESC = '\x1b', BEL = '\x07'

describe('OrkyOscParser — contract worked example + cross-prefix rejection (REQ-001)', () => {
  it('TEST-001 REQ-001 parses the worked-example BEL-terminated marker into the exact heartbeat', () => {
    // Catches drift between the hand-copied literal and the builder (both reproduced from 02-spec.md).
    expect(buildOrkyMarker(WORKED_EXAMPLE_FIELDS, 'BEL')).toBe(WORKED_EXAMPLE_MARKER)

    const p = new OrkyOscParser()
    expect(p.push(WORKED_EXAMPLE_MARKER)).toEqual([WORKED_EXAMPLE_HEARTBEAT])
  })

  it('TEST-002 REQ-001 the ST-terminated variant yields the identical result', () => {
    const stMarker = buildOrkyMarker(WORKED_EXAMPLE_FIELDS, 'ST')
    expect(stMarker).toBe(`\x1b]8888;orky=v=1;f=auth-login;k=busy;ph=implement;g=5;m=8;o=2;h=0;x=0${ESC}\\`)
    const p = new OrkyOscParser()
    expect(p.push(stMarker)).toEqual([WORKED_EXAMPLE_HEARTBEAT])
  })

  it('TEST-003 REQ-001 OSC 133 / OSC 7 / OSC 9;9 sequences yield [] (no cross-prefix match)', () => {
    expect(new OrkyOscParser().push(`${ESC}]133;A${BEL}`)).toEqual([])
    expect(new OrkyOscParser().push(`${ESC}]7;file://host/C:/dev${BEL}`)).toEqual([])
    expect(new OrkyOscParser().push(`${ESC}]9;9;C:\\dev${BEL}`)).toEqual([])
    // sanity: the SAME parser instance still parses a real marker afterwards (no state corruption)
    const p = new OrkyOscParser()
    p.push(`${ESC}]133;A${BEL}`)
    expect(p.push(WORKED_EXAMPLE_MARKER)).toEqual([WORKED_EXAMPLE_HEARTBEAT])
  })
})

describe('OrkyOscParser — chunk-boundary carry-over preserved exactly (REQ-003)', () => {
  it('TEST-004 REQ-003 splitting the worked-example marker at every byte offset 0..len yields the identical single heartbeat', () => {
    const whole = new OrkyOscParser().push(WORKED_EXAMPLE_MARKER)
    expect(whole).toEqual([WORKED_EXAMPLE_HEARTBEAT])
    for (let i = 0; i <= WORKED_EXAMPLE_MARKER.length; i++) {
      const p = new OrkyOscParser()
      const first = p.push(WORKED_EXAMPLE_MARKER.slice(0, i))
      const second = p.push(WORKED_EXAMPLE_MARKER.slice(i))
      expect([...first, ...second]).toEqual(whole)
    }
  })

  it('TEST-005 REQ-003 a partial (un-terminated) marker buffers, never emits early, and emits exactly once when the rest arrives later', () => {
    const p = new OrkyOscParser()
    expect(p.push('\x1b]8888;orky=v=1;f=auth-login')).toEqual([])
    expect(p.push(';k=busy;ph=implement;g=5;m=8;o=2;h=0;x=0' + BEL)).toEqual([WORKED_EXAMPLE_HEARTBEAT])
    // no double-emit: a further empty push yields nothing more
    expect(p.push('')).toEqual([])
  })
})

describe('OrkyOscParser — strict, bounded, non-evaluating body grammar, reject-whole (REQ-004)', () => {
  const base = WORKED_EXAMPLE_FIELDS

  it('TEST-006 REQ-004 a body over 256 bytes is rejected whole', () => {
    const body = 'v=1;f=auth-login;k=busy;ph=implement;g=5;m=8;o=2;h=0;x=0;z=' + 'a'.repeat(260)
    expect(body.length).toBeGreaterThan(256)
    expect(new OrkyOscParser().push(wrapOrkyBody(body))).toEqual([])
  })

  it('TEST-007 REQ-004 a body with more than 32 pairs is rejected whole', () => {
    const extra = Array.from({ length: 24 }, (_, i) => `z${i}=1`).join(';') // 9 required + 24 = 33 pairs
    const body = 'v=1;f=auth-login;k=busy;ph=implement;g=5;m=8;o=2;h=0;x=0;' + extra
    expect(body.length).toBeLessThanOrEqual(256) // isolates the pair-count cap from the length cap
    expect(new OrkyOscParser().push(wrapOrkyBody(body))).toEqual([])
  })

  it('TEST-008 REQ-004 v other than the literal "1" (or missing) is rejected', () => {
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, v: '2' }))).toEqual([])
    expect(new OrkyOscParser().push(buildOrkyMarkerFromPairs({ ...base, v: undefined }))).toEqual([])
  })

  it('TEST-009 REQ-004 a marker missing any required key is rejected whole', () => {
    expect(new OrkyOscParser().push(buildOrkyMarkerFromPairs({ ...base, g: undefined }))).toEqual([])
    expect(new OrkyOscParser().push(buildOrkyMarkerFromPairs({ ...base, k: undefined }))).toEqual([])
    expect(new OrkyOscParser().push(buildOrkyMarkerFromPairs({ ...base, ph: undefined }))).toEqual([])
  })

  it('TEST-010 REQ-004 f outside ^[A-Za-z0-9._-]{1,64}$ is rejected (illegal character)', () => {
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, f: 'a/b' }))).toEqual([])
  })

  it('TEST-011 REQ-004 k outside the 4-member enum is rejected', () => {
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, k: 'running' }))).toEqual([])
  })

  it('TEST-012 REQ-004 ph outside OrkyPhase ∪ {done} is rejected', () => {
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, ph: 'intake' }))).toEqual([])
  })

  it('TEST-013 REQ-004 g/m/o numeric range and non-integer violations are rejected whole', () => {
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, g: '9', m: '8' }))).toEqual([]) // g>m
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, m: '0' }))).toEqual([])          // m<1
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, m: '33' }))).toEqual([])         // m>32
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, o: '-1' }))).toEqual([])         // o<0
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, o: '10000' }))).toEqual([])      // o>9999
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, g: 'abc' }))).toEqual([])        // non-integer
  })

  it('TEST-014 REQ-004 h/x outside {0,1} is rejected', () => {
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, h: '2' }))).toEqual([])
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, x: '7' }))).toEqual([])
  })

  it('TEST-015 REQ-004 r outside the 3-member enum, when present, is rejected', () => {
    expect(new OrkyOscParser().push(buildOrkyMarker({ ...base, r: 'please' }))).toEqual([])
  })

  it('TEST-016 REQ-004 a valid marker carrying an extra unknown pair still decodes (unknown key ignored), never silently capped', () => {
    const withUnknown = buildOrkyMarkerFromPairs({ ...base, z: '1' })
    expect(new OrkyOscParser().push(withUnknown)).toEqual([WORKED_EXAMPLE_HEARTBEAT]) // identical to the base decode
  })
})

describe('OrkyOscParser — total, never-throwing tolerance of malformed/partial/garbage input (REQ-005)', () => {
  it('TEST-017 REQ-005 garbage input with no markers yields [] and never throws', () => {
    const p = new OrkyOscParser()
    expect(() => p.push('garbage no markers here')).not.toThrow()
    expect(p.push('garbage no markers here')).toEqual([])
  })

  it('TEST-018 REQ-005 an empty-body marker yields []', () => {
    expect(new OrkyOscParser().push(wrapOrkyBody(''))).toEqual([])
  })

  it('TEST-019 REQ-005 a rejected marker does not corrupt the carry-over buffer: a later push with a valid marker still parses', () => {
    const p = new OrkyOscParser()
    expect(p.push(buildOrkyMarker({ ...WORKED_EXAMPLE_FIELDS, v: '2' }))).toEqual([]) // rejected
    expect(p.push(WORKED_EXAMPLE_MARKER)).toEqual([WORKED_EXAMPLE_HEARTBEAT])          // valid, same chunk-stream
  })

  it('TEST-020 REQ-005 a rejected marker immediately followed by a valid marker in the SAME chunk still yields the valid heartbeat', () => {
    const bad = buildOrkyMarker({ ...WORKED_EXAMPLE_FIELDS, v: '2' })
    const p = new OrkyOscParser()
    expect(p.push(bad + WORKED_EXAMPLE_MARKER)).toEqual([WORKED_EXAMPLE_HEARTBEAT])
  })

  it('TEST-021 REQ-005 1 MiB of the bare prefix with no terminator does not throw and emits nothing', () => {
    const p = new OrkyOscParser()
    const huge = '\x1b]8888;orky=' + 'a'.repeat(1024 * 1024)
    expect(() => p.push(huge)).not.toThrow()
    expect(p.push(huge)).toEqual([])
  })
})
