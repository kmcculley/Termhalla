// FROZEN test suite — feature 0019-agent-replay-session-survival (phase 4).
// REQ-004 (the session store survives a connection), REQ-008 (subscription routing),
// REQ-005 (store-composed lifecycle; the F20-retired single-connection bind guard — CONV-019:
// feature 0021-exclusive-attach-lease retires/supersedes that guard through its own tests
// phase), REQ-002(b) (no missed-event queue: detached output is reachable ONLY via the replay
// snapshot). Default-composition compatibility is guarded by F16's own frozen suites remaining
// green unmodified (REQ-001/REQ-005).
//
// 0021 sanctioned amendments (CONV-019 retirement path, through 0021's tests phase):
//  - the TEST-1905 bind-guard case now pins the lease STEAL (bind-while-bound displaces the
//    incumbent — full semantics in tests/agent-lease.test.ts); the original throw is retired.
//  - mkStub's handle gained pause/resume no-ops (TS2739 vs the 0018-widened AgentPtyHandle).
//
// All vectors run in-process with an injected scripted backend (the TEST drives pane output —
// this is how "agent-side output continues while detached" is exercised deterministically) and
// an injected fake replay factory where snapshot CONTENT is not the subject.
import { describe, it, expect } from 'vitest'
import { WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, DecodedItem } from '@shared/remote/protocol'
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import { createAgentSession } from '../src/agent/session'
import { createSessionStore } from '../src/agent/session-store'
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from '../src/agent/pty-backend'

const VERSION = '1.2.3'

// ── scripted backend the test drives ─────────────────────────────────────────────────────────
interface StubPane {
  opts: AgentSpawnOpts
  writes: string[]
  resizes: Array<[number, number]>
  kills: number
  alive: boolean
  dataCb: ((d: string) => void) | null
  exitCb: ((c: number) => void) | null
}

const mkStub = () => {
  const panes = new Map<string, StubPane>()
  const spawns: AgentSpawnOpts[] = []
  const backend: AgentPtyBackend = {
    spawn(opts: AgentSpawnOpts): AgentPtyHandle {
      const p: StubPane = { opts, writes: [], resizes: [], kills: 0, alive: true, dataCb: null, exitCb: null }
      panes.set(opts.id, p)
      spawns.push(opts)
      return {
        write: (d) => p.writes.push(d),
        resize: (c, r) => p.resizes.push([c, r]),
        kill: () => { p.kills++; if (p.alive) { p.alive = false; p.exitCb?.(0) } },
        // 0021 sanctioned amendment (type-only): pause/resume no-ops vs the 0018-widened
        // AgentPtyHandle (TS2739 housekeeping routed to F20's tests phase).
        pause: () => {}, resume: () => {},
        onData: (cb) => { p.dataCb = cb },
        onExit: (cb) => { p.exitCb = cb }
      }
    }
  }
  return {
    backend,
    spawns,
    pane: (id: string) => panes.get(id)!,
    emit: (id: string, data: string) => { const p = panes.get(id); if (p?.alive) p.dataCb?.(data) },
    exit: (id: string, code: number) => { const p = panes.get(id); if (p?.alive) { p.alive = false; p.exitCb?.(code) } },
    totalKills: () => [...panes.values()].reduce((n, p) => n + p.kills, 0)
  }
}

// ── fake replay factory (content = concatenation; deterministic) ─────────────────────────────
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

// ── connection harness (store composition) ───────────────────────────────────────────────────
interface Conn {
  session: ReturnType<typeof createAgentSession>
  sent: WireFrame[]
  diags: string[]
  exits: number[]
}

const mkConn = (store: ReturnType<typeof createSessionStore>, sendImpl?: (f: WireFrame, sent: WireFrame[]) => void): Conn => {
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
const establish = (h: Conn): void => h.session.onItem(msg({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: VERSION }))
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

const until = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const attachResult = async (h: Conn, paneId: string): Promise<ResFrame> => {
  const id = req(h, 'pty:attach', { id: paneId })
  await until(() => resFor(h, id).length > 0, `attach res for ${paneId}`)
  return resFor(h, id)[0]
}

const sessionsResult = async (h: Conn): Promise<ResFrame> => {
  const id = req(h, 'pty:sessions', null)
  await until(() => resFor(h, id).length > 0, 'sessions res')
  return resFor(h, id)[0]
}

describe('TEST-1903 REQ-004 the store survives the connection; caches; destroy; containment', () => {
  it('detach kills nothing; post-detach output reaches the replay and the caches', async () => {
    const stub = mkStub()
    const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/t', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p1'))
    req(a, CH.ptySpawn, spawnArgs('p2'))
    stub.emit('p1', 'one,')
    a.session.endOfInput()
    expect(a.exits).toEqual([0])
    expect(stub.totalKills(), 'detach must kill nothing (REQ-004)').toBe(0)
    expect(stub.pane('p1').alive && stub.pane('p2').alive).toBe(true)

    stub.emit('p1', 'two,')
    stub.emit('p1', '\x1b]9;9;/tmp/spot\x07') // cwd change while DETACHED
    stub.emit('p1', '\x1b]133;C\x07')         // busy while DETACHED

    const b = mkConn(store)
    establish(b)
    const res = await attachResult(b, 'p1')
    expect(res.ok).toBe(true)
    if (res.ok) {
      const r = res.result as { snapshot: string; cwd: string; status: { state: string } }
      expect(r.snapshot).toContain('one,')
      expect(r.snapshot, 'post-detach bytes are in the replay (survival substance)').toContain('two,')
      expect(r.cwd, 'cwd cache tracked the detached-phase OSC 9;9').toBe('/tmp/spot')
      expect(r.status.state, 'status cache tracked the detached-phase marker').toBe('busy')
    }
    store.destroy()
  })

  it('a client that never attaches gets NO events for detached-phase output (REQ-002b)', async () => {
    const stub = mkStub()
    const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/t', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p1'))
    a.session.endOfInput()
    stub.emit('p1', 'missed-while-away')

    const b = mkConn(store)
    establish(b)
    stub.emit('p1', 'still-not-subscribed')
    const evtFrames = b.sent.filter((f) => f.type === 'evt')
    expect(evtFrames, 'no queued or live frames before attach/adopt').toEqual([])
    store.destroy()
  })

  it('exit while detached prunes; the id is fresh-spawnable again', async () => {
    const stub = mkStub()
    const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/t', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p1'))
    req(a, CH.ptySpawn, spawnArgs('p2'))
    a.session.endOfInput()

    stub.exit('p2', 3) // dies while nobody is connected

    const b = mkConn(store)
    establish(b)
    const inv = await sessionsResult(b)
    expect(inv.ok).toBe(true)
    if (inv.ok) expect((inv.result as Array<{ id: string }>).map((e) => e.id)).toEqual(['p1'])
    const respawn = req(b, CH.ptySpawn, spawnArgs('p2'))
    expect(resFor(b, respawn)[0]).toMatchObject({ ok: true, result: false }) // FRESH, not adopt
    store.destroy()
  })

  it('destroy() is idempotent and kills each live pane exactly once', async () => {
    const stub = mkStub()
    const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/t', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p1'))
    req(a, CH.ptySpawn, spawnArgs('p2'))
    a.session.endOfInput()

    store.destroy()
    store.destroy()
    expect(stub.pane('p1').kills).toBe(1)
    expect(stub.pane('p2').kills).toBe(1)
    expect(fr.instances.every((i) => i.disposed >= 1), 'replays disposed on destroy').toBe(true)
  })

  it('a replay failure never tears down the pane; attach on it is internal; others work', async () => {
    const stub = mkStub()
    let made = 0
    const factory = (_opts: { cols: number; rows: number; scrollback: number }) => {
      const idx = made++
      const fed: string[] = []
      return {
        feed: (d: string) => { if (idx === 1) throw new Error('replay boom'); fed.push(d) },
        resize: () => {},
        snapshot: async () => fed.join(''),
        dispose: () => {}
      }
    }
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/t', replayFactory: factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('good'))
    req(a, CH.ptySpawn, spawnArgs('bad'))
    stub.emit('bad', 'this throws inside the replay')
    stub.emit('good', 'fine')

    // the pane LIVES on: write still round-trips and data still flows to the subscribed client
    const w = req(a, CH.ptyWrite, { id: 'bad', data: 'still-alive' })
    expect(resFor(a, w)[0]?.ok).toBe(true)
    expect(stub.pane('bad').writes).toEqual(['still-alive'])
    expect(evts(a, CH.ptyData, 'bad').length, 'data keeps flowing despite the broken replay').toBeGreaterThan(0)

    const broken = await attachResult(a, 'bad')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.error.code).toBe('internal')
    const fine = await attachResult(a, 'good')
    expect(fine.ok).toBe(true)
    if (fine.ok) expect((fine.result as { snapshot: string }).snapshot).toBe('fine')
    store.destroy()
  })
})

describe('TEST-1904 REQ-008 subscription routing: spawn/adopt/attach gate every push', () => {
  it('routes data/status only to subscribed panes; adopt does not replay history', async () => {
    const stub = mkStub()
    const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/t', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('a'))
    req(a, CH.ptySpawn, spawnArgs('b'))
    stub.emit('b', 'history-before-detach')
    a.session.endOfInput()

    const b = mkConn(store)
    establish(b)
    await attachResult(b, 'a')
    stub.emit('a', 'for-a')
    stub.emit('b', 'for-b')
    expect(evts(b, CH.ptyData, 'a').map((e) => e.args[1])).toEqual(['for-a'])
    expect(evts(b, CH.ptyData, 'b'), 'unsubscribed pane pushes nothing').toEqual([])
    expect(evts(b, CH.ptyStatus, 'b')).toEqual([])

    const adopt = req(b, CH.ptySpawn, spawnArgs('b'))
    expect(resFor(b, adopt)[0]).toMatchObject({ ok: true, result: true })
    expect(stub.spawns.length, 'adopt never respawns').toBe(2)
    stub.emit('b', 'post-adopt')
    const bData = evts(b, CH.ptyData, 'b').map((e) => e.args[1])
    expect(bData, 'adopt does NOT replay history — pty:attach is the replay verb').toEqual(['post-adopt'])
    store.destroy()
  })

  it('subscribed exit: final status (lastExit) precedes pty:exit, exactly once', async () => {
    const stub = mkStub()
    const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/t', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('a'))
    stub.exit('a', 5)

    const exits = evts(a, CH.ptyExit, 'a')
    expect(exits.length, 'exactly one pty:exit').toBe(1)
    expect(exits[0].args).toEqual(['a', 5])
    const statusWithExit = a.sent.findIndex((f) =>
      f.type === 'evt' && f.channel === CH.ptyStatus && f.args[0] === 'a' &&
      (f.args[1] as { lastExit?: string }).lastExit === 'failure')
    const exitIdx = a.sent.findIndex((f) => f.type === 'evt' && f.channel === CH.ptyExit && f.args[0] === 'a')
    expect(statusWithExit, 'a lastExit status flows out').toBeGreaterThanOrEqual(0)
    expect(statusWithExit, 'status-with-lastExit precedes pty:exit (F16 order preserved)').toBeLessThan(exitIdx)
    store.destroy()
  })

  it('unsubscribed exit is silent: no frame, pruned from the next inventory', async () => {
    const stub = mkStub()
    const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/t', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('a'))
    req(a, CH.ptySpawn, spawnArgs('b'))
    a.session.endOfInput()

    const b = mkConn(store)
    establish(b)
    stub.exit('b', 0)
    expect(evts(b, CH.ptyExit), 'no exit frame for an unsubscribed pane').toEqual([])
    const inv = await sessionsResult(b)
    if (inv.ok) expect((inv.result as Array<{ id: string }>).map((e) => e.id)).toEqual(['a'])
    store.destroy()
  })
})

describe('TEST-1905 REQ-005 store-composed lifecycle: every end path detaches; bind guard; destroy', () => {
  const spawnOne = (store: ReturnType<typeof createSessionStore>): Conn => {
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p1'))
    return a
  }

  it('clean EOF detaches: exit 0, zero kills, store re-bindable', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = spawnOne(store)
    a.session.endOfInput()
    expect(a.exits).toEqual([0])
    expect(stub.totalKills()).toBe(0)
    const b = mkConn(store)
    expect(() => establish(b)).not.toThrow()
    store.destroy()
  })

  it('fatal decode item detaches: exit 1, zero kills, store re-bindable', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = spawnOne(store)
    a.session.onItem({ kind: 'fatal', error: { reason: 'frame-too-large', message: 'too big', detail: {} } })
    expect(a.exits).toEqual([1])
    expect(stub.totalKills(), 'fatal ends the CONNECTION, never the panes (survival)').toBe(0)
    const b = mkConn(store)
    expect(() => establish(b)).not.toThrow()
    store.destroy()
  })

  it('a failed handshake on a later connection leaves surviving panes untouched', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = spawnOne(store)
    a.session.endOfInput()

    const bad = mkConn(store)
    bad.session.onItem(msg({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: '9.9.9' }))
    expect(bad.exits).toEqual([1])
    expect(stub.totalKills()).toBe(0)
    const ok = mkConn(store)
    expect(() => establish(ok)).not.toThrow()
    store.destroy()
  })

  it('a throwing send is a connection death: exit 1, panes alive, store re-bindable', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store, (f, sent) => {
      if (f.type === 'evt') throw new Error('broken pipe')
      sent.push(f)
    })
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('p1'))
    stub.emit('p1', 'this evt send throws')
    expect(a.exits).toEqual([1])
    expect(stub.totalKills()).toBe(0)
    const b = mkConn(store)
    expect(() => establish(b)).not.toThrow()
    store.destroy()
  })

  it('binding while another connection is bound STEALS the lease (0021 amendment; was: throws naming F20)', () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = mkConn(store)
    establish(a)
    const b = mkConn(store)
    expect(() => establish(b), 'the single-connection guard is retired').not.toThrow()
    // The displaced connection's FINAL frame is the revocation evt; it exits 0 (orderly).
    // (The literal — not the constant — keeps this frozen file import-independent of the
    // 0021 surface; identity of literal↔constant is pinned by tests/agent-lease-vocab.test.ts.)
    const revs = a.sent.filter((f): f is EvtFrame => f.type === 'evt' && f.channel === 'lease:revoked')
    expect(revs.length).toBe(1)
    expect(a.sent[a.sent.length - 1]).toBe(revs[0])
    expect(a.exits).toEqual([0])
    expect(stub.totalKills(), 'a steal kills nothing (panes survive)').toBe(0)
    store.destroy()
  })

  it('after destroy() a new connection sees an empty inventory', async () => {
    const stub = mkStub(); const fr = mkFakeReplays()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', replayFactory: fr.factory })
    const a = spawnOne(store)
    a.session.endOfInput()
    store.destroy()
    const b = mkConn(store)
    establish(b)
    const inv = await sessionsResult(b)
    expect(inv.ok).toBe(true)
    if (inv.ok) expect(inv.result).toEqual([])
  })
})
