// FROZEN test suite — feature 0016-remote-protocol-core-handshake (phase 4).
// Framing layer: length-prefixed UTF-8 JSON frames over an arbitrary byte stream.
// Covers REQ-003 (encoding), REQ-004 (max frame size, CONV-003), REQ-005 (chunking
// invariance — determinism), REQ-006 (fatal vs per-frame error taxonomy), REQ-016
// (round-trip totality), and parts of REQ-015 (actionable structured errors).
import { describe, it, expect } from 'vitest'
import {
  encodeFrame,
  createFrameDecoder,
  FRAME_HEADER_BYTES,
  DEFAULT_MAX_FRAME_BYTES,
  WIRE_PROTO,
  AGENT_V1_CAPABILITIES,
  ProtocolError,
  type WireFrame,
  type DecodedItem
} from '@shared/remote/protocol'

const be32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, false)
  return b
}
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.byteLength }
  return out
}
const rawFrame = (payload: Uint8Array): Uint8Array => concat(be32(payload.byteLength), payload)
const headerLen = (enc: Uint8Array): number =>
  new DataView(enc.buffer, enc.byteOffset, enc.byteLength).getUint32(0, false)
const caught = (fn: () => unknown): ProtocolError => {
  try { fn() } catch (e) { return e as ProtocolError }
  throw new Error('expected the call to throw, but it returned')
}

describe('TEST-725 REQ-003 frame encoding: 4-byte big-endian length prefix + UTF-8 JSON', () => {
  it('encodes an ack frame as BE u32 payload byte length + JSON payload (header excluded from the count)', () => {
    const frame: WireFrame = { type: 'ack', id: 'p1', bytes: 1 }
    const enc = encodeFrame(frame)
    expect(FRAME_HEADER_BYTES).toBe(4)
    expect(enc).toBeInstanceOf(Uint8Array)
    expect(headerLen(enc)).toBe(enc.byteLength - 4)
    const payload = new TextDecoder().decode(enc.subarray(4))
    expect(JSON.parse(payload)).toEqual(frame)
  })
  it('validates its input: encoding a malformed frame throws a structured bad-message error, never emits bytes', () => {
    const err = caught(() => encodeFrame({ type: 'nope' } as never))
    expect(err).toBeInstanceOf(ProtocolError)
    expect(err.reason).toBe('bad-message')
    expect(err.message).toContain('nope')
  })
})

describe('TEST-726 REQ-003 the length prefix counts UTF-8 BYTES, not string length', () => {
  it('a multi-byte payload has a byte length strictly greater than its character count', () => {
    const frame: WireFrame = { type: 'evt', channel: 'pty:data', args: ['π€'] }
    const enc = encodeFrame(frame)
    const payloadText = new TextDecoder().decode(enc.subarray(4))
    expect(headerLen(enc)).toBe(enc.byteLength - 4)
    // 'π' is 2 UTF-8 bytes, '€' is 3 — byte length must exceed UTF-16 code-unit length.
    expect(headerLen(enc)).toBeGreaterThan(payloadText.length)
    expect(JSON.parse(payloadText)).toEqual(frame)
  })
})

describe('TEST-727 REQ-004 encode-side maximum frame size (CONV-003: enforced, never silent)', () => {
  it('DEFAULT_MAX_FRAME_BYTES is exactly 8 MiB', () => {
    expect(DEFAULT_MAX_FRAME_BYTES).toBe(8 * 1024 * 1024)
  })
  it('a payload over the default limit throws frame-too-large naming BOTH the actual size and the limit', () => {
    const big = 'x'.repeat(DEFAULT_MAX_FRAME_BYTES + 16)
    const frame: WireFrame = { type: 'evt', channel: 'pty:data', args: [big] }
    // deterministic: the payload is the UTF-8 encoding of JSON.stringify(frame)
    const actual = new TextEncoder().encode(JSON.stringify(frame)).byteLength
    const err = caught(() => encodeFrame(frame))
    expect(err).toBeInstanceOf(ProtocolError)
    expect(err.reason).toBe('frame-too-large')
    expect(err.message).toContain(String(DEFAULT_MAX_FRAME_BYTES))
    expect(err.message).toContain(String(actual))
    expect(err.detail).toBeDefined()
    const detailText = JSON.stringify(err.detail)
    expect(detailText).toContain(String(DEFAULT_MAX_FRAME_BYTES))
    expect(detailText).toContain(String(actual))
  })
  it('the encoder accepts a per-call maxFrameBytes override', () => {
    const frame: WireFrame = { type: 'evt', channel: 'c', args: ['y'.repeat(64)] }
    expect(() => encodeFrame(frame)).not.toThrow()
    const err = caught(() => encodeFrame(frame, { maxFrameBytes: 32 }))
    expect(err.reason).toBe('frame-too-large')
    expect(err.message).toContain('32')
  })
})

describe('TEST-728 REQ-004 decode-side maximum frame size: the declared length is never trusted', () => {
  it('a length prefix over the default limit yields a fatal item carrying both numbers', () => {
    const d = createFrameDecoder()
    const items = d.push(be32(DEFAULT_MAX_FRAME_BYTES + 1))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('fatal')
    const error = (items[0] as Extract<DecodedItem, { kind: 'fatal' }>).error
    expect(error.reason).toBe('frame-too-large')
    expect(error.message).toContain(String(DEFAULT_MAX_FRAME_BYTES + 1))
    expect(error.message).toContain(String(DEFAULT_MAX_FRAME_BYTES))
  })
  it('a custom maxFrameBytes rejects a frame the default decoder accepts', () => {
    const frame: WireFrame = { type: 'evt', channel: 'c', args: ['y'.repeat(64)] }
    const bytes = encodeFrame(frame)
    const ok = createFrameDecoder().push(bytes)
    expect(ok).toEqual([{ kind: 'message', frame }])
    const strict = createFrameDecoder({ maxFrameBytes: 64 })
    const items = strict.push(bytes)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('fatal')
    expect((items[0] as Extract<DecodedItem, { kind: 'fatal' }>).error.reason).toBe('frame-too-large')
  })
})

describe('TEST-729 REQ-005 chunking invariance: the item sequence is a pure function of the byte stream', () => {
  const f1: WireFrame = { type: 'req', id: 1, method: 'pty:spawn', params: null }
  const f2: WireFrame = { type: 'evt', channel: 'pty:data', args: ['p1', 'π€🚀 multi-byte'] }
  const f3: WireFrame = { type: 'window', size: 1024 }
  const frames = [f1, f2, f3]
  const stream = concat(...frames.map((f) => encodeFrame(f)))
  const expected: DecodedItem[] = frames.map((frame) => ({ kind: 'message', frame }))

  const runPartition = (chunks: Uint8Array[]): DecodedItem[] => {
    const d = createFrameDecoder()
    const items: DecodedItem[] = []
    for (const c of chunks) items.push(...d.push(c))
    return items
  }
  const sliceEvery = (n: number): Uint8Array[] => {
    const out: Uint8Array[] = []
    for (let i = 0; i < stream.byteLength; i += n) out.push(stream.subarray(i, Math.min(i + n, stream.byteLength)))
    return out
  }

  it('all-at-once, byte-at-a-time, mid-prefix split, and mid-multibyte splits agree exactly', () => {
    const wholeRun = runPartition([stream])
    const byteRun = runPartition(sliceEvery(1))
    const midPrefixRun = runPartition([stream.subarray(0, 2), stream.subarray(2)])
    const threesRun = runPartition(sliceEvery(3)) // inevitably splits inside multi-byte UTF-8 sequences
    expect(wholeRun).toEqual(expected)
    expect(byteRun).toEqual(expected)
    expect(midPrefixRun).toEqual(expected)
    expect(threesRun).toEqual(expected)
  })
  it('an empty chunk yields no items and no error', () => {
    const d = createFrameDecoder()
    expect(d.push(new Uint8Array(0))).toEqual([])
    expect(d.push(stream)).toEqual(expected)
  })
})

describe('TEST-730 REQ-006 per-frame message errors do not kill the stream, and arrive in order', () => {
  const valid1: WireFrame = { type: 'ack', id: 'p1', bytes: 5 }
  const valid2: WireFrame = { type: 'window', size: 2048, id: 'p1' }
  const enc = new TextEncoder()

  it('bad JSON, invalid UTF-8, an empty payload, and a bad message each error individually; valid neighbours survive', () => {
    const badJson = rawFrame(enc.encode('{"type":'))
    const badUtf8 = rawFrame(new Uint8Array([0xff, 0xfe, 0x00]))
    const emptyPayload = rawFrame(new Uint8Array(0))
    const badMessage = rawFrame(enc.encode('{"type":"nope"}'))
    const d = createFrameDecoder()
    const items = d.push(concat(encodeFrame(valid1), badJson, encodeFrame(valid2), badUtf8, emptyPayload, badMessage))
    expect(items.map((i) => i.kind)).toEqual([
      'message', 'message-error', 'message', 'message-error', 'message-error', 'message-error'
    ])
    expect((items[0] as Extract<DecodedItem, { kind: 'message' }>).frame).toEqual(valid1)
    expect((items[2] as Extract<DecodedItem, { kind: 'message' }>).frame).toEqual(valid2)
    const reasons = items.filter((i) => i.kind === 'message-error')
      .map((i) => (i as Extract<DecodedItem, { kind: 'message-error' }>).error.reason)
    expect(reasons).toEqual(['bad-json', 'bad-json', 'bad-json', 'bad-message'])
    // actionable: the bad-json error names the payload byte length it failed on (REQ-015)
    const firstError = (items[1] as Extract<DecodedItem, { kind: 'message-error' }>).error
    expect(JSON.stringify(firstError.detail)).toContain('8') // '{"type":' is 8 bytes
    // after all that, the decoder still decodes the next valid frame
    expect(d.push(encodeFrame(valid1))).toEqual([{ kind: 'message', frame: valid1 }])
  })
})

describe('TEST-731 REQ-006 a fatal framing error is unrecoverable: decoder-dead afterwards', () => {
  it('push after a fatal item throws a structured decoder-dead error', () => {
    const d = createFrameDecoder()
    const items = d.push(be32(DEFAULT_MAX_FRAME_BYTES + 1))
    expect(items[0].kind).toBe('fatal')
    const err = caught(() => d.push(encodeFrame({ type: 'ack', id: 'p1', bytes: 1 })))
    expect(err).toBeInstanceOf(ProtocolError)
    expect(err.reason).toBe('decoder-dead')
  })
})

describe('TEST-732 REQ-016 round-trip totality over the whole v1 vocabulary', () => {
  const fixtures: WireFrame[] = [
    { type: 'hello', proto: WIRE_PROTO, role: 'agent', version: '0.11.0', capabilities: [...AGENT_V1_CAPABILITIES] },
    { type: 'hello', proto: WIRE_PROTO, role: 'client', version: '0.11.0' },
    { type: 'req', id: 1, method: 'pty:spawn', params: null },
    { type: 'req', id: 2, method: 'pty:write', params: { id: 'p1', data: 'echo π€🚀\r' } },
    { type: 'res', id: 1, ok: true, result: { adopted: false, note: 'ünïcode ✓' } },
    { type: 'res', id: 2, ok: false, error: { message: 'spawn failed: shell not found', code: 'ENOENT' } },
    { type: 'evt', channel: 'pty:exit', args: [] },
    { type: 'evt', channel: 'pty:data', args: ['p1', '\u001b[31mπ€🚀\u0007\r\n'] },
    { type: 'ack', id: 'p1', bytes: 65536 },
    { type: 'window', size: 262144 },
    { type: 'window', size: 131072, id: 'p1' }
  ]

  it('decode(encode(f)) yields exactly [message f] for every fixture', () => {
    for (const frame of fixtures) {
      const items = createFrameDecoder().push(encodeFrame(frame))
      expect(items).toEqual([{ kind: 'message', frame }])
    }
  })
  it('the concatenated stream of all fixtures decodes to the same list in order', () => {
    const items = createFrameDecoder().push(concat(...fixtures.map((f) => encodeFrame(f))))
    expect(items).toEqual(fixtures.map((frame) => ({ kind: 'message', frame })))
  })
})
