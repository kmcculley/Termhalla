// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — re-derived after the
// ESC-001 loop-back; REQ-005/007/008/011/012/013/015/016/018 as amended per D4′/D6′).
// The daemon flow end-to-end through the REAL client library (connectWithProvisioning) over the
// sanctioned-amended fake-ssh shim (REQ-016, CONV-012): real child processes, the real protocol
// bytes, the REAL agent artifact bundled through vite.agent.config.ts (the TEST-774 pattern),
// PERSISTENT detached daemons KEYED BY WORKSPACE TOKEN per fake home that outlive individual
// shim invocations. No network, no real ssh, no native module. Every ledger assertion is
// CONV-051-scoped (exact kind sequences / explicit kind filters).
//
// Covers: the opt-in flow with the { workspaceId } scope (REQ-013), first-connect
// spawn-then-attach + no-second-spawn ledger (REQ-011/REQ-009), the headline close/reopen
// survival scenario + the F17×F18 stalled-acks weld (REQ-015), the fake-lane lease steal
// (REQ-008), concurrent first-connects to ONE workspace (REQ-005), the stale-remnant and
// never-accepting rigs (REQ-007), the AUTO-UPDATE reattach (old app version + SAME proto ⇒
// establish — the D4′ headline) and the honest non-destructive PROTO-drift refusal (REQ-012),
// the determinate abort during the spawn-wait (REQ-013), and same-host workspace coexistence
// over two distinct tokens (REQ-018).
//
// Shim env contract consumed here (amended through THIS tests phase):
//   FAKE_SSH_DAEMON_SOCKET   explicit daemon socket path override (else derived per fake home ×
//                            wsToken — a named pipe on win32,
//                            <home>/.termhalla/agent/agent-<ws>.sock elsewhere)
//   FAKE_SSH_DAEMON_IDLE_MS  appended to the bridge argv as --idle-timeout-ms=<n>
//   ledger kinds             'daemon-attach' (with the ws token) per daemon-flow launch;
//                            'daemon-spawn' (with the token) appended when the bridge's status
//                            line reports a fresh spawn
//
// Old-version / drift substrates (REQ-012/REQ-016): built from the SAME vite pipeline with only
// src/agent/version.ts (app version) and — for the drift bundle — the WIRE_PROTO literal in
// src/shared/remote/handshake.ts transformed. NEVER a canned fake for the persistent daemon
// (which is also why DAEMON_PROTO_COMPAT must be DERIVED from WIRE_PROTO — see 04-tests.md).
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import {
  mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect as netConnect, type Socket } from 'node:net'
import { build } from 'vite'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { createFrameDecoder, encodeFrame } from '@shared/remote/protocol'
import type { WireFrame, ResFrame, DecodedItem } from '@shared/remote/protocol'
import { CH } from '@shared/ipc-contract'
import { AGENT_LEASE_REVOKED_EVT } from '@shared/remote-agent-api'
import { connectWithProvisioning, type AgentSessionHandle, type BootstrapOptions, type ConnectResult } from '../src/remote-client/bootstrap'
import { remoteAgentInstallPath } from '../src/remote-client/ssh-command'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import { HISTORY_LIMIT_DEFAULT } from '../src/agent/replay'

const root = process.cwd()
const shim = resolve(root, 'tests/fixtures/fake-ssh.mjs')
const pkgVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version
const OLD_V = '0.0.1-old'          // same proto, older app version — the auto-update substrate
const DRIFT_V = '0.0.2-proto2'     // WIRE_PROTO transformed to 2 — the protocol-breaking substrate
const seed = { host: 'daemon.example', user: 'ci' }
const WS_MAIN = 'wsmain'
const WS_B = 'wsbeta'
const COLS = 40
const ROWS = 6

let outDir = ''
let oldOutDir = ''
let driftOutDir = ''
let bundlePath = ''
let oldBundlePath = ''
let driftBundlePath = ''
let home = ''
let logFile = ''
const kills: Array<() => void> = []
const dummies: ChildProcess[] = []
const rawSockets: Socket[] = []

const versionPlugin = (v: string, protoTwo: boolean) => ({
  name: `termhalla-0024-transform-${v}`,
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    const n = id.replace(/\\/g, '/')
    if (n.endsWith('src/agent/version.ts')) {
      return { code: `export const AGENT_VERSION: string = '${v}'\n`, map: null }
    }
    if (protoTwo && n.endsWith('src/shared/remote/handshake.ts')) {
      // A genuinely protocol-breaking release: the ONE wire-proto literal bumps; everything
      // else (incl. DAEMON_PROTO_COMPAT, derived from it) follows by construction.
      return { code: code.replace(/WIRE_PROTO = 1/, 'WIRE_PROTO = 2'), map: null }
    }
    return null
  }
})

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'termhalla-0024-it-'))
  oldOutDir = mkdtempSync(join(tmpdir(), 'termhalla-0024-it-old-'))
  driftOutDir = mkdtempSync(join(tmpdir(), 'termhalla-0024-it-drift-'))
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'), // the SAME config npm run build uses
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'),
    logLevel: 'error',
    plugins: [versionPlugin(OLD_V, false)],
    build: { outDir: oldOutDir, emptyOutDir: true }
  })
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'),
    logLevel: 'error',
    plugins: [versionPlugin(DRIFT_V, true)],
    build: { outDir: driftOutDir, emptyOutDir: true }
  })
  bundlePath = join(outDir, 'termhalla-agent.cjs')
  oldBundlePath = join(oldOutDir, 'termhalla-agent.cjs')
  driftBundlePath = join(driftOutDir, 'termhalla-agent.cjs')
}, 600_000)

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'termhalla-0024-home-'))
  logFile = join(home, 'fake-ssh-log.jsonl')
  process.env.FAKE_SSH_HOME = home
  process.env.FAKE_SSH_LOG = logFile
  process.env.FAKE_SSH_DAEMON_IDLE_MS = '90000' // long: tests that need idle-out shrink it
  delete process.env.FAKE_SSH_RIG
  delete process.env.FAKE_SSH_DAEMON_SOCKET
})

afterEach(async () => {
  for (const s of rawSockets.splice(0)) { try { s.destroy() } catch { /* gone */ } }
  for (const k of kills.splice(0)) { try { k() } catch { /* gone */ } }
  for (const d of dummies.splice(0)) { try { d.kill() } catch { /* gone */ } }
  for (const ws of [WS_MAIN, WS_B]) killDaemonAt(home, ws)
  await new Promise((r) => setTimeout(r, 100))
  delete process.env.FAKE_SSH_RIG
  delete process.env.FAKE_SSH_DAEMON_SOCKET
  delete process.env.FAKE_SSH_DAEMON_IDLE_MS
  delete process.env.FAKE_SSH_LOG
  delete process.env.FAKE_SSH_HOME
  try { rmSync(home, { recursive: true, force: true }) } catch { /* a dying daemon may hold its log a beat */ }
})

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true })
  if (oldOutDir) rmSync(oldOutDir, { recursive: true, force: true })
  if (driftOutDir) rmSync(driftOutDir, { recursive: true, force: true })
})

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
const metaPathAt = (h: string, ws: string): string => join(h, '.termhalla', 'agent', `daemon-${ws}.json`)
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch { return false } }
const daemonPidAt = (h: string, ws: string): number | null => {
  try { return (JSON.parse(readFileSync(metaPathAt(h, ws), 'utf8')) as { pid: number }).pid } catch { return null }
}
function killDaemonAt(h: string, ws: string): void {
  const pid = daemonPidAt(h, ws)
  if (pid !== null) { try { process.kill(pid) } catch { /* already gone */ } }
}

const logEntries = (): Array<{ kind: string; ws?: string }> =>
  existsSync(logFile)
    ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []
const countKind = (kind: string): number => logEntries().filter((e) => e.kind === kind).length

const installedAt = (version: string): string =>
  join(home, remoteAgentInstallPath(undefined, version).slice(2))
const preseedArtifact = (version: string, from: string): void => {
  const p = installedAt(version)
  mkdirSync(dirname(p), { recursive: true })
  copyFileSync(from, p)
}

const daemonOpts = (over: Partial<BootstrapOptions> = {}, workspaceId: string = WS_MAIN): BootstrapOptions => ({
  agent: seed,
  version: pkgVersion,
  artifactPath: bundlePath,
  ptyBackend: 'fake',
  ssh: { program: process.execPath, prefixArgs: [shim] },
  daemon: { workspaceId },
  ...over
})

const waitFor = async (cond: () => boolean, what: string, ms = 60_000): Promise<void> => {
  const deadline = Date.now() + ms
  for (;;) {
    if (cond()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

interface Driver {
  session: AgentSessionHandle
  frames: WireFrame[]
  exitCode: () => number | null | 'pending'
  req: (method: string, params: unknown) => Promise<ResFrame>
  data: (id: string) => string
  dataFrames: (id: string) => string[]
  evts: (channel: string) => WireFrame[]
}

const drive = (session: AgentSessionHandle): Driver => {
  kills.push(() => session.kill())
  const frames: WireFrame[] = []
  let reqSeq = 0
  let exit: number | null | 'pending' = 'pending'
  const waiters = new Map<number, (f: ResFrame) => void>()
  session.onFrame((f) => {
    frames.push(f)
    if (f.type === 'res') {
      const w = waiters.get(f.id as number)
      if (w) { waiters.delete(f.id as number); w(f) }
    }
  })
  session.onExit((code) => { exit = code })
  const dataFrames = (id: string): string[] =>
    frames.filter((f) => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === id)
      .map((f) => String((f as { args: unknown[] }).args[1]))
  return {
    session,
    frames,
    exitCode: () => exit,
    req: (method, params) => new Promise<ResFrame>((res) => {
      const id = ++reqSeq
      waiters.set(id, res)
      session.send({ type: 'req', id, method, params } as WireFrame)
    }),
    data: (id) => dataFrames(id).join(''),
    dataFrames,
    evts: (channel) => frames.filter((f) => f.type === 'evt' && f.channel === channel)
  }
}

const spawnParams = (id: string): unknown => ({ id, shellId: 'default', cwd: '/home/remote', cols: COLS, rows: ROWS })

const expectOk = (r: ConnectResult): AgentSessionHandle => {
  expect(r.ok, r.ok ? '' : r.diagnostic).toBe(true)
  if (!r.ok) throw new Error('unreachable')
  return r.session
}

/** Reference serialization with the daemon replay's option parity (the F18 oracle). */
const referenceSerialize = async (chunks: string[]): Promise<string> => {
  const term = new Terminal({ cols: COLS, rows: ROWS, scrollback: HISTORY_LIMIT_DEFAULT, allowProposedApi: true })
  const addon = new SerializeAddon()
  term.loadAddon(addon as unknown as Parameters<Terminal['loadAddon']>[0])
  for (const c of chunks) await new Promise<void>((r) => term.write(c, r))
  const out = addon.serialize()
  term.dispose()
  return out
}

const golden = (writes: string[]): string[] => {
  const handle = createFakePtyBackend().spawn({ id: 'golden', shellId: 'default', cwd: '/home/remote', cols: COLS, rows: ROWS })
  const out: string[] = []
  handle.onData((d) => out.push(d))
  for (const w of writes) handle.write(w)
  return out
}

const attachSnapshot = async (d: Driver, id: string): Promise<string> => {
  const res = await d.req('pty:attach', { id })
  expect(res.ok, `pty:attach ${id}`).toBe(true)
  return (res as { result: { snapshot: string } }).result.snapshot
}

const spawnDummy = (): ChildProcess => {
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  dummies.push(c)
  return c
}

/** A raw wire-proto-2 driver over the daemon socket — the "protocol-compatible client" of the
 *  REQ-012 drift rig (a test rig, so the proto-2 hello is deliberately hand-built: the shipped
 *  barrel speaks proto 1 by definition). */
interface RawDriver {
  frames: WireFrame[]
  req: (method: string, params: unknown) => Promise<ResFrame>
  data: (id: string) => string
  dataFrames: (id: string) => string[]
  end: () => void
}
const rawProto2Client = (sockPath: string): Promise<RawDriver> => new Promise((resolvePromise, reject) => {
  const s = netConnect(sockPath)
  rawSockets.push(s)
  const decoder = createFrameDecoder()
  const frames: WireFrame[] = []
  let established = false
  let reqSeq = 0
  const waiters = new Map<number, (f: ResFrame) => void>()
  const dataFrames = (id: string): string[] =>
    frames.filter((f) => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === id)
      .map((f) => String((f as { args: unknown[] }).args[1]))
  const driver: RawDriver = {
    frames,
    req: (method, params) => new Promise<ResFrame>((res) => {
      const id = ++reqSeq
      waiters.set(id, res)
      s.write(encodeFrame({ type: 'req', id, method, params } as WireFrame))
    }),
    data: (id) => dataFrames(id).join(''),
    dataFrames,
    end: () => s.end()
  }
  s.on('data', (chunk: Buffer) => {
    let items: DecodedItem[]
    try { items = decoder.push(chunk) } catch { return }
    for (const item of items) {
      if (item.kind !== 'message') continue
      const f = item.frame
      frames.push(f)
      if (!established && f.type === 'hello') {
        s.write(encodeFrame({ type: 'hello', proto: 2, role: 'client', version: 'proto2-driver' } as unknown as WireFrame))
        established = true
        resolvePromise(driver)
      }
      if (f.type === 'res') {
        const w = waiters.get(f.id as number)
        if (w) { waiters.delete(f.id as number); w(f) }
      }
    }
  })
  s.on('error', (e) => { if (!established) reject(e) })
  setTimeout(() => { if (!established) reject(new Error('raw proto-2 handshake timeout')) }, 30_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2427 REQ-013/REQ-016 the option ABSENT is byte-identical: the pre-0024 ledger through the amended shim', () => {
  it('a no-option connect produces exactly the pre-0024 exec-channel sequence — no daemon kinds anywhere', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    const r = await connectWithProvisioning({
      agent: seed, version: pkgVersion, artifactPath: bundlePath, ptyBackend: 'fake',
      ssh: { program: process.execPath, prefixArgs: [shim] }
    })
    const s = expectOk(r)
    expect(logEntries().map((e) => e.kind), 'the pre-0024 pinned ledger, byte-identical').toEqual(['launch'])
    expect(countKind('daemon-attach'), 'the legacy flow never takes the daemon path').toBe(0)
    expect(countKind('daemon-spawn')).toBe(0)
    s.kill()
  }, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2428 REQ-013/REQ-011/REQ-009 the opt-in flow: provision-once BEFORE the daemon launch; no second spawn', () => {
  it('absent artifact: daemon probe 127 → one upload → daemon attach; a second connect attaches without spawning', async () => {
    const r1 = await connectWithProvisioning(daemonOpts())
    const d1 = drive(expectOk(r1))
    // Ordering (REQ-013): the F19 provision-once flow ran BEFORE the (successful) daemon launch,
    // against the same version-embedded install path. CONV-051: explicit kind filter.
    const flowKinds = logEntries().map((e) => e.kind).filter((k) => k === 'daemon-attach' || k === 'upload' || k === 'launch')
    expect(flowKinds).toEqual(['daemon-attach', 'upload', 'daemon-attach'])
    expect(countKind('daemon-spawn'), 'exactly one daemon spawn').toBe(1)
    expect(logEntries().find((e) => e.kind === 'daemon-spawn')?.ws, 'the spawn is workspace-attributed').toBe(WS_MAIN)
    expect(readFileSync(installedAt(pkgVersion))).toEqual(readFileSync(bundlePath))

    // The daemon serves a real pty round-trip.
    const spawned = await d1.req(CH.ptySpawn, spawnParams('q1'))
    expect(spawned.ok).toBe(true)
    await waitFor(() => d1.data('q1').includes('fake$'), 'the pane prompt')

    // Second connect to the same WORKSPACE: attach only — the ledger shows NO second spawn.
    const r2 = await connectWithProvisioning(daemonOpts())
    const d2 = drive(expectOk(r2))
    expect(countKind('daemon-spawn'), 'attach-to-existing never respawns (REQ-011)').toBe(1)
    const sessions = await d2.req('pty:sessions', null)
    expect((sessions as { result: Array<{ id: string }> }).result.map((s) => s.id)).toContain('q1')
    d2.session.kill()
    d1.session.kill()
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2429 REQ-015 the headline: close Termhalla, reopen, and the pane is exactly where it was', () => {
  it('spawn → output → tear the channel down → same daemon pid survives → reattach byte-exactly', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    const c1 = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    expect((await c1.req(CH.ptySpawn, spawnParams('hp'))).ok).toBe(true)
    await waitFor(() => c1.data('hp').includes('fake$'), 'the pane prompt')
    await c1.req(CH.ptyWrite, { id: 'hp', data: 'echo before-close\n' })
    await waitFor(() => c1.data('hp').includes('before-close'), 'the pre-close echo')
    const pidBefore = daemonPidAt(home, WS_MAIN)
    expect(pidBefore, 'the daemon endpoint is recorded at the ws-keyed name').not.toBeNull()

    // The close-Termhalla shape: kill the ssh child; the exec channel and bridge die with it.
    c1.session.kill()
    await waitFor(() => alive(pidBefore!), 'noop', 100) // still alive right after the teardown
    expect(alive(pidBefore!), 'the daemon survived the channel teardown').toBe(true)

    // Reopen: the SHIPPED F18 inventory/replay path now works across the close/reopen — the
    // same workspace derives the same token and finds the SAME socket.
    const c2 = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    expect(daemonPidAt(home, WS_MAIN), 'the SAME daemon — survival, not a respawn').toBe(pidBefore)
    expect(countKind('daemon-spawn'), 'one spawn across both connects').toBe(1)
    const sessions = await c2.req('pty:sessions', null)
    expect(sessions.ok).toBe(true)
    const list = (sessions as { result: Array<{ id: string }> }).result
    expect(list.map((s) => s.id), 'the live pane is in the reattach inventory').toContain('hp')

    const snapshot = await attachSnapshot(c2, 'hp')
    expect(snapshot).toContain('before-close')
    await c2.req(CH.ptyWrite, { id: 'hp', data: 'echo after-reopen\n' })
    await waitFor(() => c2.data('hp').includes('after-reopen'), 'the post-reopen echo')
    const composed = await referenceSerialize([snapshot, ...c2.dataFrames('hp')])
    const direct = await referenceSerialize(golden(['echo before-close\n', 'echo after-reopen\n']))
    expect(composed, 'snapshot ⊕ subsequent pty:data ≡ the full stream, byte-exactly').toBe(direct)
    c2.session.kill()
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2430 REQ-015 the F17×F18 weld across a bridge-mediated disconnect (the stalled-acks variant)', () => {
  it('a pane paused by a stalled client resumes on unbind; the reattach snapshot contains the flushed backlog', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    const c1 = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    expect((await c1.req(CH.ptySpawn, spawnParams('fp'))).ok).toBe(true)
    await waitFor(() => c1.data('fp').includes('fake$'), 'the flood pane prompt')

    // Shrink the window, flood, and NEVER ack — the agent-side gate pauses the pane.
    c1.session.send({ type: 'window', size: 1024 } as WireFrame)
    await new Promise((r) => setTimeout(r, 30))
    await c1.req(CH.ptyWrite, { id: 'fp', data: 'flood 6 1024\n' })
    await waitFor(() => c1.data('fp').length >= 1024, 'the first flow window of flood output')
    await new Promise((r) => setTimeout(r, 150)) // the stall — no acks, the backlog is held

    const goldenAll = golden(['flood 6 1024\n']).join('')
    expect(c1.data('fp').length, 'the stalled client genuinely missed part of the stream').toBeLessThan(goldenAll.length)

    // Disconnect mid-stall: unbind must resume the pane so the backlog reaches the REPLAY.
    c1.session.kill()

    const c2 = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    const snapshot = await attachSnapshot(c2, 'fp')
    await c2.req(CH.ptyWrite, { id: 'fp', data: 'echo weld-tail\n' })
    await waitFor(() => c2.data('fp').includes('weld-tail'), 'the fresh flow window serves the reconnecting client')
    const composed = await referenceSerialize([snapshot, ...c2.dataFrames('fp')])
    const direct = await referenceSerialize(golden(['flood 6 1024\n', 'echo weld-tail\n']))
    expect(composed, 'the flushed backlog is in the snapshot — nothing was lost to the stall').toBe(direct)
    c2.session.kill()
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2431 REQ-008 the lease steal over two real bridges against one persistent daemon', () => {
  it('B displaces A: lease:revoked is A\'s final frame, A\'s channel exits 0, B recovers the bytes, the daemon survives', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    const a = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    expect((await a.req(CH.ptySpawn, spawnParams('sp'))).ok).toBe(true)
    await waitFor(() => a.data('sp').includes('fake$'), 'A\'s prompt')
    await a.req(CH.ptyWrite, { id: 'sp', data: 'echo one-era\n' })
    await waitFor(() => a.data('sp').includes('one-era'), 'A\'s echo')
    const pid = daemonPidAt(home, WS_MAIN)

    const b = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    await waitFor(() => a.exitCode() !== 'pending', 'the displaced channel to end')
    expect(a.exitCode(), 'an orderly displacement: the loser\'s bridge exits 0').toBe(0)
    const revokedIdx = a.frames.findIndex((f) => f.type === 'evt' && f.channel === AGENT_LEASE_REVOKED_EVT)
    expect(revokedIdx, 'the loser was notified').toBeGreaterThanOrEqual(0)
    expect(revokedIdx, 'lease:revoked is the FINAL frame — nothing after it').toBe(a.frames.length - 1)

    expect(daemonPidAt(home, WS_MAIN), 'the daemon process keeps running with the winner bound').toBe(pid)
    expect(alive(pid!)).toBe(true)
    expect(countKind('daemon-spawn'), 'no respawn rode the steal').toBe(1)

    const snapshot = await attachSnapshot(b, 'sp')
    expect(snapshot).toContain('one-era')
    await b.req(CH.ptyWrite, { id: 'sp', data: 'echo two-era\n' })
    await waitFor(() => b.data('sp').includes('two-era'), 'the winner\'s live tail')
    const composed = await referenceSerialize([snapshot, ...b.dataFrames('sp')])
    const direct = await referenceSerialize(golden(['echo one-era\n', 'echo two-era\n']))
    expect(composed, 'no agent-side byte loss across the steal').toBe(direct)

    // Steal-back is just another attach.
    const c = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    await waitFor(() => b.exitCode() !== 'pending', 'the former winner displaced in turn')
    expect((await c.req('pty:attach', { id: 'sp' })).ok).toBe(true)
    c.session.kill()
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2432 REQ-012 the AUTO-UPDATE rig: same proto + newer app version REATTACHES (locked D4′ — FINDING-014)', () => {
  it('close → update → reopen: the new client establishes on the old-app-version daemon; sessions survive byte-exactly; zero uploads', async () => {
    preseedArtifact(OLD_V, oldBundlePath)
    preseedArtifact(pkgVersion, bundlePath)

    // The pre-update era: an OLD-app-version persistent daemon with a live session.
    const oldOpts = (): BootstrapOptions => daemonOpts({ version: OLD_V, artifactPath: oldBundlePath })
    const c1 = drive(expectOk(await connectWithProvisioning(oldOpts())))
    expect((await c1.req(CH.ptySpawn, spawnParams('up'))).ok).toBe(true)
    await waitFor(() => c1.data('up').includes('fake$'), 'the pre-update prompt')
    await c1.req(CH.ptyWrite, { id: 'up', data: 'echo before-update\n' })
    await waitFor(() => c1.data('up').includes('before-update'), 'the pre-update echo')
    const oldPid = daemonPidAt(home, WS_MAIN)
    expect(oldPid).not.toBeNull()
    c1.session.kill() // close Termhalla; the auto-update runs; the daemon persists

    // The post-update client (app version bumped, proto UNCHANGED) — the daemon-flow handshake
    // establishes on protocol compatibility only: this is the motivating flow and it MUST work.
    const c2 = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    expect(daemonPidAt(home, WS_MAIN), 'the SAME old-app-version daemon serves the updated client').toBe(oldPid)
    expect(countKind('daemon-spawn'), 'no respawn — a routine update preserves the daemon').toBe(1)
    expect(countKind('upload'), 'an app-version difference is NOT provisionable drift — zero uploads').toBe(0)

    const sessions = await c2.req('pty:sessions', null)
    expect(sessions.ok).toBe(true)
    expect((sessions as { result: Array<{ id: string }> }).result.map((s) => s.id),
      'the surviving pane is in the post-update inventory').toContain('up')
    const snapshot = await attachSnapshot(c2, 'up')
    expect(snapshot).toContain('before-update')
    await c2.req(CH.ptyWrite, { id: 'up', data: 'echo after-update\n' })
    await waitFor(() => c2.data('up').includes('after-update'), 'the post-update echo')
    const composed = await referenceSerialize([snapshot, ...c2.dataFrames('up')])
    const direct = await referenceSerialize(golden(['echo before-update\n', 'echo after-update\n']))
    expect(composed, 'routine Termhalla updates preserve remote sessions across the update').toBe(direct)
    c2.session.kill()
  }, 240_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2455 REQ-012 the PROTO-drift rig: honest, non-destructive refusal; sessions reachable by a compatible client', () => {
  it('proto-breaking daemon ⇒ fatal drift (both pairs named, from the status line); zero uploads/kills; idle-out → the new version spawns', async () => {
    const sock = process.platform === 'win32'
      ? `\\\\.\\pipe\\termhalla-0024-drift-${process.pid}-${Date.now()}`
      : join(home, 'drift.sock')
    process.env.FAKE_SSH_DAEMON_SOCKET = sock
    preseedArtifact(DRIFT_V, driftBundlePath)
    preseedArtifact(pkgVersion, bundlePath)

    // A REAL protocol-breaking (proto-2) persistent daemon, launched from its version-embedded
    // in-home artifact so metadata/log land at the shared ws-keyed agent-dir names.
    const daemonChild = spawn(process.execPath, [
      installedAt(DRIFT_V), '--daemon', '--pty=fake', `--ws=${WS_MAIN}`, `--socket=${sock}`, '--idle-timeout-ms=2500'
    ], { stdio: 'ignore', windowsHide: true })
    dummies.push(daemonChild)
    await waitFor(() => existsSync(metaPathAt(home, WS_MAIN)), 'the drift daemon\'s metadata', 30_000)
    const oldPid = daemonPidAt(home, WS_MAIN)!
    const preseededMeta = readFileSync(metaPathAt(home, WS_MAIN), 'utf8')

    // Its own (protocol-compatible) era: a proto-2 driver spawns a pane and detaches.
    const era1 = await rawProto2Client(sock)
    expect((await era1.req(CH.ptySpawn, spawnParams('dp'))).ok).toBe(true)
    await waitFor(() => era1.data('dp').includes('fake$'), 'the drift-era prompt')
    await era1.req(CH.ptyWrite, { id: 'dp', data: 'echo old-era\n' })
    await waitFor(() => era1.data('dp').includes('old-era'), 'the drift-era echo')
    era1.end()

    // The proto-1 client meets the proto-2 daemon: a distinct, honest, NON-destructive fatal.
    // ptyBackend node-pty makes the bridge emit its backend-mismatch diagnostic BEFORE the
    // status line — the client-side parse must still read the line (FINDING-017's raw-stderr
    // requirement: a sanitized/newline-collapsed copy would yield the "unknown" wording).
    const uploadsBefore = countKind('upload')
    const r = await connectWithProvisioning(daemonOpts({ ptyBackend: 'node-pty' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind, 'drift surfaces through the EXISTING ConnectFailureKind vocabulary (fatal)').toBe('fatal')
    expect(r.diagnostic, 'names the client\'s app version').toContain(pkgVersion)
    expect(r.diagnostic, 'names the daemon\'s app version — read from the status line').toContain(DRIFT_V)
    expect(r.diagnostic, 'speaks in protocol terms (D4′)').toMatch(/proto/i)
    expect(r.diagnostic, 'the status line WAS readable despite the preceding diagnostic (FINDING-017)').not.toMatch(/unknown daemon/i)
    expect(r.diagnostic, 'points at the ws-keyed metadata file — the manual escape hatch')
      .toContain(`daemon-${WS_MAIN}.json`)
    expect(r.diagnostic, 'recovery path 1: idle-out').toMatch(/idle/i)
    expect(countKind('upload') - uploadsBefore, 'a drifted daemon is NOT a provisionable artifact — zero uploads').toBe(0)
    expect(alive(oldPid), 'the drifted daemon was never killed').toBe(true)
    expect(readFileSync(metaPathAt(home, WS_MAIN), 'utf8'), 'its endpoint was never removed').toBe(preseededMeta)

    // Its sessions are intact: a protocol-COMPATIBLE client attaches and the F18 oracle passes.
    const era2 = await rawProto2Client(sock)
    const attach = await era2.req('pty:attach', { id: 'dp' })
    expect(attach.ok).toBe(true)
    const snapshot = (attach as { result: { snapshot: string } }).result.snapshot
    expect(snapshot).toContain('old-era')
    await era2.req(CH.ptyWrite, { id: 'dp', data: 'echo tail-old\n' })
    await waitFor(() => era2.data('dp').includes('tail-old'), 'the compatible client\'s live tail')
    const composed = await referenceSerialize([snapshot, ...era2.dataFrames('dp')])
    const direct = await referenceSerialize(golden(['echo old-era\n', 'echo tail-old\n']))
    expect(composed, 'the drift refusal left the old daemon\'s sessions byte-intact').toBe(direct)

    // D4's tail: end the sessions; the old daemon idles out; the next connect spawns the
    // NEW-version daemon from the already-provisioned new artifact and reaches hello.
    await era2.req(CH.ptyKill, 'dp')
    await waitFor(() => era2.frames.some((f) => f.type === 'evt' && f.channel === CH.ptyExit && f.args[0] === 'dp'), 'the pane exit')
    era2.end()
    await waitFor(() => !existsSync(metaPathAt(home, WS_MAIN)), 'the old daemon\'s idle self-exit', 60_000)
    await waitFor(() => !alive(oldPid), 'the old daemon pid to die', 30_000)

    const c4 = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    expect(countKind('daemon-spawn'), 'the reconnect spawned the new-version daemon (via the bridge)').toBe(1)
    expect(daemonPidAt(home, WS_MAIN)).not.toBe(oldPid)
    expect((await c4.req('pty:sessions', null)).ok, 'the new-version daemon serves').toBe(true)
    expect(countKind('upload'), 'zero uploads across the whole drift story').toBe(0)
    c4.session.kill()
  }, 240_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2433 REQ-005 concurrent first-connects to ONE workspace: one daemon, both clients complete', () => {
  it('two racing connects both succeed; exactly one live daemon endpoint results; the winner serves panes', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    const [r1, r2] = await Promise.all([
      connectWithProvisioning(daemonOpts()),
      connectWithProvisioning(daemonOpts())
    ])
    const d1 = drive(expectOk(r1))
    const d2 = drive(expectOk(r2))

    const pid = daemonPidAt(home, WS_MAIN)
    expect(pid, 'exactly one recorded daemon endpoint').not.toBeNull()
    expect(alive(pid!), 'and it is live').toBe(true)

    // The lease has exactly one holder: at least one of the two is served; drive whichever
    // answers (the other was displaced — completing the connect is REQ-005's guarantee).
    const tryReq = (d: Driver, method: string, params: unknown): Promise<ResFrame | null> =>
      Promise.race([d.req(method, params), new Promise<null>((r) => setTimeout(() => r(null), 5000))])
    let winner: Driver | null = null
    if ((await tryReq(d2, 'pty:sessions', null)) !== null) winner = d2
    else if ((await tryReq(d1, 'pty:sessions', null)) !== null) winner = d1
    expect(winner, 'one of the two racing clients is bound and served').not.toBeNull()
    expect((await winner!.req(CH.ptySpawn, spawnParams('cc1'))).ok).toBe(true)
    await waitFor(() => winner!.data('cc1').includes('fake$'), 'service from the surviving daemon')
    winner!.session.kill()
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2434 REQ-007 stale remnants of a killed daemon are reclaimed on the next connect', () => {
  it('dead-pid metadata (and a stale socket file) → reclaim, exactly one fresh spawn, connect completes', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    // Remnants of a kill -9-shaped death: metadata with a genuinely dead pid.
    const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true })
    await new Promise<void>((r) => dead.on('exit', () => r()))
    mkdirSync(dirname(metaPathAt(home, WS_MAIN)), { recursive: true })
    writeFileSync(metaPathAt(home, WS_MAIN), JSON.stringify({
      formatVersion: 1, pid: dead.pid, version: pkgVersion, proto: 1, backend: 'fake', startedAt: new Date(0).toISOString()
    }))
    if (process.platform !== 'win32') {
      writeFileSync(join(home, '.termhalla', 'agent', `agent-${WS_MAIN}.sock`), '') // the dead socket file
    }

    const d = drive(expectOk(await connectWithProvisioning(daemonOpts())))
    expect(countKind('daemon-spawn'), 'the ledger shows exactly one daemon spawn (the reclaim)').toBe(1)
    const pid = daemonPidAt(home, WS_MAIN)
    expect(pid).not.toBe(dead.pid)
    expect(alive(pid!)).toBe(true)
    expect((await d.req('pty:sessions', null)).ok).toBe(true)
    d.session.kill()
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2435 REQ-007 a live-but-never-accepting daemon is NEVER reclaimed: fatal 96 with a named diagnostic', () => {
  it('pid alive, socket never accepting → no removal, a fatal naming the socket path, the pid, and the manual escape hatch', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    const sock = process.platform === 'win32'
      ? `\\\\.\\pipe\\termhalla-0024-busy-${process.pid}-${Date.now()}`
      : join(home, 'busy.sock')
    process.env.FAKE_SSH_DAEMON_SOCKET = sock
    const dummy = spawnDummy()
    mkdirSync(dirname(metaPathAt(home, WS_MAIN)), { recursive: true })
    const preseed = JSON.stringify({
      formatVersion: 1, pid: dummy.pid, version: pkgVersion, proto: 1, backend: 'fake', startedAt: new Date(0).toISOString()
    })
    writeFileSync(metaPathAt(home, WS_MAIN), preseed)

    const r = await connectWithProvisioning(daemonOpts())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('fatal')
    expect(r.diagnostic, 'names the socket path (CONV-001)').toContain('busy')
    expect(r.diagnostic, 'names the recorded pid').toContain(String(dummy.pid))
    // FINDING-018 disclosure: pid reuse can wedge this path — the manual escape hatch is named.
    expect(r.diagnostic, 'manual recovery: terminate the recorded pid or remove the named files').toMatch(/terminat|remove/i)
    expect(readFileSync(metaPathAt(home, WS_MAIN), 'utf8'), 'NOTHING was removed while the pid is alive').toBe(preseed)
    expect(alive(dummy.pid!), 'the live process was never killed').toBe(true)
  }, 90_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2436 REQ-013 an abort during the daemon spawn-wait is a DETERMINATE aborted', () => {
  it('aborting inside the bounded readiness wait settles "aborted" promptly, with no indeterminate flag', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    const sock = process.platform === 'win32'
      ? `\\\\.\\pipe\\termhalla-0024-abort-${process.pid}-${Date.now()}`
      : join(home, 'abort.sock')
    process.env.FAKE_SSH_DAEMON_SOCKET = sock
    const dummy = spawnDummy() // a live pid + never-accepting socket = the bridge sits in its wait
    mkdirSync(dirname(metaPathAt(home, WS_MAIN)), { recursive: true })
    writeFileSync(metaPathAt(home, WS_MAIN), JSON.stringify({
      formatVersion: 1, pid: dummy.pid, version: pkgVersion, proto: 1, backend: 'fake', startedAt: new Date(0).toISOString()
    }))

    const ac = new AbortController()
    setTimeout(() => ac.abort(), 500)
    const started = Date.now()
    const r = await connectWithProvisioning(daemonOpts({ signal: ac.signal }))
    const elapsed = Date.now() - started
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('aborted')
    expect(r.indeterminate, 'no durable-write tear exists on this path — the abort is determinate').not.toBe(true)
    expect(elapsed, 'the abort cut the readiness wait short (it did not ride out the deadline)').toBeLessThan(9_000)
  }, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2456 REQ-018 same-host workspace coexistence: two tokens, two independent daemons (locked D6′)', () => {
  it('two workspaces on one host serve interleaved traffic independently; no cross-workspace revocation; independent idle-out', async () => {
    process.env.FAKE_SSH_DAEMON_IDLE_MS = '3000'
    preseedArtifact(pkgVersion, bundlePath)

    // Workspace A and workspace B — SAME host+user, distinct workspace ids.
    const a = drive(expectOk(await connectWithProvisioning(daemonOpts({}, WS_MAIN))))
    const b = drive(expectOk(await connectWithProvisioning(daemonOpts({}, WS_B))))

    // Connecting B displaced NOTHING in A: no lease:revoked ever crosses workspace boundaries.
    expect(a.exitCode(), 'A\'s channel is still live after B\'s connect').toBe('pending')
    expect(a.evts(AGENT_LEASE_REVOKED_EVT), 'no cross-workspace revocation reached A').toHaveLength(0)
    expect(b.evts(AGENT_LEASE_REVOKED_EVT)).toHaveLength(0)

    // Two daemon pids on two sockets (two ws-keyed endpoints), both live.
    const pidA = daemonPidAt(home, WS_MAIN)
    const pidB = daemonPidAt(home, WS_B)
    expect(pidA, 'workspace A has its own recorded daemon').not.toBeNull()
    expect(pidB, 'workspace B has its own recorded daemon').not.toBeNull()
    expect(pidA).not.toBe(pidB)
    expect(alive(pidA!) && alive(pidB!)).toBe(true)
    expect(countKind('daemon-spawn'), 'one spawn per workspace').toBe(2)
    expect(new Set(logEntries().filter((e) => e.kind === 'daemon-spawn').map((e) => e.ws)),
      'the spawns are attributed to the two distinct tokens').toEqual(new Set([WS_MAIN, WS_B]))

    // Interleaved traffic: each workspace's pane sees ONLY its own bytes, and each stream
    // matches its independent F18 oracle.
    expect((await a.req(CH.ptySpawn, spawnParams('pnA'))).ok).toBe(true)
    expect((await b.req(CH.ptySpawn, spawnParams('pnB'))).ok).toBe(true)
    await waitFor(() => a.data('pnA').includes('fake$') && b.data('pnB').includes('fake$'), 'both prompts')
    await a.req(CH.ptyWrite, { id: 'pnA', data: 'echo alpha-only\n' })
    await b.req(CH.ptyWrite, { id: 'pnB', data: 'echo beta-only\n' })
    await waitFor(() => a.data('pnA').includes('alpha-only') && b.data('pnB').includes('beta-only'), 'interleaved echoes')
    expect(a.data('pnA')).not.toContain('beta-only')
    expect(b.data('pnB')).not.toContain('alpha-only')
    const oracleA = await referenceSerialize(a.dataFrames('pnA'))
    const goldA = await referenceSerialize(golden(['echo alpha-only\n']))
    expect(oracleA, 'workspace A\'s stream is byte-exact').toBe(goldA)
    const oracleB = await referenceSerialize(b.dataFrames('pnB'))
    const goldB = await referenceSerialize(golden(['echo beta-only\n']))
    expect(oracleB, 'workspace B\'s stream is byte-exact').toBe(goldB)

    // Ending workspace A (pane + connection) leaves B fully established and served.
    await a.req(CH.ptyKill, 'pnA')
    await waitFor(() => a.frames.some((f) => f.type === 'evt' && f.channel === CH.ptyExit && f.args[0] === 'pnA'), 'A\'s pane exit')
    a.session.kill()
    expect((await b.req('pty:sessions', null)).ok, 'B is untouched by A\'s teardown').toBe(true)

    // A's daemon idles out ON ITS OWN TIMEOUT while B's keeps running (independent lifecycles —
    // idle reaping is what bounds per-workspace daemon accumulation, D6′).
    await waitFor(() => !existsSync(metaPathAt(home, WS_MAIN)), 'A\'s daemon idle self-exit', 60_000)
    await waitFor(() => !alive(pidA!), 'A\'s daemon pid to die', 30_000)
    expect(alive(pidB!), 'B\'s daemon is still alive (its connection is established — idle never armed)').toBe(true)
    await b.req(CH.ptyWrite, { id: 'pnB', data: 'echo beta-after\n' })
    await waitFor(() => b.data('pnB').includes('beta-after'), 'B still served after A\'s reaping')
    expect(b.evts(AGENT_LEASE_REVOKED_EVT), 'B never saw a revocation through any of it').toHaveLength(0)
    await b.req(CH.ptyKill, 'pnB')
    b.session.kill()
  }, 240_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Revision 3 addendum (ESC-002 / FINDING-023, locked D10 — REQ-019): the close-TAB gesture,
// end-to-end through the REAL RemoteWorkspaceManager over the REAL persistent daemon —
// detach-then-forget, never pty:kill. (ESM import declarations are hoisted; these ride the
// addendum so the frozen revision-2 body above stays byte-untouched.)
import { RemoteWorkspaceManager } from '../src/main/remote/remote-workspace-manager'

interface MgrRig {
  mgr: RemoteWorkspaceManager
  sends: Array<[string, ...unknown[]]>
  outbound: WireFrame[] // every frame the manager sent on the wire (all connections)
  inbound: WireFrame[]  // every frame received from the wire
  dataOn: (paneId: string, from?: number) => string[]
  mark: () => number
}

/** The production wiring shape (services.ts): the manager's connect dep is the REAL
 *  connectWithProvisioning with the daemon scope = the workspace id (REQ-013/REQ-016 of 0024). */
const mkMgrRig = (): MgrRig => {
  const sends: Array<[string, ...unknown[]]> = []
  const outbound: WireFrame[] = []
  const inbound: WireFrame[] = []
  const mgr = new RemoteWorkspaceManager({
    send: (ch, ...a) => { sends.push([ch, ...a]) },
    loadAgents: async () => [{ id: 'ag1', name: 'daemon-box', host: seed.host, user: seed.user }],
    connect: async (o) => {
      const r = await connectWithProvisioning(daemonOpts({}, o.workspaceId ?? WS_MAIN))
      if (!r.ok) return { ok: false, kind: r.kind, diagnostic: r.diagnostic }
      const inner = r.session
      kills.push(() => inner.kill())
      return {
        ok: true,
        session: {
          ...inner,
          send: (f: WireFrame) => { outbound.push(f); inner.send(f) },
          onFrame: (cb: (f: WireFrame) => void) => inner.onFrame((f) => { inbound.push(f); cb(f) })
        }
      }
    },
    version: pkgVersion,
    artifactPath: bundlePath,
    scheduler: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>)
    }
  })
  kills.push(() => mgr.stop())
  const dataOn = (paneId: string, from = 0): string[] =>
    sends.slice(from)
      .filter(([ch, id]) => ch === CH.ptyData && id === paneId)
      .map(([, , d]) => String(d))
  return { mgr, sends, outbound, inbound, dataOn, mark: () => sends.length }
}

describe('TEST-2463 REQ-019/REQ-015 closing the workspace TAB detaches: the daemon and pane survive; reopening reattaches byte-exactly', () => {
  it('a close-tab-shaped teardown issues ZERO pty:kill frames, leaves no ghost state, keeps the daemon pid, and the F18 oracle passes on reattach', async () => {
    preseedArtifact(pkgVersion, bundlePath)
    const rig = mkMgrRig()
    const spawnArgs = {
      id: 'ct1', shellId: 'default', cwd: '/home/remote', cols: COLS, rows: ROWS,
      remote: { workspaceId: WS_MAIN, agentId: 'ag1' }
    }
    await rig.mgr.spawn(spawnArgs)
    await waitFor(() => rig.dataOn('ct1').join('').includes('fake$'), 'the pane prompt')
    rig.mgr.write('ct1', 'echo before-tab-close\n')
    await waitFor(() => rig.dataOn('ct1').join('').includes('before-tab-close'), 'the pre-close echo')
    const pid = daemonPidAt(home, WS_MAIN)
    expect(pid, 'the ws-keyed daemon endpoint is recorded').not.toBeNull()

    // The close-tab gesture (the REQ-019 routing): detach + forget — NEVER a pane kill.
    ;(rig.mgr.disconnectWorkspace as unknown as (id: string, opts?: { forget?: boolean }) => void)(WS_MAIN, { forget: true })
    await waitFor(() => alive(pid!), 'noop', 100)
    expect(rig.outbound.filter((f) => f.type === 'req' && f.method === CH.ptyKill),
      'NO pty:kill was issued for the workspace panes - not over the wire, not via the local kill path').toHaveLength(0)
    expect(rig.mgr.currentStates().map((s) => s.workspaceId),
      'after the close settles the workspace serves NO ghost remote state (the no-ghost discipline, by detach-then-forget)')
      .not.toContain(WS_MAIN)
    expect(alive(pid!), 'the daemon survived the tab close').toBe(true)

    // Reopen: the same workspace id => the same wsToken => the same socket (REQ-019 corollary d).
    const mark = rig.mark()
    const adopted = await rig.mgr.spawn(spawnArgs)
    expect(adopted, 'the reopened workspace ADOPTS the surviving pane from the daemon inventory').toBe(true)
    expect(daemonPidAt(home, WS_MAIN), 'the SAME daemon - survival, not a respawn').toBe(pid)
    expect(countKind('daemon-spawn'), 'one spawn across the close and the reopen').toBe(1)
    await waitFor(() => rig.dataOn('ct1', mark).length > 0, 'the reattach snapshot push')
    const first = rig.dataOn('ct1', mark)[0]
    expect(first.startsWith('\x1bc'), 'the reset-preamble + snapshot re-adoption push').toBe(true)
    expect(first, 'the pre-close output is in the snapshot').toContain('before-tab-close')

    rig.mgr.write('ct1', 'echo after-reopen\n')
    await waitFor(() => rig.dataOn('ct1', mark).join('').includes('after-reopen'), 'the post-reopen echo')
    const [snapFrame, ...tail] = rig.dataOn('ct1', mark)
    const composed = await referenceSerialize([snapFrame.slice(2), ...tail]) // strip the \x1bc preamble
    const direct = await referenceSerialize(golden(['echo before-tab-close\n', 'echo after-reopen\n']))
    expect(composed, 'snapshot + subsequent pty:data reproduce the full stream byte-exactly (the REQ-015 oracle across a tab close)').toBe(direct)
    rig.mgr.stop()
  }, 240_000)
})

describe('TEST-2464 REQ-019/REQ-006 the no-reopen tail: a deliberate pane close stays a kill; an unreopened workspace daemon idle-reaps', () => {
  it('per-pane close sends EXACTLY one pty:kill (corollary b); after the tab close the empty daemon reaps itself - observed signals, never a bare sleep', async () => {
    process.env.FAKE_SSH_DAEMON_IDLE_MS = '2500'
    preseedArtifact(pkgVersion, bundlePath)
    const rig = mkMgrRig()
    const spawnArgs = {
      id: 'ct2', shellId: 'default', cwd: '/home/remote', cols: COLS, rows: ROWS,
      remote: { workspaceId: WS_MAIN, agentId: 'ag1' }
    }
    await rig.mgr.spawn(spawnArgs)
    await waitFor(() => rig.dataOn('ct2').join('').includes('fake$'), 'the pane prompt')
    const pid = daemonPidAt(home, WS_MAIN)
    expect(pid).not.toBeNull()

    // Corollary (b): closing an individual remote PANE (not the tab) is a deliberate kill of
    // exactly that one pane - unchanged.
    rig.mgr.kill('ct2')
    await waitFor(() => rig.inbound.some((f) => f.type === 'evt' && f.channel === CH.ptyExit && f.args[0] === 'ct2'),
      'the pane wire exit after the deliberate kill')
    expect(
      rig.outbound.filter((f) => f.type === 'req' && f.method === CH.ptyKill).map((f) => (f as { params: unknown }).params),
      'exactly one pty:kill, for exactly the deliberately closed pane'
    ).toEqual(['ct2'])

    // The tab close (detach + forget) on the now pane-less workspace leaves no ghost...
    ;(rig.mgr.disconnectWorkspace as unknown as (id: string, opts?: { forget?: boolean }) => void)(WS_MAIN, { forget: true })
    expect(rig.mgr.currentStates(), 'no ghost after the close settles').toEqual([])

    // ...and the unreopened workspace daemon idle-reaps once its established-connection count
    // reaches 0 (REQ-006): metadata gone + pid dead - synchronized on observed signals (CONV-062).
    await waitFor(() => !existsSync(metaPathAt(home, WS_MAIN)), 'the idle self-exit removed the ws-keyed metadata', 60_000)
    await waitFor(() => !alive(pid!), 'the daemon pid died on idle', 30_000)
    rig.mgr.stop()
  }, 240_000)
})
