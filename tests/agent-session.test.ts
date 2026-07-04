// FROZEN test suite — feature 0017-agent-runtime-skeleton (phase 4).
// The agent session core, in-process: handshake-first, exactly-one-res dispatch, pty method
// semantics, status-at-the-source, push mirroring, and the lifecycle taxonomy
// (REQ-004..REQ-010, REQ-013). All IO is injected; every vector is synchronous and
// deterministic (the fake backend emits synchronously; no timers are awaited).
import { describe, it, expect } from 'vitest'
import { WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, DecodedItem } from '@shared/remote/protocol'
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import type { TerminalStatus } from '@shared/types'
import { createAgentSession } from '../src/agent/session'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from '../src/agent/pty-backend'

const VERSION = '1.2.3'

interface Harness {
  session: ReturnType<typeof createAgentSession>
  sent: WireFrame[]
  diags: string[]
  exits: number[]
}

const mkHarness = (backend: AgentPtyBackend = createFakePtyBackend(), homeDir = '/home/test'): Harness => {
  const sent: WireFrame[] = []
  const diags: string[] = []
  const exits: number[] = []
  const session = createAgentSession({
    version: VERSION,
    backend,
    homeDir,
    send: (f) => sent.push(f),
    diag: (t) => diags.push(t),
    shutdown: (c) => exits.push(c)
  })
  session.start()
  return { session, sent, diags, exits }
}

const msg = (frame: WireFrame): DecodedItem => ({ kind: 'message', frame })
const clientHello = (version = VERSION): WireFrame => ({ type: 'hello', proto: WIRE_PROTO, role: 'client', version })
const establish = (h: Harness): void => h.session.onItem(msg(clientHello()))

let nextReqId = 1
const req = (h: Harness, method: string, params: unknown, id = nextReqId++): number => {
  h.session.onItem(msg({ type: 'req', id, method, params }))
  return id
}
const spawnArgs = (id: string, over: Partial<PtySpawnArgs> = {}): PtySpawnArgs =>
  ({ id, shellId: 'default', cwd: '/home/u', cols: 80, rows: 24, ...over })

const resFor = (h: Harness, id: number): ResFrame[] =>
  h.sent.filter((f): f is ResFrame => f.type === 'res' && f.id === id)
const evts = (h: Harness, channel: string, paneId?: string): EvtFrame[] =>
  h.sent.filter((f): f is EvtFrame => f.type === 'evt' && f.channel === channel &&
    (paneId === undefined || f.args[0] === paneId))
const dataText = (h: Harness, paneId: string): string =>
  evts(h, CH.ptyData, paneId).map((e) => String(e.args[1])).join('')

/** Wrap a backend to record spawns and expose per-handle kill counters. */
const spy = (inner: AgentPtyBackend): { backend: AgentPtyBackend; spawns: AgentSpawnOpts[]; kills: number[] } => {
  const spawns: AgentSpawnOpts[] = []
  const kills: number[] = []
  return {
    spawns,
    kills,
    backend: {
      spawn(opts) {
        spawns.push(opts)
        const h = inner.spawn(opts)
        const idx = kills.push(0) - 1
        return { ...h, kill: () => { kills[idx]++; h.kill() } }
      }
    }
  }
}

describe('TEST-764 REQ-004 the agent hello is the first frame, with the pinned identity', () => {
  it('sends exactly the agent hello before anything else, capabilities = [pty, status]', () => {
    const h = mkHarness()
    expect(h.sent.length).toBe(1)
    expect(h.sent[0]).toEqual({
      type: 'hello', proto: WIRE_PROTO, role: 'agent', version: VERSION, capabilities: ['pty', 'status']
    })
    establish(h)
    expect(h.exits).toEqual([]) // established, still running
  })
})

describe('TEST-765 REQ-005 handshake failure: no further frames, stderr reason, exit 1', () => {
  it('version mismatch names both versions and shuts down with 1', () => {
    const h = mkHarness()
    h.session.onItem(msg(clientHello('9.9.9')))
    expect(h.sent.length).toBe(1) // only the agent hello, nothing after failure
    expect(h.exits).toEqual([1])
    const all = h.diags.join('\n')
    expect(all).toContain('version-mismatch')
    expect(all).toContain(VERSION)
    expect(all).toContain('9.9.9')
  })

  it('a req before any hello fails the handshake (unexpected-frame)', () => {
    const h = mkHarness()
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    expect(h.sent.length).toBe(1)
    expect(h.exits).toEqual([1])
    expect(h.diags.join('\n')).toContain('unexpected-frame')
  })

  it('a malformed pre-hello frame (message-error item) fails the handshake', () => {
    const h = mkHarness()
    h.session.onItem({ kind: 'message-error', error: { reason: 'bad-json', message: 'not json', detail: {} } })
    expect(h.sent.length).toBe(1)
    expect(h.exits).toEqual([1])
    expect(h.diags.join('\n')).toContain('bad-json')
  })
})

describe('TEST-766 REQ-006 exactly one res per req, same id; unknown-method; internal', () => {
  it('answers each req exactly once with its own id and codes unknown methods', () => {
    const h = mkHarness()
    establish(h)
    const id1 = req(h, CH.ptySpawn, spawnArgs('a'))
    const [r1] = resFor(h, id1)
    expect(resFor(h, id1).length).toBe(1)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.result).toBe(false) // fresh spawn

    for (const method of ['fs:read', 'pty:transit-begin']) {
      const id = req(h, method, null)
      const rs = resFor(h, id)
      expect(rs.length).toBe(1)
      expect(rs[0].ok).toBe(false)
      if (!rs[0].ok) {
        expect(rs[0].error.code).toBe('unknown-method')
        expect(rs[0].error.message).toContain(method)
      }
    }

    // Across the session: the multiset of res ids equals the req ids sent.
    const reqIds = [id1, id1 + 1, id1 + 2].sort()
    const resIds = h.sent.filter((f): f is ResFrame => f.type === 'res').map((f) => f.id).sort()
    expect(resIds).toEqual(reqIds)
  })

  it('a throwing handler yields internal and the session survives', () => {
    const inner = createFakePtyBackend()
    const backend: AgentPtyBackend = {
      spawn: (o) => {
        const real = inner.spawn(o)
        return { ...real, write: () => { throw new Error('write exploded') } }
      }
    }
    const h = mkHarness(backend)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    req(h, CH.ptyWrite, { id: 'a', data: 'echo x\n' }, 2)
    const [r2] = resFor(h, 2)
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.error.code).toBe('internal')
      expect(r2.error.message.length).toBeGreaterThan(0)
    }
    req(h, CH.ptyResize, { id: 'a', cols: 90, rows: 30 }, 3)
    expect(resFor(h, 3)[0].ok).toBe(true) // session survived the handler throw
    expect(h.exits).toEqual([])
  })
})

describe('TEST-767 REQ-007 pty:spawn semantics: fresh/adopt/respawn, spawn-failed, resolution', () => {
  it('fresh spawn is false, adopt is true with exactly one backend spawn, respawn after exit is fresh', () => {
    const s = spy(createFakePtyBackend())
    const h = mkHarness(s.backend)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    req(h, CH.ptySpawn, spawnArgs('a'), 2)
    const [r1] = resFor(h, 1)
    const [r2] = resFor(h, 2)
    if (r1.ok) expect(r1.result).toBe(false)
    if (r2.ok) expect(r2.result).toBe(true) // adopted, not respawned
    expect(r1.ok && r2.ok).toBe(true)
    expect(s.spawns.length).toBe(1)

    req(h, CH.ptyWrite, { id: 'a', data: 'exit 0\n' }, 3)
    expect(evts(h, CH.ptyExit, 'a').length).toBe(1)
    req(h, CH.ptySpawn, spawnArgs('a'), 4)
    const [r4] = resFor(h, 4)
    expect(r4.ok).toBe(true)
    if (r4.ok) expect(r4.result).toBe(false) // id freed by exit — fresh again
    expect(s.spawns.length).toBe(2)
  })

  it('a throwing backend spawn yields spawn-failed naming the cause and registers no pane', () => {
    const backend: AgentPtyBackend = { spawn: () => { throw new Error('boom: no pty available') } }
    const h = mkHarness(backend)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    const [r1] = resFor(h, 1)
    expect(r1.ok).toBe(false)
    if (!r1.ok) {
      expect(r1.error.code).toBe('spawn-failed')
      expect(r1.error.message).toContain('boom')
    }
    req(h, CH.ptyWrite, { id: 'a', data: 'x' }, 2)
    const [r2] = resFor(h, 2)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('unknown-pane') // nothing was registered
  })

  it('empty cwd resolves to the injected home dir (observable via pwd) and shellId passes through', () => {
    const s = spy(createFakePtyBackend())
    const h = mkHarness(s.backend, '/home/test')
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a', { cwd: '', shellId: 'anything-goes' }), 1)
    expect(s.spawns[0].cwd).toBe('/home/test')
    expect(s.spawns[0].shellId).toBe('anything-goes') // backend owns resolution (REQ-007)
    req(h, CH.ptyWrite, { id: 'a', data: 'pwd\n' }, 2)
    expect(dataText(h, 'a')).toContain('/home/test')
  })
})

describe('TEST-768 REQ-007 write/resize/kill: effects and unknown-pane', () => {
  it('write reaches the pty, resize is observable, kill tears down', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    const wid = req(h, CH.ptyWrite, { id: 'a', data: 'echo ping\n' })
    const [wr] = resFor(h, wid)
    expect(wr.ok).toBe(true)
    if (wr.ok) expect(wr.result).toBe(null)
    expect(dataText(h, 'a')).toContain('ping')

    const rid = req(h, CH.ptyResize, { id: 'a', cols: 100, rows: 31 })
    const [rr] = resFor(h, rid)
    if (rr.ok) expect(rr.result).toBe(null)
    req(h, CH.ptyWrite, { id: 'a', data: 'size\n' })
    expect(dataText(h, 'a')).toContain('size=100x31')

    const kid = req(h, CH.ptyKill, 'a')
    const [kr] = resFor(h, kid)
    expect(kr.ok).toBe(true)
    if (kr.ok) expect(kr.result).toBe(null)
    expect(evts(h, CH.ptyExit, 'a').length).toBe(1)
  })

  it('write/resize/kill on a pane that is not live yield unknown-pane naming the id', () => {
    const h = mkHarness()
    establish(h)
    const vectors: Array<[string, unknown]> = [
      [CH.ptyWrite, { id: 'nope', data: 'x' }],
      [CH.ptyResize, { id: 'nope', cols: 10, rows: 10 }],
      [CH.ptyKill, 'nope']
    ]
    for (const [method, params] of vectors) {
      const id = req(h, method, params)
      const [r] = resFor(h, id)
      expect(r.ok, `${method} on a dead pane must fail`).toBe(false)
      if (!r.ok) {
        expect(r.error.code).toBe('unknown-pane')
        expect(r.error.message).toContain('nope')
      }
    }
  })
})

describe('TEST-769 REQ-008 pty:status from the real engine: transitions, lastExit, dedup', () => {
  it('markers drive idle→busy→idle and lastExit; no consecutive duplicate status', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    const initial = evts(h, CH.ptyStatus, 'a')
    expect(initial.length).toBeGreaterThanOrEqual(1)
    expect((initial[0].args[1] as TerminalStatus).state).toBe('idle')

    req(h, CH.ptyWrite, { id: 'a', data: 'echo work\n' }, 2)
    const states = evts(h, CH.ptyStatus, 'a').map((e) => e.args[1] as TerminalStatus)
    const busyAt = states.findIndex((s) => s.state === 'busy')
    expect(busyAt, 'a busy status must appear on the command marker').toBeGreaterThanOrEqual(1)
    const idleAfter = states.slice(busyAt).findIndex((s) => s.state === 'idle')
    expect(idleAfter, 'the prompt marker must return the pane to idle').toBeGreaterThan(0)
    expect(states.some((s) => s.lastExit === 'success'), 'D;0 must surface lastExit success').toBe(true)

    req(h, CH.ptyWrite, { id: 'a', data: 'exit 3\n' }, 3)
    const after = evts(h, CH.ptyStatus, 'a').map((e) => e.args[1] as TerminalStatus)
    expect(after.some((s) => s.lastExit === 'failure'), 'D;3 must surface lastExit failure').toBe(true)

    for (let i = 1; i < after.length; i++) {
      const prev = after[i - 1]
      const cur = after[i]
      expect(prev.state === cur.state && prev.lastExit === cur.lastExit,
        `consecutive duplicate pty:status at index ${i}`).toBe(false)
    }
  })
})

describe('TEST-770 REQ-008 pty:cwd via OSC 9;9, verbatim POSIX path, change-only', () => {
  it('emits the exact path once per change', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    req(h, CH.ptyWrite, { id: 'a', data: 'cwd /home/kevin/dev\n' }, 2)
    const cwds = evts(h, CH.ptyCwd, 'a')
    expect(cwds.length).toBe(1)
    expect(cwds[0].args).toEqual(['a', '/home/kevin/dev'])
    req(h, CH.ptyWrite, { id: 'a', data: 'cwd /home/kevin/dev\n' }, 3)
    expect(evts(h, CH.ptyCwd, 'a').length).toBe(1) // unchanged cwd re-report is not re-pushed
  })
})

describe('TEST-771 REQ-010 data order is byte-faithful; exit is last and exactly once per pane', () => {
  it('concatenated pty:data equals the scripted output order and pty:exit closes the pane stream', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    req(h, CH.ptyWrite, { id: 'a', data: 'echo one\n' }, 2)
    req(h, CH.ptyWrite, { id: 'a', data: 'echo two\n' }, 3)
    req(h, CH.ptyWrite, { id: 'a', data: 'exit 5\n' }, 4)
    const text = dataText(h, 'a')
    const oneAt = text.indexOf('one\r\n')
    const twoAt = text.indexOf('two\r\n')
    expect(oneAt).toBeGreaterThanOrEqual(0)
    expect(twoAt).toBeGreaterThan(oneAt)

    const exit = evts(h, CH.ptyExit, 'a')
    expect(exit.length).toBe(1)
    expect(exit[0].args).toEqual(['a', 5])
    const exitIdx = h.sent.indexOf(exit[0])
    const paneFramesAfter = h.sent.slice(exitIdx + 1).filter((f) =>
      f.type === 'evt' && f.args[0] === 'a')
    expect(paneFramesAfter, 'pty:exit must be the last frame for its pane').toEqual([])
  })

  it('kill and self-exit each produce exactly one pty:exit per pane', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    req(h, CH.ptySpawn, spawnArgs('b'), 2)
    req(h, CH.ptyWrite, { id: 'a', data: 'exit 0\n' }, 3)
    req(h, CH.ptyKill, 'b', 4)
    expect(evts(h, CH.ptyExit, 'a').length).toBe(1)
    expect(evts(h, CH.ptyExit, 'b').length).toBe(1)
  })
})

describe('TEST-772 REQ-009 rejected params execute nothing', () => {
  it('a rejected spawn registers nothing and touches no backend; a rejected write writes nothing', () => {
    const s = spy(createFakePtyBackend())
    const h = mkHarness(s.backend)
    establish(h)
    req(h, CH.ptySpawn, { ...spawnArgs('a'), cols: 0 }, 1)
    const [r1] = resFor(h, 1)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error.code).toBe('bad-params')
    expect(s.spawns.length, 'no backend call from a rejected spawn (CONV-051: spawn-scoped)').toBe(0)

    req(h, CH.ptySpawn, spawnArgs('a'), 2)
    const [r2] = resFor(h, 2)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.result).toBe(false) // fresh — the rejected attempt left no residue

    req(h, CH.ptyWrite, { id: 'a' }, 3) // missing data
    const [r3] = resFor(h, 3)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error.code).toBe('bad-params')
    req(h, CH.ptyWrite, { id: 'a', data: 'echo ok\n' }, 4)
    expect(dataText(h, 'a')).toContain('ok')
  })
})

// SCOPE-GUARD RETIREMENT PATH (CONV-019): the ack/window INERTNESS pinned below is v1-only.
// F17 (0018-windowed-flow-control) gives these frames semantics and MUST retire/supersede
// these assertions through its own tests phase — never silently during implementation.
describe('TEST-773 REQ-013 lifecycle taxonomy: inert reserved frames, recovery, fatal, clean end', () => {
  it('ack/window are inert: no res, no state change, the session continues', () => {
    const h = mkHarness()
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    const before = h.sent.length
    h.session.onItem(msg({ type: 'ack', id: 'a', bytes: 4096 }))
    h.session.onItem(msg({ type: 'window', size: 65536 }))
    expect(h.sent.length).toBe(before) // nothing emitted for reserved frames
    req(h, CH.ptyWrite, { id: 'a', data: 'echo still-alive\n' }, 2)
    expect(dataText(h, 'a')).toContain('still-alive')
    expect(h.exits).toEqual([])
  })

  it('post-handshake hello/res/evt are ignored with a diagnostic naming the type', () => {
    const h = mkHarness()
    establish(h)
    const wrongDirection: WireFrame[] = [
      clientHello(),
      { type: 'res', id: 1, ok: true, result: null },
      { type: 'evt', channel: 'pty:data', args: ['x', 'y'] }
    ]
    for (const frame of wrongDirection) {
      const before = h.sent.length
      const diagsBefore = h.diags.length
      h.session.onItem(msg(frame))
      expect(h.sent.length, `${frame.type} must produce no frame`).toBe(before)
      expect(h.diags.length, `${frame.type} must produce a diagnostic`).toBeGreaterThan(diagsBefore)
      expect(h.diags[h.diags.length - 1]).toContain(frame.type)
    }
    expect(h.exits).toEqual([])
  })

  it('a per-frame message-error is diagnosed and the session recovers', () => {
    const h = mkHarness()
    establish(h)
    h.session.onItem({ kind: 'message-error', error: { reason: 'bad-json', message: 'garbage bytes', detail: {} } })
    expect(h.exits).toEqual([])
    expect(h.diags.join('\n')).toContain('bad-json')
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    expect(resFor(h, 1)[0].ok).toBe(true)
  })

  it('a fatal decode item shuts the agent down with exit 1', () => {
    const h = mkHarness()
    establish(h)
    h.session.onItem({
      kind: 'fatal',
      error: { reason: 'frame-too-large', message: 'declares 9000000 bytes, over the limit', detail: {} }
    })
    expect(h.exits).toEqual([1])
    expect(h.diags.join('\n')).toContain('frame-too-large')
  })

  it('end of input kills every live pane and exits 0', () => {
    const s = spy(createFakePtyBackend())
    const h = mkHarness(s.backend)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('a'), 1)
    req(h, CH.ptySpawn, spawnArgs('b'), 2)
    h.session.endOfInput()
    expect(h.exits).toEqual([0])
    expect(s.kills.filter((k) => k > 0).length, 'both live panes must be killed on shutdown').toBe(2)
  })
})
