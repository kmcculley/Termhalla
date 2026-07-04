// FROZEN test suite — feature 0019-agent-replay-session-survival (phase 4).
// REQ-006 (pty:attach), REQ-007 (pty:sessions), REQ-009 (vocabulary + six-method message).
// These vectors run the REAL replay path (@xterm/headless + serialize addon) behind the REAL
// scripted fake backend (F16's deterministic pseudo-shell), through createAgentSession over an
// external store — the wire shapes here are exactly what F21's client will consume.
import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, DecodedItem } from '@shared/remote/protocol'
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import {
  AGENT_ERROR_CODES, AGENT_PTY_METHODS, AGENT_SESSION_METHODS,
  type AgentAttachResult, type AgentSessionInfo
} from '@shared/remote-agent-api'
import { createAgentSession } from '../src/agent/session'
import { createSessionStore } from '../src/agent/session-store'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import { HISTORY_LIMIT_DEFAULT } from '../src/agent/replay'
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from '../src/agent/pty-backend'

const VERSION = '1.2.3'
const SCROLLBACK = 50

interface Conn {
  session: ReturnType<typeof createAgentSession>
  sent: WireFrame[]
  diags: string[]
  exits: number[]
}

const mkConn = (store: ReturnType<typeof createSessionStore>): Conn => {
  const sent: WireFrame[] = []
  const diags: string[] = []
  const exits: number[] = []
  const session = createAgentSession({
    version: VERSION,
    sessions: store,
    send: (f) => sent.push(f),
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
const dataPayloads = (h: Conn, paneId: string): string[] =>
  evts(h, CH.ptyData, paneId).map((e) => String(e.args[1]))

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

const mkFakeStore = (): ReturnType<typeof createSessionStore> =>
  createSessionStore({ backend: createFakePtyBackend(), homeDir: '/home/t', scrollback: SCROLLBACK })

describe('TEST-1906 REQ-006 pty:attach: params, result, races, ordering invariant', () => {
  it('returns the exact result shape with a reference-faithful snapshot and re-shaped status', async () => {
    const store = mkFakeStore()
    const h = mkConn(store)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('p'))
    await until(() => dataPayloads(h, 'p').join('').includes('fake$'), 'the spawn prompt')

    const first = await attach(h, 'p')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const r = first.result as AgentAttachResult
    expect(Object.keys(r).sort()).toEqual(['cols', 'cwd', 'rows', 'snapshot', 'status'])
    expect(r.cols).toBe(40)
    expect(r.rows).toBe(6)
    expect(r.cwd, 'non-empty spawn cwd is verbatim (F16 REQ-007)').toBe('/home/u')
    expect(r.status.state).toBe('idle')
    expect('lastExit' in r.status, 'no lastExit KEY before any command exit (F16 reshaping precedent)').toBe(false)
    // Snapshot equals the reference fed everything the subscribed client saw before the res.
    const resIdx = h.sent.indexOf(first)
    const preResData = h.sent.slice(0, resIdx)
      .filter((f): f is EvtFrame => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === 'p')
      .map((e) => String(e.args[1]))
    expect(r.snapshot).toBe(await referenceSerialize(preResData, 40, 6))
    store.destroy()
  })

  it('carries lastExit after a command completes; re-attach returns a FRESH snapshot', async () => {
    const store = mkFakeStore()
    const h = mkConn(store)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('p'))
    req(h, CH.ptyWrite, { id: 'p', data: 'echo first-pass\n' })
    await until(() => dataPayloads(h, 'p').join('').includes('first-pass'), 'first echo output')

    const one = await attach(h, 'p')
    expect(one.ok).toBe(true)
    const snapOne = one.ok ? (one.result as AgentAttachResult).snapshot : ''
    if (one.ok) expect((one.result as AgentAttachResult).status.lastExit, 'D;0 marker → success').toBe('success')
    expect(snapOne).toContain('first-pass')

    req(h, CH.ptyWrite, { id: 'p', data: 'echo second-pass\n' })
    await until(() => dataPayloads(h, 'p').join('').includes('second-pass'), 'second echo output')
    const two = await attach(h, 'p')
    expect(two.ok).toBe(true)
    if (two.ok) {
      const snapTwo = (two.result as AgentAttachResult).snapshot
      expect(snapTwo).toContain('second-pass')
      expect(snapTwo, 'the re-attach snapshot reflects bytes since the first').not.toBe(snapOne)
    }
    store.destroy()
  })

  it('rejects malformed params strictly, executing nothing', async () => {
    const store = mkFakeStore()
    const h = mkConn(store)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('p'))
    const vectors: Array<[unknown, string]> = [
      [null, 'params'],
      ['p', 'params'],
      [{ id: '' }, 'id'],
      [{ id: 'p', extra: 1 }, 'extra'],
      [{}, 'id']
    ]
    for (const [params, offender] of vectors) {
      const r = await awaitRes(h, req(h, 'pty:attach', params), `bad-params attach ${JSON.stringify(params)}`)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error.code).toBe('bad-params')
        expect(r.error.message).toContain(offender)
      }
    }
    const still = await attach(h, 'p') // nothing was torn down by the rejections
    expect(still.ok).toBe(true)
    store.destroy()
  })

  it('unknown-pane: never-spawned and already-exited ids, naming the id', async () => {
    const store = mkFakeStore()
    const h = mkConn(store)
    establish(h)
    const never = await attach(h, 'nope')
    expect(never.ok).toBe(false)
    if (!never.ok) {
      expect(never.error.code).toBe('unknown-pane')
      expect(never.error.message).toContain('nope')
    }
    req(h, CH.ptySpawn, spawnArgs('q'))
    req(h, CH.ptyWrite, { id: 'q', data: 'exit 0\n' })
    await until(() => evts(h, CH.ptyExit, 'q').length > 0, 'pane q exit')
    const gone = await attach(h, 'q')
    expect(gone.ok).toBe(false)
    if (!gone.ok) expect(gone.error.code).toBe('unknown-pane')
    store.destroy()
  })

  it('ordering invariant: no pty:data in the attach window; held bytes after the res; composition exact', async () => {
    const store = mkFakeStore()
    const h = mkConn(store)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('p'))
    req(h, CH.ptyWrite, { id: 'p', data: 'echo before-attach\n' })
    await until(() => dataPayloads(h, 'p').join('').includes('before-attach'), 'pre-attach echo')

    const attachId = req(h, 'pty:attach', { id: 'p' })
    // Emitted while the attach snapshot is in flight — MUST be held until after the res.
    req(h, CH.ptyWrite, { id: 'p', data: 'echo mid-attach\n' })
    const res = await awaitRes(h, attachId, 'the attach res')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const resIdx = h.sent.indexOf(res)
    for (let i = 0; i < h.sent.length; i++) {
      const f = h.sent[i]
      if (f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === 'p' && String(f.args[1]).includes('mid-attach')) {
        expect(i, 'window bytes are delivered only AFTER the attach res').toBeGreaterThan(resIdx)
      }
    }
    // Composition oracle: snapshot ⊕ post-res data ≡ the entire pane stream.
    const snapshot = (res.result as AgentAttachResult).snapshot
    const postRes = h.sent.slice(resIdx + 1)
      .filter((f): f is EvtFrame => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === 'p')
      .map((e) => String(e.args[1]))
    const composed = await referenceSerialize([snapshot, ...postRes], 40, 6)
    const direct = await referenceSerialize(dataPayloads(h, 'p'), 40, 6)
    expect(composed, 'no byte lost, duplicated, or reordered across the attach boundary').toBe(direct)
    store.destroy()
  })

  it('a pane exiting during the snapshot barrier yields unknown-pane, exactly one res', async () => {
    // Controlled barrier: a replay factory whose snapshot resolves only when the test says so.
    let releaseSnapshot: ((s: string) => void) | null = null
    const factory = (_opts: { cols: number; rows: number; scrollback: number }) => ({
      feed: () => {},
      resize: () => {},
      snapshot: () => new Promise<string>((r) => { releaseSnapshot = r }),
      dispose: () => {}
    })
    interface StubHandle { exitCb: ((c: number) => void) | null }
    const handles = new Map<string, StubHandle>()
    const backend: AgentPtyBackend = {
      spawn(opts: AgentSpawnOpts): AgentPtyHandle {
        const s: StubHandle = { exitCb: null }
        handles.set(opts.id, s)
        return {
          write: () => {}, resize: () => {}, kill: () => s.exitCb?.(0),
          // 0021 sanctioned amendment (type-only): pause/resume no-ops vs the 0018-widened
          // AgentPtyHandle (TS2739 housekeeping routed to F20's tests phase).
          pause: () => {}, resume: () => {},
          onData: () => {}, onExit: (cb) => { s.exitCb = cb }
        }
      }
    }
    const store = createSessionStore({ backend, homeDir: '/h', replayFactory: factory })
    const h = mkConn(store)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('p'))
    const attachId = req(h, 'pty:attach', { id: 'p' })
    handles.get('p')!.exitCb?.(0) // dies while the snapshot is pending
    await until(() => releaseSnapshot !== null, 'the snapshot barrier to be reached')
    releaseSnapshot!('stale-snapshot-of-a-dead-pane')
    const r = await awaitRes(h, attachId, 'the raced attach res')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code, 'never a snapshot of a disposed terminal').toBe('unknown-pane')
    expect(resFor(h, attachId).length, 'exactly one res').toBe(1)
    store.destroy()
  })
})

describe('TEST-1907 REQ-007 pty:sessions: strict null params, sorted live inventory', () => {
  it('is [] when no pane lives; rejects non-null params', async () => {
    const store = mkFakeStore()
    const h = mkConn(store)
    establish(h)
    const empty = await sessions(h)
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.result).toEqual([])
    for (const params of [{}, 1, 'all', []]) {
      const r = await awaitRes(h, req(h, 'pty:sessions', params), 'bad sessions params')
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error.code).toBe('bad-params')
        expect(r.error.message).toContain('null')
      }
    }
    store.destroy()
  })

  it('lists surviving panes sorted by id with truthful attached flags across connections', async () => {
    const store = mkFakeStore()
    const a = mkConn(store)
    establish(a)
    req(a, CH.ptySpawn, spawnArgs('b'))
    req(a, CH.ptySpawn, spawnArgs('a', { cwd: '/home/other', cols: 33, rows: 9 }))
    a.session.endOfInput()

    const b = mkConn(store)
    establish(b)
    const before = await sessions(b)
    expect(before.ok).toBe(true)
    if (before.ok) {
      const list = before.result as AgentSessionInfo[]
      expect(list.map((e) => e.id), 'sorted ascending by id').toEqual(['a', 'b'])
      expect(list.every((e) => e.attached === false), 'subscriptions died with connection A').toBe(true)
      const ea = list[0]
      expect(ea.shellId).toBe('default')
      expect(ea.cwd).toBe('/home/other')
      expect(ea.cols).toBe(33)
      expect(ea.rows).toBe(9)
      expect(ea.status.state).toBe('idle')
    }
    await attach(b, 'a')
    const after = await sessions(b)
    if (after.ok) {
      const list = after.result as AgentSessionInfo[]
      expect(list.find((e) => e.id === 'a')?.attached).toBe(true)
      expect(list.find((e) => e.id === 'b')?.attached).toBe(false)
    }
    store.destroy()
  })

  it('drops exited panes from the inventory', async () => {
    const store = mkFakeStore()
    const h = mkConn(store)
    establish(h)
    req(h, CH.ptySpawn, spawnArgs('keep'))
    req(h, CH.ptySpawn, spawnArgs('die'))
    req(h, CH.ptyWrite, { id: 'die', data: 'exit 7\n' })
    await until(() => evts(h, CH.ptyExit, 'die').length > 0, 'the exit event')
    const inv = await sessions(h)
    expect(inv.ok).toBe(true)
    if (inv.ok) expect((inv.result as AgentSessionInfo[]).map((e) => e.id)).toEqual(['keep'])
    store.destroy()
  })
})

describe('TEST-1908 REQ-009 vocabulary: additive constants; closed sets; six-method message', () => {
  it('AGENT_SESSION_METHODS is exactly the sorted pair, disjoint from the pinned pty methods', () => {
    expect([...AGENT_SESSION_METHODS]).toEqual(['pty:attach', 'pty:sessions'])
    expect([...AGENT_SESSION_METHODS]).toEqual([...AGENT_SESSION_METHODS].slice().sort())
    expect(new Set(AGENT_SESSION_METHODS).size).toBe(AGENT_SESSION_METHODS.length)
    for (const m of AGENT_SESSION_METHODS) {
      expect((AGENT_PTY_METHODS as readonly string[]).includes(m)).toBe(false)
    }
    expect(HISTORY_LIMIT_DEFAULT, 'the doc-facing default rides the replay module').toBe(2000)
  })

  it('unknown-method messages name the full six-method surface; codes stay in the closed set', async () => {
    const store = mkFakeStore()
    const h = mkConn(store)
    establish(h)
    const r = await awaitRes(h, req(h, 'fs:read', { path: '/etc/passwd' }), 'unknown-method res')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('unknown-method')
      for (const m of [...AGENT_PTY_METHODS, ...AGENT_SESSION_METHODS]) {
        expect(r.error.message, `the surface enumeration names ${m}`).toContain(m)
      }
    }
    // Every code the new methods emit is a member of the UNMODIFIED closed union.
    const badParams = await awaitRes(h, req(h, 'pty:attach', null), 'bad-params res')
    const unknownPane = await awaitRes(h, req(h, 'pty:attach', { id: 'ghost' }), 'unknown-pane res')
    for (const res of [r, badParams, unknownPane]) {
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code, 'every failure carries a code').toBeDefined()
        expect(AGENT_ERROR_CODES as readonly string[]).toContain(res.error.code as string)
      }
    }
    store.destroy()
  })
})
