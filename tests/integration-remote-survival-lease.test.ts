// INTEGRATION-phase suite — Remote Agent v1 roadmap (.orky/roadmap.json → integration.summary).
// Written AFTER the fact against the assembled system (no spec-freeze, no red-first): the REAL
// RemoteWorkspaceManager (F21, src/main/remote/) is wired over an in-process bridge to the REAL
// agent connection core (F16 createAgentSession) over the REAL survival store (F18
// createSessionStore + @xterm/headless replay) over the REAL deterministic fake pty backend —
// no stub session store, no canned responses, no mocks between the features. The bridge models
// exactly what a stdio pipe models: ordered frames and an async client→agent direction (a
// synchronous ack inside the agent's own deliver would be reentrant in a way no pipe can be).
//
// Mandate coverage (feature spans in brackets):
//   point 2 — TEST-IT-201: disconnect → agent-side output continues → the manager's reconnect
//             readopt (pty:sessions + pty:attach) repaints EXACTLY: the replayed snapshot equals
//             an independent headless reference terminal, and snapshot ⊕ live tail ≡ the full
//             stream [F21 × F18 × F16].
//   point 4 — TEST-IT-202: a second client's attach STEALS the lease; the losing manager drops
//             its workspace to disconnected/lease-stolen (tmux attach -d), the winner adopts the
//             surviving session with the loser-era bytes, and a steal-back reverses it
//             [F21 × F20 × F18 × F16].
//   point 3 — TEST-IT-203: under an output flood the agent-side flow gate pauses the backend and
//             the manager's OWN ack policy (createClientAckPolicy inside F21) drives the resumes;
//             ack accounting conserves exactly (agent-delivered units == client-acked units after
//             the quiet flush) [F21 × F17 × F16 × F18].
//
// Additive only: no existing test or source file is touched.
import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { createClientHandshake } from '@shared/remote/protocol'
import type { WireFrame, HelloFrame, DecodedItem, AckFrame } from '@shared/remote/protocol'
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import type { NamedAgent } from '@shared/remote-agents'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'
import { createAgentSession } from '../src/agent/session'
import { createSessionStore, type AgentSessionStore } from '../src/agent/session-store'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from '../src/agent/pty-backend'
import {
  RemoteWorkspaceManager,
  type RemoteConnectFn, type RemoteConnectResult, type RemoteManagerDeps, type RemoteWire
} from '../src/main/remote/remote-workspace-manager'

const VERSION = '7.7.7-it'
const COLS = 40
const ROWS = 6
const SCROLLBACK = 60
const AGENT: NamedAgent = { id: 'agent-1', name: 'itbox', host: 'it.example', user: 'ci' }

const OSC_C = '\x1b]133;C\x07'
const oscD = (code: number): string => `\x1b]133;D;${code}\x07`

const msg = (frame: WireFrame): DecodedItem => ({ kind: 'message', frame })

// ── the spy backend: the REAL fake pseudo-shell, with pause/resume/write/kill observation ────
interface SpyPane {
  seq: string[]                    // pause/resume call log (mandate point 3's observable)
  writes: string[]
  resizes: Array<[number, number]>
  kills: number
  raw: AgentPtyHandle              // the unwrapped handle — the TEST drives it while detached
}

const spyBackend = (inner: AgentPtyBackend) => {
  const panes = new Map<string, SpyPane>()
  const backend: AgentPtyBackend = {
    spawn(opts: AgentSpawnOpts): AgentPtyHandle {
      const h = inner.spawn(opts)
      const rec: SpyPane = { seq: [], writes: [], resizes: [], kills: 0, raw: h }
      panes.set(opts.id, rec)
      // The fake handle's methods are OWN enumerable properties (its header sanctions spreading).
      return {
        ...h,
        write: (d) => { rec.writes.push(d); h.write(d) },
        resize: (c, r) => { rec.resizes.push([c, r]); h.resize(c, r) },
        kill: () => { rec.kills++; h.kill() },
        pause: () => { rec.seq.push('pause'); h.pause() },
        resume: () => { rec.seq.push('resume'); h.resume() }
      }
    }
  }
  return { backend, pane: (id: string) => panes.get(id)! }
}

// ── the bridge: a REAL agent connection per manager connect, over an in-process "pipe" ───────
interface BridgeConn {
  session: ReturnType<typeof createAgentSession>
  /** Every frame the manager put on the wire (client → agent), acks included. */
  outbound: WireFrame[]
  diags: string[]
  exitCode: number | null
}

const mkBridge = (store: AgentSessionStore) => {
  const conns: BridgeConn[] = []
  const connect: RemoteConnectFn = async (): Promise<RemoteConnectResult> => {
    const conn: BridgeConn = { session: null as never, outbound: [], diags: [], exitCode: null }
    let cb: ((f: WireFrame) => void) | null = null
    let exitCb: ((code: number | null) => void) | null = null
    const buffer: WireFrame[] = []
    let hello: HelloFrame | null = null
    const session = createAgentSession({
      version: VERSION,
      sessions: store,
      send: (f) => {
        if (hello === null && f.type === 'hello') { hello = f; return }
        if (cb) cb(f)
        else buffer.push(f)
      },
      diag: (t) => conn.diags.push(t),
      shutdown: (code) => { conn.exitCode = code; exitCb?.(code) }
    })
    conn.session = session
    session.start() // the agent speaks hello-first, synchronously
    if (hello === null) return { ok: false, kind: 'fatal', diagnostic: 'bridge: no agent hello' }
    const agentHello: HelloFrame = hello
    const hs = createClientHandshake({ version: VERSION })
    const r = hs.onMessage(agentHello)
    if (!r.ok) return { ok: false, kind: 'handshake', diagnostic: r.failure.message }
    // The client hello reply, fed synchronously (nothing is in flight yet). If the store is
    // already bound, the STEAL happens right here, inside the newcomer's connect — the same
    // deterministic arrival order a stdio transport gives F20's bind.
    session.onItem(msg(r.reply))
    const wire: RemoteWire = {
      version: agentHello.version,
      capabilities: [...(agentHello.capabilities ?? [])],
      // The load-bearing asynchrony: on a real pipe a client frame can never land INSIDE the
      // agent's own send. deliverData counts the flow gate AFTER deliver returns, so a
      // synchronous ack here would be reentrant and corrupt the F17 accounting in a way no
      // transport can — defer by one microtask, order-preserving.
      send: (f) => { conn.outbound.push(f); queueMicrotask(() => session.onItem(msg(f))) },
      onFrame: (fn) => {
        cb = fn
        for (const f of buffer.splice(0)) fn(f)
        return () => { if (cb === fn) cb = null }
      },
      onExit: (fn) => { exitCb = fn; return () => { if (exitCb === fn) exitCb = null } },
      kill: () => session.endOfInput()
    }
    conns.push(conn)
    return { ok: true, session: wire }
  }
  return { conns, connect }
}

// ── the manager harness (real RemoteWorkspaceManager; only the impure edges injected) ────────
interface FakeScheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
  fire(): number
  pending(): number
}

const mkScheduler = (): FakeScheduler => {
  let seq = 0
  const timers = new Map<number, () => void>()
  return {
    setTimeout: (fn: () => void) => { const id = ++seq; timers.set(id, fn); return id },
    clearTimeout: (t: unknown) => { timers.delete(t as number) },
    fire: () => { const fns = [...timers.values()]; timers.clear(); for (const fn of fns) fn(); return fns.length },
    pending: () => timers.size
  }
}

interface Mgr {
  mgr: RemoteWorkspaceManager
  sends: Array<[string, ...unknown[]]>
  diags: string[]
  scheduler: FakeScheduler
  dataFrames(paneId: string): string[]
  dataText(paneId: string): string
  states(): RemoteWorkspaceState[]
  lastState(): RemoteWorkspaceState | undefined
}

const mkMgr = (connect: RemoteConnectFn, over: Partial<RemoteManagerDeps> = {}): Mgr => {
  const sends: Array<[string, ...unknown[]]> = []
  const diags: string[] = []
  const scheduler = mkScheduler()
  const mgr = new RemoteWorkspaceManager({
    send: (ch, ...a) => sends.push([ch, ...a]),
    loadAgents: async () => [AGENT],
    connect,
    version: VERSION,
    artifactPath: 'X:/unused/termhalla-agent.cjs', // the bridge never provisions
    scheduler,
    ackQuietMs: 200,
    diag: (t) => diags.push(t),
    ...over
  })
  const dataFrames = (paneId: string): string[] =>
    sends.filter(([ch, id]) => ch === CH.ptyData && id === paneId).map(([, , d]) => String(d))
  return {
    mgr, sends, diags, scheduler,
    dataFrames,
    dataText: (paneId) => dataFrames(paneId).join(''),
    states: () => sends.filter(([ch]) => ch === CH.remoteState).map(([, s]) => s as RemoteWorkspaceState),
    lastState() { const all = this.states(); return all[all.length - 1] }
  }
}

const spawnArgs = (id: string, workspaceId: string): PtySpawnArgs => ({
  id, shellId: 'default', cwd: '/home/it', cols: COLS, rows: ROWS,
  remote: { workspaceId, agentId: AGENT.id }
})

const until = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 4000; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Reference serialization with the agent replay's option parity ({cols, rows, scrollback,
 *  allowProposedApi}) — the INDEPENDENT headless oracle the mandate names. */
const referenceSerialize = async (chunks: string[]): Promise<string> => {
  const term = new Terminal({ cols: COLS, rows: ROWS, scrollback: SCROLLBACK, allowProposedApi: true })
  const addon = new SerializeAddon()
  term.loadAddon(addon as unknown as Parameters<Terminal['loadAddon']>[0])
  for (const c of chunks) await new Promise<void>((r) => term.write(c, r))
  const out = addon.serialize()
  term.dispose()
  return out
}

/** The golden full stream: the same write script driven directly on a fresh fake handle. */
const golden = (writes: string[]): string[] => {
  const handle = createFakePtyBackend().spawn({ id: 'golden', shellId: 'default', cwd: '/home/it', cols: COLS, rows: ROWS })
  const out: string[] = []
  handle.onData((d) => out.push(d))
  for (const w of writes) handle.write(w)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-201 mandate point 2 — disconnect → output continues → manager reattach repaints exactly [F21 × F18 × F16]', () => {
  it('the reconnect readopt replays a snapshot equal to the independent reference; snapshot ⊕ live tail ≡ the full stream; recorded dims re-apply', async () => {
    const stub = spyBackend(createFakePtyBackend())
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/it', scrollback: SCROLLBACK })
    const bridge = mkBridge(store)
    const m = mkMgr(bridge.connect)

    // Spawn through the manager (the renderer-facing seam): fresh polarity = false.
    const adopted = await m.mgr.spawn(spawnArgs('p1', 'ws-A'))
    expect(adopted, 'a genuinely fresh remote spawn resolves false (the auto-resume polarity)').toBe(false)
    await until(() => m.dataText('p1').includes('fake$'), 'the spawn prompt routed to the renderer send')
    expect(m.lastState()?.phase).toBe('connected')
    expect([...(m.lastState()?.capabilities ?? [])].sort(), 'capabilities come from the REAL agent hello').toEqual(['pty', 'status'])

    m.mgr.write('p1', 'echo before-detach\n')
    await until(() => m.dataText('p1').includes('before-detach'), 'the pre-detach echo')

    // Disconnect. The store (F18) must keep the pane alive: nothing is killed.
    m.mgr.disconnectWorkspace('ws-A')
    expect(m.lastState()?.phase).toBe('disconnected')
    expect(m.lastState()?.reason).toBe('cancelled')
    expect(stub.pane('p1').kills, 'a disconnect kills NOTHING (locked decision 3)').toBe(0)

    // Output continues with NOBODY connected — the test drives the surviving shell directly.
    const framesAtDetach = m.dataFrames('p1').length
    stub.pane('p1').raw.write('echo while-away\n')
    expect(m.dataFrames('p1').length, 'no frame reaches the disconnected client').toBe(framesAtDetach)

    // Writes while frozen are dropped by the manager (they must NOT queue up and replay later).
    const writesAtDetach = stub.pane('p1').writes.length
    m.mgr.write('p1', 'echo ghost\n')
    expect(stub.pane('p1').writes.length, 'a frozen write never reaches the agent').toBe(writesAtDetach)

    // Reconnect: the manager's inventory-driven readopt attaches the surviving pane.
    await m.mgr.connectWorkspace('ws-A', AGENT.id)
    await until(() => m.dataFrames('p1').some((d) => d.startsWith('\x1bc')), 'the reset-preamble snapshot frame')
    const snapFrames = m.dataFrames('p1').filter((d) => d.startsWith('\x1bc'))
    expect(snapFrames.length, 'reset preamble + snapshot EXACTLY once').toBe(1)
    const snapshot = snapFrames[0].slice('\x1bc'.length)
    expect(snapshot).toContain('before-detach')
    expect(snapshot, 'bytes emitted while DETACHED are in the replayed snapshot').toContain('while-away')
    expect(snapshot, 'the dropped frozen write left no trace').not.toContain('ghost')

    // The independent reference terminal (the mandate's oracle): same script on a fresh fake
    // handle, serialized by a second headless terminal with option parity.
    expect(snapshot).toBe(await referenceSerialize(golden(['echo before-detach\n', 'echo while-away\n'])))

    // Status + cwd are re-pushed on attach (the agent-sourced chip keeps working after reattach).
    const statusFrames = m.sends.filter(([ch, id]) => ch === CH.ptyStatus && id === 'p1')
    expect(statusFrames.length, 'pty:status re-pushed on attach').toBeGreaterThan(0)
    const cwdFrames = m.sends.filter(([ch, id]) => ch === CH.ptyCwd && id === 'p1')
    expect(cwdFrames[cwdFrames.length - 1]?.[2]).toBe('/home/it')

    // Live tail + the composition oracle: snapshot ⊕ post-attach frames ≡ the entire stream.
    m.mgr.write('p1', 'echo live-again\n')
    await until(() => m.dataText('p1').includes('live-again'), 'the post-reattach echo')
    const allFrames = m.dataFrames('p1')
    const snapIdx = allFrames.findIndex((d) => d.startsWith('\x1bc'))
    const post = allFrames.slice(snapIdx + 1)
    const composed = await referenceSerialize([snapshot, ...post])
    const direct = await referenceSerialize(golden(['echo before-detach\n', 'echo while-away\n', 'echo live-again\n']))
    expect(composed, 'no byte lost, duplicated, or reordered across the disconnect').toBe(direct)

    // Second cycle: dims recorded while DISCONNECTED are re-applied on the next attach (REQ-013).
    m.mgr.disconnectWorkspace('ws-A')
    stub.pane('p1').raw.write('echo second-gap\n')
    m.mgr.resize('p1', 100, 30) // frozen: recorded only — nothing reaches the wire
    expect(stub.pane('p1').resizes).toEqual([])
    await m.mgr.connectWorkspace('ws-A', AGENT.id)
    await until(() => m.dataFrames('p1').filter((d) => d.startsWith('\x1bc')).length === 2, 'the second snapshot')
    const snap2 = m.dataFrames('p1').filter((d) => d.startsWith('\x1bc'))[1].slice('\x1bc'.length)
    expect(snap2, 'the second detach-gap is in the second snapshot').toContain('second-gap')
    await until(() => stub.pane('p1').resizes.length > 0, 'the renderer-recorded dims re-applied on attach')
    expect(stub.pane('p1').resizes).toEqual([[100, 30]])
    m.mgr.write('p1', 'size\n')
    await until(() => m.dataText('p1').includes('size=100x30'), 'the resized size report')

    expect(stub.pane('p1').kills, 'the whole double disconnect/reattach cycle killed nothing').toBe(0)
    m.mgr.stop()
    store.destroy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-202 mandate point 4 — a lease steal drops the losing workspace to disconnected [F21 × F20 × F18 × F16]', () => {
  it('the winner adopts the surviving session with loser-era bytes; the loser goes lease-stolen and silent; steal-back reverses it', async () => {
    const stub = spyBackend(createFakePtyBackend())
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/it', scrollback: SCROLLBACK })
    const bridge = mkBridge(store)
    // Two INDEPENDENT managers over the same agent — two Termhalla instances, one remote box.
    const m1 = mkMgr(bridge.connect)
    const m2 = mkMgr(bridge.connect)

    expect(await m1.mgr.spawn(spawnArgs('p1', 'ws-A'))).toBe(false)
    await until(() => m1.dataText('p1').includes('fake$'), 'client A\'s prompt')
    m1.mgr.write('p1', 'echo hello-one\n')
    await until(() => m1.dataText('p1').includes('hello-one'), 'client A\'s echo')
    const aFramesAtSteal = m1.dataFrames('p1').length

    // Client B attaches the SAME pane id (its own workspace): tmux attach -d — the steal.
    const adopted = await m2.mgr.spawn(spawnArgs('p1', 'ws-B'))
    expect(adopted, 'the winner ADOPTS the surviving session via the inventory (not a fresh spawn)').toBe(true)

    // The loser's workspace dropped to disconnected/lease-stolen (the banner state).
    const loser = m1.lastState()
    expect(loser?.phase).toBe('disconnected')
    expect(loser?.reason).toBe('lease-stolen')
    expect(loser?.diagnostic).toContain('exclusive attach')
    expect(m1.mgr.currentStates().find((s) => s.workspaceId === 'ws-A')?.reason).toBe('lease-stolen')

    // The winner's snapshot carries the loser-era bytes (F18 replay across the F20 boundary).
    await until(() => m2.dataFrames('p1').some((d) => d.startsWith('\x1bc')), 'the winner\'s snapshot')
    const winnerSnap = m2.dataFrames('p1').find((d) => d.startsWith('\x1bc'))!
    expect(winnerSnap).toContain('hello-one')

    // Post-steal: the winner is served; the loser receives nothing and its writes are dropped.
    m2.mgr.write('p1', 'echo hello-two\n')
    await until(() => m2.dataText('p1').includes('hello-two'), 'the winner\'s echo')
    expect(m1.dataFrames('p1').length, 'the displaced client\'s pane log never grows again').toBe(aFramesAtSteal)
    m1.mgr.write('p1', 'echo ghost\n')
    expect(stub.pane('p1').writes.join(''), 'a lease-stolen workspace\'s writes never reach the agent').not.toContain('ghost')
    expect(stub.pane('p1').kills, 'a steal kills nothing').toBe(0)

    // Steal-back (the banner's Reconnect): the loser's fresh connection displaces the thief and
    // reattaches its still-tracked pane with the FULL history, both eras.
    await m1.mgr.connectWorkspace('ws-A', AGENT.id)
    await until(() => m1.dataFrames('p1').some((d) => d.startsWith('\x1bc')), 'the steal-back snapshot')
    const backSnap = m1.dataFrames('p1').find((d) => d.startsWith('\x1bc'))!
    expect(backSnap).toContain('hello-one')
    expect(backSnap, 'the thief-era bytes survived into the steal-back snapshot').toContain('hello-two')
    expect(m2.lastState()?.reason, 'the thief is now the displaced one').toBe('lease-stolen')
    expect(m1.lastState()?.phase).toBe('connected')

    m1.mgr.write('p1', 'echo back-again\n')
    await until(() => m1.dataText('p1').includes('back-again'), 'the steal-back live tail')
    expect(m2.dataText('p1'), 'the displaced thief sees none of it').not.toContain('back-again')

    m1.mgr.stop()
    m2.mgr.stop()
    store.destroy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-203 mandate point 3 — flow control under a flood: the manager\'s acks drive the agent\'s pause/resume [F21 × F17 × F16 × F18]', () => {
  it('the backend is paused at the window and resumed by REAL manager acks; the flood drains fully; ack accounting conserves exactly', async () => {
    const WINDOW = 4096
    const CADENCE = 8192 // deliberately > window so every chunk crossing is VISIBLE as a pause
    const CHUNKS = 6
    const CHUNK = 8192

    const stub = spyBackend(createFakePtyBackend())
    const store = createSessionStore({ backend: stub.backend, homeDir: '/home/it', scrollback: SCROLLBACK })
    const bridge = mkBridge(store)
    const m = mkMgr(bridge.connect, { ackEveryBytes: CADENCE })

    await m.mgr.connectWorkspace('ws-F', AGENT.id)
    // The test speaks the connection's client half exactly once, to shrink the agent's
    // connection-default window (a protocol-legal frame — F15's window shape, F17's semantics).
    // Production's manager never emits one (0018 FINDING-006), which is exactly why the 1 MiB
    // default can never be crossed by a promptly-acking client: without this, pause() would be
    // unobservable here BY DESIGN.
    const agentSide = bridge.conns[bridge.conns.length - 1].session
    agentSide.onItem(msg({ type: 'window', size: WINDOW }))

    expect(await m.mgr.spawn(spawnArgs('fp1', 'ws-F'))).toBe(false)
    await until(() => m.dataText('fp1').includes('fake$'), 'the flood pane prompt')

    m.mgr.write('fp1', `flood ${CHUNKS} ${CHUNK}\n`)
    await until(() => m.dataText('fp1').includes(oscD(0)), 'the flood to drain to completion under the manager\'s acks')

    // Integrity: every unit arrived, nothing dropped or duplicated (the acks resumed the pty).
    const all = m.dataText('fp1')
    const start = all.indexOf(OSC_C) + OSC_C.length
    const end = all.indexOf(oscD(0))
    expect(start).toBeGreaterThan(0)
    expect(end - start, 'the full flood arrived through the pause/resume cycles').toBe(CHUNKS * CHUNK)

    // node-pty pause()/resume() observed (mandate point 3's literal observable), strictly
    // alternating — the F17 gate's edge-triggered contract — starting paused, ending resumed.
    const seq = stub.pane('fp1').seq
    expect(seq.length).toBeGreaterThanOrEqual(2)
    expect(seq.length % 2, 'pause/resume come in pairs').toBe(0)
    for (let i = 0; i < seq.length; i++) {
      expect(seq[i], `flow decision #${i} alternates`).toBe(i % 2 === 0 ? 'pause' : 'resume')
    }
    expect(seq.filter((s) => s === 'pause').length, 'every window crossing paused the backend').toBeGreaterThanOrEqual(CHUNKS - 1)
    expect(seq[seq.length - 1], 'nothing is left paused after the drain').toBe('resume')

    // The quiet-flush timer (CONV-036 seam) flushes the sub-cadence residue…
    expect(m.scheduler.pending(), 'data arrival armed the ack quiet-flush timer').toBeGreaterThan(0)
    m.scheduler.fire()
    await new Promise((r) => setTimeout(r, 0)) // let the deferred residue ack cross the bridge
    // …after which client acks conserve the agent's delivery exactly: every delivered unit is
    // acked, none twice (both sides share flow-control.ts's ONE measure — data.length).
    const delivered = m.dataFrames('fp1').reduce((n, d) => n + d.length, 0)
    const acked = bridge.conns[bridge.conns.length - 1].outbound
      .filter((f): f is AckFrame => f.type === 'ack' && f.id === 'fp1')
      .reduce((n, f) => n + f.bytes, 0)
    expect(acked, 'client-acked units == agent-delivered units (no drift, no ratchet)').toBe(delivered)

    m.mgr.stop()
    store.destroy()
  })
})
