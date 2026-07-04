// FROZEN test suite — feature 0018-windowed-flow-control (phase 4).
// The agent session with flow-control semantics, in-process (REQ-005..REQ-009 session-level,
// REQ-013): ack/window replace F16's inertness (superseding TEST-773's inertness pin, per its
// own retirement path), the flood is bounded under a stalled consumer, the session stays
// responsive, and policy-driven acks recover the stream with byte-for-byte integrity.
// All IO is injected; every vector is synchronous and deterministic.
import { describe, it, expect } from 'vitest'
import { WIRE_PROTO, createClientAckPolicy } from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, DecodedItem, AckFrame } from '@shared/remote/protocol'
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import { createAgentSession } from '../src/agent/session'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import type { AgentPtyBackend, AgentSpawnOpts } from '../src/agent/pty-backend'

const VERSION = '1.2.3'

interface Harness {
  session: ReturnType<typeof createAgentSession>
  sent: WireFrame[]
  diags: string[]
  exits: number[]
}

/** Wrap a backend to record every handle's pause/resume call sequence, per spawn. */
interface FlowSpy {
  backend: AgentPtyBackend
  spawns: Array<{ opts: AgentSpawnOpts; seq: string[] }>
  seqFor: (id: string) => string[][]
}
const flowSpy = (inner: AgentPtyBackend): FlowSpy => {
  const spawns: Array<{ opts: AgentSpawnOpts; seq: string[] }> = []
  return {
    spawns,
    seqFor: (id) => spawns.filter((s) => s.opts.id === id).map((s) => s.seq),
    backend: {
      spawn(opts) {
        const h = inner.spawn(opts)
        const rec = { opts, seq: [] as string[] }
        spawns.push(rec)
        return {
          ...h,
          pause: () => { rec.seq.push('pause'); h.pause() },
          resume: () => { rec.seq.push('resume'); h.resume() }
        }
      }
    }
  }
}

const mkHarness = (backend: AgentPtyBackend = createFakePtyBackend()): Harness => {
  const sent: WireFrame[] = []
  const diags: string[] = []
  const exits: number[] = []
  const session = createAgentSession({
    version: VERSION,
    backend,
    homeDir: '/home/test',
    send: (f) => sent.push(f),
    diag: (t) => diags.push(t),
    shutdown: (c) => exits.push(c)
  })
  session.start()
  return { session, sent, diags, exits }
}

const msg = (frame: WireFrame): DecodedItem => ({ kind: 'message', frame })
const establish = (h: Harness): void =>
  h.session.onItem(msg({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: VERSION }))

let nextReqId = 1
const req = (h: Harness, method: string, params: unknown, id = nextReqId++): number => {
  h.session.onItem(msg({ type: 'req', id, method, params }))
  return id
}
const spawnArgs = (id: string): PtySpawnArgs => ({ id, shellId: 'default', cwd: '/home/u', cols: 80, rows: 24 })
const resFor = (h: Harness, id: number): ResFrame[] =>
  h.sent.filter((f): f is ResFrame => f.type === 'res' && f.id === id)
const evts = (h: Harness, channel: string, paneId: string): EvtFrame[] =>
  h.sent.filter((f): f is EvtFrame => f.type === 'evt' && f.channel === channel && f.args[0] === paneId)
const dataText = (h: Harness, paneId: string): string =>
  evts(h, CH.ptyData, paneId).map((e) => String(e.args[1])).join('')
const dataUnits = (h: Harness, paneId: string): number =>
  evts(h, CH.ptyData, paneId).reduce((n, e) => n + String(e.args[1]).length, 0)

const oscD = (code: number): string => `\x1b]133;D;${code}\x07`

/** The golden stream: the same script driven directly on a fresh, never-paused fake handle. */
const golden = (script: string[]): string => {
  const handle = createFakePtyBackend().spawn({ id: 'g', cwd: '/home/u', cols: 80, rows: 24, shellId: 'default' })
  const out: string[] = []
  handle.onData((d) => out.push(d))
  for (const line of script) handle.write(line)
  return out.join('')
}

describe('TEST-791 REQ-005/REQ-013 a flood past the window pauses exactly once, synchronously bounded', () => {
  it('emits at most window + one chunk of pty:data, then nothing further until acked', () => {
    const spyB = flowSpy(createFakePtyBackend())
    const h = mkHarness(spyB.backend)
    establish(h)
    h.session.onItem(msg({ type: 'window', size: 100 })) // connection default, applies to the future pane
    const sid = req(h, CH.ptySpawn, spawnArgs('a'))
    expect(resFor(h, sid)[0]?.ok).toBe(true)
    const wid = req(h, CH.ptyWrite, { id: 'a', data: 'flood 40 10\n' }) // 400 units >> window 100
    expect(resFor(h, wid)[0]?.ok).toBe(true)

    expect(spyB.seqFor('a')[0], 'pause called exactly once').toEqual(['pause'])
    const units = dataUnits(h, 'a')
    expect(units, 'the window was actually crossed').toBeGreaterThan(100)
    expect(units, 'bounded by window + the crossing chunk').toBeLessThanOrEqual(110)
    expect(dataText(h, 'a')).not.toContain(oscD(0)) // the flood is NOT complete
    expect(h.exits).toEqual([])
  })
})

describe('TEST-792 REQ-006/REQ-007/REQ-013 session-level ack/window edges; flow frames never get a res', () => {
  it('ack and window produce no reply frame and no diagnostic on the happy path', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'))
    const frames = h.sent.length
    const diags = h.diags.length
    h.session.onItem(msg({ type: 'ack', id: 'a', bytes: 4 }))
    h.session.onItem(msg({ type: 'window', size: 5000 }))
    h.session.onItem(msg({ type: 'window', size: 4096, id: 'a' }))
    expect(h.sent.length, 'flow frames are fire-and-forget').toBe(frames)
    expect(h.diags.length).toBe(diags)
    expect(h.exits).toEqual([])
  })

  it('a window for an unknown pane is diagnosed and stores nothing; an unknown-pane ack is silent', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'))
    const frames = h.sent.length
    const diagsBefore = h.diags.length
    h.session.onItem(msg({ type: 'window', size: 64, id: 'ghost' }))
    expect(h.diags.length).toBe(diagsBefore + 1)
    expect(h.diags[h.diags.length - 1]).toContain('ghost')
    h.session.onItem(msg({ type: 'ack', id: 'ghost', bytes: 9 }))
    expect(h.diags.length, 'unknown-pane ack adds no diagnostic (ack-after-exit race)').toBe(diagsBefore + 1)
    expect(h.sent.length).toBe(frames)
  })

  it('a late ack after the pane exits is silently tolerated and the session stays serviceable', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'))
    req(h, CH.ptyWrite, { id: 'a', data: 'exit 0\n' })
    expect(evts(h, CH.ptyExit, 'a').length).toBe(1)
    const frames = h.sent.length
    const diags = h.diags.length
    h.session.onItem(msg({ type: 'ack', id: 'a', bytes: 999 }))
    expect(h.sent.length).toBe(frames)
    expect(h.diags.length).toBe(diags)
    const sid = req(h, CH.ptySpawn, spawnArgs('b'))
    expect(resFor(h, sid)[0]?.ok).toBe(true)
    expect(h.exits).toEqual([])
  })

  it('a window frame before the client hello still fails the handshake (F15 taxonomy unchanged)', () => {
    const h = mkHarness()
    h.session.onItem(msg({ type: 'window', size: 4096 }))
    expect(h.exits).toEqual([1])
    expect(h.diags.join('\n')).toContain('unexpected-frame')
  })
})

describe('TEST-793 REQ-009/REQ-013 pane exit prunes flow state; a reused id starts fresh', () => {
  it('kill discards the explicit per-pane window; the respawned id floods under the default', () => {
    const spyB = flowSpy(createFakePtyBackend())
    const h = mkHarness(spyB.backend)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'))
    h.session.onItem(msg({ type: 'window', size: 50, id: 'a' })) // explicit tiny window
    req(h, CH.ptyWrite, { id: 'a', data: 'flood 10 10\n' }) // 100 units > 50
    expect(spyB.seqFor('a')[0]).toEqual(['pause'])

    req(h, CH.ptyKill, 'a') // wire shape: the bare pane-id string (mirrors TermhallaApi.ptyKill)
    expect(evts(h, CH.ptyExit, 'a').length, 'exactly one exit').toBe(1)

    const frames = h.sent.length
    h.session.onItem(msg({ type: 'ack', id: 'a', bytes: 40 })) // late ack for the dead incarnation
    expect(h.sent.length).toBe(frames)

    const sid = req(h, CH.ptySpawn, spawnArgs('a')) // REUSE the id
    expect(resFor(h, sid)[0]?.ok).toBe(true)
    if (resFor(h, sid)[0]?.ok) expect((resFor(h, sid)[0] as Extract<ResFrame, { ok: true }>).result).toBe(false) // fresh spawn, not adopt
    const baseline = dataUnits(h, 'a')
    req(h, CH.ptyWrite, { id: 'a', data: 'flood 10 10\n' }) // 100 units < the 1 MiB default
    expect(spyB.seqFor('a')[1], 'no pause under the default window — the explicit 50 was pruned').toEqual([])
    const flood = dataText(h, 'a').slice(0) // full second flood present, completed
    expect(dataUnits(h, 'a') - baseline).toBeGreaterThan(100)
    expect(flood).toContain(oscD(0))
  })
})

describe('TEST-794 REQ-008/REQ-013 stalled consumer: bounded and responsive; acks recover byte-for-byte', () => {
  it('flood with zero acks is bounded; a second pane works; policy-driven acks drain it to completion', () => {
    const spyB = flowSpy(createFakePtyBackend())
    const h = mkHarness(spyB.backend)
    establish(h)
    h.session.onItem(msg({ type: 'window', size: 1000 }))
    req(h, CH.ptySpawn, spawnArgs('a'))
    req(h, CH.ptyWrite, { id: 'a', data: 'flood 100 50\n' }) // 5000 units >> window 1000

    // --- stalled: bounded, incomplete, exactly one pause
    const stalledUnits = dataUnits(h, 'a')
    expect(stalledUnits).toBeGreaterThan(1000)
    expect(stalledUnits).toBeLessThanOrEqual(1050)
    expect(dataText(h, 'a')).not.toContain(oscD(0))
    expect(spyB.seqFor('a')[0]).toEqual(['pause'])

    // --- the session stays responsive while pane a is paused
    const sidB = req(h, CH.ptySpawn, spawnArgs('b'))
    expect(resFor(h, sidB)[0]?.ok).toBe(true)
    req(h, CH.ptyWrite, { id: 'b', data: 'echo pane-b-alive\n' })
    expect(dataText(h, 'b')).toContain('pane-b-alive')
    req(h, CH.ptyKill, 'b') // wire shape: the bare pane-id string (mirrors TermhallaApi.ptyKill)
    expect(evts(h, CH.ptyExit, 'b').length).toBe(1)
    expect(dataUnits(h, 'a'), 'pane a is stalled, not just slow').toBe(stalledUnits)
    expect(h.exits).toEqual([])

    // --- recovery: the CLIENT-side policy drives acks off the received evts (the F17 client half)
    const policy = createClientAckPolicy({ ackEveryBytes: 64 })
    let consumed = 0
    for (let guard = 0; guard < 10_000; guard++) {
      const pending: AckFrame[] = []
      const es = evts(h, CH.ptyData, 'a')
      while (consumed < es.length) {
        const ack = policy.onData('a', String(es[consumed].args[1]))
        if (ack) pending.push(ack)
        consumed++
      }
      if (pending.length === 0) pending.push(...policy.flush())
      if (pending.length === 0) break
      for (const ack of pending) h.session.onItem(msg(ack))
    }

    // --- complete, byte-for-byte, and the pause/resume log alternates strictly
    const got = dataText(h, 'a')
    expect(got).toContain(oscD(0))
    expect(got).toBe(golden(['flood 100 50\n']))
    const seq = spyB.seqFor('a')[0]
    expect(seq.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < seq.length; i++) expect(seq[i]).toBe(i % 2 === 0 ? 'pause' : 'resume')

    // --- clean shutdown taxonomy preserved (F16 REQ-013)
    h.session.endOfInput()
    expect(h.exits).toEqual([0])
  })
})
