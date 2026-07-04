// FROZEN test suite — feature 0019-agent-replay-session-survival (phase 4).
// REQ-012: the reattach surface works over the REAL artifact — bundle on demand through the SAME
// (unmodified) vite.agent.config.ts, spawn under plain Node with --pty=fake, and round-trip
// pty:attach / pty:sessions within one connection. Proves @xterm/headless + the serialize addon
// run inside the single-file cjs bundle under plain Node (no node_modules), and that the SHIPPED
// single-connection composition still kills panes on stdin end (survival never leaks into the
// v1 CLI behavior — REQ-005). F16's frozen roundtrip suite (tests/agent-stdio-roundtrip.test.ts)
// is untouched; this is a NEW self-sufficient sibling.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { build } from 'vite'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import {
  WIRE_PROTO, encodeFrame, createFrameDecoder, createClientHandshake, createRequestTracker
} from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, HelloFrame, DecodedItem } from '@shared/remote/protocol'
import { CH } from '@shared/ipc-contract'
import { AGENT_SESSION_METHODS, type AgentAttachResult, type AgentSessionInfo } from '@shared/remote-agent-api'

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

const referenceSerialize = async (chunks: string[], cols: number, rows: number, scrollback: number): Promise<string> => {
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true })
  const addon = new SerializeAddon()
  term.loadAddon(addon as unknown as Parameters<Terminal['loadAddon']>[0])
  for (const c of chunks) await new Promise<void>((r) => term.write(c, r))
  const out = addon.serialize()
  term.dispose()
  return out
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'termhalla-agent-f18-'))
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'), // the SAME, unmodified config (REQ-012)
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })
  bundlePath = join(outDir, 'termhalla-agent.cjs')
}, 180_000)

afterEach(() => { for (const c of clients.splice(0)) c.dispose() })
afterAll(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }) })

describe('TEST-1911 REQ-012 attach + sessions over the real bundled artifact', () => {
  it('round-trips attach/sessions through the artifact; shipped stdin-end behavior unchanged', async () => {
    const c = new TestClient()
    await doHandshake(c)

    const tracker = createRequestTracker()
    const ask = async (method: string, params: unknown): Promise<ResFrame> => {
      const opened = tracker.open(method, params)
      c.send(opened.frame)
      const res = await c.waitFor(() => c.res(opened.id), `res for ${method} #${opened.id}`)
      expect(tracker.settle(res).kind, `${method} settled exactly once`).toBe('settled')
      return res
    }

    const spawnRes = await ask(CH.ptySpawn, { id: 's1', shellId: 'default', cwd: '/srv/replay', cols: 44, rows: 9 })
    expect(spawnRes.ok).toBe(true)

    await ask(CH.ptyWrite, { id: 's1', data: 'echo replayed-through-bundle\n' })
    await c.waitFor(
      () => c.evts(CH.ptyData, 's1').some((e) => String(e.args[1]).includes('replayed-through-bundle')) ? true : undefined,
      'the echoed output')

    // pty:attach — the bundled @xterm/headless + serialize addon produce the snapshot.
    const attachRes = await ask(AGENT_SESSION_METHODS[0], { id: 's1' })
    expect(attachRes.ok, `attach failed: ${JSON.stringify(attachRes)}`).toBe(true)
    if (!attachRes.ok) return
    const result = attachRes.result as AgentAttachResult
    expect(Object.keys(result).sort()).toEqual(['cols', 'cwd', 'rows', 'snapshot', 'status'])
    expect(result.cols).toBe(44)
    expect(result.rows).toBe(9)
    expect(result.cwd).toBe('/srv/replay')
    expect(result.snapshot).toContain('replayed-through-bundle')
    expect(result.status.lastExit, 'the echo completed with D;0').toBe('success')

    // Reference oracle (HISTORY_LIMIT_DEFAULT = 2000 is the store default in the artifact):
    const resIdx = c.frames.indexOf(attachRes)
    const preResData = c.frames.slice(0, resIdx)
      .filter((f): f is EvtFrame => f.type === 'evt' && f.channel === CH.ptyData && f.args[0] === 's1')
      .map((e) => String(e.args[1]))
    expect(result.snapshot).toBe(await referenceSerialize(preResData, 44, 9, 2000))

    // Inventory over the wire: the spawned-and-attached pane, truthful dims.
    const invRes = await ask(AGENT_SESSION_METHODS[1], null)
    expect(invRes.ok).toBe(true)
    if (invRes.ok) {
      const list = invRes.result as AgentSessionInfo[]
      expect(list.map((e) => e.id)).toEqual(['s1'])
      expect(list[0].attached).toBe(true)
      expect(list[0].cols).toBe(44)
      expect(list[0].shellId).toBe('default')
    }

    // Unknown-method message now names the session methods (REQ-009 over the wire).
    const unknown = await ask('pty:bogus', null)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.error.code).toBe('unknown-method')
      expect(unknown.error.message).toContain('pty:attach')
      expect(unknown.error.message).toContain('pty:sessions')
    }

    // Exited panes leave the inventory.
    await ask(CH.ptyWrite, { id: 's1', data: 'exit 0\n' })
    await c.waitFor(() => c.evts(CH.ptyExit, 's1')[0], 'the exit event')
    const after = await ask(AGENT_SESSION_METHODS[1], null)
    if (after.ok) expect(after.result).toEqual([])

    // The SHIPPED composition still ends cleanly on stdin end (REQ-005 boundary).
    c.child.stdin.end()
    expect(await c.exit).toBe(0)
    expect(c.badItems, 'stdout carried only valid frames the whole session').toEqual([])
  }, 120_000)
})
