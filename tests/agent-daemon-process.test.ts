// Test suite — feature 0024-agent-daemonization (phase 4, revision 2 — re-derived after the
// ESC-001 loop-back; REQ-002/003/004/005/006/007/010/011/018 as amended).
// The REAL daemon and bridge processes, exercised portably through the injectable --socket path
// (a named-pipe path on win32 — REQ-016): the artifact is bundled on demand through the SAME
// vite.agent.config.ts `npm run build` uses (the TEST-774 pattern) and run as plain local child
// processes. Every mode invocation carries the WORKSPACE scope (`--ws=<token>`, locked D6′) so
// metadata/log land at the ws-keyed names; the explicit `--socket` override supplies the
// portable endpoint (contract: when BOTH are given, the socket path is the override while
// metadata/log still derive from the token).
//
// Covers bridge byte-transparency + exit taxonomy (REQ-010), spawn-then-attach with detach
// hygiene / survival across bridge exits / idle self-exit / metadata (with proto) + log
// discipline (REQ-011/REQ-004/REQ-006/REQ-002/REQ-003), the race-proof single daemon per
// workspace socket incl. reclaim-under-concurrency and the ownership-checked cleanup (REQ-005),
// stale-reclaim and live-busy-96 with the manual escape hatch (REQ-007/FINDING-018), the
// POSIX-real 0600-from-birth socket (REQ-003/FINDING-005, skipIf win32), and the 0023
// co-provisioned node-pty resolution from the agent dir (REQ-011).
//
// RUNS RED until the artifact implements the amended --daemon/--attach/--ws contract.
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync, copyFileSync, cpSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { connect as netConnect, createServer, type Socket, type Server } from 'node:net'
import { build } from 'vite'
import { createFrameDecoder, createDaemonClientHandshake, encodeFrame, WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame, ResFrame, DecodedItem } from '@shared/remote/protocol'
import { CH } from '@shared/ipc-contract'

const root = process.cwd()
const pkgVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version
const stubPkg = resolve(root, 'tests/fixtures/node-pty-stub')

// Mirrors BRIDGE_DAEMON_UNREACHABLE_EXIT (pinned by TEST-2403; a literal here keeps this file
// loadable while the constant is unimplemented — the 0023 PROBE_STDOUT_CAP precedent).
const UNREACHABLE_EXIT = 96
const STATUS_PREFIX = 'TERMHALLA_BRIDGE_V1 '

let outDir = ''
let bundlePath = ''
let pipeSeq = 0
const dirs: string[] = []
const children: ChildProcessWithoutNullStreams[] = []
const reapPids: number[] = []
const servers: Server[] = []
const sockets: Socket[] = []

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'termhalla-daemon-proc-'))
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'), // the SAME config npm run build uses
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })
  bundlePath = join(outDir, 'termhalla-agent.cjs')
}, 240_000)

afterEach(() => {
  for (const s of sockets.splice(0)) { try { s.destroy() } catch { /* gone */ } }
  for (const s of servers.splice(0)) { try { s.close() } catch { /* gone */ } }
  for (const c of children.splice(0)) { try { c.kill() } catch { /* gone */ } }
  for (const pid of reapPids.splice(0)) { try { process.kill(pid) } catch { /* gone */ } }
  for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }) } catch { /* locked */ } }
})

afterAll(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }) })

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch { return false } }

const mkAgentDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'termhalla-agent-dir-'))
  dirs.push(d)
  copyFileSync(bundlePath, join(d, `termhalla-agent-${pkgVersion}.cjs`))
  return d
}
const artifactIn = (dir: string): string => join(dir, `termhalla-agent-${pkgVersion}.cjs`)

const uniqueSock = (dir: string): string =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\termhalla-0024-${process.pid}-${++pipeSeq}-${Date.now()}`
    : join(dir, `s${++pipeSeq}.sock`)

// The ws-keyed on-disk names (Definitions): metadata/log always derive from the token even
// when the socket endpoint itself is an explicit --socket override.
const metaPath = (dir: string, ws: string): string => join(dir, `daemon-${ws}.json`)
const logPath = (dir: string, ws: string): string => join(dir, `daemon-${ws}.log`)
const readMeta = (dir: string, ws: string): { pid: number; version: string; proto: number; backend: string } =>
  JSON.parse(readFileSync(metaPath(dir, ws), 'utf8'))

const waitFor = async (cond: () => boolean, what: string, ms = 60_000): Promise<void> => {
  const deadline = Date.now() + ms
  for (;;) {
    if (cond()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

const spawnNode = (args: string[]): ChildProcessWithoutNullStreams => {
  const c = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  children.push(c)
  return c
}

const statusLinesOf = (stderr: string): Array<Record<string, unknown>> =>
  stderr.split('\n').filter((l) => l.startsWith(STATUS_PREFIX)).map((l) => {
    try { return JSON.parse(l.slice(STATUS_PREFIX.length)) as Record<string, unknown> } catch { return { parseError: l } }
  })

// ── a frame-speaking client over a bridge child's stdio ──────────────────────────────────────
interface ProcClient {
  child: ChildProcessWithoutNullStreams
  frames: WireFrame[]
  stderr: () => string
  isEstablished: () => boolean
  send: (f: WireFrame) => void
  req: (method: string, params: unknown) => Promise<ResFrame>
  data: (id: string) => string
  dataFrames: (id: string) => string[]
  exit: Promise<number | null>
  endInput: () => void
}

const bridgeClient = (args: string[]): ProcClient => {
  const child = spawnNode(args)
  const decoder = createFrameDecoder()
  const hs = createDaemonClientHandshake({ version: pkgVersion })
  const frames: WireFrame[] = []
  let stderrText = ''
  let established = false
  let reqSeq = 0
  const waiters = new Map<number, (f: ResFrame) => void>()

  child.stderr.on('data', (c: Buffer) => { stderrText += c.toString('utf8') })
  child.stdout.on('data', (chunk: Buffer) => {
    let items: DecodedItem[]
    try { items = decoder.push(chunk) } catch { return }
    for (const item of items) {
      if (item.kind !== 'message') continue
      const f = item.frame
      frames.push(f)
      if (!established && f.type === 'hello') {
        const r = hs.onMessage(f)
        if (r.ok) {
          child.stdin.write(encodeFrame(r.reply))
          established = true
        }
      }
      if (f.type === 'res') {
        const w = waiters.get(f.id as number)
        if (w) { waiters.delete(f.id as number); w(f) }
      }
    }
  })
  child.stdin.on('error', () => { /* EPIPE on a dying child; the exit path reports */ })
  const exit = new Promise<number | null>((res) => { child.on('exit', (code) => res(code)) })

  const dataFrames = (id: string): string[] =>
    frames.filter((f) => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === id)
      .map((f) => String((f as { args: unknown[] }).args[1]))

  return {
    child,
    frames,
    stderr: () => stderrText,
    isEstablished: () => established,
    send: (f) => child.stdin.write(encodeFrame(f)),
    req: (method, params) => new Promise<ResFrame>((res) => {
      const id = ++reqSeq
      waiters.set(id, res)
      child.stdin.write(encodeFrame({ type: 'req', id, method, params } as WireFrame))
    }),
    data: (id) => dataFrames(id).join(''),
    dataFrames,
    exit,
    endInput: () => child.stdin.end()
  }
}

const spawnParams = (id: string): unknown => ({ id, shellId: 'default', cwd: '/home/it', cols: 40, rows: 6 })

const metaSeed = (pid: number, backend = 'fake'): string => JSON.stringify({
  formatVersion: 1, pid, version: pkgVersion, proto: WIRE_PROTO, backend, startedAt: new Date(0).toISOString()
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2422 REQ-010 the bridge is a pure byte pipe with the 0/… exit taxonomy and one status line', () => {
  it('passes arbitrary bytes both ways untouched; stdin EOF and socket EOF each end cleanly with exit 0', async () => {
    const dir = mkAgentDir()
    const ws = 'w2422'
    const sock = uniqueSock(dir)
    const inbound: Buffer[] = []
    let conn: Socket | null = null
    const server = createServer((s) => { conn = s; s.on('data', (c: Buffer) => inbound.push(c)) })
    servers.push(server)
    await new Promise<void>((r) => server.listen(sock, r))

    const bridge = spawnNode([artifactIn(dir), '--attach', '--pty=fake', `--ws=${ws}`, `--socket=${sock}`])
    const out: Buffer[] = []
    let stderrText = ''
    bridge.stdout.on('data', (c: Buffer) => out.push(c))
    bridge.stderr.on('data', (c: Buffer) => { stderrText += c.toString('utf8') })
    const exit = new Promise<number | null>((res) => { bridge.on('exit', (code) => res(code)) })

    await waitFor(() => conn !== null, 'the bridge connected to the scripted listener', 20_000)

    // Daemon → client direction: arbitrary bytes (not frames — the bridge must not inspect),
    // split at awkward boundaries.
    const down = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251))
    for (let off = 0; off < down.length; off += 7) conn!.write(down.subarray(off, Math.min(off + 7, down.length)))
    await waitFor(() => Buffer.concat(out).length >= down.length, 'the downstream bytes on bridge stdout', 20_000)
    expect(Buffer.concat(out).equals(down), 'stdout carries EXACTLY the socket bytes, in order — no injection, no re-framing').toBe(true)

    // Client → daemon direction.
    const up = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 7) % 253))
    for (let off = 0; off < up.length; off += 5) bridge.stdin.write(up.subarray(off, Math.min(off + 5, up.length)))
    await waitFor(() => Buffer.concat(inbound).length >= up.length, 'the upstream bytes at the listener', 20_000)
    expect(Buffer.concat(inbound).equals(up), 'the daemon side received exactly the stdin bytes').toBe(true)

    // Exactly ONE machine-parseable status line, attach-to-existing shape, metadata unreadable
    // ⇒ ALL nulls (the 4-field Definitions shape incl. daemonProto).
    const lines = statusLinesOf(stderrText)
    expect(lines, 'exactly one TERMHALLA_BRIDGE_V1 line').toHaveLength(1)
    expect(lines[0]).toEqual({ spawned: false, daemonVersion: null, daemonProto: null, daemonPid: null })

    // stdin EOF: the bridge half-closes the socket; the peer ends; the bridge exits 0.
    const sawEnd = new Promise<void>((r) => { conn!.once('end', r) })
    bridge.stdin.end()
    await sawEnd
    conn!.end()
    expect(await exit, 'a clean end (stdin EOF) is exit 0').toBe(0)

    // Socket-EOF-first variant on a fresh listener: the daemon side closes (the lease-
    // displacement shape); the bridge flushes stdout and exits 0 even with stdin still open.
    const sock2 = uniqueSock(dir)
    const server2 = createServer((s) => { s.write('goodbye-burst'); s.end() })
    servers.push(server2)
    await new Promise<void>((r) => server2.listen(sock2, r))
    const bridge2 = spawnNode([artifactIn(dir), '--attach', '--pty=fake', `--ws=${ws}b`, `--socket=${sock2}`])
    const out2: Buffer[] = []
    bridge2.stdout.on('data', (c: Buffer) => out2.push(c))
    const exit2 = new Promise<number | null>((res) => { bridge2.on('exit', (code) => res(code)) })
    expect(await exit2, 'socket EOF (including a lease displacement) is exit 0').toBe(0)
    expect(Buffer.concat(out2).toString('utf8'), 'the final burst reached stdout before the clean end').toContain('goodbye-burst')
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2423 REQ-011/REQ-004/REQ-002/REQ-003/REQ-006 spawn-then-attach, detach hygiene, survival, idle self-exit', () => {
  it('first connect spawns the daemon; the bridge exits while the daemon survives; a second bridge reattaches; then the daemon idles out', async () => {
    const dir = mkAgentDir()
    const ws = 'w2423'
    const sock = uniqueSock(dir)
    const idleMs = 4000

    // ── first bridge: no listener → spawn-then-attach (REQ-011)
    const c1 = bridgeClient([artifactIn(dir), '--attach', '--pty=fake', `--ws=${ws}`, `--socket=${sock}`, `--idle-timeout-ms=${idleMs}`])
    await waitFor(() => c1.isEstablished(), 'the handshake through the freshly spawned daemon', 30_000)

    const lines1 = statusLinesOf(c1.stderr())
    expect(lines1, 'exactly one status line').toHaveLength(1)
    expect(lines1[0].spawned, 'the first connect reports a fresh spawn').toBe(true)
    expect(lines1[0].daemonVersion).toBe(pkgVersion)
    expect(lines1[0].daemonProto, 'the status line reports the daemon\'s wire proto').toBe(WIRE_PROTO)
    expect(typeof lines1[0].daemonPid).toBe('number')

    // Metadata: written beside the artifact at the WS-KEYED name, the exact cross-version-frozen
    // shape now including proto (REQ-003).
    expect(existsSync(metaPath(dir, ws)), `daemon-${ws}.json lives beside the artifact`).toBe(true)
    const meta = JSON.parse(readFileSync(metaPath(dir, ws), 'utf8')) as Record<string, unknown>
    expect(Object.keys(meta).sort()).toEqual(['backend', 'formatVersion', 'pid', 'proto', 'startedAt', 'version'])
    expect(meta.formatVersion).toBe(1)
    expect(meta.version).toBe(pkgVersion)
    expect(meta.proto).toBe(WIRE_PROTO)
    expect(meta.backend).toBe('fake')
    const daemonPid = meta.pid as number
    expect(alive(daemonPid), 'the recorded daemon pid is live').toBe(true)
    reapPids.push(daemonPid)

    // A pane with a distinctive payload marker.
    const spawned = await c1.req(CH.ptySpawn, spawnParams('d1'))
    expect(spawned.ok).toBe(true)
    await waitFor(() => c1.data('d1').includes('fake$'), 'the pane prompt', 30_000)
    await c1.req(CH.ptyWrite, { id: 'd1', data: 'echo payload-survive-me\n' })
    await waitFor(() => c1.data('d1').includes('payload-survive-me'), 'the echo', 30_000)

    // REQ-004 log discipline: the ws-keyed daemon log exists and carries NO pane payload bytes.
    expect(existsSync(logPath(dir, ws)), `daemon-${ws}.log lives beside the artifact`).toBe(true)
    expect(readFileSync(logPath(dir, ws), 'utf8'), 'PTY payload never reaches the daemon log').not.toContain('payload-survive-me')

    // ── REQ-004(a) + REQ-002: the bridge exits promptly on stdin EOF while the daemon keeps running
    c1.endInput()
    expect(await c1.exit, 'the bridge exit is clean (0)').toBe(0)
    expect(alive(daemonPid), 'the daemon survived its spawning channel\'s teardown').toBe(true)
    expect(existsSync(metaPath(dir, ws)), 'no connection end removes the endpoint').toBe(true)

    // ── second bridge: attach-to-existing, with a MISMATCHED --pty (REQ-011's diagnostic row)
    const c2 = bridgeClient([artifactIn(dir), '--attach', '--pty=node-pty', `--ws=${ws}`, `--socket=${sock}`, `--idle-timeout-ms=${idleMs}`])
    await waitFor(() => c2.isEstablished(), 'the reattach handshake', 30_000)
    const lines2 = statusLinesOf(c2.stderr())
    expect(lines2).toHaveLength(1)
    expect(lines2[0].spawned, 'no second daemon spawn for the same workspace').toBe(false)
    expect(lines2[0].daemonVersion).toBe(pkgVersion)
    expect(lines2[0].daemonProto).toBe(WIRE_PROTO)
    expect(lines2[0].daemonPid).toBe(daemonPid)
    await waitFor(() => /node-pty/.test(c2.stderr()) && /fake/.test(c2.stderr()),
      'the backend-mismatch diagnostic naming both backends', 10_000)

    // The SHIPPED F18 reattach path now works across a client close/reopen (the feature's point).
    const sessions = await c2.req('pty:sessions', null)
    expect(sessions.ok).toBe(true)
    expect((sessions as { result: Array<{ id: string }> }).result.map((s) => s.id)).toContain('d1')
    const attach = await c2.req('pty:attach', { id: 'd1' })
    expect(attach.ok).toBe(true)
    expect((attach as { result: { snapshot: string } }).result.snapshot).toContain('payload-survive-me')

    // ── REQ-006 end-to-end: kill the pane, drop the connection, and the daemon idles out —
    //    synchronized on observed signals (metadata gone + pid dead), never a bare sleep.
    await c2.req(CH.ptyKill, 'd1')
    await waitFor(() => c2.frames.some((f) => f.type === 'evt' && f.channel === CH.ptyExit && f.args[0] === 'd1'),
      'the pane exit event', 30_000)
    c2.endInput()
    expect(await c2.exit).toBe(0)
    await waitFor(() => !existsSync(metaPath(dir, ws)), `the idle self-exit removed daemon-${ws}.json`, 60_000)
    await waitFor(() => !alive(daemonPid), 'the daemon pid died on idle', 30_000)
  }, 240_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2424 REQ-005 exactly one daemon per workspace-scoped socket under concurrent first-starts (CONV-060)', () => {
  it('two overlapping --daemon starts: one listener survives, the loser exits 0 without unlinking, both clients complete', async () => {
    const dir = mkAgentDir()
    const ws = 'w2424'
    const sock = uniqueSock(dir)
    const argv = [artifactIn(dir), '--daemon', '--pty=fake', `--ws=${ws}`, `--socket=${sock}`, '--idle-timeout-ms=60000']

    const d1 = spawnNode(argv)
    const d2 = spawnNode(argv)
    const exits: Array<number | null> = [NaN as unknown as number, NaN as unknown as number]
    let exited = 0
    d1.on('exit', (code) => { exits[0] = code; exited++ })
    d2.on('exit', (code) => { exits[1] = code; exited++ })

    // A listener results (either winner) …
    const connectable = (): Promise<boolean> => new Promise((res) => {
      const s = netConnect(sock, () => { s.destroy(); res(true) })
      s.on('error', () => res(false))
    })
    await waitFor(() => exited >= 1, 'the losing daemon to concede', 30_000)
    // … and stays connectable AFTER the loser conceded (the loser removed nothing).
    await waitFor(() => existsSync(metaPath(dir, ws)), 'the winner\'s metadata', 30_000)
    let ok = false
    for (let i = 0; i < 200 && !ok; i++) ok = await connectable()
    expect(ok, 'the surviving daemon is connectable after the loser exited').toBe(true)

    expect(exited, 'exactly one of the two conceded').toBe(1)
    const loserCode = exits.find((c) => !Number.isNaN(c as number))
    expect(loserCode, 'the loser exits cleanly, without disturbing the winner').toBe(0)

    const meta = readMeta(dir, ws)
    expect([d1.pid, d2.pid], 'the recorded pid is one of the two candidates').toContain(meta.pid)
    expect(alive(meta.pid), 'the winner is alive').toBe(true)
    reapPids.push(meta.pid)

    // BOTH clients complete their connects against the surviving daemon (the second steals the
    // lease from the first — completing the connect is the guarantee, not co-holding it).
    await handshakeOnce(sock)
    await handshakeOnce(sock)
  }, 120_000)
})

const handshakeOnce = (sock: string): Promise<void> => new Promise((res, rej) => {
  const s = netConnect(sock)
  sockets.push(s)
  const decoder = createFrameDecoder()
  const hs = createDaemonClientHandshake({ version: pkgVersion })
  let done = false
  s.on('data', (chunk: Buffer) => {
    let items: DecodedItem[]
    try { items = decoder.push(chunk) } catch { return }
    for (const item of items) {
      if (done || item.kind !== 'message' || item.frame.type !== 'hello') continue
      const r = hs.onMessage(item.frame)
      if (!r.ok) { rej(new Error(r.failure.message)); return }
      s.write(encodeFrame(r.reply))
      done = true
      res()
    }
  })
  s.on('error', (e) => { if (!done) rej(e) })
  setTimeout(() => { if (!done) rej(new Error('handshake timeout')) }, 20_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2452 REQ-005 reclaim happens INSIDE the serialized critical section — even under concurrency (FINDING-006)', () => {
  it('dead-pid remnants + two overlapping bootstraps: exactly one listener, no live socket ever unlinked, both clients complete', async () => {
    const dir = mkAgentDir()
    const ws = 'w2452'
    const sock = uniqueSock(dir)

    // Remnants of a kill -9-shaped death: metadata with a genuinely dead pid (+ a stale socket
    // file on POSIX; win32 pipes vanish with their process).
    const dead = spawnNode(['-e', ''])
    await new Promise<void>((r) => dead.on('exit', () => r()))
    writeFileSync(metaPath(dir, ws), metaSeed(dead.pid!))
    if (process.platform !== 'win32') writeFileSync(sock, '')

    const argv = [artifactIn(dir), '--daemon', '--pty=fake', `--ws=${ws}`, `--socket=${sock}`, '--idle-timeout-ms=60000']
    const d1 = spawnNode(argv)
    const d2 = spawnNode(argv)
    let exited = 0
    const exitCodes: Array<number | null> = []
    d1.on('exit', (code) => { exitCodes.push(code); exited++ })
    d2.on('exit', (code) => { exitCodes.push(code); exited++ })

    // Exactly one survives; the loser conceded cleanly. The reclaim (unlink of the PROVEN
    // remnants) ran inside the winner's serialized claim — a concurrent winner's LIVE socket was
    // never removed, which is observable as: the surviving endpoint answers handshakes.
    await waitFor(() => exited >= 1, 'one bootstrap to concede', 30_000)
    await waitFor(() => existsSync(metaPath(dir, ws)) && readMeta(dir, ws).pid !== dead.pid, 'the winner\'s fresh metadata', 30_000)
    expect(exited, 'exactly one conceded — never both (the guard must not wedge)').toBe(1)
    expect(exitCodes[0], 'the loser exits 0-or-quietly').toBe(0)

    const meta = readMeta(dir, ws)
    expect(alive(meta.pid), 'the surviving daemon is live').toBe(true)
    reapPids.push(meta.pid)

    await handshakeOnce(sock)
    await handshakeOnce(sock)
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2453 REQ-005 ownership-checked cleanup: a superseded daemon never unlinks a successor\'s files', () => {
  it('metadata overwritten with a live foreign pid → the idle-exiting daemon removes NOTHING', async () => {
    const dir = mkAgentDir()
    const ws = 'w2453'
    const sock = uniqueSock(dir)

    const daemon = spawnNode([artifactIn(dir), '--daemon', '--pty=fake', `--ws=${ws}`, `--socket=${sock}`, '--idle-timeout-ms=2000'])
    await waitFor(() => existsSync(metaPath(dir, ws)), 'the daemon\'s metadata', 30_000)
    const ownPid = readMeta(dir, ws).pid
    reapPids.push(ownPid)

    // Simulate a successor's takeover: the recorded metadata pid is no longer this daemon's own.
    const successor = spawnNode(['-e', 'setInterval(() => {}, 1000)'])
    reapPids.push(successor.pid!)
    const superseded = metaSeed(successor.pid!)
    writeFileSync(metaPath(dir, ws), superseded)

    // The daemon idles out (no connection ever established) — its cleanup MUST re-verify the
    // recorded pid is its own before unlinking (FINDING-006c / CONV-045).
    await new Promise<void>((r) => daemon.on('exit', () => r()))
    expect(alive(ownPid)).toBe(false)
    expect(existsSync(metaPath(dir, ws)), 'the successor\'s metadata was NOT unlinked').toBe(true)
    expect(readFileSync(metaPath(dir, ws), 'utf8'), 'byte-untouched').toBe(superseded)
    if (process.platform !== 'win32') {
      expect(existsSync(sock), 'the (successor-owned) socket path was NOT unlinked either').toBe(true)
    }
    expect(alive(successor.pid!), 'the live successor was never killed').toBe(true)
  }, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(process.platform === 'win32')('TEST-2454 REQ-003 the REAL AF_UNIX socket is owner-only 0600 from the instant it exists (FINDING-005)', () => {
  it('a real --daemon bind (ws-derived socket) yields mode 0600 at first observable existence', async () => {
    const dir = mkAgentDir()
    const ws = 'w2454'
    // No --socket override: the endpoint derives from the token — agent-<ws>.sock beside the
    // artifact (the production shape).
    const sockPath = join(dir, `agent-${ws}.sock`)
    spawnNode([artifactIn(dir), '--daemon', '--pty=fake', `--ws=${ws}`, '--idle-timeout-ms=60000'])

    // Hot-poll stat: the FIRST successful stat of the socket file must already be 0600 — the
    // restrictive umask was in force during the bind, so no wider-mode window can exist.
    let mode = -1
    const deadline = Date.now() + 30_000
    for (;;) {
      try {
        mode = statSync(sockPath).mode & 0o777
        break
      } catch {
        if (Date.now() > deadline) throw new Error('timed out waiting for the real socket to exist')
        await new Promise((r) => setTimeout(r, 2))
      }
    }
    expect(mode, 'owner-only from birth — never a chmod-after-listen window').toBe(0o600)

    await waitFor(() => existsSync(metaPath(dir, ws)), 'the metadata announcement', 30_000)
    reapPids.push(readMeta(dir, ws).pid)
    // The 0600 socket still accepts its owner: a handshake completes.
    await handshakeOnce(sockPath)
  }, 90_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2425 REQ-007 stale reclaim vs live-busy: deterministic, never wedged, never killing a live daemon', () => {
  it('(a) dead-pid remnants are reclaimed by the DAEMON\'s claim: fresh spawn, truncated log, hello reached', async () => {
    const dir = mkAgentDir()
    const ws = 'w2425a'
    const sock = uniqueSock(dir)

    // A genuinely dead pid: a child that already exited.
    const dead = spawnNode(['-e', ''])
    await new Promise<void>((r) => dead.on('exit', () => r()))
    const deadPid = dead.pid!

    writeFileSync(metaPath(dir, ws), metaSeed(deadPid))
    writeFileSync(logPath(dir, ws), 'STALE-LOG-MARKER from the crashed generation\n')
    if (process.platform !== 'win32') writeFileSync(sock, '') // the stale socket-file remnant

    const c = bridgeClient([artifactIn(dir), '--attach', '--pty=fake', `--ws=${ws}`, `--socket=${sock}`, '--idle-timeout-ms=60000'])
    await waitFor(() => c.isEstablished(), 'reclaim → fresh spawn → hello', 30_000)
    const lines = statusLinesOf(c.stderr())
    expect(lines[0].spawned, 'the next connect spawned a fresh daemon (locked D7 — never wedge on a dead socket)').toBe(true)
    const meta = readMeta(dir, ws)
    expect(meta.pid).not.toBe(deadPid)
    expect(alive(meta.pid)).toBe(true)
    reapPids.push(meta.pid)
    // CONV-003 log-bound: each daemon start truncates the previous generation's log.
    await waitFor(() => existsSync(logPath(dir, ws)), 'the fresh generation\'s log', 20_000)
    expect(readFileSync(logPath(dir, ws), 'utf8')).not.toContain('STALE-LOG-MARKER')
    c.endInput()
    await c.exit
  }, 120_000)

  it('(b) a live-but-not-accepting pid is NEVER reclaimed: retries, then exit 96 naming socket, pid, log, and the manual escape hatch', async () => {
    const dir = mkAgentDir()
    const ws = 'w2425b'
    const sock = uniqueSock(dir)

    const dummy = spawnNode(['-e', 'setInterval(() => {}, 1000)'])
    const dummyPid = dummy.pid!
    reapPids.push(dummyPid)
    const preseed = metaSeed(dummyPid)
    writeFileSync(metaPath(dir, ws), preseed)

    const bridge = spawnNode([artifactIn(dir), '--attach', '--pty=fake', `--ws=${ws}`, `--socket=${sock}`])
    let stderrText = ''
    bridge.stderr.on('data', (c: Buffer) => { stderrText += c.toString('utf8') })
    const code = await new Promise<number | null>((res) => { bridge.on('exit', (c) => res(c)) })

    expect(code, 'the bridge sentinel: could not reach a listening daemon').toBe(UNREACHABLE_EXIT)
    expect(stderrText, 'the diagnostic names the socket path (CONV-001)').toContain(sock)
    expect(stderrText, 'the diagnostic names the recorded pid').toContain(String(dummyPid))
    expect(stderrText, 'the diagnostic names the daemon log location').toContain(`daemon-${ws}.log`)
    // FINDING-018 disclosure: the pid-reuse wedge's manual escape hatch is spelled out.
    expect(stderrText, 'manual recovery: terminate the recorded pid').toMatch(/terminat/i)
    expect(stderrText, 'manual recovery: or remove the named socket/metadata files').toMatch(/remove/i)
    expect(existsSync(metaPath(dir, ws)), 'NOTHING was removed while the recorded pid is alive').toBe(true)
    expect(readFileSync(metaPath(dir, ws), 'utf8')).toBe(preseed)
    expect(alive(dummyPid), 'the live process was never killed').toBe(true)
  }, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('TEST-2426 REQ-011 the daemon resolves the 0023 co-provisioned node-pty from the agent dir', () => {
  it('with the stub at <agentDir>/node_modules/node-pty, --pty=node-pty reaches hello and serves a pane', async () => {
    const dir = mkAgentDir()
    const ws = 'w2426'
    const sock = uniqueSock(dir)
    cpSync(stubPkg, join(dir, 'node_modules', 'node-pty'), { recursive: true })

    const c = bridgeClient([artifactIn(dir), '--attach', '--pty=node-pty', `--ws=${ws}`, `--socket=${sock}`, '--idle-timeout-ms=60000'])
    await waitFor(() => c.isEstablished(), 'hello through a node-pty-backend daemon', 30_000)
    const meta = readMeta(dir, ws)
    expect(meta.backend).toBe('node-pty')
    reapPids.push(meta.pid)

    const spawned = await c.req(CH.ptySpawn, spawnParams('np1'))
    expect(spawned.ok, 'the stub node-pty resolved from the agent dir and spawned').toBe(true)
    await waitFor(() => c.data('np1').includes('stub-ready'), 'the stub pty\'s ready line', 30_000)
    await c.req(CH.ptyKill, 'np1')
    c.endInput()
    await c.exit
  }, 120_000)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Revision 3 addendum (ESC-002 / FINDING-022): the REQ-003 over-long-path guard binds the
// PRODUCTION bind path, not only the pure seam — the seam twin lives in
// tests/agent-daemon-guard.test.ts (TEST-2458, always-on portable).
describe.skipIf(process.platform === 'win32')('TEST-2459 REQ-003 the PRODUCTION bind path fails FAST and NAMED on an over-long socket path (FINDING-022)', () => {
  it('a real --daemon with an over-long --socket exits nonzero promptly with the path-and-limit error — never a raw EINVAL, never a silent 0, no claim-loop retries', async () => {
    const dir = mkAgentDir()
    const ws = 'w2459'
    const longSock = join(dir, `${'x'.repeat(160)}.sock`)
    expect(Buffer.byteLength(longSock, 'utf8'), 'the vector genuinely exceeds the AF_UNIX byte limit').toBeGreaterThan(107)

    const child = spawnNode([artifactIn(dir), '--daemon', '--pty=fake', `--ws=${ws}`, `--socket=${longSock}`])
    let stderrText = ''
    child.stderr.on('data', (c: Buffer) => { stderrText += c.toString('utf8') })
    const started = Date.now()
    const code = await Promise.race([
      new Promise<number | null>((res) => child.on('exit', (c) => res(c))),
      // Well under DAEMON_SPAWN_WAIT_MS (10 s): a guard that fails fast never needs the deadline;
      // the pre-fix 200-attempt claim loop takes far longer and is caught here as 'looping'.
      new Promise<'looping'>((res) => setTimeout(() => res('looping'), 8000))
    ])
    expect(code, 'fails FAST — BEFORE any single-instance claim/reclaim attempt or retry loop (FINDING-022)').not.toBe('looping')
    expect(Date.now() - started, 'prompt: well under the spawn-readiness deadline').toBeLessThan(8000)
    expect(code, 'nonzero — never a silent exit 0').not.toBe(0)

    // Run directly, the diagnostic sink is stderr (REQ-003): the named path-and-limit error.
    expect(stderrText, 'names the offending socket path (CONV-001)').toContain(longSock)
    expect(stderrText, 'names the limit (byte-measured)').toMatch(/limit|byte/i)
    expect(stderrText, 'never a raw errno leaking through').not.toMatch(/EINVAL|ENAMETOOLONG/)
    // The ws-keyed daemon log (a SHORT path — only the socket was over-long) carries the same
    // named error when it exists, so a detached spawn's bridge-96 diagnostic can point at it.
    const lp = logPath(dir, ws)
    if (existsSync(lp)) {
      expect(readFileSync(lp, 'utf8')).not.toMatch(/EINVAL|ENAMETOOLONG/)
    }
  }, 30_000)
})
