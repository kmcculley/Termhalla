// FROZEN test suite — feature 0019-agent-replay-session-survival (phase 4).
// REQ-011: the feature's centerpiece — disconnect → agent-side output continues → reattach →
// exact repaint, fully in-process and deterministic (locked decision 1: no ssh, no real pty,
// no second OS transport; the store IS the survival boundary). The scripted backend is driven
// by the TEST between connections — that is how "output continues while detached" is exercised.
// Determinism: run-twice equality over the full frame sequence with the engine's Date.now-fed
// `status.since` normalized to 0 (F16 accepted the engine's default clock; nothing else is
// normalized).
import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, DecodedItem, HelloFrame } from '@shared/remote/protocol'
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import type { AgentAttachResult, AgentSessionInfo } from '@shared/remote-agent-api'
import { createAgentSession } from '../src/agent/session'
import { createSessionStore } from '../src/agent/session-store'
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from '../src/agent/pty-backend'

const VERSION = '1.2.3'
const SCROLLBACK = 40
const COLS = 40
const ROWS = 6

interface StubPane {
  writes: string[]
  resizes: Array<[number, number]>
  kills: number
  alive: boolean
  dataCb: ((d: string) => void) | null
  exitCb: ((c: number) => void) | null
}

const mkStub = () => {
  const panes = new Map<string, StubPane>()
  const backend: AgentPtyBackend = {
    spawn(opts: AgentSpawnOpts): AgentPtyHandle {
      const p: StubPane = { writes: [], resizes: [], kills: 0, alive: true, dataCb: null, exitCb: null }
      panes.set(opts.id, p)
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
    pane: (id: string) => panes.get(id)!,
    emit: (id: string, data: string) => { const p = panes.get(id); if (p?.alive) p.dataCb?.(data) },
    totalKills: () => [...panes.values()].reduce((n, p) => n + p.kills, 0)
  }
}

interface Conn {
  session: ReturnType<typeof createAgentSession>
  sent: WireFrame[]
  exits: number[]
}

const mkConn = (store: ReturnType<typeof createSessionStore>): Conn => {
  const sent: WireFrame[] = []
  const exits: number[] = []
  const session = createAgentSession({
    version: VERSION,
    sessions: store,
    send: (f) => sent.push(f),
    diag: () => {},
    shutdown: (c) => exits.push(c)
  })
  session.start()
  return { session, sent, exits }
}

const msg = (frame: WireFrame): DecodedItem => ({ kind: 'message', frame })
const establish = (h: Conn): void => h.session.onItem(msg({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: VERSION }))
const spawnArgs = (id: string): PtySpawnArgs => ({ id, shellId: 'default', cwd: '/w', cols: COLS, rows: ROWS })
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

const referenceSerialize = async (chunks: string[]): Promise<string> => {
  const term = new Terminal({ cols: COLS, rows: ROWS, scrollback: SCROLLBACK, allowProposedApi: true })
  const addon = new SerializeAddon()
  term.loadAddon(addon as unknown as Parameters<Terminal['loadAddon']>[0])
  for (const c of chunks) await new Promise<void>((r) => term.write(c, r))
  const out = addon.serialize()
  term.dispose()
  return out
}

/** The scripted survival session (clean-EOF variant), returning every observable it produced. */
const runSurvivalScript = async (): Promise<{
  aFrames: WireFrame[]; bFrames: WireFrame[]; snapshot: string; postResData: string[]
  allBytes: string[]; kills: number; stubWrites: string[]; finalInventory: unknown
}> => {
  const stub = mkStub()
  const store = createSessionStore({ backend: stub.backend, homeDir: '/h', scrollback: SCROLLBACK })
  let reqId = 1

  // Connection A: spawn + drive output, then a clean disconnect.
  const a = mkConn(store)
  establish(a)
  a.session.onItem(msg({ type: 'req', id: reqId++, method: CH.ptySpawn, params: spawnArgs('p1') }))
  stub.emit('p1', 'pre-detach\r\n')
  a.session.endOfInput()

  // Output continues with NOBODY connected.
  stub.emit('p1', 'while-away\r\n')

  // Connection B: fresh handshake, inventory, attach, live tail, write/resize/kill.
  const b = mkConn(store)
  expect((b.sent[0] as HelloFrame).type, 'the agent still speaks hello-first to a reconnection').toBe('hello')
  establish(b)

  const invId = reqId++
  b.session.onItem(msg({ type: 'req', id: invId, method: 'pty:sessions', params: null }))
  await until(() => resFor(b, invId).length > 0, 'the inventory res')
  const inv = resFor(b, invId)[0]
  expect(inv.ok).toBe(true)
  const entries = inv.ok ? (inv.result as AgentSessionInfo[]) : []
  expect(entries.map((e) => e.id)).toEqual(['p1'])
  expect(entries[0].attached).toBe(false)
  expect(entries[0].cwd).toBe('/w')

  const attachId = reqId++
  b.session.onItem(msg({ type: 'req', id: attachId, method: 'pty:attach', params: { id: 'p1' } }))
  await until(() => resFor(b, attachId).length > 0, 'the attach res')
  const att = resFor(b, attachId)[0]
  expect(att.ok).toBe(true)
  const snapshot = att.ok ? (att.result as AgentAttachResult).snapshot : ''
  const resIdx = b.sent.indexOf(att)

  stub.emit('p1', 'live-now\r\n')
  await until(() => evts(b, CH.ptyData, 'p1').some((e) => String(e.args[1]).includes('live-now')), 'live data after reattach')

  const wId = reqId++
  b.session.onItem(msg({ type: 'req', id: wId, method: CH.ptyWrite, params: { id: 'p1', data: 'typed-by-b' } }))
  const rzId = reqId++
  b.session.onItem(msg({ type: 'req', id: rzId, method: CH.ptyResize, params: { id: 'p1', cols: 100, rows: 30 } }))
  const killId = reqId++
  b.session.onItem(msg({ type: 'req', id: killId, method: CH.ptyKill, params: 'p1' }))
  await until(() => evts(b, CH.ptyExit, 'p1').length > 0, 'the kill-driven exit event')

  const afterId = reqId++
  b.session.onItem(msg({ type: 'req', id: afterId, method: 'pty:sessions', params: null }))
  await until(() => resFor(b, afterId).length > 0, 'the post-kill inventory')

  const postResData = b.sent.slice(resIdx + 1)
    .filter((f): f is EvtFrame => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === 'p1')
    .map((e) => String(e.args[1]))
  const finalRes = resFor(b, afterId)[0]

  return {
    aFrames: a.sent,
    bFrames: b.sent,
    snapshot,
    postResData,
    allBytes: ['pre-detach\r\n', 'while-away\r\n', 'live-now\r\n'],
    kills: stub.totalKills(),
    stubWrites: stub.pane('p1').writes,
    finalInventory: finalRes.ok ? finalRes.result : undefined
  }
}

describe('TEST-1909 REQ-011 disconnect → output continues → reattach → exact repaint', () => {
  it('survives a clean disconnect and repaints exactly (reference + composition oracles)', async () => {
    const run = await runSurvivalScript()
    expect(run.kills, 'the disconnect killed nothing; only the explicit pty:kill did').toBe(1)
    expect(run.snapshot, 'the snapshot covers pre-detach bytes').toContain('pre-detach')
    expect(run.snapshot, 'the snapshot covers bytes emitted while DETACHED').toContain('while-away')
    // Reference oracle over the whole pre-attach stream:
    expect(run.snapshot).toBe(await referenceSerialize(['pre-detach\r\n', 'while-away\r\n']))
    // Composition oracle: repaint + live tail ≡ the entire stream.
    const composed = await referenceSerialize([run.snapshot, ...run.postResData])
    const direct = await referenceSerialize(run.allBytes)
    expect(composed, 'snapshot ⊕ post-res data ≡ full stream (repaints exactly)').toBe(direct)
    // The reattached client fully OWNS the pane:
    expect(run.stubWrites).toEqual(['typed-by-b'])
    expect(run.finalInventory, 'the killed pane left the inventory store-wide').toEqual([])
  })

  it('survives a FATAL connection death the same way', async () => {
    const stub = mkStub()
    const store = createSessionStore({ backend: stub.backend, homeDir: '/h', scrollback: SCROLLBACK })
    const a = mkConn(store)
    establish(a)
    a.session.onItem(msg({ type: 'req', id: 1, method: CH.ptySpawn, params: spawnArgs('p2') }))
    stub.emit('p2', 'before-crash\r\n')
    a.session.onItem({ kind: 'fatal', error: { reason: 'frame-too-large', message: 'client died mid-frame', detail: {} } })
    expect(a.exits).toEqual([1])
    expect(stub.totalKills(), 'a client CRASH must not kill the session (locked decision 3)').toBe(0)

    stub.emit('p2', 'after-crash\r\n')
    const b = mkConn(store)
    establish(b)
    b.session.onItem(msg({ type: 'req', id: 2, method: 'pty:attach', params: { id: 'p2' } }))
    await until(() => resFor(b, 2).length > 0, 'the attach res')
    const att = resFor(b, 2)[0]
    expect(att.ok).toBe(true)
    if (att.ok) {
      const snap = (att.result as AgentAttachResult).snapshot
      expect(snap).toContain('before-crash')
      expect(snap).toContain('after-crash')
    }
    store.destroy()
  })

  it('is deterministic: the same scripted session twice yields identical frames (since normalized)', async () => {
    const normalize = (frames: WireFrame[]): unknown[] =>
      frames.map((f) => {
        if (f.type === 'evt' && f.channel === CH.ptyStatus) {
          const status = { ...(f.args[1] as Record<string, unknown>), since: 0 }
          return { ...f, args: [f.args[0], status] }
        }
        if (f.type === 'res' && f.ok) {
          const r = f.result
          if (r !== null && typeof r === 'object' && !Array.isArray(r) && 'status' in (r as Record<string, unknown>)) {
            const rr = r as { status: Record<string, unknown> }
            return { ...f, result: { ...rr, status: { ...rr.status, since: 0 } } }
          }
          if (Array.isArray(r)) {
            return {
              ...f,
              result: r.map((e) => (e !== null && typeof e === 'object' && 'status' in (e as Record<string, unknown>)
                ? { ...(e as Record<string, unknown>), status: { ...((e as { status: Record<string, unknown> }).status), since: 0 } }
                : e))
            }
          }
        }
        return f
      })
    const one = await runSurvivalScript()
    const two = await runSurvivalScript()
    expect(normalize(two.aFrames)).toEqual(normalize(one.aFrames))
    expect(normalize(two.bFrames)).toEqual(normalize(one.bFrames))
  })
})
