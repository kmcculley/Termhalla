// FROZEN test suite — feature 0018-windowed-flow-control (phase 4).
// The stdio integration proof for flow control (REQ-013): bundle the agent ON DEMAND through
// the SAME vite.agent.config.ts (scratch outDir — no dependency on a prior npm run build),
// spawn the artifact under plain Node with --pty=fake, and drive it as a real client with
// F15's own machinery: a scripted flood against a DELIBERATELY STALLED consumer (no acks) is
// bounded by the declared window; the session stays responsive; policy-driven acks then drain
// the flood to completion with full integrity. No ssh, no real node-pty (locked decision 1).
// Timing discipline: "no further data" is asserted behind same-channel BARRIERS (completed
// round-trips on a second pane), never a bare sleep.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { build } from 'vite'
import {
  encodeFrame, createFrameDecoder, createClientHandshake, createRequestTracker, createClientAckPolicy
} from '@shared/remote/protocol'
import type { WireFrame, EvtFrame, ResFrame, DecodedItem } from '@shared/remote/protocol'
import { CH } from '@shared/ipc-contract'

const root = process.cwd()
const pkgVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version

const OSC_C = '\x1b]133;C\x07'
const oscD = (code: number): string => `\x1b]133;D;${code}\x07`

let outDir = ''
let bundlePath = ''
const clients: TestClient[] = []

class TestClient {
  child: ChildProcessWithoutNullStreams
  frames: WireFrame[] = []
  stderr = ''
  exit: Promise<number | null>

  constructor(args: string[] = ['--pty=fake']) {
    this.child = spawn(process.execPath, [bundlePath, ...args], { windowsHide: true })
    const decoder = createFrameDecoder()
    this.child.stdout.on('data', (chunk: Buffer) => {
      for (const item of decoder.push(chunk)) {
        if (item.kind === 'message') this.frames.push(item.frame)
      }
    })
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderr += chunk.toString('utf8') })
    this.exit = new Promise((res) => this.child.on('exit', (code) => res(code)))
    clients.push(this)
  }

  send(frame: WireFrame): void { this.child.stdin.write(encodeFrame(frame)) }

  async waitFor<T>(pick: () => T | undefined, what: string, ms = 30_000): Promise<T> {
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

  evts(channel: string, paneId: string): EvtFrame[] {
    return this.frames.filter((f): f is EvtFrame => f.type === 'evt' && f.channel === channel && f.args[0] === paneId)
  }

  dataText(paneId: string): string {
    return this.evts(CH.ptyData, paneId).map((e) => String(e.args[1])).join('')
  }

  dataUnits(paneId: string): number {
    return this.evts(CH.ptyData, paneId).reduce((n, e) => n + String(e.args[1]).length, 0)
  }

  dispose(): void { try { this.child.kill() } catch { /* already gone */ } }
}

const doHandshake = async (c: TestClient): Promise<void> => {
  const hello = await c.waitFor(() => c.frames[0], 'the agent hello')
  const hs = createClientHandshake({ version: pkgVersion })
  const r = hs.onMessage(hello)
  if (!r.ok) throw new Error(`client handshake failed: ${r.failure.message}`)
  c.send(r.reply)
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'termhalla-agent-flow-'))
  await build({
    configFile: resolve(root, 'vite.agent.config.ts'), // the SAME config npm run build uses (REQ-015)
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })
  bundlePath = join(outDir, 'termhalla-agent.cjs')
}, 180_000)

afterEach(() => { for (const c of clients.splice(0)) c.dispose() })
afterAll(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }) })

describe('TEST-795 REQ-013 stdio flood: stalled consumer is bounded; acks drain it; clean exit', () => {
  it('bounds the flood at the declared window, stays responsive, recovers, and exits 0', async () => {
    const WINDOW = 4096
    const CHUNKS = 64
    const CHUNK_BYTES = 256 // 16_384 total flood units, 4x the window

    const c = new TestClient()
    await doHandshake(c)

    const tracker = createRequestTracker()
    const ask = async (method: string, params: unknown): Promise<ResFrame> => {
      const opened = tracker.open(method, params)
      c.send(opened.frame)
      const res = await c.waitFor(() => c.res(opened.id), `res for ${method} #${opened.id}`)
      expect(tracker.settle(res).kind).toBe('settled')
      return res
    }

    c.send({ type: 'window', size: WINDOW }) // connection-wide, before any pane exists

    const spawned = await ask(CH.ptySpawn, { id: 'a', shellId: 'default', cwd: '/home/remote', cols: 80, rows: 24 })
    expect(spawned.ok).toBe(true)
    await ask(CH.ptyWrite, { id: 'a', data: `flood ${CHUNKS} ${CHUNK_BYTES}\n` })

    // The flood crosses the window, then STOPS (we send no acks — the deliberately stalled consumer).
    await c.waitFor(() => c.dataUnits('a') > WINDOW ? true : undefined, 'the window crossing')

    // BARRIER 1: a full round-trip on a second pane proves the agent is alive and serving.
    await ask(CH.ptySpawn, { id: 'b', shellId: 'default', cwd: '/home/remote', cols: 80, rows: 24 })
    await ask(CH.ptyWrite, { id: 'b', data: 'echo barrier-one\n' })
    await c.waitFor(() => c.dataText('b').includes('barrier-one') ? true : undefined, 'barrier one')

    const stalledUnits = c.dataUnits('a')
    expect(stalledUnits).toBeGreaterThan(WINDOW)
    expect(stalledUnits).toBeLessThanOrEqual(WINDOW + CHUNK_BYTES)
    expect(c.dataText('a')).not.toContain(oscD(0))

    // BARRIER 2: another full round-trip — pane a's stream must be STALLED, not merely slow.
    await ask(CH.ptyWrite, { id: 'b', data: 'echo barrier-two\n' })
    await c.waitFor(() => c.dataText('b').includes('barrier-two') ? true : undefined, 'barrier two')
    expect(c.dataUnits('a'), 'no pane-a data between the two barriers').toBe(stalledUnits)
    const killed = await ask(CH.ptyKill, 'b') // wire shape: the bare pane-id string
    expect(killed.ok, 'killing the barrier pane while pane a stays paused must succeed').toBe(true)

    // RECOVERY: the client-side ack policy drives acks off received data until the flood completes.
    const policy = createClientAckPolicy({ ackEveryBytes: 1024 })
    let consumed = 0
    const feed = (): number => {
      const es = c.evts(CH.ptyData, 'a')
      let sentAcks = 0
      while (consumed < es.length) {
        const ack = policy.onData('a', String(es[consumed].args[1]))
        if (ack) { c.send(ack); sentAcks++ }
        consumed++
      }
      return sentAcks
    }
    await c.waitFor(() => {
      feed()
      if (c.dataText('a').includes(oscD(0))) return true
      for (const residue of policy.flush()) c.send(residue) // settle sub-quantum residue
      return undefined
    }, 'the flood to complete under acks', 60_000)

    // INTEGRITY: exactly CHUNKS x CHUNK_BYTES units arrived between the C marker and D;0.
    const all = c.dataText('a')
    const start = all.indexOf(OSC_C) + OSC_C.length
    const end = all.indexOf(oscD(0))
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(end - start, 'the full flood arrived, nothing dropped or duplicated').toBe(CHUNKS * CHUNK_BYTES)

    // Clean shutdown taxonomy (F16): stdin end -> exit 0, stdout stayed frames-only throughout.
    c.child.stdin.end()
    expect(await c.exit).toBe(0)
  }, 120_000)
})
