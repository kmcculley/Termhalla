// INTEGRATION-phase suite — Remote Agent v1 roadmap (.orky/roadmap.json → integration.summary).
// The full assembled stack, no seam mocked: the REAL RemoteWorkspaceManager (F21) connects via
// the REAL F19 provisioned bootstrap (connectWithProvisioning — system-ssh argv through the
// frozen fake-ssh shim, exactly the services.ts wiring shape) to the REAL agent artifact (F16),
// bundled on demand through the SAME vite.agent.config.ts `npm run build` uses and spawned as a
// plain local child process — the IDENTICAL protocol path production runs over ssh (locked
// decision 1). F15's frames, F17's acks (the manager's own policy) and F18's inventory flow all
// ride the same real pipe.
//
// Mandate coverage (feature spans in brackets):
//   point 8 — TEST-IT-101: a spawn with NO remote field never touches the remote stack: zero
//             connect attempts, zero pushes, zero ownership [F21 alone, the local-identity gate].
//   point 1 — TEST-IT-102: the full pty round-trip (spawn/write/resize/data/status/cwd/exit)
//             renderer-send to agent artifact and back [F21 × F19 × F16 × F15].
//   point 5 — TEST-IT-102 (absent → upload → serve), TEST-IT-103 (version-mismatch → overwrite →
//             serve), TEST-IT-104 (matching → NO upload) — the provisioning truth table exercised
//             by the manager end to end, with the REAL artifact [F21 × F19 × F16].
//   point 3 — TEST-IT-106: an output flood 64× the (shrunk) agent window drains to completion
//             ONLY because the manager's ack policy keeps resuming the agent's pty — over the
//             real child-process wire, with exact ack conservation [F21 × F17 × F16 × F15].
//   CONV-054 reality check — TEST-IT-105: after a real transport drop the v1 agent's sessions
//             die with it; the manager's reconnect inventory surfaces the pane as exited and a
//             fresh pane spawns cleanly on the new connection [F21 × F19 × F18 × F16].
//
// Additive only: no existing test or source file is touched.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import {
  mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { build } from 'vite'
import { encodeFrame, WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame, AckFrame } from '@shared/remote/protocol'
import { CH, type PtySpawnArgs } from '@shared/ipc-contract'
import type { NamedAgent } from '@shared/remote-agents'
import type { RemoteWorkspaceState } from '@shared/remote-workspace'
import { connectWithProvisioning, type AgentSessionHandle } from '../src/remote-client/bootstrap'
import { remoteAgentInstallPath } from '../src/remote-client/ssh-command'
import {
  RemoteWorkspaceManager,
  type RemoteConnectFn, type RemoteManagerDeps
} from '../src/main/remote/remote-workspace-manager'

const root = process.cwd()
const shim = resolve(root, 'tests/fixtures/fake-ssh.mjs')
const pkgVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version
const AGENT: NamedAgent = { id: 'agent-1', name: 'itbox', host: 'stack.example', user: 'ci' }

const OSC_C = '\x1b]133;C\x07'
const oscD = (code: number): string => `\x1b]133;D;${code}\x07`

let outDir = ''
let bundlePath = ''
let home = ''
let logFile = ''
const liveManagers: RemoteWorkspaceManager[] = []
const liveSessions: AgentSessionHandle[] = []

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'termhalla-remote-it-'))
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'), // the SAME config npm run build uses
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })
  bundlePath = join(outDir, 'termhalla-agent.cjs')
}, 240_000)

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'termhalla-it-home-'))
  logFile = join(home, 'fake-ssh-log.jsonl')
  process.env.FAKE_SSH_HOME = home
  process.env.FAKE_SSH_LOG = logFile
  delete process.env.FAKE_SSH_RIG
})

afterEach(() => {
  for (const m of liveManagers.splice(0)) { try { m.stop() } catch { /* gone */ } }
  for (const s of liveSessions.splice(0)) { try { s.kill() } catch { /* gone */ } }
  delete process.env.FAKE_SSH_RIG
  delete process.env.FAKE_SSH_LOG
  delete process.env.FAKE_SSH_HOME
  rmSync(home, { recursive: true, force: true })
})

afterAll(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }) })

// ── shim-ledger + install-path helpers (the frozen F19 suite's vocabulary) ───────────────────
const logEntries = (): Array<{ kind: string }> =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []
const countKind = (kind: string): number => logEntries().filter((e) => e.kind === kind).length

const installedAt = (version: string): string =>
  join(home, remoteAgentInstallPath(undefined, version).slice(2))

/** A canned wrong-version agent occupying the install path (the mismatch precondition): emits
 *  one real-encoded hello and exits on stdin end — an independent peer over the same wire. */
const installCannedAgent = (advertisedVersion: string): void => {
  const helloHex = Buffer.from(encodeFrame(
    { type: 'hello', proto: WIRE_PROTO, role: 'agent', version: advertisedVersion, capabilities: ['pty', 'status'] } as WireFrame
  )).toString('hex')
  const p = installedAt(pkgVersion)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `
process.stdout.write(Buffer.from('${helloHex}', 'hex'))
process.stdin.on('data', () => {})
process.stdin.on('end', () => process.exit(0))
`)
}

// ── the stack harness: real manager over the real bootstrap over the shim ───────────────────
interface Stack {
  mgr: RemoteWorkspaceManager
  sends: Array<[string, ...unknown[]]>
  /** Every frame the manager put on the wire (reqs + acks), per connection in order. */
  outbound: WireFrame[]
  raw: AgentSessionHandle[]
  connectCalls(): number
  dataFrames(paneId: string): string[]
  dataText(paneId: string): string
  states(): RemoteWorkspaceState[]
}

const mkStack = (over: Partial<RemoteManagerDeps> = {}): Stack => {
  const sends: Array<[string, ...unknown[]]> = []
  const outbound: WireFrame[] = []
  const raw: AgentSessionHandle[] = []
  let calls = 0
  const connect: RemoteConnectFn = async ({ agent, version, artifactPath, signal }) => {
    calls++
    const r = await connectWithProvisioning({
      agent, version, artifactPath, signal,
      ptyBackend: 'fake', // no real node-pty anywhere in CI (locked decision 1)
      ssh: { program: process.execPath, prefixArgs: [shim] }
    })
    if (!r.ok) return r
    raw.push(r.session)
    liveSessions.push(r.session)
    const inner = r.session
    return {
      ok: true,
      session: {
        version: inner.version,
        capabilities: inner.capabilities,
        send: (f: WireFrame) => { outbound.push(f); inner.send(f) },
        onFrame: (cb: (f: WireFrame) => void) => inner.onFrame(cb),
        onExit: (cb: (code: number | null) => void) => inner.onExit(cb),
        kill: () => inner.kill()
      }
    }
  }
  const mgr = new RemoteWorkspaceManager({
    send: (ch, ...a) => sends.push([ch, ...a]),
    loadAgents: async () => [AGENT],
    connect,
    version: pkgVersion, // the ONE manifest version — the same value the bundle inlined
    artifactPath: bundlePath,
    scheduler: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>)
    },
    ackQuietMs: 50,
    diag: () => {},
    ...over
  })
  liveManagers.push(mgr)
  const dataFrames = (paneId: string): string[] =>
    sends.filter(([ch, id]) => ch === CH.ptyData && id === paneId).map(([, , d]) => String(d))
  return {
    mgr, sends, outbound, raw,
    connectCalls: () => calls,
    dataFrames,
    dataText: (paneId) => dataFrames(paneId).join(''),
    states: () => sends.filter(([ch]) => ch === CH.remoteState).map(([, s]) => s as RemoteWorkspaceState)
  }
}

const spawnArgs = (id: string, workspaceId = 'ws-1'): PtySpawnArgs => ({
  id, shellId: 'default', cwd: '/home/remote', cols: 80, rows: 24,
  remote: { workspaceId, agentId: AGENT.id }
})

const waitFor = async (cond: () => boolean, what: string, ms = 60_000): Promise<void> => {
  const deadline = Date.now() + ms
  for (;;) {
    if (cond()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-101 mandate point 8 — a local spawn never touches the remote stack [F21]', () => {
  it('no remote field: zero connect attempts, zero routed sends, zero ownership, zero states', async () => {
    const s = mkStack()
    const adopted = await s.mgr.spawn({ id: 'local-1', shellId: 'default', cwd: 'C:/tmp', cols: 80, rows: 24 })
    expect(adopted, 'the manager declines a local spawn immediately').toBe(false)
    expect(s.connectCalls(), 'no connection attempt for a local pane').toBe(0)
    expect(s.sends, 'no state push, no pane frame — the local path is untouched').toEqual([])
    expect(s.mgr.owns('local-1')).toBe(false)
    expect(s.mgr.currentStates()).toEqual([])
    expect(countKind('launch'), 'the shim was never invoked').toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-102 mandate points 1+5(absent) — absent → provision → the full pty round-trip through the real stack [F21 × F19 × F16 × F15]', () => {
  it('uploads the real bundle into an empty home, then round-trips spawn/write/resize/data/status/cwd/exit', async () => {
    const s = mkStack()

    await s.mgr.connectWorkspace('ws-1', AGENT.id)
    const phases = s.states().map((st) => st.phase)
    expect(phases[0], 'the connecting state is pushed first').toBe('connecting')
    expect(phases[phases.length - 1]).toBe('connected')
    const connected = s.states()[s.states().length - 1]
    expect([...connected.capabilities].sort(), 'capabilities come from the REAL artifact\'s hello').toEqual(['pty', 'status'])
    expect(s.raw[0].version, 'the version-lock held end to end').toBe(pkgVersion)
    expect(countKind('upload'), 'absent → exactly one provision').toBe(1)
    expect(countKind('launch'), 'probe, then relaunch of the uploaded artifact').toBe(2)
    expect(readFileSync(installedAt(pkgVersion))).toEqual(readFileSync(bundlePath))

    // Fresh spawn polarity + prompt.
    expect(await s.mgr.spawn(spawnArgs('it-pane-1'))).toBe(false)
    await waitFor(() => s.dataText('it-pane-1').includes('fake$'), 'the remote prompt')
    // Idempotent re-spawn (the same-process remount shape): adopt, no second wire spawn.
    expect(await s.mgr.spawn(spawnArgs('it-pane-1'))).toBe(true)
    const spawnReqs = s.outbound.filter((f) =>
      f.type === 'req' && f.method === CH.ptySpawn && (f.params as { id?: string })?.id === 'it-pane-1')
    expect(spawnReqs.length, 'a pane id is never re-spawned on the same connection').toBe(1)

    // Write → data.
    s.mgr.write('it-pane-1', 'echo remote-round-trip\n')
    await waitFor(() => s.dataText('it-pane-1').includes('remote-round-trip'), 'the echoed pty:data')

    // Resize → observed by the shell; a redundant resize is suppressed on the wire.
    s.mgr.resize('it-pane-1', 100, 31)
    s.mgr.resize('it-pane-1', 100, 31)
    s.mgr.write('it-pane-1', 'size\n')
    await waitFor(() => s.dataText('it-pane-1').includes('size=100x31'), 'the resized size report')
    const resizeReqs = s.outbound.filter((f) => f.type === 'req' && f.method === CH.ptyResize)
    expect(resizeReqs.length, 'the redundant resize never reached the wire (the ConPTY gotcha, applied remotely)').toBe(1)

    // Status chips are agent-sourced: a pty:status push crossed the whole stack.
    await waitFor(() => s.sends.some(([ch, id]) => ch === CH.ptyStatus && id === 'it-pane-1'), 'a routed pty:status push')

    // cwd rides the wire to the renderer send.
    s.mgr.write('it-pane-1', 'cwd /srv/app\n')
    await waitFor(() => s.sends.some(([ch, id, cwd]) => ch === CH.ptyCwd && id === 'it-pane-1' && cwd === '/srv/app'), 'the routed pty:cwd push')

    // Exit crosses back with its code, and the manager releases ownership.
    s.mgr.write('it-pane-1', 'exit 4\n')
    await waitFor(() => s.sends.some(([ch, id, code]) => ch === CH.ptyExit && id === 'it-pane-1' && code === 4), 'the routed pty:exit push')
    expect(s.mgr.owns('it-pane-1')).toBe(false)
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-103 mandate point 5 (version-mismatch) — overwrite provisioning through the manager [F21 × F19 × F16]', () => {
  it('a wrong-version installed agent is overwritten with the real bundle, which then serves', async () => {
    installCannedAgent('0.0.1-wrong')
    const s = mkStack()
    await s.mgr.connectWorkspace('ws-1', AGENT.id)
    expect(s.states()[s.states().length - 1].phase).toBe('connected')
    expect(s.raw[0].version).toBe(pkgVersion)
    expect(countKind('upload'), 'mismatch → exactly one overwrite upload').toBe(1)
    expect(readFileSync(installedAt(pkgVersion)), 'the real bundle replaced the impostor byte-identically').toEqual(readFileSync(bundlePath))

    // The uploaded artifact IS the agent that then serves.
    expect(await s.mgr.spawn(spawnArgs('it-pane-m'))).toBe(false)
    s.mgr.write('it-pane-m', 'echo served-after-overwrite\n')
    await waitFor(() => s.dataText('it-pane-m').includes('served-after-overwrite'), 'service from the overwritten install')
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-104 mandate point 5 (matching) — a matching installed agent is used as-is [F21 × F19 × F16]', () => {
  it('connects with ZERO uploads and ONE launch when the right version already sits at the install path', async () => {
    const p = installedAt(pkgVersion)
    mkdirSync(dirname(p), { recursive: true })
    copyFileSync(bundlePath, p)
    const s = mkStack()
    await s.mgr.connectWorkspace('ws-1', AGENT.id)
    expect(s.states()[s.states().length - 1].phase).toBe('connected')
    expect(s.raw[0].version).toBe(pkgVersion)
    expect(countKind('upload'), 'a matching agent must never be re-provisioned').toBe(0)
    expect(countKind('launch'), 'one probe-launch, no relaunch').toBe(1)
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-105 the shipped v1 reconnect reality (CONV-054) — a real transport drop, then the inventory flow [F21 × F19 × F18 × F16]', () => {
  it('after the drop the pane surfaces as exited from the (empty) inventory, and a fresh pane spawns on the new connection', async () => {
    const p = installedAt(pkgVersion)
    mkdirSync(dirname(p), { recursive: true })
    copyFileSync(bundlePath, p)
    const s = mkStack()

    expect(await s.mgr.spawn(spawnArgs('it-pane-a'))).toBe(false)
    await waitFor(() => s.dataText('it-pane-a').includes('fake$'), 'the first connection\'s prompt')

    // A real transport drop: the wire (ssh child + agent process) dies with the disconnect.
    s.mgr.disconnectWorkspace('ws-1')
    const afterDrop = s.states()[s.states().length - 1]
    expect(afterDrop.phase).toBe('disconnected')
    expect(afterDrop.reason).toBe('cancelled')

    // Reconnect: the v1 agent is NOT daemonized — its store died with the stdio connection, so
    // the inventory is empty and the tracked pane surfaces as exited (never silently vanishes).
    await s.mgr.connectWorkspace('ws-1', AGENT.id)
    await waitFor(() => s.sends.some(([ch, id, code]) => ch === CH.ptyExit && id === 'it-pane-a' && code === 0),
      'the tracked pane surfacing as exited from the empty inventory')
    expect(s.dataText('it-pane-a')).toContain('[remote session ended]')
    expect(s.mgr.owns('it-pane-a')).toBe(false)
    expect(countKind('launch'), 'two real launches — one per connection').toBe(2)

    // The new connection serves fresh panes (fresh uuid discipline: a NEW id, never a reuse).
    expect(await s.mgr.spawn(spawnArgs('it-pane-b'))).toBe(false)
    s.mgr.write('it-pane-b', 'echo second-life\n')
    await waitFor(() => s.dataText('it-pane-b').includes('second-life'), 'service on the reconnect connection')
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-IT-106 mandate point 3 over the real wire — the manager\'s acks drain a flood 64× the agent window [F21 × F17 × F16 × F15]', () => {
  it('the flood completes with full integrity and the acks conserve the delivered units exactly', async () => {
    const WINDOW = 4096
    const CHUNKS = 64
    const CHUNK = 4096 // 256 KiB total — 64× the shrunk window; a non-acking client provably
                       // stalls at ~1 window (frozen TEST-795), so completion REQUIRES the
                       // manager's acks to keep resuming the agent-side pty.
    const p = installedAt(pkgVersion)
    mkdirSync(dirname(p), { recursive: true })
    copyFileSync(bundlePath, p)
    const s = mkStack({ ackEveryBytes: WINDOW })

    await s.mgr.connectWorkspace('ws-1', AGENT.id)
    // Shrink the agent's connection-default window over the SAME live wire (a protocol-legal
    // client frame; production never sends one — the 1 MiB default is deliberately uncrossable
    // for a healthy client, which is why observing flow control needs this).
    s.raw[0].send({ type: 'window', size: WINDOW } as WireFrame)

    expect(await s.mgr.spawn(spawnArgs('it-flood'))).toBe(false)
    await waitFor(() => s.dataText('it-flood').includes('fake$'), 'the flood pane prompt')

    s.mgr.write('it-flood', `flood ${CHUNKS} ${CHUNK}\n`)
    await waitFor(() => s.dataText('it-flood').includes(oscD(0)), 'the flood to complete under the manager\'s acks', 90_000)

    const all = s.dataText('it-flood')
    const start = all.indexOf(OSC_C) + OSC_C.length
    const end = all.indexOf(oscD(0))
    expect(start).toBeGreaterThan(0)
    expect(end - start, 'the full flood arrived, nothing dropped or duplicated').toBe(CHUNKS * CHUNK)

    const ackCount = (): number => s.outbound.filter((f) => f.type === 'ack').length
    expect(ackCount(), 'the drain took many ack-driven resume cycles').toBeGreaterThan(CHUNKS / 2)

    // The real quiet-flush timer (50 ms) settles the residue; then conservation holds exactly.
    const delivered = (): number => s.dataFrames('it-flood').reduce((n, d) => n + d.length, 0)
    const acked = (): number => s.outbound
      .filter((f): f is AckFrame => f.type === 'ack' && f.id === 'it-flood')
      .reduce((n, f) => n + f.bytes, 0)
    await waitFor(() => acked() === delivered(), 'the residue flush to conserve acked == delivered', 15_000)
  }, 150_000)
})
