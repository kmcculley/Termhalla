// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// The per-client WS session: REQ-009 (snapshot-then-stream, exactly-once), REQ-010 (one
// multiplexed socket, pane-scoped routing, hello version), REQ-011 (status pushes), REQ-012
// (input injection + specific errors), REQ-013 (no resize reachable from any client message),
// REQ-014 (no lifecycle capability), REQ-016 (concurrent clients, no lease), REQ-017 (session
// half of drop-and-resnapshot), REQ-018 (untrusted frames never throw), REQ-024 (reconnect is
// a fresh attach), REQ-026 (paneExit pushed).
//
// Contract set here for the implementer — src/main/phone-remote/ws-session.ts exports:
//   createWsSession(deps: WsSessionDeps): WsSession
//   WsSessionDeps = {
//     send(msg: Record<string, unknown>): void       // outbound message object (pre-serialize)
//     bufferedAmount?: () => number                  // socket buffer probe (default 0)
//     mirrors: { snapshot(paneId: string): Promise<string> | undefined }
//     panes: {
//       inventory(): unknown                         // payload of the `panes` message
//       isLive(paneId: string): boolean
//       write(paneId: string, data: string): void
//     }
//   }
//   WsSession = {
//     start(): void                                  // sends hello (FIRST) then panes
//     handleFrame(raw: unknown): void                // one inbound WS frame (untrusted)
//     paneData(paneId: string, chunk: string): void  // live fan-in from the service
//     paneStatus(paneId: string, status: string): void
//     paneGrid(paneId: string, cols: number, rows: number): void
//     paneExit(paneId: string): void
//     socketDrained(): void                          // the transport's drain event (CONV-036)
//     close(): void
//   }
// NOTE the deps shape deliberately exposes NO resize capability: the session cannot resize
// what it cannot reach (REQ-013).
import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import { createPaneReplay, type PaneReplay } from '../../src/agent/replay'
import { PHONE_REMOTE_PROTO_VERSION } from '../../src/shared/phone-remote/protocol'
import { PHONE_WS_HIGH_WATER, PHONE_WS_LOW_WATER } from '../../src/main/phone-remote/constants'
import { createWsSession } from '../../src/main/phone-remote/ws-session'

type Msg = Record<string, unknown> & { type: string }

const until = async (pred: () => boolean, ms = 8000): Promise<void> => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const frame = (obj: unknown): string => JSON.stringify(obj)

interface Harness {
  sent: Msg[]
  writes: Array<[string, string]>
  session: ReturnType<typeof createWsSession>
  mirror: PaneReplay
  /** the service-shaped fan-in: mirror first, then the session (one code path for all feeds) */
  feed: (chunk: string) => void
}

const mkHarness = (opts?: { live?: string[]; bufferedAmount?: () => number }): Harness => {
  const sent: Msg[] = []
  const writes: Array<[string, string]> = []
  const live = new Set(opts?.live ?? ['A', 'B'])
  const mirror = createPaneReplay({ cols: 40, rows: 6, scrollback: 2000 })
  const session = createWsSession({
    send: (m) => sent.push(m as Msg),
    bufferedAmount: opts?.bufferedAmount,
    mirrors: { snapshot: (paneId) => (paneId === 'A' ? mirror.snapshot() : undefined) },
    panes: {
      inventory: () => ({ workspaces: [{ id: 'ws1', name: 'W', panes: [{ paneId: 'A' }, { paneId: 'B' }] }] }),
      isLive: (id) => live.has(id),
      write: (id, data) => writes.push([id, data])
    }
  })
  return {
    sent, writes, session, mirror,
    feed: (chunk) => { mirror.feed(chunk); session.paneData('A', chunk) }
  }
}

/** Client-side reconstruction oracle: snapshot/resync REPLACE the buffer, data appends. */
const reconstruct = async (msgs: Msg[], paneId: string): Promise<string> => {
  const term = new Terminal({ cols: 40, rows: 6, scrollback: 2000, allowProposedApi: true })
  const write = (d: string): Promise<void> => new Promise((r) => term.write(d, r))
  for (const m of msgs) {
    if (m.paneId !== paneId) continue
    if (m.type === 'snapshot' || m.type === 'resync') { term.reset(); await write(String(m.data)) }
    else if (m.type === 'data') await write(String(m.data))
  }
  const text = bufferText(term)
  term.dispose()
  return text
}

const bufferText = (term: Terminal): string => {
  const buf = term.buffer.active
  const out: string[] = []
  for (let i = 0; i < buf.length; i++) out.push(buf.getLine(i)?.translateToString(true) ?? '')
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

const referenceText = async (chunks: string[]): Promise<string> => {
  const term = new Terminal({ cols: 40, rows: 6, scrollback: 2000, allowProposedApi: true })
  for (const c of chunks) await new Promise<void>((r) => term.write(c, r))
  const text = bufferText(term)
  term.dispose()
  return text
}

describe('TEST-2625 REQ-009 attach is snapshot-then-stream, exactly-once under interleaving', () => {
  it('output before / during / after the attach lands exactly once (reference-terminal oracle)', async () => {
    const h = mkHarness()
    h.session.start()
    const all = ['L1\r\n', 'L2\r\n', 'L3\r\n', 'L4\r\n', 'L5\r\n']
    // before the subscribe
    h.feed(all[0]); h.feed(all[1])
    // the subscribe — snapshot point is HERE
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    // racing the attach: fed after the subscribe call, before the snapshot resolves
    h.feed(all[2]); h.feed(all[3])
    await until(() => h.sent.some((m) => m.type === 'snapshot' && m.paneId === 'A'))
    // after the snapshot
    h.feed(all[4])
    await until(() => h.sent.filter((m) => m.type === 'data' && m.paneId === 'A').length >= 3)

    // ordering: the snapshot precedes every data message for the pane
    const paneMsgs = h.sent.filter((m) => m.paneId === 'A' && (m.type === 'snapshot' || m.type === 'data'))
    expect(paneMsgs[0].type).toBe('snapshot')
    // exactly-once at the message level: pre-subscribe bytes appear ONLY in the snapshot,
    // post-subscribe bytes ONLY in the stream
    const streamed = paneMsgs.filter((m) => m.type === 'data').map((m) => String(m.data))
    expect(streamed).toEqual(['L3\r\n', 'L4\r\n', 'L5\r\n'])
    const snap = String(paneMsgs[0].data)
    expect(snap).toContain('L1')
    expect(snap).toContain('L2')
    expect(snap).not.toContain('L3')

    // exactly-once at the render level: the reconstruction equals the reference terminal
    expect(await reconstruct(h.sent, 'A')).toBe(await referenceText(all))
    h.mirror.dispose()
  })

  it('holds when output races the subscribe across microtask boundaries', async () => {
    const h = mkHarness()
    h.session.start()
    h.feed('pre\r\n')
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    h.feed('race-1\r\n')
    await Promise.resolve()
    h.feed('race-2\r\n')
    await until(() => h.sent.some((m) => m.type === 'snapshot' && m.paneId === 'A'))
    h.feed('post\r\n')
    await until(() => h.sent.filter((m) => m.type === 'data' && m.paneId === 'A').length >= 3)
    expect(await reconstruct(h.sent, 'A')).toBe(await referenceText(['pre\r\n', 'race-1\r\n', 'race-2\r\n', 'post\r\n']))
    h.mirror.dispose()
  })
})

describe('TEST-2626 REQ-010 one multiplexed socket: hello, inventory, pane-scoped routing', () => {
  it('start() sends hello FIRST with the exported protocol version, then the inventory', () => {
    const h = mkHarness()
    h.session.start()
    expect(h.sent[0]?.type).toBe('hello')
    expect(h.sent[0]?.proto).toBe(PHONE_REMOTE_PROTO_VERSION)
    expect(h.sent[1]?.type).toBe('panes')
    h.mirror.dispose()
  })

  it('routes pane-scoped, per-pane ordered; unsubscribed panes stop flowing', async () => {
    const h = mkHarness()
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'B' }))
    await until(() => h.sent.filter((m) => m.type === 'snapshot').length >= 1)
    h.session.paneData('A', 'a1')
    h.session.paneData('B', 'b1')
    h.session.paneData('A', 'a2')
    await until(() => h.sent.filter((m) => m.type === 'data').length >= 3)
    const forA = h.sent.filter((m) => m.type === 'data' && m.paneId === 'A').map((m) => m.data)
    const forB = h.sent.filter((m) => m.type === 'data' && m.paneId === 'B').map((m) => m.data)
    expect(forA).toEqual(['a1', 'a2'])
    expect(forB).toEqual(['b1'])

    h.session.handleFrame(frame({ type: 'unsubscribe', paneId: 'A' }))
    h.session.paneData('A', 'a3')
    h.session.paneData('B', 'b2')
    await until(() => h.sent.filter((m) => m.type === 'data' && m.paneId === 'B').length >= 2)
    expect(h.sent.filter((m) => m.type === 'data' && m.paneId === 'A').map((m) => m.data)).toEqual(['a1', 'a2'])
    h.mirror.dispose()
  })
})

describe('TEST-2627 REQ-016 concurrent clients coexist — no lease, no steal, no cross-degradation', () => {
  it('two sessions on one pane both stream; a slow consumer degrades only itself; input is accepted from both', async () => {
    const fast = mkHarness()
    let slowBuffered = 0
    const slow = mkHarness({ bufferedAmount: () => slowBuffered })
    fast.session.start(); slow.session.start()
    fast.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    slow.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    await until(() => fast.sent.some((m) => m.type === 'snapshot') && slow.sent.some((m) => m.type === 'snapshot'))

    // both receive the stream
    fast.session.paneData('A', 'x1'); slow.session.paneData('A', 'x1')
    await until(() => fast.sent.some((m) => m.type === 'data') && slow.sent.some((m) => m.type === 'data'))

    // the slow one saturates — only ITS delivery stops
    slowBuffered = PHONE_WS_HIGH_WATER + 1
    fast.session.paneData('A', 'x2'); slow.session.paneData('A', 'x2')
    await until(() => fast.sent.filter((m) => m.type === 'data').length >= 2)
    expect(fast.sent.filter((m) => m.type === 'data').map((m) => m.data)).toEqual(['x1', 'x2'])
    expect(slow.sent.filter((m) => m.type === 'data').map((m) => m.data)).toEqual(['x1'])

    // input from BOTH authenticated clients is accepted (the desktop is never displaced)
    fast.session.handleFrame(frame({ type: 'input', paneId: 'A', data: 'from-fast' }))
    slow.session.handleFrame(frame({ type: 'input', paneId: 'A', data: 'from-slow' }))
    expect(fast.writes).toContainEqual(['A', 'from-fast'])
    expect(slow.writes).toContainEqual(['A', 'from-slow'])

    // disconnecting one leaves the other unaffected
    fast.session.close()
    slow.session.handleFrame(frame({ type: 'input', paneId: 'A', data: 'still-alive' }))
    expect(slow.writes).toContainEqual(['A', 'still-alive'])
    fast.mirror.dispose(); slow.mirror.dispose()
  })
})

describe('TEST-2629 REQ-017 session half: stale pane is resynced from the drain signal with a buffer-replacing snapshot', () => {
  it('above high water data stops; the drain event (not a future chunk) emits one resync', async () => {
    let buffered = 0
    const h = mkHarness({ bufferedAmount: () => buffered })
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    await until(() => h.sent.some((m) => m.type === 'snapshot'))

    buffered = PHONE_WS_HIGH_WATER + 1
    h.feed('dropped-while-stale\r\n')
    // the stream goes QUIET; only the transport drain arrives
    buffered = PHONE_WS_LOW_WATER - 1
    h.session.socketDrained()
    await until(() => h.sent.some((m) => m.type === 'resync' && m.paneId === 'A'))
    const resyncs = h.sent.filter((m) => m.type === 'resync' && m.paneId === 'A')
    expect(resyncs.length).toBe(1)
    // the resync snapshot carries the bytes the client missed (fresh mirror snapshot)
    expect(String(resyncs[0].data)).toContain('dropped-while-stale')
    // and the dropped chunk was NOT also delivered as data (replacement, not append+dup)
    expect(h.sent.filter((m) => m.type === 'data' && String(m.data).includes('dropped-while-stale'))).toEqual([])
    h.mirror.dispose()
  })
})

describe('TEST-2628 REQ-024 reconnection is a fresh attach against the surviving mirror', () => {
  it('a new session after a drop reconstructs the pane from snapshot + new stream, no duplicated region', async () => {
    const mirror = createPaneReplay({ cols: 40, rows: 6, scrollback: 2000 })
    const mk = (): { sent: Msg[]; session: ReturnType<typeof createWsSession> } => {
      const sent: Msg[] = []
      const session = createWsSession({
        send: (m) => sent.push(m as Msg),
        mirrors: { snapshot: (id) => (id === 'A' ? mirror.snapshot() : undefined) },
        panes: { inventory: () => ({}), isLive: () => true, write: () => {} }
      })
      return { sent, session }
    }
    const first = mk()
    first.session.start()
    first.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    mirror.feed('early\r\n'); first.session.paneData('A', 'early\r\n')
    await until(() => first.sent.some((m) => m.type === 'snapshot'))
    // the connection drops mid-stream
    first.session.close()
    mirror.feed('while-gone\r\n')
    // the client reconnects: a brand-new session, fresh attach semantics
    const second = mk()
    second.session.start()
    second.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    await until(() => second.sent.some((m) => m.type === 'snapshot' && m.paneId === 'A'))
    mirror.feed('after-reconnect\r\n'); second.session.paneData('A', 'after-reconnect\r\n')
    await until(() => second.sent.some((m) => m.type === 'data' && m.paneId === 'A'))
    expect(await reconstruct(second.sent, 'A'))
      .toBe(await referenceText(['early\r\n', 'while-gone\r\n', 'after-reconnect\r\n']))
    mirror.dispose()
  })
})

describe('TEST-2630 REQ-012 input injection is byte-faithful; bogus panes get a specific error', () => {
  it('writes the exact bytes to the pane write seam (UTF-8 + control bytes)', () => {
    const h = mkHarness()
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    const payload = 'héllo\x03\t\x1b[A\r'
    h.session.handleFrame(frame({ type: 'input', paneId: 'A', data: payload }))
    expect(h.writes).toEqual([['A', payload]])
    h.mirror.dispose()
  })

  it('input to an unknown pane yields an error naming the pane id — and the socket stays usable', () => {
    const h = mkHarness({ live: ['A'] })
    h.session.start()
    h.session.handleFrame(frame({ type: 'input', paneId: 'no-such-pane', data: 'x' }))
    const err = h.sent.find((m) => m.type === 'error')
    expect(err, 'a specific error message must be sent').toBeDefined()
    expect(String(err?.message)).toContain('no-such-pane')
    expect(h.writes).toEqual([])
    // the connection is not poisoned
    h.session.handleFrame(frame({ type: 'input', paneId: 'A', data: 'ok' }))
    expect(h.writes).toEqual([['A', 'ok']])
    h.mirror.dispose()
  })
})

describe('TEST-2631 REQ-012/REQ-026 input to an exited pane errors after the exit push', () => {
  it('paneExit is pushed to the subscribed client and later input gets the specific error', async () => {
    const live = new Set(['A'])
    const sent: Msg[] = []
    const writes: Array<[string, string]> = []
    const session = createWsSession({
      send: (m) => sent.push(m as Msg),
      mirrors: { snapshot: () => Promise.resolve('') },
      panes: { inventory: () => ({}), isLive: (id) => live.has(id), write: (id, d) => writes.push([id, d]) }
    })
    session.start()
    session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    await until(() => sent.some((m) => m.type === 'snapshot'))
    live.delete('A')
    session.paneExit('A')
    expect(sent.some((m) => m.type === 'paneExit' && m.paneId === 'A')).toBe(true)
    session.handleFrame(frame({ type: 'input', paneId: 'A', data: 'too late' }))
    const err = sent.filter((m) => m.type === 'error')
    expect(err.length).toBeGreaterThan(0)
    expect(String(err[err.length - 1].message)).toContain('A')
    expect(writes).toEqual([])
  })
})

describe('TEST-2632 REQ-013 fuzz: no client message reaches a resize seam, nothing throws', () => {
  it('resize-shaped and arbitrary messages are inert (no write, no throw, error or ignore)', () => {
    const h = mkHarness()
    h.session.start()
    const fuzz: unknown[] = [
      frame({ type: 'resize', paneId: 'A', cols: 1, rows: 1 }),
      frame({ type: 'resize', cols: 9999, rows: 9999 }),
      frame({ type: 'grid', paneId: 'A', cols: 10, rows: 10 }),   // server->client type replayed back
      frame({ type: 'kill', paneId: 'A' }),
      frame({ type: 'spawn', cwd: 'C:/' }),
      frame({ type: 'subscribe', paneId: { $bad: true } }),
      frame({ type: '__proto__', paneId: 'A' }),
      '{"type":"resize"',                                          // truncated JSON
      Buffer.from('\x00\x01resize'),
      12345,
      null
    ]
    for (const f of fuzz) {
      expect(() => h.session.handleFrame(f), `frame ${String(f).slice(0, 40)} must not throw`).not.toThrow()
    }
    // nothing was written into any pane, and no grid/resize side effect can exist: the deps
    // shape exposes no resize capability at all (see the contract header)
    expect(h.writes).toEqual([])
    h.mirror.dispose()
  })
})

describe('TEST-2633 REQ-013 desktop grid changes are pushed to attached clients', () => {
  it('paneGrid produces a grid message with the new cols/rows for subscribed panes only', async () => {
    const h = mkHarness()
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    await until(() => h.sent.some((m) => m.type === 'snapshot'))
    h.session.paneGrid('A', 100, 30)
    h.session.paneGrid('B', 50, 20)   // not subscribed
    await until(() => h.sent.some((m) => m.type === 'grid'))
    const grids = h.sent.filter((m) => m.type === 'grid')
    expect(grids).toEqual([{ type: 'grid', paneId: 'A', cols: 100, rows: 30 }])
    h.mirror.dispose()
  })
})

describe('TEST-2634 REQ-014 no lifecycle capability: unknown types get the error treatment', () => {
  it('kill/spawn/close/workspace messages are rejected with a specific error, with zero side effects', () => {
    const h = mkHarness()
    h.session.start()
    const before = h.sent.length
    for (const type of ['kill', 'spawn', 'close', 'split', 'moveWorkspace', 'fsRead', 'openFile']) {
      h.session.handleFrame(frame({ type, paneId: 'A' }))
    }
    const errors = h.sent.slice(before).filter((m) => m.type === 'error')
    expect(errors.length).toBeGreaterThan(0)
    for (const e of errors) expect(String(e.message).length).toBeGreaterThan(0)
    expect(h.writes).toEqual([])
    h.mirror.dispose()
  })
})

describe('TEST-2635 REQ-018 the session boundary contains every untrusted failure', () => {
  it('malformed frames yield error/clean handling, never a throw escaping the handler', () => {
    const h = mkHarness()
    h.session.start()
    for (const raw of ['not json', '', ' ', '\x00\x01', 'null', '[]', '"str"']) {
      expect(() => h.session.handleFrame(raw)).not.toThrow()
    }
    expect(h.sent.filter((m) => m.type === 'error').length).toBeGreaterThan(0)
    h.mirror.dispose()
  })

  it('a throwing pane write seam is contained: specific error out, no uncaught throw in main', () => {
    const sent: Msg[] = []
    const session = createWsSession({
      send: (m) => sent.push(m as Msg),
      mirrors: { snapshot: () => Promise.resolve('') },
      panes: {
        inventory: () => ({}),
        isLive: () => true,
        write: () => { throw new Error('EPIPE: pty gone') }
      }
    })
    session.start()
    expect(() => session.handleFrame(frame({ type: 'input', paneId: 'A', data: 'x' }))).not.toThrow()
    expect(sent.some((m) => m.type === 'error')).toBe(true)
  })

  it('a throwing send seam never propagates into the pane-data path', () => {
    const session = createWsSession({
      send: () => { throw new Error('socket destroyed') },
      mirrors: { snapshot: () => Promise.resolve('') },
      panes: { inventory: () => ({}), isLive: () => true, write: () => {} }
    })
    expect(() => session.start()).not.toThrow()
    expect(() => session.paneData('A', 'chunk')).not.toThrow()
    expect(() => session.paneStatus('A', 'busy')).not.toThrow()
  })
})

describe('TEST-2636 REQ-026/REQ-011 exit and status pushes reach connected clients', () => {
  it('a status flip is pushed to a connected client WITHOUT re-requesting the inventory', () => {
    const h = mkHarness()
    h.session.start()
    h.session.paneStatus('A', 'idle')
    const status = h.sent.filter((m) => m.type === 'status')
    expect(status).toEqual([{ type: 'status', paneId: 'A', status: 'idle' }])
    h.mirror.dispose()
  })

  it('a subscribed pane exit pushes paneExit and the terminal exited status', async () => {
    const h = mkHarness()
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    await until(() => h.sent.some((m) => m.type === 'snapshot'))
    h.session.paneExit('A')
    expect(h.sent.some((m) => m.type === 'paneExit' && m.paneId === 'A')).toBe(true)
    expect(h.sent.some((m) => m.type === 'status' && m.paneId === 'A' && m.status === 'exited')).toBe(true)
    h.mirror.dispose()
  })
})

// ---------------------------------------------------------------------------------------------
// v2 loopback amendments (ESC-001; FINDING-008/009/002/019/020) — REQ-009 identity-guarded
// supersession, REQ-017 resync hold-window / stale lifecycle / push coalescing at the session.
// This harness controls SNAPSHOT RESOLUTION ORDER: mirrors.snapshot captures the mirror text at
// the CALL (the F18 write-flush-barrier semantics) but resolves only when the test says so.

interface DeferredHarness {
  sent: Msg[]
  session: ReturnType<typeof createWsSession>
  /** feed a chunk: mirror text first (the service feeds the mirror before the session) */
  feed: (chunk: string) => void
  /** snapshot calls in order; resolve(i) delivers the text captured at call i */
  resolveSnapshot: (i: number) => void
  snapshotCalls: () => number
  setBuffered: (n: number) => void
}

const mkDeferredHarness = (): DeferredHarness => {
  const sent: Msg[] = []
  let mirrorText = ''
  let buffered = 0
  const calls: Array<{ captured: string; resolve: (s: string) => void }> = []
  const session = createWsSession({
    send: (m) => sent.push(m as Msg),
    bufferedAmount: () => buffered,
    mirrors: {
      snapshot: (paneId) => {
        if (paneId !== 'A') return undefined
        let resolveFn!: (s: string) => void
        const p = new Promise<string>((res) => { resolveFn = res })
        calls.push({ captured: mirrorText, resolve: resolveFn })
        return p
      }
    },
    panes: {
      inventory: () => ({ workspaces: [{ id: 'ws1', name: 'W', panes: [{ paneId: 'A' }] }] }),
      isLive: () => true,
      write: () => {}
    }
  })
  return {
    sent,
    session,
    feed: (chunk) => { mirrorText += chunk; session.paneData('A', chunk) },
    resolveSnapshot: (i) => { calls[i].resolve(calls[i].captured) },
    snapshotCalls: () => calls.length,
    setBuffered: (n) => { buffered = n }
  }
}

describe('TEST-2705 REQ-009 attach supersession is IDENTITY-guarded (FINDING-008)', () => {
  it('resolving the FIRST snapshot after a second subscribe completes nothing; C and D land exactly once', async () => {
    const h = mkDeferredHarness()
    h.session.start()
    h.feed('B\r\n')
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' })) // attach 1 captured "B"
    h.feed('C\r\n')
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' })) // attach 2 supersedes, captured "B C"
    h.feed('D\r\n')
    expect(h.snapshotCalls()).toBe(2)

    // adversarial resolution order: the SUPERSEDED snapshot resolves first
    h.resolveSnapshot(0)
    await new Promise((r) => setTimeout(r, 20))
    h.resolveSnapshot(1)
    await until(() => h.sent.some((m) => m.type === 'snapshot' && m.paneId === 'A'))
    await until(() => h.sent.some((m) => m.type === 'data' && String(m.data).includes('D')))

    const snapshots = h.sent.filter((m) => m.type === 'snapshot' && m.paneId === 'A')
    expect(snapshots, 'only the LATEST subscribe may complete the attach — exactly one snapshot').toHaveLength(1)
    expect(String(snapshots[0].data)).toContain('C')
    // exactly-once: C rides ONLY the (second) snapshot, D rides ONLY the stream
    const streamed = h.sent.filter((m) => m.type === 'data' && m.paneId === 'A').map((m) => String(m.data))
    expect(streamed.join('')).toContain('D')
    expect(streamed.join('')).not.toContain('C')
    const rendered = await reconstruct(h.sent, 'A')
    expect(rendered).toBe(await referenceText(['B\r\n', 'C\r\n', 'D\r\n']))
  })
})

describe('TEST-2706 REQ-017 resync rides the attach hold-window: no delivered byte is erased', () => {
  it('data arriving between the drain trigger and the resync resolution is queued BEHIND the resync', async () => {
    const h = mkDeferredHarness()
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    h.resolveSnapshot(0)
    await until(() => h.sent.some((m) => m.type === 'snapshot' && m.paneId === 'A'))
    h.feed('one\r\n')
    await until(() => h.sent.some((m) => m.type === 'data' && String(m.data).includes('one')))

    // saturate: the next chunk is dropped and the pane goes stale
    h.setBuffered(PHONE_WS_HIGH_WATER + 1)
    h.feed('lost-while-saturated\r\n')
    // drain: the resync snapshot is requested but NOT yet resolved
    h.setBuffered(0)
    h.session.socketDrained()
    await until(() => h.snapshotCalls() >= 2)
    // the hold-window race: output arrives between the trigger and the snapshot resolution
    h.feed('during-resync\r\n')
    const sentBeforeResolve = h.sent.filter((m) => m.type === 'data' && String(m.data).includes('during-resync'))
    expect(sentBeforeResolve, 'post-trigger data must be queued behind the resync, never sent ahead of it').toEqual([])

    h.resolveSnapshot(1)
    await until(() => h.sent.some((m) => m.type === 'resync' && m.paneId === 'A'))
    await until(() => h.sent.some((m) => m.type === 'data' && String(m.data).includes('during-resync')))
    const order = h.sent.filter((m) => m.paneId === 'A' && (m.type === 'resync' || m.type === 'data'))
    const resyncIdx = order.findIndex((m) => m.type === 'resync')
    const heldIdx = order.findIndex((m) => m.type === 'data' && String(m.data).includes('during-resync'))
    expect(resyncIdx).toBeGreaterThanOrEqual(0)
    expect(heldIdx).toBeGreaterThan(resyncIdx)
    // replace-then-append reconstructs exactly the reference — nothing erased, nothing doubled
    const rendered = await reconstruct(h.sent, 'A')
    expect(rendered).toBe(await referenceText(['one\r\n', 'lost-while-saturated\r\n', 'during-resync\r\n']))
  })
})

describe('TEST-2707 REQ-017 stale-state lifecycle at the session (FINDING-020)', () => {
  it('stale then unsubscribe then drain emits NO resync', async () => {
    const h = mkDeferredHarness()
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    h.resolveSnapshot(0)
    await until(() => h.sent.some((m) => m.type === 'snapshot'))
    h.setBuffered(PHONE_WS_HIGH_WATER + 1)
    h.feed('dropped\r\n')
    h.session.handleFrame(frame({ type: 'unsubscribe', paneId: 'A' }))
    h.setBuffered(0)
    h.session.socketDrained()
    await new Promise((r) => setTimeout(r, 50))
    expect(h.sent.filter((m) => m.type === 'resync')).toEqual([])
  })

  it('stale then fresh subscribe: the attach snapshot IS the resync; post-snapshot chunks flow as data', async () => {
    const h = mkDeferredHarness()
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    h.resolveSnapshot(0)
    await until(() => h.sent.some((m) => m.type === 'snapshot'))
    h.setBuffered(PHONE_WS_HIGH_WATER + 1)
    h.feed('missed\r\n')
    h.setBuffered(0)
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' })) // fresh subscribe clears staleness
    await until(() => h.snapshotCalls() >= 2)
    h.resolveSnapshot(1)
    await until(() => h.sent.filter((m) => m.type === 'snapshot').length >= 2)
    const snap2 = h.sent.filter((m) => m.type === 'snapshot')[1]
    expect(String(snap2.data)).toContain('missed')
    h.session.socketDrained()
    await new Promise((r) => setTimeout(r, 50))
    expect(h.sent.filter((m) => m.type === 'resync'), 'the fresh attach cleared staleness — no resync follows').toEqual([])
    h.feed('after\r\n')
    await until(() => h.sent.some((m) => m.type === 'data' && String(m.data).includes('after')))
  })
})

describe('TEST-2708 REQ-017 status/grid pushes to a saturated session are coalesced latest-wins', () => {
  it('holds pushes while saturated and delivers ONE latest status + grid per pane on drain', async () => {
    const h = mkDeferredHarness()
    h.session.start()
    h.session.handleFrame(frame({ type: 'subscribe', paneId: 'A' }))
    h.resolveSnapshot(0)
    await until(() => h.sent.some((m) => m.type === 'snapshot'))
    const sentBefore = h.sent.length

    h.setBuffered(PHONE_WS_HIGH_WATER + 1)
    for (let i = 0; i < 25; i++) h.session.paneStatus('A', i % 2 === 0 ? 'busy' : 'idle')
    h.session.paneStatus('A', 'needs-input')
    h.session.paneGrid('A', 100, 30)
    h.session.paneGrid('A', 120, 40)
    expect(h.sent.length, 'a saturated client must not accumulate unbounded pushes').toBe(sentBefore)

    h.setBuffered(0)
    h.session.socketDrained()
    await until(() => h.sent.some((m) => m.type === 'status' && m.paneId === 'A'))
    const statuses = h.sent.slice(sentBefore).filter((m) => m.type === 'status' && m.paneId === 'A')
    const grids = h.sent.slice(sentBefore).filter((m) => m.type === 'grid' && m.paneId === 'A')
    expect(statuses).toHaveLength(1)
    expect(statuses[0].status).toBe('needs-input')
    expect(grids).toHaveLength(1)
    expect(grids[0].cols).toBe(120)
    expect(grids[0].rows).toBe(40)
  })
})
