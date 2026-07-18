// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// REQ-010 (vocabulary + version), REQ-014 (closed client->server set), REQ-018 (parse-time
// hardening), REQ-013 (no resize in the protocol). Contract set here for the implementer —
// src/shared/phone-remote/protocol.ts exports:
//   PHONE_REMOTE_PROTO_VERSION: number             // integer >= 1, carried by `hello`
//   SERVER_MESSAGE_TYPES: readonly string[]        // >= the REQ-010 server vocabulary
//   CLIENT_MESSAGE_TYPES: readonly string[]        // EXACTLY {subscribe, unsubscribe, input}
//                                                  // (+ optionally a pure keepalive 'ping')
//   PHONE_WS_MAX_FRAME: number                     // 1 MiB inbound frame bound (co-located
//                                                  // export; re-export from constants.ts is fine)
//   parseClientMessage(raw: unknown):
//     | { ok: true;  msg: { type: string; paneId?: string; data?: string } }
//     | { ok: false; error: { code: string; message: string } }
// parseClientMessage is TOTAL over untrusted frames (string | Buffer | anything): malformed
// JSON, wrong shapes, unknown types, non-string `data`, oversized and binary frames each yield
// a typed { ok: false } with a specific code/message — never a throw.
import { describe, it, expect } from 'vitest'
import {
  PHONE_REMOTE_PROTO_VERSION,
  SERVER_MESSAGE_TYPES,
  CLIENT_MESSAGE_TYPES,
  PHONE_WS_MAX_FRAME,
  parseClientMessage
} from '../../src/shared/phone-remote/protocol'

describe('TEST-2610 REQ-010 versioned vocabulary', () => {
  it('exports an integer protocol version >= 1 for the hello message', () => {
    expect(Number.isInteger(PHONE_REMOTE_PROTO_VERSION)).toBe(true)
    expect(PHONE_REMOTE_PROTO_VERSION).toBeGreaterThanOrEqual(1)
  })

  it('the server->client vocabulary carries at least the REQ-010 set', () => {
    for (const t of ['hello', 'panes', 'status', 'grid', 'snapshot', 'data', 'resync', 'paneExit', 'error']) {
      expect(SERVER_MESSAGE_TYPES, `server vocabulary must include '${t}'`).toContain(t)
    }
  })
})

describe('TEST-2611 REQ-010 inbound parse: happy path', () => {
  it('parses the three client messages with their fields', () => {
    const sub = parseClientMessage(JSON.stringify({ type: 'subscribe', paneId: 'p1' }))
    expect(sub).toEqual({ ok: true, msg: { type: 'subscribe', paneId: 'p1' } })
    const unsub = parseClientMessage(JSON.stringify({ type: 'unsubscribe', paneId: 'p1' }))
    expect(unsub.ok).toBe(true)
    const input = parseClientMessage(JSON.stringify({ type: 'input', paneId: 'p1', data: 'ls\r' }))
    expect(input.ok).toBe(true)
    if (input.ok) expect(input.msg).toMatchObject({ type: 'input', paneId: 'p1', data: 'ls\r' })
  })
})

describe('TEST-2612 REQ-018 inbound parse: total over untrusted frames', () => {
  const malformed: Array<[string, unknown]> = [
    ['not JSON', 'this is not json'],
    ['a JSON scalar', '42'],
    ['JSON null', 'null'],
    ['an array', '[1,2,3]'],
    ['missing type', JSON.stringify({ paneId: 'p1' })],
    ['non-string type', JSON.stringify({ type: 7 })],
    ['unknown type', JSON.stringify({ type: 'frobnicate', paneId: 'p1' })],
    ['subscribe without paneId', JSON.stringify({ type: 'subscribe' })],
    ['input with non-string data', JSON.stringify({ type: 'input', paneId: 'p1', data: 123 })],
    ['input with non-string paneId', JSON.stringify({ type: 'input', paneId: {}, data: 'x' })],
    ['a binary frame', Buffer.from([0x00, 0x01, 0xfe, 0xff])],
    ['undefined', undefined],
    ['an object (not a frame)', { type: 'subscribe', paneId: 'p1' } as unknown]
  ]

  it('every malformed frame yields ok:false with a specific error and never throws', () => {
    for (const [name, raw] of malformed) {
      let res: ReturnType<typeof parseClientMessage> | undefined
      expect(() => { res = parseClientMessage(raw) }, `${name} must not throw`).not.toThrow()
      expect(res && !res.ok, `${name} must be rejected`).toBe(true)
      if (res && !res.ok) {
        expect(res.error.code.length, `${name}: code must be non-empty`).toBeGreaterThan(0)
        expect(res.error.message.length, `${name}: message must be non-empty (CONV-001)`).toBeGreaterThan(0)
      }
    }
  })

  it('errors are specific, not one generic bucket (CONV-001)', () => {
    const notJson = parseClientMessage('not json')
    const unknown = parseClientMessage(JSON.stringify({ type: 'frobnicate' }))
    expect(notJson.ok || unknown.ok).toBe(false)
    if (!notJson.ok && !unknown.ok) {
      expect(unknown.error.code).not.toBe(notJson.error.code)
      // the unknown-type error names the offending type
      expect(unknown.error.message).toContain('frobnicate')
    }
  })

  it('enforces the exported 1 MiB frame bound (CONV-003)', () => {
    expect(PHONE_WS_MAX_FRAME).toBe(1_048_576)
    const pad = (n: number): string =>
      JSON.stringify({ type: 'input', paneId: 'p1', data: 'x'.repeat(n) })
    // a frame comfortably inside the bound parses
    expect(parseClientMessage(pad(1024)).ok).toBe(true)
    // a frame over the bound is rejected without a throw
    const overRaw = 'x'.repeat(PHONE_WS_MAX_FRAME + 1)
    let over: ReturnType<typeof parseClientMessage> | undefined
    expect(() => { over = parseClientMessage(overRaw) }).not.toThrow()
    expect(over && !over.ok).toBe(true)
  })
})

describe('TEST-2613 REQ-014/REQ-013 the client->server set is closed; no resize, no lifecycle', () => {
  it('accepted client message types are exactly {subscribe, unsubscribe, input} (+ pure keepalive)', () => {
    const set = new Set(CLIENT_MESSAGE_TYPES)
    for (const required of ['subscribe', 'unsubscribe', 'input']) expect(set.has(required)).toBe(true)
    for (const t of set) {
      expect(['subscribe', 'unsubscribe', 'input', 'ping'],
        `client type '${t}' is outside the sanctioned closed set`).toContain(t)
    }
  })

  it('the vocabulary contains no resize and no pane-lifecycle capability', () => {
    const banned = ['resize', 'kill', 'spawn', 'close', 'split', 'move', 'rearrange', 'open', 'delete']
    for (const t of CLIENT_MESSAGE_TYPES) expect(banned).not.toContain(t)
    // and parse rejects a smuggled resize/kill as an unknown type
    for (const type of ['resize', 'kill', 'spawn']) {
      const res = parseClientMessage(JSON.stringify({ type, paneId: 'p1', cols: 1, rows: 1 }))
      expect(res.ok, `'${type}' must not parse as a valid client message`).toBe(false)
    }
  })
})
