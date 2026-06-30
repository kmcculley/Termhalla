// Phase-4 unit suite — feature 0014-orky-osc-heartbeat (REQ-001/003/004/005/006/007/008/011). FROZEN
// once the tests gate passes (ADR-009): the implementer makes these pass without editing them.
//
// REWRITTEN against the REAL, shipped wire contract — Orky ADR-026 (introducer `\x1b]`, code `9999`,
// single `;` separator splitting on the FIRST `;` only, single-line compact JSON payload, BEL terminator,
// MAY also accept ST) — superseding the prior iteration's placeholder (OSC `8888`, key=value body, see
// ESC-001 in `state.json`). Every marker byte string is built from
// `tests/fixtures/orky-osc-fixtures.ts` (REQ-014: synthetic/golden bytes only — no live Orky process,
// network, or `.orky/` tree anywhere in this file).
//
// `MAX_PENDING_BYTES`/`MAX_PAYLOAD_BYTES` are named exports REQUIRED of `orky-osc-parser.ts` by this
// frozen suite (an addition to 02-spec.md's literal "Public interface" section, made by the test
// designer): REQ-006/REQ-007 are binding hardening REQs carried forward from FINDING-SEC-001/
// FINDING-CODEX-001 whose acceptance criteria explicitly demand the bounded ceiling / byte cap be
// "asserted directly" — that is only possible if the implementer documents the constants as exported
// values the test can read and build boundary fixtures against, rather than this suite hard-coding a
// guessed numeric cap that could silently drift from whatever the implementer documents at the constant.
// The internal carry-over buffer itself is read via the `buf` field REQ-002's acceptance already mandates
// (a private-in-TypeScript-only field, "single internal buffer", "private buf = ''" — readable at runtime
// like any other property; see `tests/main/orky-osc-structural.test.ts` TEST-006).
//
// Runs RED: `src/main/status/orky-osc-parser.ts` still implements the superseded 8888/key=value contract
// (no `ORKY_OSC = '\x1b]9999;'`, no JSON decode, no `MAX_PENDING_BYTES`/`MAX_PAYLOAD_BYTES` exports).
import { describe, it, expect } from 'vitest'
import { OrkyOscParser, ORKY_OSC, MAX_PENDING_BYTES, MAX_PAYLOAD_BYTES } from '../../src/main/status/orky-osc-parser'
import {
  BEL, wrapOrkyPayload, buildOrkyMarker,
  AWAITING_HUMAN_PAYLOAD, AWAITING_HUMAN_MARKER, AWAITING_HUMAN_MARKER_LITERAL, AWAITING_HUMAN_HEARTBEAT,
  APP_LOOP_MARKER, APP_LOOP_MARKER_LITERAL, APP_LOOP_HEARTBEAT,
  MALFORMED_JSON_MARKER, NON_OBJECT_JSON_MARKERS, EMPTY_PAYLOAD_MARKER
} from '../fixtures/orky-osc-fixtures'

const ESC = '\x1b'

function bufBytes(p: OrkyOscParser): number {
  return Buffer.byteLength((p as unknown as { buf: string }).buf, 'utf8')
}

describe('OrkyOscParser — ADR-026 contract worked example + cross-prefix rejection (REQ-001)', () => {
  it('TEST-001 REQ-001 parses the worked-example awaiting-human BEL-terminated marker into the exact heartbeat', () => {
    // Catches drift between the hand-copied literal and the builder (both reproduced from 02-spec.md / ADR-026).
    expect(AWAITING_HUMAN_MARKER).toBe(AWAITING_HUMAN_MARKER_LITERAL)

    const p = new OrkyOscParser()
    expect(p.push(AWAITING_HUMAN_MARKER)).toEqual([AWAITING_HUMAN_HEARTBEAT])
  })

  it('TEST-002 REQ-001 the ST-terminated variant yields the identical result', () => {
    const stMarker = buildOrkyMarker(AWAITING_HUMAN_PAYLOAD, 'ST')
    expect(stMarker).toBe(
      `${ORKY_OSC}${JSON.stringify(AWAITING_HUMAN_PAYLOAD)}${ESC}\\`
    )
    const p = new OrkyOscParser()
    expect(p.push(stMarker)).toEqual([AWAITING_HUMAN_HEARTBEAT])
  })

  it('TEST-003 REQ-001 a reason value containing a literal ";" parses whole — the inner ";" is NOT a split point', () => {
    const payload = { ...AWAITING_HUMAN_PAYLOAD, reason: 'blocked by 1 open escalation(s): ESC-001; resolve first' }
    const p = new OrkyOscParser()
    expect(p.push(buildOrkyMarker(payload))).toEqual([{
      ...AWAITING_HUMAN_HEARTBEAT, reason: 'blocked by 1 open escalation(s): ESC-001; resolve first'
    }])
  })

  it('TEST-004 REQ-001 OSC 133 / OSC 7 / OSC 9;9 sequences yield [] (no cross-prefix match), and do not corrupt parser state', () => {
    expect(new OrkyOscParser().push(`${ESC}]133;A${BEL}`)).toEqual([])
    expect(new OrkyOscParser().push(`${ESC}]7;file://host/C:/dev${BEL}`)).toEqual([])
    expect(new OrkyOscParser().push(`${ESC}]9;9;C:\\dev${BEL}`)).toEqual([])
    // sanity: the SAME parser instance still parses a real marker afterwards (no state corruption)
    const p = new OrkyOscParser()
    p.push(`${ESC}]133;A${BEL}`)
    expect(p.push(AWAITING_HUMAN_MARKER)).toEqual([AWAITING_HUMAN_HEARTBEAT])
  })
})

describe('OrkyOscParser — chunk-boundary carry-over preserved exactly (REQ-003)', () => {
  it('TEST-007 REQ-003 splitting the worked-example marker at every byte offset 0..len yields the identical single heartbeat', () => {
    const whole = new OrkyOscParser().push(AWAITING_HUMAN_MARKER)
    expect(whole).toEqual([AWAITING_HUMAN_HEARTBEAT])
    for (let i = 0; i <= AWAITING_HUMAN_MARKER.length; i++) {
      const p = new OrkyOscParser()
      const first = p.push(AWAITING_HUMAN_MARKER.slice(0, i))
      const second = p.push(AWAITING_HUMAN_MARKER.slice(i))
      expect([...first, ...second]).toEqual(whole)
    }
  })

  it('TEST-008 REQ-003 a partial (un-terminated) marker buffers, never emits early, and emits exactly once when the rest arrives later', () => {
    const p = new OrkyOscParser()
    const splitAt = AWAITING_HUMAN_MARKER.indexOf('"feature"')
    expect(p.push(AWAITING_HUMAN_MARKER.slice(0, splitAt))).toEqual([])
    expect(p.push(AWAITING_HUMAN_MARKER.slice(splitAt))).toEqual([AWAITING_HUMAN_HEARTBEAT])
    // no double-emit: a further empty push yields nothing more
    expect(p.push('')).toEqual([])
  })
})

describe('OrkyOscParser — thin client: verbatim mapping, never "correcting" Orky\'s verdict (REQ-004)', () => {
  it('TEST-010 REQ-004 needsHuman/reason/phase/gate decode verbatim even when implausible under 0004\'s own gate logic', () => {
    // Early phase, low gate count — 0004's own gateFrontier/needsHuman logic would never call this
    // needs-human, but Orky's drive() is the sole authority (thin client): the parser must not "fix" it.
    const payload = { v: 1, feature: 'auth-login', phase: 'spec', gate: '1/8', needsHuman: true, reason: 'odd but verbatim' }
    const p = new OrkyOscParser()
    expect(p.push(buildOrkyMarker(payload))).toEqual([{
      feature: 'auth-login', phase: 'spec', gateN: 1, gateM: 8, needsHuman: true, reason: 'odd but verbatim', action: null
    }])
  })
})

describe('OrkyOscParser — forward-compatible, NOT fail-closed, on version + unknown fields (REQ-005)', () => {
  it('TEST-011 REQ-005 v:2 with otherwise-known fields still decodes (not rejected for a newer schema version)', () => {
    const payload = { ...AWAITING_HUMAN_PAYLOAD, v: 2 }
    const p = new OrkyOscParser()
    expect(p.push(buildOrkyMarker(payload))).toEqual([AWAITING_HUMAN_HEARTBEAT])
  })

  it('TEST-012 REQ-005 a missing v entirely still decodes', () => {
    const { v: _v, ...payload } = AWAITING_HUMAN_PAYLOAD as Record<string, unknown>
    const p = new OrkyOscParser()
    expect(p.push(buildOrkyMarker(payload))).toEqual([AWAITING_HUMAN_HEARTBEAT])
  })

  it('TEST-013 REQ-005 a valid payload carrying an unknown extra field decodes and ignores it', () => {
    const payload = { ...AWAITING_HUMAN_PAYLOAD, futureFlag: true }
    const p = new OrkyOscParser()
    expect(p.push(buildOrkyMarker(payload))).toEqual([AWAITING_HUMAN_HEARTBEAT])
  })
})

describe('OrkyOscParser — bounded carry-over ceiling on a no-terminator stream (REQ-006, FINDING-SEC-001)', () => {
  it('TEST-014 REQ-006 many MiB of non-terminating data after the bare prefix does not throw, emits nothing, and keeps the retained buffer bounded (asserted directly)', () => {
    const p = new OrkyOscParser()
    expect(p.push(ORKY_OSC)).toEqual([])
    const chunk = 'a'.repeat(64 * 1024) // 64 KiB per push
    const totalPushed = 96 * chunk.length // 6 MiB total
    expect(() => {
      for (let i = 0; i < 96; i++) {
        expect(p.push(chunk)).toEqual([])
      }
    }).not.toThrow()
    const retained = bufBytes(p)
    expect(retained).toBeLessThanOrEqual(MAX_PENDING_BYTES)
    // proves the ceiling actually bounded growth, not merely a generous constant that happens not to
    // have been hit yet by this test's input size
    expect(retained).toBeLessThan(totalPushed)
  })

  it('TEST-015 REQ-006 MAX_PENDING_BYTES never drops an in-flight legal marker: it exceeds the longest possible marker, and a legitimate marker fed in tiny chunks still parses', () => {
    // ORKY_OSC + the largest legal payload (MAX_PAYLOAD_BYTES) + the longest terminator (ST, 2 bytes)
    expect(MAX_PENDING_BYTES).toBeGreaterThan(ORKY_OSC.length + MAX_PAYLOAD_BYTES + 2)

    const p = new OrkyOscParser()
    const heartbeats: unknown[] = []
    for (let i = 0; i < AWAITING_HUMAN_MARKER.length; i += 3) {
      heartbeats.push(...p.push(AWAITING_HUMAN_MARKER.slice(i, i + 3)))
    }
    expect(heartbeats).toEqual([AWAITING_HUMAN_HEARTBEAT])
  })
})

describe('OrkyOscParser — payload size cap measured as actual UTF-8 byte length, before JSON.parse (REQ-007, FINDING-CODEX-001)', () => {
  it('TEST-016 REQ-007 a payload whose UTF-16 .length is under the cap but whose UTF-8 byte length is over it is rejected', () => {
    const skeleton = { v: 1, feature: 'auth-login', phase: 'implement', gate: '5/8', needsHuman: true, reason: '' }
    const overheadLen = JSON.stringify(skeleton).length
    const remaining = MAX_PAYLOAD_BYTES - overheadLen
    expect(remaining).toBeGreaterThan(0) // sanity: the cap is generous enough to even hold this skeleton

    // U+1F600 (😀): 2 UTF-16 code units (.length), 4 UTF-8 bytes — pick N so 2N keeps .length under the
    // cap while 4N pushes the real byte length over it.
    const n = Math.ceil((remaining + 1) / 4)
    const reason = '\u{1F600}'.repeat(n)
    const payload = { ...skeleton, reason }
    const json = JSON.stringify(payload)

    expect(json.length).toBeLessThan(MAX_PAYLOAD_BYTES) // a naive UTF-16 .length check would wrongly accept this
    expect(Buffer.byteLength(json, 'utf8')).toBeGreaterThan(MAX_PAYLOAD_BYTES) // the REAL byte length is over cap

    expect(new OrkyOscParser().push(wrapOrkyPayload(json))).toEqual([])
  })

  it('TEST-017 REQ-007 a payload at exactly the byte cap is accepted; one byte over is rejected (ASCII boundary)', () => {
    const skeleton = { v: 1, feature: 'a', phase: 'plan', gate: '1/8', needsHuman: false, reason: '' }
    const overheadBytes = Buffer.byteLength(JSON.stringify(skeleton), 'utf8')
    const padAtCap = MAX_PAYLOAD_BYTES - overheadBytes
    expect(padAtCap).toBeGreaterThan(0)

    const atCapJson = JSON.stringify({ ...skeleton, reason: 'x'.repeat(padAtCap) })
    expect(Buffer.byteLength(atCapJson, 'utf8')).toBe(MAX_PAYLOAD_BYTES)
    expect(new OrkyOscParser().push(wrapOrkyPayload(atCapJson))).not.toEqual([])

    const overCapJson = JSON.stringify({ ...skeleton, reason: 'x'.repeat(padAtCap + 1) })
    expect(Buffer.byteLength(overCapJson, 'utf8')).toBe(MAX_PAYLOAD_BYTES + 1)
    expect(new OrkyOscParser().push(wrapOrkyPayload(overCapJson))).toEqual([])
  })
})

describe('OrkyOscParser — strict-but-tolerant JSON validation; push is total, never wedges (REQ-008)', () => {
  it('TEST-018 REQ-008 garbage input with no markers yields [] and never throws', () => {
    const p = new OrkyOscParser()
    expect(() => p.push('garbage no markers here')).not.toThrow()
    expect(p.push('garbage no markers here')).toEqual([])
  })

  it('TEST-019 REQ-008 a marker whose payload is not valid JSON yields [] and never throws', () => {
    expect(() => new OrkyOscParser().push(MALFORMED_JSON_MARKER)).not.toThrow()
    expect(new OrkyOscParser().push(MALFORMED_JSON_MARKER)).toEqual([])
  })

  it('TEST-020 REQ-008 valid-JSON-but-non-object payloads (array/string/number/boolean/null) all yield []', () => {
    for (const marker of Object.values(NON_OBJECT_JSON_MARKERS)) {
      expect(new OrkyOscParser().push(marker)).toEqual([])
    }
  })

  it('TEST-021 REQ-008 an empty payload yields []', () => {
    expect(new OrkyOscParser().push(EMPTY_PAYLOAD_MARKER)).toEqual([])
  })

  it('TEST-022 REQ-008 a rejected marker does not corrupt the carry-over buffer: a valid marker afterwards still parses, same chunk or a later one', () => {
    const p1 = new OrkyOscParser()
    expect(p1.push(MALFORMED_JSON_MARKER)).toEqual([]) // rejected
    expect(p1.push(AWAITING_HUMAN_MARKER)).toEqual([AWAITING_HUMAN_HEARTBEAT]) // valid, later push

    const p2 = new OrkyOscParser()
    expect(p2.push(MALFORMED_JSON_MARKER + AWAITING_HUMAN_MARKER)).toEqual([AWAITING_HUMAN_HEARTBEAT]) // valid, same chunk
  })
})

describe('OrkyOscParser — a feature-less (app-loop) heartbeat decodes as a valid liveness tick (REQ-011)', () => {
  it('TEST-029 REQ-011 push(APP_LOOP_MARKER) returns exactly one heartbeat whose feature is null — parses, not a failure', () => {
    expect(APP_LOOP_MARKER).toBe(APP_LOOP_MARKER_LITERAL)
    const p = new OrkyOscParser()
    expect(p.push(APP_LOOP_MARKER)).toEqual([APP_LOOP_HEARTBEAT])
  })
})
