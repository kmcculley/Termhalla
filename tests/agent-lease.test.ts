// FROZEN test suite — feature 0021-exclusive-attach-lease (phase 4).
// The agent-side exclusive-attach lease (locked decision 5, tmux `attach -d` semantics):
// REQ-002 (exactly one holder; grant/release; holder-scoped release), REQ-003 (steal:
// displace → notify → grant, identity-blind, contained callback), REQ-004 (`lease:revoked`
// is the loser's FINAL frame; exit 0; best-effort containment; post-revocation silence),
// REQ-005 (the F17×F18 weld preserved across a steal), REQ-006 (in-flight attach work
// settles inert; no agent-side byte loss), REQ-007 (deterministic total order; steal-back;
// run-twice determinism), REQ-009 (the winner is an ordinary connection), REQ-010(a) (the
// owned composition never steals).
//
// All vectors run in-process over the survival composition (the F18 harness): injected
// scripted backends where the TEST drives output, the deterministic fake pseudo-shell +
// REAL replay where byte-exactness is the subject, and a test-controlled snapshot barrier
// where in-flight attach interleavings are the subject.
import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WIRE_PROTO, createFrameDecoder, encodeFrame } from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, DecodedItem } from '@shared/remote/protocol'
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import { AGENT_LEASE_REVOKED_EVT, type AgentAttachResult, type AgentSessionInfo } from '@shared/remote-agent-api'
import { createAgentSession } from '../src/agent/session'
import { createSessionStore, type BoundClient } from '../src/agent/session-store'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from '../src/agent/pty-backend'

const VERSION = '1.2.3'
const SCROLLBACK = 50

// ── scripted backend the test drives (the F18 harness stub, pause/resume-aware) ─────────────
interface StubPane {
  opts: AgentSpawnOpts
  writes: string[]
  kills: number
  alive: boolean
  paused: boolean
  queued: string[]
  seq: string[] // pause/resume call log
  resumeThrows: boolean
  dataCb: ((d: string) => void) | null
  exitCb: ((c: number) => void) | null
}

const mkStub = () => {
  const panes = new Map<string, StubPane>()
  const backend: AgentPtyBackend = {
    spawn(opts: AgentSpawnOpts): AgentPtyHandle {
      const p: StubPane = {
        opts, writes: [], kills: 0, alive: true, paused: false, queued: [], seq: [],
        resumeThrows: false, dataCb: null, exitCb: null
      }
      panes.set(opts.id, p)
      return {
        write: (d) => p.writes.push(d),
        resize: () => {},
        kill: () => { p.kills++; if (p.alive) { p.alive = false; p.exitCb?.(0) } },
        pause: () => { p.seq.push('pause'); p.paused = true },
        resume: () => {
          p.seq.push('resume')
          if (p.resumeThrows) throw new Error('scripted resume failure')
          p.paused = false
          const q = p.queued; p.queued = []
          for (const d of q) if (p.alive) p.dataCb?.(d)
        },
        onData: (cb) => { p.dataCb = cb },
        onExit: (cb) => { p.exitCb = cb }
      }
    }
  }
  return {
    backend,
    pane: (id: string) => panes.get(id)!,
    emit: (id: string, data: string) => {
      const p = panes.get(id)
      if (!p?.alive) return
      if (p.paused) { p.queued.push(data); return }
      p.dataCb?.(data)
    },
    exit: (id: string, code: number) => { const p = panes.get(id); if (p?.alive) { p.alive = false; p.exitCb?.(code) } },
    totalKills: () => [...panes.values()].reduce((n, p) => n + p.kills, 0)
  }
}

// ── fake replay factory (content = concatenation; deterministic; feed-recording) ────────────
const mkFakeReplays = () => {
  const instances: Array<{ fed: string[]; disposed: number }> = []
  const factory = (_opts: { cols: number; rows: number; scrollback: number }) => {
    const inst = { fed: [] as string[], disposed: 0 }
    instances.push(inst)
    return {
      feed: (d: string) => { inst.fed.push(d) },
      resize: (_c: number, _r: number) => {},
      snapshot: async () => inst.fed.join(''),
      dispose: () => { inst.disposed++ }
    }
  }
  return { instances, factory }
}

// ── controlled-barrier replay factory (in-flight attach interleavings) ──────────────────────
const mkBarrierReplays = () => {
  const releases: Array<(s: string) => void> = []
  const instances: Array<{ fed: string[] }> = []
  const factory = (_opts: { cols: number; rows: number; scrollback: number }) => {
    const inst = { fed: [] as string[] }
    instances.push(inst)
    return {
      feed: (d: string) => { inst.fed.push(d) },
      resize: () => {},
      snapshot: () => new Promise<string>((r) => { releases.push(r) }),
      dispose: () => {}
    }
  }
  return { releases, instances, factory }
}

// ── connection harness (survival composition) ───────────────────────────────────────────────
interface Conn {
  session: ReturnType<typeof createAgentSession>
  sent: WireFrame[]
  diags: string[]
  exits: number[]
}

const mkConn = (
  store: ReturnType<typeof createSessionStore>,
  sendImpl?: (f: WireFrame, sent: WireFrame[]) => void
): Conn => {
  const sent: WireFrame[] = []
  const diags: string[] = []
  const exits: number[] = []
  const session = createAgentSession({
    version: VERSION,
    sessions: store,
    send: (f) => { if (sendImpl) sendImpl(f, sent); else sent.push(f) },
    diag: (t) => diags.push(t),
    shutdown: (c) => exits.push(c)
  })
  session.start()
  return { session, sent, diags, exits }
}

const msg = (frame: WireFrame): DecodedItem => ({ kind: 'message', frame })
const establish = (h: Conn): void =>
  h.session.onItem(msg({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: VERSION }))
let nextId = 1
const req = (h: Conn, method: string, params: unknown, id = nextId++): number => {
  h.session.onItem(msg({ type: 'req', id, method, params }))
  return id
}
const spawnArgs = (id: string, over: Partial<PtySpawnArgs> = {}): PtySpawnArgs =>
  ({ id, shellId: 'default', cwd: '/home/u', cols: 40, rows: 6, ...over })
const resFor = (h: Conn, id: number): ResFrame[] =>
  h.sent.filter((f): f is ResFrame => f.type === 'res' && f.id === id)
const evts = (h: Conn, channel: string, paneId?: string): EvtFrame[] =>
  h.sent.filter((f): f is EvtFrame => f.type === 'evt' && f.channel === channel &&
    (paneId === undefined || f.args[0] === paneId))
const dataPayloads = (h: Conn, paneId: string): string[] =>
  evts(h, CH.ptyData, paneId).map((e) => String(e.args[1]))
const leaseEvts = (h: Conn): EvtFrame[] =>
  h.sent.filter((f): f is EvtFrame => f.type === 'evt' && f.channel === AGENT_LEASE_REVOKED_EVT)

const until = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}
const awaitRes = async (h: Conn, id: number, what: string): Promise<ResFrame> => {
  await until(() => resFor(h, id).length > 0, what)
  return resFor(h, id)[0]
}
const attach = async (h: Conn, paneId: string): Promise<ResFrame> =>
  awaitRes(h, req(h, 'pty:attach', { id: paneId }), `attach res for ${paneId}`)
const sessions = async (h: Conn): Promise<ResFrame> =>
  awaitRes(h, req(h, 'pty:sessions', null), 'sessions res')

/** The loser's contract, asserted everywhere: exactly one revocation evt, as the FINAL frame,
 *  exit code 0. */
const expectDisplaced = (h: Conn): void => {
  const revs = leaseEvts(h)
  expect(revs.length, 'exactly one lease:revoked evt').toBe(1)
  expect(revs[0].args, 'the revocation evt carries an empty args array').toEqual([])
  expect(h.sent[h.sent.length - 1], 'the revocation evt is the FINAL frame').toBe(revs[0])
  expect(h.exits, 'a displaced connection ends with exit code 0 (orderly)').toEqual([0])
}

/** Reference serialization with the replay's option parity ({cols, rows, scrollback, proposed}). */
const referenceSerialize = async (chunks: string[], cols: number, rows: number): Promise<string> => {
  const term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
  const addon = new SerializeAddon()
  term.loadAddon(addon as unknown as Parameters<Terminal['loadAddon']>[0])
  for (const c of chunks) await new Promise<void>((r) => term.write(c, r))
  const out = addon.serialize()
  term.dispose()
  return out
}

/** The golden full stream: the same script driven directly on a fresh fake handle. */
const golden = (writes: string[]): string[] => {
  const handle = createFakePtyBackend().spawn({ id: 'g', cwd: '/home/u', cols: 40, rows: 6, shellId: 'default' })
  const out: string[] = []
  handle.onData((d) => out.push(d))
  for (const w of writes) handle.write(w)
  return out
}

describe('TEST-2101 REQ-002 grant and voluntary release are unchanged; exactly one holder', () => {
  it('a voluntary release (clean EOF) emits NO revocation evt and the store re-binds fresh', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    a.session.endOfInput()
    expect(a.exits).toEqual([0])
    expect(leaseEvts(a).length, 'voluntary release is not a displacement').toBe(0)
    const b = mkConn(store)
    expect(() => establish(b)).not.toThrow()
    expect(stub.totalKills()).toBe(0)
    store.destroy()
  })

  it('after a steal, pane events grow exactly one connection log (the holder\'s)', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    stub.emit('p', 'to-a,')
    const b = mkConn(store)
    establish(b) // the steal
    await attach(b, 'p')
    const aLen = a.sent.length
    stub.emit('p', 'to-b,')
    expect(a.sent.length, 'the displaced log never grows again').toBe(aLen)
    expect(dataPayloads(b, 'p').join('')).toContain('to-b,')
    expect(dataPayloads(a, 'p').join('')).not.toContain('to-b,')
    store.destroy()
  })
})

describe('TEST-2102 REQ-003 the steal: displace, notify, grant — in order, atomically', () => {
  it('bind-while-bound no longer throws; the loser gets the evt after its last pane frame; steal-gap bytes route to nobody', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    stub.emit('p', 'pre-steal,')
    expect(dataPayloads(a, 'p').join('')).toContain('pre-steal,')

    const b = mkConn(store)
    expect(() => establish(b), 'the guard is retired — binding while bound steals').not.toThrow()
    expectDisplaced(a)

    // Bytes emitted between the displacement and the winner's attach route to NOBODY as
    // frames — they are reachable only via the replay history.
    stub.emit('p', 'steal-gap,')
    expect(dataPayloads(a, 'p').join('')).not.toContain('steal-gap,')
    expect(dataPayloads(b, 'p').length, 'the winner is not subscribed until it attaches').toBe(0)

    const res = await attach(b, 'p')
    expect(res.ok).toBe(true)
    if (res.ok) {
      const snap = (res.result as AgentAttachResult).snapshot
      expect(snap, 'pre-steal bytes are in the winner\'s snapshot').toContain('pre-steal,')
      expect(snap, 'steal-gap bytes are in the winner\'s snapshot').toContain('steal-gap,')
    }
    expect(stub.totalKills(), 'a steal kills nothing').toBe(0)
    store.destroy()
  })

  it('a throwing onLeaseRevoked is contained: diagnosed, the grant proceeds (raw store)', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const diags: string[] = []
    const store = createSessionStore({
      backend: stub.backend, homeDir: '/h', replayFactory: fr.factory, diag: (t) => diags.push(t)
    })
    const aFrames: WireFrame[] = []
    const clientA: BoundClient = {
      send: (f) => aFrames.push(f),
      onSendFailure: () => {},
      onLeaseRevoked: () => { throw new Error('handler exploded') }
    }
    const bFrames: WireFrame[] = []
    const clientB: BoundClient = {
      send: (f) => bFrames.push(f),
      onSendFailure: () => {},
      onLeaseRevoked: () => {}
    }
    store.bind(clientA)
    store.spawn(spawnArgs('p'))
    stub.emit('p', 'x')
    expect(aFrames.some((f) => f.type === 'evt' && f.channel === CH.ptyData)).toBe(true)

    expect(() => store.bind(clientB), 'the throw is contained inside bind').not.toThrow()
    expect(diags.some((d) => d.includes('handler exploded')), 'the failure is diagnosed').toBe(true)
    // The grant proceeded: B is the holder and is served.
    store.spawn(spawnArgs('q'))
    stub.emit('q', 'to-b')
    expect(bFrames.some((f) => f.type === 'evt' && f.channel === CH.ptyData && (f as EvtFrame).args[0] === 'q')).toBe(true)
    store.destroy()
  })

  it('identity-blind: re-binding the currently bound client displaces-then-regrants it (raw store)', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    let revoked = 0
    const frames: WireFrame[] = []
    const client: BoundClient = {
      send: (f) => frames.push(f),
      onSendFailure: () => {},
      onLeaseRevoked: () => { revoked++ }
    }
    store.bind(client)
    store.spawn(spawnArgs('p'))
    expect(() => store.bind(client)).not.toThrow()
    expect(revoked, 'the incumbent — even itself — is displaced exactly once').toBe(1)
    // The regrant holds: a fresh spawn subscribes and routes to the (re)bound client.
    store.spawn(spawnArgs('q'))
    stub.emit('q', 'post-regrant')
    expect(frames.some((f) => f.type === 'evt' && f.channel === CH.ptyData && (f as EvtFrame).args[0] === 'q')).toBe(true)
    // The displacement cleared the OLD subscription (the lease is fresh, not resumed).
    stub.emit('p', 'old-subscription')
    expect(frames.some((f) => f.type === 'evt' && f.channel === CH.ptyData && (f as EvtFrame).args[0] === 'p')).toBe(false)
    store.destroy()
  })

  it('a destroyed store still answers, and binding it never throws (uniformity)', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    store.destroy()
    const a = mkConn(store)
    expect(() => establish(a)).not.toThrow()
    const ra = await sessions(a)
    expect(ra.ok).toBe(true)
    if (ra.ok) expect(ra.result).toEqual([])
    const b = mkConn(store)
    expect(() => establish(b), 'bind-while-bound on a destroyed store steals, never throws').not.toThrow()
    expectDisplaced(a)
    const rb = await sessions(b)
    expect(rb.ok).toBe(true)
    if (rb.ok) expect(rb.result).toEqual([])
    store.destroy() // idempotent
  })
})

describe('TEST-2103 REQ-004 the revocation notification: final frame, exit 0, containment, silence', () => {
  it('post-revocation reqs get no res; a late endOfInput no-ops', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    const b = mkConn(store)
    establish(b)
    expectDisplaced(a)

    const lateReq = req(a, 'pty:sessions', null)
    await sessions(b) // give any (wrong) async settlement a chance to land
    expect(resFor(a, lateReq).length, 'an ended connection answers nothing').toBe(0)
    expectDisplaced(a) // still exactly one evt, still the final frame

    a.session.endOfInput()
    expect(a.exits, 'a late EOF after displacement no-ops').toEqual([0])
    store.destroy()
  })

  it('a send that throws ON the revocation evt: diagnosed, exit 0, winner unaffected', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store, (f, sent) => {
      if (f.type === 'evt' && f.channel === AGENT_LEASE_REVOKED_EVT) throw new Error('sink died first')
      sent.push(f)
    })
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    const b = mkConn(store)
    expect(() => establish(b)).not.toThrow()
    expect(a.exits, 'the loser still ends with exit code 0').toEqual([0])
    expect(a.diags.some((d) => d.includes('lease')), 'the delivery failure is diagnosed').toBe(true)
    expect(leaseEvts(a).length, 'the evt never reached the dead sink').toBe(0)
    // The winner is fully served regardless.
    const res = await attach(b, 'p')
    expect(res.ok).toBe(true)
    stub.emit('p', 'winner-data')
    expect(dataPayloads(b, 'p').join('')).toContain('winner-data')
    store.destroy()
  })

  it('the revocation evt round-trips F15\'s strict framing', () => {
    const frame: WireFrame = { type: 'evt', channel: AGENT_LEASE_REVOKED_EVT, args: [] }
    const decoder = createFrameDecoder()
    const items = decoder.push(Buffer.from(encodeFrame(frame)))
    expect(items.length).toBe(1)
    expect(items[0].kind).toBe('message')
    if (items[0].kind === 'message') expect(items[0].frame).toEqual(frame)
  })
})

describe('TEST-2104 REQ-002(c) holder-scoped release: a displaced connection cannot detach the winner', () => {
  it('every late loser end-path leaves the winner bound, subscribed, and served', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    const b = mkConn(store)
    establish(b)
    expectDisplaced(a)
    await attach(b, 'p')

    // Late loser activity, every shape it can take on an ended session:
    a.session.endOfInput()
    a.session.onItem({ kind: 'fatal', error: { reason: 'frame-too-large', message: 'late', detail: {} } })
    a.session.onItem(msg({ type: 'req', id: 999001, method: 'pty:sessions', params: null }))
    expect(a.exits, 'no second shutdown').toEqual([0])

    // The winner's binding and subscription survived it all.
    stub.emit('p', 'still-bound')
    expect(dataPayloads(b, 'p').join('')).toContain('still-bound')
    const inv = await sessions(b)
    expect(inv.ok).toBe(true)
    if (inv.ok) expect((inv.result as AgentSessionInfo[])[0].attached).toBe(true)
    store.destroy()
  })
})

describe('TEST-2105 REQ-005 the F17×F18 weld across a steal: resume into replay; fresh window', () => {
  it('a pane paused by the loser\'s stall resumes during the steal; the backlog feeds replay only', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    stub.emit('p', 'seed,') // the gate tracks a pane on first emission (F17 D4: windows for untracked panes are ignored)
    a.session.onItem(msg({ type: 'window', size: 10, id: 'p' })) // tiny per-pane window
    stub.emit('p', 'x'.repeat(11)) // 5+11 units cross the window: paused, synchronously
    expect(stub.pane('p').seq).toEqual(['pause'])
    stub.emit('p', 'queued-under-pause') // queues inside the (scripted) backend

    const b = mkConn(store)
    establish(b) // the steal
    expect(stub.pane('p').seq, 'exactly one resume, during the steal').toEqual(['pause', 'resume'])
    expectDisplaced(a)
    // The flushed backlog went to NOBODY as frames…
    expect(dataPayloads(a, 'p').join('')).not.toContain('queued-under-pause')
    expect(dataPayloads(b, 'p').length).toBe(0)
    // …but into the replay history, where the winner's attach finds it.
    const res = await attach(b, 'p')
    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as AgentAttachResult).snapshot).toContain('queued-under-pause')
    store.destroy()
  })

  it('the winner starts a fresh gate: the loser\'s per-pane window override is forgotten', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    stub.emit('p', 'seed,') // track the pane first (F17 D4)
    a.session.onItem(msg({ type: 'window', size: 10, id: 'p' }))
    stub.emit('p', 'y'.repeat(11))
    expect(stub.pane('p').seq).toEqual(['pause'])

    const b = mkConn(store)
    establish(b)
    await attach(b, 'p')
    // 200 units would have re-paused under the loser's 10-unit override; the default window
    // (1 MiB) absorbs it silently — the override died with the loser's connection.
    stub.emit('p', 'z'.repeat(200))
    expect(stub.pane('p').seq, 'no pause under the winner\'s fresh default window').toEqual(['pause', 'resume'])
    expect(dataPayloads(b, 'p').join('')).toContain('z'.repeat(200))
    store.destroy()
  })

  it('a resume that throws during the steal is contained: diagnosed, the winner binds and is served', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const diags: string[] = []
    const store = createSessionStore({
      backend: stub.backend, homeDir: '/h', replayFactory: fr.factory, diag: (t) => diags.push(t)
    })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    stub.emit('p', 'seed,') // track the pane first (F17 D4)
    a.session.onItem(msg({ type: 'window', size: 10, id: 'p' }))
    stub.emit('p', 'w'.repeat(11))
    expect(stub.pane('p').seq).toEqual(['pause'])
    stub.pane('p').resumeThrows = true

    const b = mkConn(store)
    expect(() => establish(b), 'a throwing resume never breaks the steal').not.toThrow()
    expectDisplaced(a)
    expect(diags.some((d) => d.includes('resume')), 'the resume failure is diagnosed').toBe(true)
    stub.pane('p').resumeThrows = false
    const res = await attach(b, 'p')
    expect(res.ok).toBe(true)
    store.destroy()
  })
})

describe('TEST-2106 REQ-006 in-flight attach work settles inert across a steal', () => {
  it('the loser\'s pending attach yields no res and no held bytes; the winner\'s attach is undisturbed', async () => {
    const stub = mkStub()
    const br = mkBarrierReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: br.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    const attachId = req(a, 'pty:attach', { id: 'p' }) // barrier pending
    stub.emit('p', 'held-for-a') // rides the open hold window
    await until(() => br.releases.length === 1, 'the loser\'s snapshot barrier')

    const b = mkConn(store)
    establish(b) // the steal, while A's snapshot is in flight
    expectDisplaced(a)
    br.releases[0]('stale-snapshot') // the loser's barrier settles AFTER displacement

    await sessions(b) // let any wrong settlement land
    expect(resFor(a, attachId).length, 'the displaced attach yields NO res').toBe(0)
    expect(dataPayloads(a, 'p').join('')).not.toContain('held-for-a')
    expectDisplaced(a) // the evt is still the final frame — held bytes never followed it

    // The held bytes fed the replay at emission — nothing was lost agent-side…
    expect(br.instances[0].fed.join('')).toContain('held-for-a')
    // …and the winner's own attach opens a FRESH window, undisturbed by the stale release.
    const winnerAttachId = req(b, 'pty:attach', { id: 'p' })
    await until(() => br.releases.length === 2, 'the winner\'s snapshot barrier')
    stub.emit('p', 'held-for-b')
    br.releases[1]('winner-snapshot')
    const winnerRes = await awaitRes(b, winnerAttachId, 'the winner\'s attach res')
    expect(winnerRes.ok).toBe(true)
    if (winnerRes.ok) expect((winnerRes.result as AgentAttachResult).snapshot).toBe('winner-snapshot')
    const resIdx = b.sent.indexOf(winnerRes)
    const heldIdx = b.sent.findIndex((f) => f.type === 'evt' && f.channel === CH.ptyData && String((f as EvtFrame).args[1]).includes('held-for-b'))
    expect(heldIdx, 'the winner\'s held bytes drain AFTER its res (the window works)').toBeGreaterThan(resIdx)
    store.destroy()
  })

  it('overlap rejection still applies within the winner\'s connection; sequential re-attach works', async () => {
    const stub = mkStub()
    const br = mkBarrierReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: br.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    const b = mkConn(store)
    establish(b)

    const first = req(b, 'pty:attach', { id: 'p' })
    await until(() => br.releases.length === 1, 'the first barrier')
    const second = req(b, 'pty:attach', { id: 'p' })
    const overlap = await awaitRes(b, second, 'the overlapping attach res')
    expect(overlap.ok).toBe(false)
    if (!overlap.ok) expect(overlap.error.code, 'windows never coexist (F18 REQ-006)').toBe('internal')
    br.releases[0]('snap-1')
    const ok1 = await awaitRes(b, first, 'the first attach res')
    expect(ok1.ok).toBe(true)
    const third = req(b, 'pty:attach', { id: 'p' })
    await until(() => br.releases.length === 2, 'the sequential re-attach barrier')
    br.releases[1]('snap-2')
    const ok3 = await awaitRes(b, third, 'the sequential re-attach res')
    expect(ok3.ok).toBe(true)
    store.destroy()
  })
})

describe('TEST-2107 REQ-006(b) byte-exactness across the steal boundary (real replay oracle)', () => {
  it('winner snapshot ⊕ winner events ≡ the full agent-side stream, including the loser\'s never-delivered tail', async () => {
    const store = createSessionStore({ backend: createFakePtyBackend(), homeDir: '/home/t', scrollback: SCROLLBACK })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    await until(() => dataPayloads(a, 'p').join('').includes('fake$'), 'the spawn prompt')
    req(a, CH.ptyWrite, { id: 'p', data: 'echo before-steal\n' })
    await until(() => dataPayloads(a, 'p').join('').includes('before-steal'), 'pre-steal echo')

    // Open an attach window on the loser and write INTO it, then steal before the barrier
    // resolves: those bytes are held for a connection that will never see them.
    req(a, 'pty:attach', { id: 'p' })
    req(a, CH.ptyWrite, { id: 'p', data: 'echo held-tail\n' })
    const b = mkConn(store)
    establish(b) // synchronous steal — the loser's barrier has not resolved yet
    expectDisplaced(a)
    expect(dataPayloads(a, 'p').join(''), 'the loser never saw the held tail').not.toContain('held-tail')

    const res = await attach(b, 'p')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    req(b, CH.ptyWrite, { id: 'p', data: 'echo after-steal\n' })
    await until(() => dataPayloads(b, 'p').join('').includes('after-steal'), 'post-steal echo')

    const resIdx = b.sent.indexOf(res)
    const postRes = b.sent.slice(resIdx + 1)
      .filter((f): f is EvtFrame => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === 'p')
      .map((e) => String(e.args[1]))
    const composed = await referenceSerialize([(res.result as AgentAttachResult).snapshot, ...postRes], 40, 6)
    const full = golden(['echo before-steal\n', 'echo held-tail\n', 'echo after-steal\n'])
    const direct = await referenceSerialize(full, 40, 6)
    expect(composed, 'no byte lost, duplicated, or reordered across the steal').toBe(direct)
    store.destroy()
  })
})

describe('TEST-2108 REQ-007 deterministic resolution: total order, chains, steal-back, run-twice', () => {
  it('a steal chain A→B→C: one revocation each, in displacement order; C fully served', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    stub.emit('p', 'era-a,')

    const b = mkConn(store)
    establish(b)
    expectDisplaced(a)
    const c = mkConn(store)
    establish(c) // same-tick follow-up steal
    expectDisplaced(b)
    expect(leaseEvts(a).length, 'A was displaced exactly once, by B').toBe(1)

    stub.emit('p', 'era-c,')
    expect(dataPayloads(c, 'p').length, 'C is not subscribed until it attaches').toBe(0)
    const res = await attach(c, 'p')
    expect(res.ok).toBe(true)
    if (res.ok) {
      const snap = (res.result as AgentAttachResult).snapshot
      expect(snap).toContain('era-a,')
      expect(snap).toContain('era-c,')
    }
    stub.emit('p', 'live-c,')
    expect(dataPayloads(c, 'p').join('')).toContain('live-c,')
    expect(stub.totalKills()).toBe(0)
    store.destroy()
  })

  it('steal-back: the displaced client\'s fresh connection displaces the thief', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    stub.emit('p', 'first,')
    const thief = mkConn(store)
    establish(thief)
    expectDisplaced(a)
    await attach(thief, 'p')
    stub.emit('p', 'thief-era,')

    const aAgain = mkConn(store) // the same user, reconnecting — just another bind
    establish(aAgain)
    expectDisplaced(thief)
    const res = await attach(aAgain, 'p')
    expect(res.ok).toBe(true)
    if (res.ok) {
      const snap = (res.result as AgentAttachResult).snapshot
      expect(snap).toContain('first,')
      expect(snap, 'the thief-era bytes survived into the steal-back snapshot').toContain('thief-era,')
    }
    store.destroy()
  })

  it('the same scripted steal scenario twice yields identical per-connection logs', async () => {
    /** `since` is the status engine's wall-clock stamp (pre-existing, outside the lease
     *  surface) — normalized to 0 for the comparison; everything else must be byte-equal. */
    const norm = (frames: WireFrame[]): unknown =>
      JSON.parse(JSON.stringify(frames), (key, value) => (key === 'since' ? 0 : value))
    const run = async (): Promise<unknown> => {
      const stub = mkStub(); const fr = mkFakeReplays()
      const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
      const a = mkConn(store)
      establish(a)
      req(a, CH.ptySpawn, spawnArgs('p'), 990001)
      stub.emit('p', 'alpha,')
      const b = mkConn(store)
      establish(b)
      stub.emit('p', 'beta,')
      req(b, 'pty:attach', { id: 'p' }, 990002)
      await awaitRes(b, 990002, 'the deterministic attach res')
      stub.emit('p', 'gamma,')
      req(b, 'pty:sessions', null, 990003)
      await awaitRes(b, 990003, 'the deterministic sessions res')
      store.destroy()
      return { aSent: norm(a.sent), aExits: a.exits, bSent: norm(b.sent), bExits: b.exits }
    }
    const one = await run()
    const two = await run()
    expect(two).toEqual(one)
  })
})

describe('TEST-2109 REQ-009 post-steal service: the winner is an ordinary connection; the loser\'s view is a clean prefix', () => {
  it('the full two-client scenario', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('a1'))
    req(a, CH.ptySpawn, spawnArgs('b2'))
    await attach(a, 'a1')
    await attach(a, 'b2')
    stub.emit('a1', 'seen-by-a,')

    const b = mkConn(store)
    establish(b)
    expectDisplaced(a)
    stub.emit('a1', '\x1b]9;9;/tmp/spot\x07') // cwd moves while nobody holds a1's events

    const inv = await sessions(b)
    expect(inv.ok).toBe(true)
    if (inv.ok) {
      const entries = inv.result as AgentSessionInfo[]
      expect(entries.map((e) => e.id)).toEqual(['a1', 'b2'])
      expect(entries.every((e) => !e.attached), 'subscriptions never leak across a steal').toBe(true)
      expect(entries[0].cwd, 'post-steal metadata is current').toBe('/tmp/spot')
    }

    // Adopt (no history replay) + attach (snapshot-bearing) + write + kill all work.
    const adoptRes = await awaitRes(b, req(b, CH.ptySpawn, spawnArgs('a1')), 'the adopt res')
    expect(adoptRes.ok).toBe(true)
    if (adoptRes.ok) expect(adoptRes.result, 'live id → adopted').toBe(true)
    expect(dataPayloads(b, 'a1').length, 'adoption replays no history').toBe(0)
    const att = await attach(b, 'b2')
    expect(att.ok).toBe(true)
    req(b, CH.ptyWrite, { id: 'a1', data: 'typed-by-b' })
    expect(stub.pane('a1').writes).toContain('typed-by-b')
    req(b, CH.ptyKill, 'a1')
    expect(evts(b, CH.ptyExit, 'a1').length, 'the winner owns the pane fully').toBe(1)
    const inv2 = await sessions(b)
    if (inv2.ok) expect((inv2.result as AgentSessionInfo[]).map((e) => e.id), 'kill prunes store-wide').toEqual(['b2'])

    // The loser's view: a strict prefix of pane frames, then the revocation, then nothing.
    expect(dataPayloads(a, 'a1').join('')).toBe('seen-by-a,')
    expectDisplaced(a)
    store.destroy()
  })
})

describe('TEST-2113 REQ-002(c) FINDING-001 only the holder releases: a never-bound connection cannot strip the holder', () => {
  it('a concurrent failed-handshake connection leaves the holder bound, subscribed, and served', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))
    stub.emit('p', 'before,')
    expect(dataPayloads(a, 'p').join('')).toBe('before,')

    // C's hello is REJECTED (version mismatch): it never binds — its end must not release.
    const c = mkConn(store)
    c.session.onItem(msg({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: '9.9.9' }))
    expect(c.exits).toEqual([1])

    stub.emit('p', 'after,')
    expect(dataPayloads(a, 'p').join(''), 'the holder keeps receiving (FINDING-001)').toBe('before,after,')
    expect(leaseEvts(a).length, 'the holder was never displaced').toBe(0)
    const inv = await sessions(a)
    expect(inv.ok).toBe(true)
    if (inv.ok) expect((inv.result as AgentSessionInfo[])[0].attached, 'subscription intact').toBe(true)
    store.destroy()
  })

  it('a pre-hello EOF on a concurrent connection leaves the holder untouched', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))

    const d = mkConn(store) // hello sent by the agent; the client never answers
    d.session.endOfInput()
    expect(d.exits).toEqual([0])

    stub.emit('p', 'still-mine')
    expect(dataPayloads(a, 'p').join(''), 'the holder keeps receiving').toBe('still-mine')
    store.destroy()
  })
})

describe('TEST-2114 REQ-004(b) FINDING-002 nothing follows the revocation evt, even under a reentrant sink', () => {
  it('a sink that synchronously feeds a req back on seeing the evt gets no res after it', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    let self: Conn | null = null
    const a = mkConn(store, (f, sent) => {
      sent.push(f)
      if (f.type === 'evt' && f.channel === AGENT_LEASE_REVOKED_EVT && self) {
        // Pathological embedder: the outbound write synchronously pumps new INBOUND frames.
        self.session.onItem(msg({ type: 'req', id: 990201, method: 'pty:sessions', params: null }))
        self.session.onItem(msg({ type: 'req', id: 990202, method: CH.ptySpawn, params: spawnArgs('leak') }))
      }
    })
    self = a
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p'))

    const b = mkConn(store)
    establish(b) // the steal — the reentrant sink fires during A's revocation
    expectDisplaced(a) // the evt is STILL the final frame: no res, nothing, follows it
    expect(resFor(a, 990201).length, 'no res after revocation (FINDING-002)').toBe(0)
    // The reentrant spawn must not have leaked a subscription to the next holder: pane
    // "leak" was never created (the revoked connection dispatches nothing).
    stub.emit('leak', 'ghost')
    expect(evts(b, CH.ptyData, 'leak').length, 'no stale subscription leaks to the winner').toBe(0)
    store.destroy()
  })
})

describe('TEST-2115 REQ-007(a) FINDING-003 a nested bind during the revocation callback: newest wins', () => {
  it('the outer (older) bind self-displaces instead of clobbering the nested (newer) holder', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const framesC: WireFrame[] = []
    let cRevoked = 0
    const clientC: BoundClient = {
      send: (f) => framesC.push(f),
      onSendFailure: () => {},
      onLeaseRevoked: () => { cRevoked++ }
    }
    let aRevoked = 0
    const clientA: BoundClient = {
      send: () => {},
      onSendFailure: () => {},
      onLeaseRevoked: () => {
        aRevoked++
        store.bind(clientC) // the embedder reconnects synchronously inside the revocation
      }
    }
    let bRevoked = 0
    const clientB: BoundClient = {
      send: () => {},
      onSendFailure: () => {},
      onLeaseRevoked: () => { bRevoked++ }
    }
    store.bind(clientA)
    store.spawn(spawnArgs('p'))
    expect(() => store.bind(clientB), 'the reentrant steal is contained').not.toThrow()

    expect(aRevoked, 'A displaced exactly once').toBe(1)
    expect(cRevoked, 'C — the NEWEST bind — holds; it is never revoked').toBe(0)
    expect(bRevoked, 'B — the older outer bind — self-displaces (newest wins)').toBe(1)
    // C is the live holder: a fresh spawn subscribes and routes to C.
    store.spawn(spawnArgs('q'))
    stub.emit('q', 'to-c')
    expect(framesC.some((f) => f.type === 'evt' && f.channel === CH.ptyData && (f as EvtFrame).args[0] === 'q'),
      'the nested holder is served').toBe(true)
    store.destroy()
  })
})

describe('TEST-2110 REQ-010(a) the owned composition cannot steal and never emits the evt', () => {
  it('endOfInput still kills panes and exits 0; no lease frame ever appears', () => {
    const stub = mkStub()
    const sent: WireFrame[] = []
    const exits: number[] = []
    const session = createAgentSession({
      version: VERSION,
      backend: stub.backend,
      homeDir: '/home/test',
      send: (f) => sent.push(f),
      diag: () => {},
      shutdown: (c) => exits.push(c)
    })
    session.start()
    session.onItem(msg({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: VERSION }))
    session.onItem(msg({ type: 'req', id: 990101, method: CH.ptySpawn, params: spawnArgs('p') }))
    session.endOfInput()
    expect(exits).toEqual([0])
    expect(stub.totalKills(), 'the owned store dies with its one connection (F16)').toBe(1)
    expect(sent.some((f) => f.type === 'evt' && f.channel === AGENT_LEASE_REVOKED_EVT)).toBe(false)
  })
})
