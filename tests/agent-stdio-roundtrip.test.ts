// FROZEN test suite — feature 0017-agent-runtime-skeleton (phase 4).
// The stdio integration proof (REQ-016): bundle the agent ON DEMAND through the SAME
// vite.agent.config.ts (outDir overridden to a scratch dir — `npm test` never depends on a
// prior `npm run build`), spawn the artifact under plain Node with --pty=fake, and drive it
// as a real client using F15's OWN client-side machinery over the child's stdio — the
// identical protocol path production runs over ssh (locked decision 1), with no ssh and no
// real node-pty anywhere (REQ-011's lazy-load proof: on this checkout node-pty is either
// absent-for-plain-node (Electron ABI) or platform-inapplicable, so the run succeeding
// proves --pty=fake never loads it).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { build } from 'vite'
import {
  WIRE_PROTO, encodeFrame, createFrameDecoder, createClientHandshake, createRequestTracker
} from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, HelloFrame, DecodedItem } from '@shared/remote/protocol'
import { CH } from '@shared/ipc-contract'

const root = process.cwd()
const pkgVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version

let outDir = ''
let bundlePath = ''
const clients: TestClient[] = []

class TestClient {
  child: ChildProcessWithoutNullStreams
  frames: WireFrame[] = []
  badItems: DecodedItem[] = []
  stderr = ''
  exit: Promise<number | null>

  constructor(args: string[] = ['--pty=fake']) {
    this.child = spawn(process.execPath, [bundlePath, ...args], { windowsHide: true })
    const decoder = createFrameDecoder()
    this.child.stdout.on('data', (chunk: Buffer) => {
      for (const item of decoder.push(chunk)) {
        if (item.kind === 'message') this.frames.push(item.frame)
        else this.badItems.push(item)
      }
    })
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderr += chunk.toString('utf8') })
    this.exit = new Promise((res) => this.child.on('exit', (code) => res(code)))
    clients.push(this)
  }

  send(frame: WireFrame): void { this.child.stdin.write(encodeFrame(frame)) }
  sendRaw(bytes: Uint8Array): void { this.child.stdin.write(bytes) }

  async waitFor<T>(pick: () => T | undefined, what: string, ms = 15_000): Promise<T> {
    const deadline = Date.now() + ms
    for (;;) {
      const got = pick()
      if (got !== undefined) return got
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; stderr so far: ${this.stderr}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  res(id: number): ResFrame | undefined {
    return this.frames.find((f): f is ResFrame => f.type === 'res' && f.id === id)
  }

  evts(channel: string, paneId?: string): EvtFrame[] {
    return this.frames.filter((f): f is EvtFrame => f.type === 'evt' && f.channel === channel &&
      (paneId === undefined || f.args[0] === paneId))
  }

  dispose(): void { try { this.child.kill() } catch { /* already gone */ } }
}

const doHandshake = async (c: TestClient): Promise<HelloFrame> => {
  const hello = await c.waitFor(() => c.frames[0], 'the agent hello')
  const hs = createClientHandshake({ version: pkgVersion })
  const r = hs.onMessage(hello)
  if (!r.ok) throw new Error(`client handshake failed: ${r.failure.message}`)
  c.send(r.reply)
  return hello as HelloFrame
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'termhalla-agent-it-'))
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'), // the SAME config npm run build uses (REQ-015/REQ-016)
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })
  bundlePath = join(outDir, 'termhalla-agent.cjs')
}, 180_000)

afterEach(() => { for (const c of clients.splice(0)) c.dispose() })
afterAll(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }) })

describe('TEST-774 REQ-016/REQ-003/REQ-004 full round-trip through the real protocol and artifact', () => {
  it('handshakes, spawns, writes, resizes, observes status/cwd, exits — stdout is frames only', async () => {
    const c = new TestClient()
    const hello = await doHandshake(c)
    expect(hello.proto).toBe(WIRE_PROTO)
    expect(hello.role).toBe('agent')
    expect(hello.version).toBe(pkgVersion) // the artifact carries the repo version (REQ-004)
    expect([...(hello.capabilities ?? [])].sort()).toEqual(['pty', 'status'])

    const tracker = createRequestTracker()
    const ask = async (method: string, params: unknown): Promise<ResFrame> => {
      const opened = tracker.open(method, params)
      c.send(opened.frame)
      const res = await c.waitFor(() => c.res(opened.id), `res for ${method} #${opened.id}`)
      const settled = tracker.settle(res)
      expect(settled.kind, `${method} settled exactly once`).toBe('settled')
      return res
    }

    const spawnArgs = { id: 'r1', shellId: 'default', cwd: '/home/remote', cols: 80, rows: 24 }
    const fresh = await ask(CH.ptySpawn, spawnArgs)
    expect(fresh.ok).toBe(true)
    if (fresh.ok) expect(fresh.result).toBe(false)
    const adopt = await ask(CH.ptySpawn, spawnArgs)
    if (adopt.ok) expect(adopt.result).toBe(true)

    await ask(CH.ptyWrite, { id: 'r1', data: 'echo remote-round-trip\n' })
    await c.waitFor(
      () => c.evts(CH.ptyData, 'r1').some((e) => String(e.args[1]).includes('remote-round-trip')) ? true : undefined,
      'the echoed pty:data')

    await ask(CH.ptyResize, { id: 'r1', cols: 100, rows: 31 })
    await ask(CH.ptyWrite, { id: 'r1', data: 'size\n' })
    await c.waitFor(
      () => c.evts(CH.ptyData, 'r1').some((e) => String(e.args[1]).includes('size=100x31')) ? true : undefined,
      'the resized size report')

    await c.waitFor(() => c.evts(CH.ptyStatus, 'r1').length > 0 ? true : undefined, 'a pty:status push')

    await ask(CH.ptyWrite, { id: 'r1', data: 'cwd /srv/app\n' })
    const cwdEvt = await c.waitFor(() => c.evts(CH.ptyCwd, 'r1')[0], 'the pty:cwd push')
    expect(cwdEvt.args).toEqual(['r1', '/srv/app'])

    const unknown = await ask('fs:read', { path: '/etc/passwd' })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.error.code).toBe('unknown-method')
      expect(unknown.error.message).toContain('fs:read')
    }

    await ask(CH.ptyWrite, { id: 'r1', data: 'exit 4\n' })
    const exitEvt = await c.waitFor(() => c.evts(CH.ptyExit, 'r1')[0], 'the pty:exit push')
    expect(exitEvt.args).toEqual(['r1', 4])

    c.child.stdin.end() // clean shutdown (REQ-013)
    expect(await c.exit).toBe(0)

    // REQ-003: every stdout byte across the whole session decoded as valid frames.
    expect(c.badItems).toEqual([])
    expect(tracker.pendingCount).toBe(0)
  }, 60_000)
})

describe('TEST-775 REQ-005 handshake failures over the real stdio', () => {
  it('a version mismatch yields one hello on stdout, the reason on stderr, exit 1', async () => {
    const c = new TestClient()
    await c.waitFor(() => c.frames[0], 'the agent hello')
    c.send({ type: 'hello', proto: WIRE_PROTO, role: 'client', version: `${pkgVersion}-not` })
    expect(await c.exit).toBe(1)
    expect(c.frames.length).toBe(1) // nothing after its own hello
    expect(c.stderr).toContain('version-mismatch')
    expect(c.stderr).toContain(pkgVersion)
  }, 30_000)

  it('a req before the client hello fails the handshake with exit 1', async () => {
    const c = new TestClient()
    await c.waitFor(() => c.frames[0], 'the agent hello')
    c.send({ type: 'req', id: 1, method: CH.ptySpawn, params: null })
    expect(await c.exit).toBe(1)
    expect(c.frames.length).toBe(1)
    expect(c.stderr).toContain('unexpected-frame')
  }, 30_000)
})

describe('TEST-776 REQ-011 CLI usage errors', () => {
  it('--pty=bogus exits 2 with usage on stderr and ZERO stdout bytes', async () => {
    const c = new TestClient(['--pty=bogus'])
    expect(await c.exit).toBe(2)
    expect(c.frames).toEqual([])
    expect(c.badItems).toEqual([])
    expect(c.stderr).toContain('--pty')
    expect(c.stderr).toContain('bogus')
  }, 30_000)
})

describe('TEST-777 REQ-013 lifecycle over the real stdio', () => {
  it('stdin close with a live pane exits 0 promptly', async () => {
    const c = new TestClient()
    await doHandshake(c)
    const tracker = createRequestTracker()
    const opened = tracker.open(CH.ptySpawn, { id: 'r1', shellId: 'default', cwd: '/x', cols: 80, rows: 24 })
    c.send(opened.frame)
    await c.waitFor(() => c.res(opened.id), 'the spawn res')
    c.child.stdin.end()
    expect(await c.exit).toBe(0) // a live pane must not keep the agent alive
  }, 30_000)

  it('a garbage frame is diagnosed and the session recovers; an oversized prefix is fatal (exit 1)', async () => {
    const c = new TestClient()
    await doHandshake(c)
    const garbage = Buffer.from('not json!', 'utf8')
    const hdr = Buffer.alloc(4)
    hdr.writeUInt32BE(garbage.byteLength, 0)
    c.sendRaw(Buffer.concat([hdr, garbage]))
    await c.waitFor(() => c.stderr.includes('bad-json') ? true : undefined, 'the bad-json diagnostic')

    const tracker = createRequestTracker()
    const opened = tracker.open(CH.ptySpawn, { id: 'r2', shellId: 'default', cwd: '/x', cols: 80, rows: 24 })
    c.send(opened.frame)
    const res = await c.waitFor(() => c.res(opened.id), 'the post-garbage spawn res')
    expect(res.ok).toBe(true) // per-frame errors never kill the session

    const fatal = Buffer.alloc(4)
    fatal.writeUInt32BE(8 * 1024 * 1024 + 1, 0)
    c.sendRaw(fatal)
    expect(await c.exit).toBe(1) // fatal framing: the decoder is dead, the agent must not continue
  }, 30_000)
})
