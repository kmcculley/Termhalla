// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — re-derived after the
// ESC-001 loop-back; REQ-002/006/008/012/018 as amended).
// The daemon core driven IN-PROCESS over injected byte-transport pairs (REQ-016's factoring
// mandate): each accepted connection is an independent protocol connection over the ONE
// process-lifetime store, handshaken by the DAEMON-FLOW relaxed machine (D4′ — protocol-range
// acceptance, app version advisory). A connection ending only DETACHES (REQ-002); the F20 lease
// steal is reachable end-to-end and byte-lossless (REQ-008); the lifecycle hooks carry the
// established/ended COUNT signals (REQ-006/FINDING-012); two cores are fully independent
// (REQ-018's in-process variant).
//
// Chosen contract (frozen here): src/agent/daemon-server.ts exports
//   createDaemonCore({ version, backend, homeDir, scrollback?, diag?, hooks? }) → {
//     accept(peer: { send(bytes: Uint8Array): void; end(): void }): {
//       push(bytes: Uint8Array): void; end(): void },
//     destroy(): void
//   }
//   with hooks?: { onConnectionEstablished?(); onConnectionEnded?(); onPaneSpawned?();
//   onPaneExited?() } — established increments ONLY on a completed handshake; ended fires for
//   EVERY end path of an established connection (clean EOF, fatal framing, lease displacement)
//   and NEVER for a connection that failed its handshake.
// The client half uses the daemon-flow machine from the F15 barrel exactly like production
// would — no re-derived framing, no hand-built hellos (except deliberate poison vectors).
import { describe, it, expect } from 'vitest'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import {
  createFrameDecoder, createDaemonClientHandshake, encodeFrame,
  FRAME_HEADER_BYTES, DEFAULT_MAX_FRAME_BYTES
} from '@shared/remote/protocol'
import type { WireFrame, ResFrame, DecodedItem } from '@shared/remote/protocol'
import { CH } from '@shared/ipc-contract'
import { AGENT_LEASE_REVOKED_EVT } from '@shared/remote-agent-api'
import { createDaemonCore } from '../src/agent/daemon-server'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from '../src/agent/pty-backend'

const V = '0.24.0-core'
const COLS = 40
const ROWS = 6
const SCROLLBACK = 200

const until = async (cond: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 4000; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ── the spy backend (the IT-201 pattern): real fake pseudo-shell + observation ───────────────
interface SpyPane { kills: number; raw: AgentPtyHandle }

const spyBackend = (inner: AgentPtyBackend) => {
  const panes = new Map<string, SpyPane>()
  const backend: AgentPtyBackend = {
    spawn(opts: AgentSpawnOpts): AgentPtyHandle {
      const h = inner.spawn(opts)
      const rec: SpyPane = { kills: 0, raw: h }
      panes.set(opts.id, rec)
      return { ...h, kill: () => { rec.kills++; h.kill() } }
    }
  }
  return { backend, pane: (id: string) => panes.get(id)! }
}

// ── a byte-level client over one accepted daemon connection ──────────────────────────────────
interface CoreClient {
  frames: WireFrame[]
  isEstablished: () => boolean
  endedByPeer: () => boolean
  send: (f: WireFrame) => void
  sendRaw: (b: Buffer) => void
  req: (method: string, params: unknown) => Promise<ResFrame>
  end: () => void
  dataFrames: (id: string) => string[]
  data: (id: string) => string
  evts: (channel: string) => WireFrame[]
}

type DaemonCore = ReturnType<typeof createDaemonCore>

const connectClient = (core: DaemonCore, opts: { replyToHello?: boolean; version?: string } = {}): CoreClient => {
  const decoder = createFrameDecoder()
  // The daemon-flow client machine (D4′): establishes on protocol-range compatibility only —
  // the client's app version is advisory (REQ-012).
  const hs = createDaemonClientHandshake({ version: opts.version ?? V })
  const frames: WireFrame[] = []
  let ended = false
  let established = false
  let reqSeq = 0
  const waiters = new Map<number, (f: ResFrame) => void>()
  let conn: { push(bytes: Uint8Array): void; end(): void } | null = null

  const handle = (bytes: Uint8Array): void => {
    let items: DecodedItem[]
    try {
      items = decoder.push(bytes)
    } catch {
      return
    }
    for (const item of items) {
      if (item.kind !== 'message') continue
      const f = item.frame
      frames.push(f)
      if (!established && f.type === 'hello' && opts.replyToHello !== false) {
        const r = hs.onMessage(f)
        if (r.ok) {
          // One microtask of deferral: on a real pipe a client frame can never land INSIDE the
          // daemon's own send stack (the survival-lease integration bridge's load-bearing note).
          const reply = r.reply
          queueMicrotask(() => { conn?.push(encodeFrame(reply)); established = true })
        }
      }
      if (f.type === 'res') {
        const w = waiters.get(f.id as number)
        if (w) { waiters.delete(f.id as number); w(f) }
      }
    }
  }

  // The daemon speaks hello-first, possibly synchronously inside accept() — buffer until the
  // connection handle exists, then drain.
  const pre: Uint8Array[] = []
  let live = false
  conn = core.accept({
    send: (bytes: Uint8Array) => { if (live) handle(bytes); else pre.push(Uint8Array.from(bytes)) },
    end: () => { ended = true }
  })
  live = true
  for (const b of pre.splice(0)) handle(b)

  const dataFrames = (id: string): string[] =>
    frames
      .filter((f) => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === id)
      .map((f) => String((f as { args: unknown[] }).args[1]))

  return {
    frames,
    isEstablished: () => established,
    endedByPeer: () => ended,
    send: (f) => conn?.push(encodeFrame(f)),
    sendRaw: (b) => conn?.push(b),
    req: (method, params) => new Promise<ResFrame>((res) => {
      const id = ++reqSeq
      waiters.set(id, res)
      conn?.push(encodeFrame({ type: 'req', id, method, params } as WireFrame))
    }),
    end: () => conn?.end(),
    dataFrames,
    data: (id) => dataFrames(id).join(''),
    evts: (channel) => frames.filter((f) => f.type === 'evt' && f.channel === channel)
  }
}

const spawnParams = (id: string): unknown => ({ id, shellId: 'default', cwd: '/home/it', cols: COLS, rows: ROWS })

/** Reference serialization with the replay's option parity — the independent headless oracle. */
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

const mkCore = (hooks?: {
  onConnectionEstablished?: () => void
  onConnectionEnded?: () => void
  onPaneSpawned?: () => void
  onPaneExited?: () => void
}) => {
  const stub = spyBackend(createFakePtyBackend())
  const core = createDaemonCore({
    version: V, backend: stub.backend, homeDir: '/home/it', scrollback: SCROLLBACK,
    ...(hooks !== undefined ? { hooks } : {})
  })
  return { stub, core }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2413 REQ-002 a connection ending only detaches: panes survive, replay keeps consuming, the daemon keeps serving', () => {
  it('spawn over A; end A abruptly; output keeps landing; B lists, reattaches, and the composition oracle holds byte-exactly', async () => {
    const { stub, core } = mkCore()
    const a = connectClient(core)
    await until(() => a.isEstablished(), 'A establishment')

    const spawned = await a.req(CH.ptySpawn, spawnParams('p1'))
    expect(spawned.ok, 'fresh spawn succeeds').toBe(true)
    await until(() => a.data('p1').includes('fake$'), 'A\'s prompt')
    await a.req(CH.ptyWrite, { id: 'p1', data: 'echo before-away\n' })
    await until(() => a.data('p1').includes('before-away'), 'A\'s echo')

    a.end() // the abrupt connection end — however it ends, the store only detaches

    // The pane's backend is still live and subsequent output feeds its replay terminal.
    expect(stub.pane('p1').kills, 'no connection end ever kills a pane (REQ-002)').toBe(0)
    stub.pane('p1').raw.write('echo while-away\n')

    // Connection B handshakes on the SAME daemon core.
    const b = connectClient(core)
    await until(() => b.isEstablished(), 'B establishment')
    const sessions = await b.req('pty:sessions', null)
    expect(sessions.ok).toBe(true)
    const list = (sessions as { result: Array<{ id: string }> }).result
    expect(list.map((s) => s.id), 'the surviving pane is in the inventory').toContain('p1')

    const attach = await b.req('pty:attach', { id: 'p1' })
    expect(attach.ok, 'attach on the surviving pane succeeds').toBe(true)
    const snapshot = (attach as { result: { snapshot: string } }).result.snapshot
    expect(snapshot).toContain('before-away')
    expect(snapshot, 'bytes produced while NOBODY was connected are in the snapshot').toContain('while-away')

    // The F18 oracle, now across a real connection boundary: snapshot ⊕ subsequent pty:data
    // reproduces the full stream byte-exactly.
    await b.req(CH.ptyWrite, { id: 'p1', data: 'echo live-again\n' })
    await until(() => b.data('p1').includes('live-again'), 'B\'s live tail')
    const composed = await referenceSerialize([snapshot, ...b.dataFrames('p1')])
    const direct = await referenceSerialize(golden(['echo before-away\n', 'echo while-away\n', 'echo live-again\n']))
    expect(composed, 'no byte lost, duplicated, or reordered across the connection end').toBe(direct)

    expect(stub.pane('p1').kills).toBe(0)
    core.destroy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2414 REQ-002 fatal framing kills the CONNECTION, never the process', () => {
  it('an over-limit frame on one connection ends only that connection; a concurrent one keeps operating; the daemon keeps accepting', async () => {
    const { stub, core } = mkCore()
    const b = connectClient(core)
    await until(() => b.isEstablished(), 'B establishment')
    await b.req(CH.ptySpawn, spawnParams('p2'))
    await until(() => b.data('p2').includes('fake$'), 'B\'s prompt')

    // A second, not-yet-established connection sends a frame-too-large header.
    const c = connectClient(core, { replyToHello: false })
    await until(() => c.frames.some((f) => f.type === 'hello'), 'C received the daemon hello')
    const poison = Buffer.alloc(FRAME_HEADER_BYTES)
    poison.writeUInt32BE(DEFAULT_MAX_FRAME_BYTES + 1, 0)
    c.sendRaw(poison)
    await until(() => c.endedByPeer(), 'the poisoned connection was ended by the daemon')

    // The concurrent connection keeps operating and its pane never died.
    await b.req(CH.ptyWrite, { id: 'p2', data: 'echo still-here\n' })
    await until(() => b.data('p2').includes('still-here'), 'B still served after C\'s fatal framing')
    expect(b.endedByPeer(), 'B was never ended').toBe(false)
    expect(stub.pane('p2').kills).toBe(0)

    // The daemon process keeps listening: a fresh connection still establishes.
    const d = connectClient(core)
    await until(() => d.isEstablished(), 'a fresh post-fatal connection establishes')
    core.destroy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2415 REQ-002 a handshake failure on one connection leaves the daemon serving others (CONV-002)', () => {
  it('a bad first message ends only that connection; the bound one and later ones are unaffected', async () => {
    const { stub, core } = mkCore()
    const b = connectClient(core)
    await until(() => b.isEstablished(), 'B establishment')
    await b.req(CH.ptySpawn, spawnParams('p3'))
    await until(() => b.data('p3').includes('fake$'), 'B\'s prompt')

    // C answers the hello with a REQUEST instead of the client hello — a handshake failure.
    const c = connectClient(core, { replyToHello: false })
    await until(() => c.frames.some((f) => f.type === 'hello'), 'C received the daemon hello')
    c.send({ type: 'req', id: 1, method: 'pty:sessions', params: null } as WireFrame)
    await until(() => c.endedByPeer(), 'the failed-handshake connection was ended')

    await b.req(CH.ptyWrite, { id: 'p3', data: 'echo unbothered\n' })
    await until(() => b.data('p3').includes('unbothered'), 'B still served')
    expect(b.endedByPeer()).toBe(false)
    expect(stub.pane('p3').kills).toBe(0)

    const d = connectClient(core)
    await until(() => d.isEstablished(), 'the daemon still accepts after the handshake failure')
    core.destroy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2447 REQ-012 the daemon-flow handshake establishes on PROTOCOL compatibility only (D4′)', () => {
  it('a client with a DIFFERENT app version but an in-range proto establishes and is served', async () => {
    const { core } = mkCore()
    // The auto-update shape: the daemon advertises V; the client bumped its app version.
    const updated = connectClient(core, { version: '99.99.99-post-update' })
    await until(() => updated.isEstablished(), 'establishment despite the app-version difference')
    const sessions = await updated.req('pty:sessions', null)
    expect(sessions.ok, 'the version-drifted-but-protocol-compatible client is fully served').toBe(true)
    core.destroy()
  })

  it('a client hello with a proto OUTSIDE the compatible range is refused (connection ended); the daemon serves others', async () => {
    const { core } = mkCore()
    const good = connectClient(core)
    await until(() => good.isEstablished(), 'the good connection establishes')

    const bad = connectClient(core, { replyToHello: false })
    await until(() => bad.frames.some((f) => f.type === 'hello'), 'the daemon hello arrived')
    // A deliberately foreign-proto client hello (a poison vector — hand-built by design).
    bad.send({ type: 'hello', proto: 99, role: 'client', version: V } as unknown as WireFrame)
    await until(() => bad.endedByPeer(), 'the out-of-range-proto connection was ended')
    expect(bad.isEstablished()).toBe(false)

    const after = connectClient(core)
    await until(() => after.isEstablished(), 'the daemon still accepts after the proto refusal')
    core.destroy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2448 REQ-006 the lifecycle hooks speak establishment/end — counted for EVERY end path (FINDING-008/012)', () => {
  it('established fires per completed handshake; ended fires for displacement and clean EOF; a failed handshake never counts', async () => {
    let established = 0
    let ended = 0
    let panesSpawned = 0
    let panesExited = 0
    const { core } = mkCore({
      onConnectionEstablished: () => { established++ },
      onConnectionEnded: () => { ended++ },
      onPaneSpawned: () => { panesSpawned++ },
      onPaneExited: () => { panesExited++ }
    })

    const a = connectClient(core)
    await until(() => a.isEstablished(), 'A establishment')
    await until(() => established === 1, 'the establishment hook for A')

    await a.req(CH.ptySpawn, spawnParams('hp'))
    await until(() => a.data('hp').includes('fake$'), 'the pane prompt')
    expect(panesSpawned).toBe(1)

    // B binds — the F20 steal displaces A: the LOSER'S CONNECTION END must decrement the count
    // (a lease displacement is an end path like any other — FINDING-008).
    const b = connectClient(core)
    await until(() => b.isEstablished(), 'B establishment')
    await until(() => a.endedByPeer(), 'A displaced')
    await until(() => established === 2, 'the establishment hook for B')
    await until(() => ended === 1, 'the displaced (established) connection counted as ended')

    // A connection that FAILS its handshake was never established — it must not count as ended.
    const c = connectClient(core, { replyToHello: false })
    await until(() => c.frames.some((f) => f.type === 'hello'), 'C received the daemon hello')
    c.send({ type: 'req', id: 1, method: 'pty:sessions', params: null } as WireFrame)
    await until(() => c.endedByPeer(), 'the failed-handshake connection ended')
    await settle(20)
    expect(established, 'a failed handshake never establishes').toBe(2)
    expect(ended, 'a never-established connection never decrements (FINDING-008)').toBe(1)

    // Clean EOF on B is the second counted end; the pane exit is observed independently.
    await b.req(CH.ptyKill, 'hp')
    await until(() => panesExited === 1, 'the pane exit hook')
    b.end()
    await until(() => ended === 2, 'B\'s clean EOF counted as ended')
    expect(established).toBe(2)
    core.destroy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2416 REQ-008 the lease steal end-to-end: revoked-final for the loser, byte-lossless for the winner', () => {
  it('B\'s bind displaces A (lease:revoked is A\'s FINAL frame); the winner\'s attach recovers bytes A never received; steal-back works', async () => {
    const { core } = mkCore()
    const a = connectClient(core)
    await until(() => a.isEstablished(), 'A establishment')
    await a.req(CH.ptySpawn, spawnParams('fp'))
    await until(() => a.data('fp').includes('fake$'), 'A\'s prompt')

    // A shrinks its flow window then floods WITHOUT acking — the stalled-client shape: the
    // agent-side gate pauses the pane, so part of the flood never reaches A.
    a.send({ type: 'window', size: 512 } as WireFrame)
    await settle(10)
    await a.req(CH.ptyWrite, { id: 'fp', data: 'flood 4 512\n' })
    await until(() => a.data('fp').length >= 512, 'the first window of flood output')
    await settle(50) // the stall: no acks, the gate holds the pane paused

    const goldenFlood = golden(['flood 4 512\n']).join('')
    const aBytes = a.data('fp').length
    expect(aBytes, 'the loser genuinely missed part of the stream (the gate held it)').toBeLessThan(goldenFlood.length)

    // B binds — the steal (tmux attach -d).
    const b = connectClient(core)
    await until(() => b.isEstablished(), 'B establishment')
    await until(() => a.endedByPeer(), 'the displaced connection was ended (orderly, exit-0-shaped)')

    // lease:revoked is A's FINAL frame — nothing follows it.
    const revokedIdx = a.frames.findIndex((f) => f.type === 'evt' && f.channel === AGENT_LEASE_REVOKED_EVT)
    expect(revokedIdx, 'the loser was notified').toBeGreaterThanOrEqual(0)
    expect(revokedIdx, 'lease:revoked is the FINAL frame — nothing after it').toBe(a.frames.length - 1)
    expect(a.evts(AGENT_LEASE_REVOKED_EVT), 'exactly one revocation').toHaveLength(1)

    // The winner recovers the FULL stream — including bytes the loser never received.
    const sessions = await b.req('pty:sessions', null)
    expect((sessions as { result: Array<{ id: string }> }).result.map((s) => s.id)).toContain('fp')
    const attach = await b.req('pty:attach', { id: 'fp' })
    expect(attach.ok).toBe(true)
    const snapshot = (attach as { result: { snapshot: string } }).result.snapshot
    await b.req(CH.ptyWrite, { id: 'fp', data: 'echo tail\n' })
    await until(() => b.data('fp').includes('tail'), 'the winner\'s live tail')
    const composed = await referenceSerialize([snapshot, ...b.dataFrames('fp')])
    const direct = await referenceSerialize(golden(['flood 4 512\n', 'echo tail\n']))
    expect(composed, 'no agent-side byte loss across the steal (REQ-008)').toBe(direct)

    // The daemon process survived the displacement, and a steal-back is just another attach.
    const c = connectClient(core)
    await until(() => c.isEstablished(), 'C establishment (steal-back)')
    await until(() => b.endedByPeer(), 'the former winner was displaced in turn')
    const back = await c.req('pty:attach', { id: 'fp' })
    expect(back.ok, 'steal-back reattaches the same surviving pane').toBe(true)
    expect((back as { result: { snapshot: string } }).result.snapshot).toContain('tail')
    core.destroy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2449 REQ-018 two daemon cores side by side share NOTHING (the per-workspace model, in-process)', () => {
  it('independent stores: inventories never cross, same pane ids coexist, one core\'s steal never revokes the other\'s connection', async () => {
    const { core: coreA } = mkCore()
    const { core: coreB } = mkCore()

    const a = connectClient(coreA)
    const b = connectClient(coreB)
    await until(() => a.isEstablished() && b.isEstablished(), 'both workspaces established concurrently')

    // The SAME pane id in both — truly independent stores never collide (zero shared state).
    await a.req(CH.ptySpawn, spawnParams('p1'))
    await b.req(CH.ptySpawn, spawnParams('p1'))
    await until(() => a.data('p1').includes('fake$') && b.data('p1').includes('fake$'), 'both prompts')
    await a.req(CH.ptyWrite, { id: 'p1', data: 'echo alpha-only\n' })
    await b.req(CH.ptyWrite, { id: 'p1', data: 'echo beta-only\n' })
    await until(() => a.data('p1').includes('alpha-only') && b.data('p1').includes('beta-only'), 'interleaved traffic landed')
    expect(a.data('p1'), 'workspace A never sees B\'s bytes').not.toContain('beta-only')
    expect(b.data('p1'), 'workspace B never sees A\'s bytes').not.toContain('alpha-only')

    // A second bind on core B steals B's lease — and must NOT touch A's connection (no
    // lease:revoked ever crosses workspace boundaries, REQ-018).
    const b2 = connectClient(coreB)
    await until(() => b2.isEstablished(), 'B2 establishment')
    await until(() => b.endedByPeer(), 'B displaced within ITS OWN workspace')
    expect(a.endedByPeer(), 'workspace A\'s connection was never perturbed').toBe(false)
    expect(a.evts(AGENT_LEASE_REVOKED_EVT), 'no cross-workspace revocation').toHaveLength(0)

    // A is still fully served after all of B's churn.
    await a.req(CH.ptyWrite, { id: 'p1', data: 'echo alpha-still\n' })
    await until(() => a.data('p1').includes('alpha-still'), 'A served after B\'s steal')

    // Destroying core B leaves core A serving (no shared mutable state by construction).
    coreB.destroy()
    await a.req(CH.ptyWrite, { id: 'p1', data: 'echo alpha-final\n' })
    await until(() => a.data('p1').includes('alpha-final'), 'A served after B\'s destroy')
    coreA.destroy()
  })
})
