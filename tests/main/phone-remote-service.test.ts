// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// The composed service over a REAL HTTP+WS listener: REQ-001 (disabled inert / enable-disable
// round trip), REQ-002 (bind modes), REQ-004/REQ-007 (pairing URL, hash-only at rest),
// REQ-005 (auth + allowlist), REQ-006 (regenerate revokes everything), REQ-009/REQ-024 (wire
// attach + reconnect + restart), REQ-011 (inventory + status push over the wire), REQ-019
// (stop with live clients), REQ-020 (specific enable failures).
//
// Contract set here for the implementer — src/main/phone-remote/service.ts exports:
//   createPhoneRemoteService(deps: PhoneRemoteServiceDeps): PhoneRemoteService
//   PhoneRemoteServiceDeps = {
//     loadSettings(): Promise<PhoneRemoteSettings | undefined>
//     saveSettings(s: PhoneRemoteSettings | undefined): Promise<void>
//     panes: {
//       list(): Array<{ paneId: string; workspaceId: string; workspaceName: string;
//                       title: string; kind: string; cols: number; rows: number; status: string }>
//       onData(cb: (paneId: string, chunk: string) => void): () => void
//       onExit(cb: (paneId: string) => void): () => void
//       onGrid(cb: (paneId: string, cols: number, rows: number) => void): () => void
//       onStatus(cb: (paneId: string, status: string) => void): () => void
//       write(paneId: string, data: string): void
//     }
//     staticRoot?: string            // dir served as the web-client bundle (out/phone-client in prod)
//     notifyError(message: string): void   // routed to the error-severity toast by the IPC layer
//     replayFactory?: ReplayFactory  // test seam; defaults to the F18 createPaneReplay
//   }
//   PhoneRemoteService = {
//     init(): Promise<void>                       // load settings; start listener iff enabled
//     setEnabled(b: boolean): Promise<void>
//     setBind(m: 'localhost' | 'lan'): Promise<void>
//     setPort(p: number): Promise<void>
//     status(): { enabled: boolean; bind: string; port: number; running: boolean;
//                 urls: string[]; hasToken: boolean; tokenAvailableThisSession: boolean }
//     regenerateToken(): Promise<{ pairingUrl: string }>
//     stop(): Promise<void>
//   }
// The service TRUSTS its injected settings (normalization happens at the quick-store
// boundary); settings.port === 0 means OS-assigned and the ACTUAL bound port is reported
// back through status().port / status().urls. The WS endpoint is `/ws`; the token rides
// the `token` query parameter or the `X-Termhalla-Token` header (REQ-005).
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server, connect } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { createPhoneRemoteService } from '../../src/main/phone-remote/service'
import { verifyToken } from '../../src/main/phone-remote/token'
import type { PhoneRemoteSettings } from '../../src/shared/phone-remote/settings'
import type { ReplayFactory } from '../../src/agent/replay'

type Msg = Record<string, unknown> & { type: string }

const until = async (pred: () => boolean, ms = 8000): Promise<void> => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('until: timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

interface PaneSourceHandle {
  panes: Parameters<typeof createPhoneRemoteService>[0]['panes']
  writes: Array<[string, string]>
  emitData: (paneId: string, chunk: string) => void
  emitStatus: (paneId: string, status: string) => void
  emitExit: (paneId: string) => void
}

const mkPaneSource = (list: Array<Record<string, unknown>>): PaneSourceHandle => {
  const dataCbs: Array<(id: string, c: string) => void> = []
  const exitCbs: Array<(id: string) => void> = []
  const gridCbs: Array<(id: string, c: number, r: number) => void> = []
  const statusCbs: Array<(id: string, s: string) => void> = []
  const writes: Array<[string, string]> = []
  return {
    panes: {
      list: () => list as never,
      onData: (cb) => { dataCbs.push(cb); return () => {} },
      onExit: (cb) => { exitCbs.push(cb); return () => {} },
      onGrid: (cb) => { gridCbs.push(cb); return () => {} },
      onStatus: (cb) => { statusCbs.push(cb); return () => {} },
      write: (id, d) => writes.push([id, d])
    },
    writes,
    emitData: (id, c) => dataCbs.forEach((cb) => cb(id, c)),
    emitStatus: (id, s) => statusCbs.forEach((cb) => cb(id, s)),
    emitExit: (id) => exitCbs.forEach((cb) => cb(id))
  }
}

const TERM_PANE = (paneId: string, ws = 'ws1'): Record<string, unknown> => ({
  paneId, workspaceId: ws, workspaceName: `Workspace ${ws}`, title: `term ${paneId}`,
  kind: 'terminal', cols: 80, rows: 24, status: 'idle'
})

interface Ctx {
  svc: ReturnType<typeof createPhoneRemoteService>
  src: PaneSourceHandle
  errors: string[]
  persisted: () => PhoneRemoteSettings | undefined
  staticDir: string
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanups.length > 0) { try { await cleanups.pop()!() } catch { /* teardown */ } }
})

const mkService = async (
  initial: PhoneRemoteSettings | undefined,
  paneList: Array<Record<string, unknown>> = [TERM_PANE('A')],
  replayFactory?: ReplayFactory
): Promise<Ctx> => {
  let stored = initial
  const errors: string[] = []
  const src = mkPaneSource(paneList)
  const staticDir = mkdtempSync(join(tmpdir(), 'termh-phone-static-'))
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Termhalla Phone</title>')
  writeFileSync(join(staticDir, 'manifest.webmanifest'), JSON.stringify({ name: 'Termhalla', display: 'standalone', start_url: '/' }))
  mkdirSync(join(staticDir, 'icons'), { recursive: true })
  writeFileSync(join(staticDir, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const svc = createPhoneRemoteService({
    loadSettings: async () => stored,
    saveSettings: async (s) => { stored = s },
    panes: src.panes,
    staticRoot: staticDir,
    notifyError: (m) => errors.push(m),
    ...(replayFactory ? { replayFactory } : {})
  })
  await svc.init()
  cleanups.push(async () => { await svc.stop(); rmSync(staticDir, { recursive: true, force: true }) })
  return { svc, src, errors, persisted: () => stored, staticDir }
}

const baseOf = (ctx: Ctx): string => {
  const url = ctx.svc.status().urls[0]
  expect(url, 'status().urls must report a reachable URL while running').toBeTruthy()
  return url.replace(/\/$/, '')
}

const wsOpen = (url: string): Promise<{ ws: WebSocket; msgs: Msg[]; closed: () => boolean }> =>
  new Promise((res, rej) => {
    const ws = new WebSocket(url)
    const msgs: Msg[] = []
    let isClosed = false
    ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))) } catch { /* non-JSON */ } })
    ws.on('close', () => { isClosed = true })
    ws.on('open', () => res({ ws, msgs, closed: () => isClosed }))
    ws.on('error', rej)
  })

const wsRejects = (url: string): Promise<boolean> =>
  new Promise((res) => {
    const ws = new WebSocket(url)
    ws.on('open', () => { ws.close(); res(false) })
    ws.on('error', () => res(true))
    ws.on('unexpected-response', () => res(true))
  })

const ENABLED: PhoneRemoteSettings = { enabled: true, bind: 'localhost', port: 0 }

describe('TEST-2650 REQ-001 off by default; disabled means inert; enable->disable round-trips', () => {
  it('absent settings: not running; pane bytes cost no mirror work at all', async () => {
    const feeds: string[] = []
    const factory: ReplayFactory = (opts) => ({
      feed: (d) => { feeds.push(d) }, resize: () => {}, snapshot: async () => '', dispose: () => {}
    })
    const ctx = await mkService(undefined, [TERM_PANE('A')], factory)
    expect(ctx.svc.status().enabled).toBe(false)
    expect(ctx.svc.status().running).toBe(false)
    ctx.src.emitData('A', 'burst of output')
    await new Promise((r) => setTimeout(r, 30))
    expect(feeds, 'the disabled path must perform no mirror feed').toEqual([])
  })

  it('enable binds and creates mirrors; disable closes the listener and disposes every mirror', async () => {
    let createdCount = 0
    let disposedCount = 0
    const factory: ReplayFactory = () => {
      createdCount++
      return { feed: () => {}, resize: () => {}, snapshot: async () => '', dispose: () => { disposedCount++ } }
    }
    const ctx = await mkService({ enabled: false, bind: 'localhost', port: 0 }, [TERM_PANE('A'), TERM_PANE('B')], factory)
    await ctx.svc.setEnabled(true)
    expect(ctx.svc.status().running).toBe(true)
    expect(createdCount, 'enable creates a mirror per existing live pane').toBe(2)
    const port = ctx.svc.status().port
    await ctx.svc.setEnabled(false)
    expect(ctx.svc.status().running).toBe(false)
    expect(disposedCount).toBe(2)
    // the listener is really gone
    const refused = await new Promise<boolean>((res) => {
      const s = connect({ host: '127.0.0.1', port }, () => { s.destroy(); res(false) })
      s.on('error', () => res(true))
    })
    expect(refused).toBe(true)
  })
})

describe('TEST-2640 REQ-002 bind modes: localhost default, LAN a separate explicit toggle', () => {
  it('default bind serves on 127.0.0.1 and reports loopback URLs only', async () => {
    const ctx = await mkService({ ...ENABLED })
    const st = ctx.svc.status()
    expect(st.running).toBe(true)
    expect(st.bind).toBe('localhost')
    expect(st.urls.length).toBeGreaterThan(0)
    for (const u of st.urls) expect(u).toContain('127.0.0.1')
    const res = await fetch(`${baseOf(ctx)}/`)
    expect([200, 401]).toContain(res.status) // reachable on loopback (401: unauthenticated)
  })

  it('setBind is separate from enabled: flipping it while disabled starts nothing', async () => {
    const ctx = await mkService({ enabled: false, bind: 'localhost', port: 0 })
    await ctx.svc.setBind('lan')
    expect(ctx.svc.status().bind).toBe('lan')
    expect(ctx.svc.status().running).toBe(false)
  })

  it('flipping LAN while running rebinds and stays reachable (0.0.0.0 includes loopback)', async () => {
    const ctx = await mkService({ ...ENABLED })
    await ctx.svc.setBind('lan')
    expect(ctx.svc.status().bind).toBe('lan')
    expect(ctx.svc.status().running).toBe(true)
    const res = await fetch(`http://127.0.0.1:${ctx.svc.status().port}/`)
    expect([200, 401]).toContain(res.status)
    expect(ctx.persisted()?.bind).toBe('lan')
  })
})

describe('TEST-2647 REQ-004/REQ-007 pairing: QR URL carries the plaintext, disk carries only the hash', () => {
  it('regenerateToken returns a pairing URL with host:port and a verifying token; only the hash persists', async () => {
    const ctx = await mkService({ ...ENABLED })
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const u = new URL(pairingUrl)
    expect(u.host).toContain('127.0.0.1')
    expect(String(ctx.svc.status().port)).toBe(u.port)
    const token = u.searchParams.get('token')
    expect(token, 'the pairing URL must carry the plaintext token').toBeTruthy()
    const stored = ctx.persisted()
    expect(stored?.tokenHash, 'the hash must be persisted').toBeTruthy()
    expect(verifyToken(String(token), stored?.tokenHash)).toBe(true)
    // serialize-and-scan: the plaintext appears NOWHERE in the persisted settings
    expect(JSON.stringify(stored)).not.toContain(String(token))
    expect(ctx.svc.status().hasToken).toBe(true)
    expect(ctx.svc.status().tokenAvailableThisSession).toBe(true)
  })
})

describe('TEST-2643 REQ-005 every data-bearing request authenticates; the install allowlist does not', () => {
  it('GET / rejects absent and wrong tokens with no pane data; accepts query or header auth', async () => {
    const ctx = await mkService({ ...ENABLED }, [TERM_PANE('secret-pane-title')])
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const base = baseOf(ctx)

    const noToken = await fetch(`${base}/`)
    expect(noToken.status).toBe(401)
    expect(await noToken.text()).not.toContain('secret-pane-title')

    const wrong = await fetch(`${base}/?token=WRONG`)
    expect(wrong.status).toBe(401)

    const viaQuery = await fetch(`${base}/?token=${encodeURIComponent(token)}`)
    expect(viaQuery.status).toBe(200)
    expect(await viaQuery.text()).toContain('Termhalla')

    const viaHeader = await fetch(`${base}/`, { headers: { 'X-Termhalla-Token': token } })
    expect(viaHeader.status).toBe(200)
  })

  it('the WS upgrade refuses absent/wrong tokens before any pane data is reachable', async () => {
    const ctx = await mkService({ ...ENABLED })
    await ctx.svc.regenerateToken()
    const base = baseOf(ctx).replace('http', 'ws')
    expect(await wsRejects(`${base}/ws`)).toBe(true)
    expect(await wsRejects(`${base}/ws?token=WRONG`)).toBe(true)
  })

  it('the allowlist (manifest, icons) serves without a token, byte-identical regardless of app state', async () => {
    const ctx = await mkService({ ...ENABLED })
    const base = baseOf(ctx)
    const before = await fetch(`${base}/manifest.webmanifest`)
    expect(before.status).toBe(200)
    const bytesBefore = Buffer.from(await before.arrayBuffer())
    expect(bytesBefore.toString()).toBe(readFileSync(join(ctx.staticDir, 'manifest.webmanifest'), 'utf8'))
    await ctx.svc.regenerateToken()
    const after = await fetch(`${base}/manifest.webmanifest`)
    expect(Buffer.from(await after.arrayBuffer()).equals(bytesBefore)).toBe(true)
    // everything else stays behind the gate
    const other = await fetch(`${base}/some-other-route`)
    expect([401, 404]).toContain(other.status)
    expect(other.status).not.toBe(200)
  })
})

describe('TEST-2644 REQ-005 no token ever generated: ALL authenticated routes reject', () => {
  it('with tokenHash absent, presenting ANY token is rejected', async () => {
    const ctx = await mkService({ ...ENABLED }) // no tokenHash, no regenerate
    const base = baseOf(ctx)
    expect((await fetch(`${base}/?token=anything`)).status).toBe(401)
    expect(await wsRejects(`${base.replace('http', 'ws')}/ws?token=anything`)).toBe(true)
  })
})

describe('TEST-2645 REQ-006 regenerate revokes everything, atomically', () => {
  it('closes connected clients, rejects the old token, accepts the new one', async () => {
    const ctx = await mkService({ ...ENABLED })
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const tokenA = String(new URL(pairingUrl).searchParams.get('token'))
    const wsBase = baseOf(ctx).replace('http', 'ws')
    const client = await wsOpen(`${wsBase}/ws?token=${encodeURIComponent(tokenA)}`)
    await until(() => client.msgs.some((m) => m.type === 'hello'))

    const { pairingUrl: url2 } = await ctx.svc.regenerateToken()
    const tokenB = String(new URL(url2).searchParams.get('token'))
    await until(() => client.closed(), 5000)
    expect(await wsRejects(`${wsBase}/ws?token=${encodeURIComponent(tokenA)}`)).toBe(true)
    const fresh = await wsOpen(`${wsBase}/ws?token=${encodeURIComponent(tokenB)}`)
    await until(() => fresh.msgs.some((m) => m.type === 'hello'))
    fresh.ws.close()
  })
})

describe('TEST-2646 REQ-011 wire inventory: terminal panes only, grouped, with live status pushes', () => {
  it('lists only terminal panes grouped by workspace and pushes status flips unprompted', async () => {
    const panes = [
      TERM_PANE('t1', 'ws1'), TERM_PANE('t2', 'ws2'),
      { ...TERM_PANE('e1', 'ws1'), kind: 'editor' },
      { ...TERM_PANE('x1', 'ws1'), kind: 'explorer' },
      { ...TERM_PANE('o1', 'ws2'), kind: 'orky' }
    ]
    const ctx = await mkService({ ...ENABLED }, panes)
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const client = await wsOpen(`${baseOf(ctx).replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`)
    await until(() => client.msgs.some((m) => m.type === 'panes'))
    const inv = client.msgs.find((m) => m.type === 'panes') as Msg
    const flat = JSON.stringify(inv)
    expect(flat).toContain('t1')
    expect(flat).toContain('t2')
    for (const excluded of ['e1', 'x1', 'o1']) expect(flat).not.toContain(`"${excluded}"`)
    const workspaces = (inv as { workspaces?: Array<{ panes: Array<{ paneId?: string; cols?: number; rows?: number; status?: string }> }> }).workspaces
    expect(Array.isArray(workspaces), 'inventory must be workspace-grouped under `workspaces`').toBe(true)
    expect(workspaces!.length).toBe(2)
    const somePane = workspaces!.flatMap((w) => w.panes)[0]
    expect(somePane.cols).toBe(80)
    expect(somePane.rows).toBe(24)
    expect(somePane.status).toBe('idle')

    // a status flip in main reaches the connected client without a re-request
    ctx.src.emitStatus('t1', 'busy')
    await until(() => client.msgs.some((m) => m.type === 'status' && m.paneId === 't1' && m.status === 'busy'))
    client.ws.close()
  })
})

describe('TEST-2648 REQ-009/REQ-024 wire attach: snapshot-then-stream; reconnect is a fresh attach', () => {
  it('subscribe yields the snapshot of pre-attach bytes, then the live stream; a reconnect re-snapshots', async () => {
    const ctx = await mkService({ ...ENABLED })
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const wsUrl = `${baseOf(ctx).replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`

    ctx.src.emitData('A', 'before-attach\r\n')
    const c1 = await wsOpen(wsUrl)
    c1.ws.send(JSON.stringify({ type: 'subscribe', paneId: 'A' }))
    await until(() => c1.msgs.some((m) => m.type === 'snapshot' && m.paneId === 'A'))
    const snap1 = c1.msgs.find((m) => m.type === 'snapshot' && m.paneId === 'A') as Msg
    expect(String(snap1.data)).toContain('before-attach')

    ctx.src.emitData('A', 'live-stream\r\n')
    await until(() => c1.msgs.some((m) => m.type === 'data' && m.paneId === 'A' && String(m.data).includes('live-stream')))
    // the pre-attach bytes were never re-sent as data (exactly-once)
    expect(c1.msgs.filter((m) => m.type === 'data' && String(m.data).includes('before-attach'))).toEqual([])

    // drop and reconnect: fresh attach semantics, snapshot replaces the client buffer
    c1.ws.terminate()
    ctx.src.emitData('A', 'while-gone\r\n')
    const c2 = await wsOpen(wsUrl)
    c2.ws.send(JSON.stringify({ type: 'subscribe', paneId: 'A' }))
    await until(() => c2.msgs.some((m) => m.type === 'snapshot' && m.paneId === 'A'))
    const snap2 = c2.msgs.find((m) => m.type === 'snapshot' && m.paneId === 'A') as Msg
    expect(String(snap2.data)).toContain('while-gone')
    c2.ws.close()
  })

  it('input over the wire reaches the pane write seam byte-faithfully (REQ-012 end-to-end)', async () => {
    const ctx = await mkService({ ...ENABLED })
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const c = await wsOpen(`${baseOf(ctx).replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`)
    c.ws.send(JSON.stringify({ type: 'subscribe', paneId: 'A' }))
    await until(() => c.msgs.some((m) => m.type === 'snapshot'))
    c.ws.send(JSON.stringify({ type: 'input', paneId: 'A', data: 'ls -la\r\x03' }))
    await until(() => ctx.src.writes.length > 0)
    expect(ctx.src.writes).toEqual([['A', 'ls -la\r\x03']])
    c.ws.close()
  })
})

describe('TEST-2652 REQ-019 stop() with live clients completes promptly', () => {
  it('stop closes the listener and every client socket within the teardown budget', async () => {
    const ctx = await mkService({ ...ENABLED })
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const client = await wsOpen(`${baseOf(ctx).replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`)
    const t0 = Date.now()
    await ctx.svc.stop()
    expect(Date.now() - t0, 'stop() must not hang on live sockets').toBeLessThan(5000)
    await until(() => client.closed(), 5000)
  })
})

describe('TEST-2653 REQ-020 enable failures are specific and leave a coherent state', () => {
  it('EADDRINUSE surfaces an error naming the port with a corrective hint; state never claims running', async () => {
    const blocker: Server = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
    const busyPort = (blocker.address() as { port: number }).port
    cleanups.push(() => new Promise<void>((r) => blocker.close(() => r())))

    const ctx = await mkService({ enabled: false, bind: 'localhost', port: busyPort })
    await ctx.svc.setEnabled(true)
    expect(ctx.svc.status().running).toBe(false)
    expect(ctx.errors.length).toBeGreaterThan(0)
    const msg = ctx.errors[0]
    expect(msg, 'the error must name the configured port (CONV-001)').toContain(String(busyPort))
    expect(msg, 'the error must carry a corrective hint, never a bare failure').toMatch(/free|change|another|in use|already/i)
  })
})

describe('TEST-2655 REQ-007/REQ-024 restarts: pairing survives, the QR does not pretend to', () => {
  it('a fresh instance on persisted state has NO session plaintext but still authenticates the paired token', async () => {
    const first = await mkService({ ...ENABLED })
    const { pairingUrl } = await first.svc.regenerateToken()
    const token = String(new URL(pairingUrl).searchParams.get('token'))
    const persisted = first.persisted()
    await first.svc.stop()

    // "restart": a new service instance loading ONLY persisted state
    const second = await mkService(persisted && { ...persisted, enabled: true, port: 0 })
    const st = second.svc.status()
    expect(st.hasToken).toBe(true)
    expect(st.tokenAvailableThisSession, 'after a restart the UI must not claim a valid QR').toBe(false)
    // the paired phone's stored token keeps working with zero user action
    const res = await fetch(`${baseOf(second)}/`, { headers: { 'X-Termhalla-Token': token } })
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------------------------
// v2 loopback amendments (ESC-001; FINDING-018/034/049/022/038/039/044/001/015/019/005) —
// REQ-019 serialized/idempotent lifecycle, REQ-020 status().error persistence, REQ-011
// membership currency, REQ-031 externalHost, REQ-007 pairingUrl re-fetch, REQ-017 real
// transport (drain trigger + keepalive/stall), REQ-001 enable-time registry rebuild.
//
// Contract amendments for the implementer (PhoneRemoteServiceDeps/PhoneRemoteService gain):
//   deps.panes.onSpawn(cb: (pane: PaneRecord) => void): () => void
//     // fires when a pane spawns while the app runs; the service re-pushes the inventory to
//     // every connected client (a full `panes` push — the client treats it as a list replace)
//     // and mirrors the new pane while enabled. Pane EXIT likewise re-pushes the inventory.
//   deps.timing?: { pingIntervalMs?: number; pongTimeoutMs?: number; stallTimeoutMs?: number }
//     // test/e2e-seam overrides; defaults are the exported constants.
//   service.setExternalHost(host: string | undefined): Promise<void>
//   service.pairingUrl(): Promise<{ pairingUrl: string } | { unavailable: true }>
//     // re-fetch while tokenAvailableThisSession — NEVER regenerates (REQ-007).
//   service.status() additionally reports `error?: string` (the LAST failure until a successful
//   start clears it) and `externalHost?: string`.

type SvcV2 = ReturnType<typeof createPhoneRemoteService> & {
  setExternalHost(host: string | undefined): Promise<void>
  pairingUrl(): Promise<{ pairingUrl: string } | { unavailable: true }>
}

interface PaneSourceV2 extends PaneSourceHandle {
  emitSpawn: (pane: Record<string, unknown>) => void
  listCalls: () => number
  backing: Array<Record<string, unknown>>
}

const mkPaneSourceV2 = (initial: Array<Record<string, unknown>>): PaneSourceV2 => {
  const backing = [...initial]
  const dataCbs: Array<(id: string, c: string) => void> = []
  const exitCbs: Array<(id: string) => void> = []
  const gridCbs: Array<(id: string, c: number, r: number) => void> = []
  const statusCbs: Array<(id: string, s: string) => void> = []
  const spawnCbs: Array<(p: Record<string, unknown>) => void> = []
  const writes: Array<[string, string]> = []
  let listCalls = 0
  return {
    panes: {
      list: () => { listCalls++; return backing as never },
      onData: (cb: (id: string, c: string) => void) => { dataCbs.push(cb); return () => {} },
      onExit: (cb: (id: string) => void) => { exitCbs.push(cb); return () => {} },
      onGrid: (cb: (id: string, c: number, r: number) => void) => { gridCbs.push(cb); return () => {} },
      onStatus: (cb: (id: string, s: string) => void) => { statusCbs.push(cb); return () => {} },
      onSpawn: (cb: (p: Record<string, unknown>) => void) => { spawnCbs.push(cb); return () => {} },
      write: (id: string, d: string) => writes.push([id, d])
    } as never,
    writes,
    emitData: (id, c) => dataCbs.forEach((cb) => cb(id, c)),
    emitStatus: (id, s) => statusCbs.forEach((cb) => cb(id, s)),
    emitExit: (id) => {
      const i = backing.findIndex((p) => p.paneId === id)
      if (i >= 0) backing.splice(i, 1)
      exitCbs.forEach((cb) => cb(id))
    },
    emitSpawn: (pane) => { backing.push(pane); spawnCbs.forEach((cb) => cb(pane)) },
    listCalls: () => listCalls,
    backing
  }
}

interface CtxV2 {
  svc: SvcV2
  src: PaneSourceV2
  errors: string[]
  persisted: () => PhoneRemoteSettings | undefined
}

const mkServiceV2 = async (
  initial: PhoneRemoteSettings | undefined,
  paneList: Array<Record<string, unknown>> = [TERM_PANE('A')],
  extra?: { replayFactory?: ReplayFactory; timing?: Record<string, number> }
): Promise<CtxV2> => {
  let stored = initial
  const errors: string[] = []
  const src = mkPaneSourceV2(paneList)
  const staticDir = mkdtempSync(join(tmpdir(), 'termh-phone-v2-'))
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Termhalla Phone</title>')
  writeFileSync(join(staticDir, 'manifest.webmanifest'), '{}')
  const deps = {
    loadSettings: async () => stored,
    saveSettings: async (s: PhoneRemoteSettings | undefined) => { stored = s },
    panes: src.panes,
    staticRoot: staticDir,
    notifyError: (m: string) => errors.push(m),
    ...(extra?.replayFactory ? { replayFactory: extra.replayFactory } : {}),
    ...(extra?.timing ? { timing: extra.timing } : {})
  }
  const svc = createPhoneRemoteService(deps as Parameters<typeof createPhoneRemoteService>[0]) as SvcV2
  await svc.init()
  cleanups.push(async () => { await svc.stop(); rmSync(staticDir, { recursive: true, force: true }) })
  return { svc, src, errors, persisted: () => stored }
}

const pairedClient = async (ctx: CtxV2): Promise<{ token: string; wsUrl: string }> => {
  const { pairingUrl } = await ctx.svc.regenerateToken()
  const token = String(new URL(pairingUrl).searchParams.get('token'))
  const base = ctx.svc.status().urls[0].replace(/\/$/, '').replace('http', 'ws')
  return { token, wsUrl: `${base}/ws?token=${encodeURIComponent(token)}` }
}

const rawSocketOf = (ws: WebSocket): { pause(): void; resume(): void } =>
  (ws as unknown as { _socket: { pause(): void; resume(): void } })._socket

describe('TEST-2709 REQ-019 lifecycle mutations are serialized and idempotent (no zombie listener)', () => {
  it('a redundant setEnabled(true) is a no-op, never a misclassified bind failure', async () => {
    const ctx = await mkServiceV2({ ...ENABLED })
    expect(ctx.svc.status().running).toBe(true)
    const port = ctx.svc.status().port
    await ctx.svc.setEnabled(true)
    expect(ctx.svc.status().running).toBe(true)
    expect(ctx.svc.status().port, 'the healthy listener must be left alone').toBe(port)
    expect(ctx.errors, 'a redundant enable must not surface a bind-failure error').toEqual([])
    const res = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`)
    expect(res.status).toBe(200)
  })

  it('a stop racing an in-flight start never leaks the freshly bound listener', async () => {
    const ctx = await mkServiceV2({ enabled: false, bind: 'localhost', port: 0 })
    await ctx.svc.setEnabled(true)
    const p1 = ctx.svc.status().port
    // race: disable and re-enable WITHOUT awaiting in between — the op queue must serialize
    const race = Promise.all([ctx.svc.setEnabled(false), ctx.svc.setEnabled(true)])
    await race
    const st = ctx.svc.status()
    expect(st.running, 'reported state and actual listening state can never diverge').toBe(true)
    const p2 = st.port
    const reachable = await fetch(`http://127.0.0.1:${p2}/manifest.webmanifest`)
    expect(reachable.status).toBe(200)
    if (p1 !== p2) {
      const refused = await new Promise<boolean>((res) => {
        const s = connect({ host: '127.0.0.1', port: p1 }, () => { s.destroy(); res(false) })
        s.on('error', () => res(true))
      })
      expect(refused, 'the superseded listener must be closed, not leaked (no zombie)').toBe(true)
    }
  })
})

describe('TEST-2710 REQ-020 status() carries the LAST failure for late-subscribing windows', () => {
  it('a startup failure persists in status().error and clears on a later successful start', async () => {
    const blocker: Server = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
    const busyPort = (blocker.address() as { port: number }).port
    const ctx = await mkServiceV2({ enabled: true, bind: 'localhost', port: busyPort })
    const st = ctx.svc.status() as { running: boolean; error?: string }
    expect(st.running).toBe(false)
    expect(st.error, 'a pre-window startup failure must be readable from status()').toBeTruthy()
    expect(String(st.error)).toContain(String(busyPort))
    await new Promise<void>((r) => blocker.close(() => r()))
    await ctx.svc.setEnabled(true)
    const healthy = ctx.svc.status() as { running: boolean; error?: string }
    expect(healthy.running).toBe(true)
    expect(healthy.error ?? undefined, 'a successful start clears the stale failure').toBeUndefined()
  })
})

describe('TEST-2711 REQ-011/REQ-026 membership currency: spawn/exit re-push the inventory', () => {
  it('a pane spawned while a client is connected appears via a push; an exited pane leaves the list', async () => {
    const ctx = await mkServiceV2({ ...ENABLED }, [TERM_PANE('t1')])
    const { wsUrl } = await pairedClient(ctx)
    const client = await wsOpen(wsUrl)
    await until(() => client.msgs.some((m) => m.type === 'panes'))
    const invCountAfterHello = client.msgs.filter((m) => m.type === 'panes').length

    ctx.src.emitSpawn(TERM_PANE('t-new'))
    await until(() => client.msgs.filter((m) => m.type === 'panes').length > invCountAfterHello)
    const latest = client.msgs.filter((m) => m.type === 'panes').pop() as Msg
    expect(JSON.stringify(latest)).toContain('t-new')

    const countBeforeExit = client.msgs.filter((m) => m.type === 'panes').length
    ctx.src.emitExit('t-new')
    await until(() => client.msgs.filter((m) => m.type === 'panes').length > countBeforeExit)
    const afterExit = client.msgs.filter((m) => m.type === 'panes').pop() as Msg
    expect(JSON.stringify(afterExit)).not.toContain('t-new')
    client.ws.close()
  })
})

describe('TEST-2695 REQ-031 externalHost override + ranked reachable URLs', () => {
  it('with externalHost set, the pairing URL uses that host with the configured port; the bind is unaffected', async () => {
    const withHost = { ...ENABLED, externalHost: 'myhost.ts.net' } as PhoneRemoteSettings & { externalHost: string }
    const ctx = await mkServiceV2(withHost)
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const u = new URL(pairingUrl)
    expect(u.hostname).toBe('myhost.ts.net')
    expect(u.port).toBe(String(ctx.svc.status().port))
    expect((ctx.svc.status() as { externalHost?: string }).externalHost).toBe('myhost.ts.net')
    // still served on loopback — the override changes the ADVERTISED host only
    const res = await fetch(`http://127.0.0.1:${ctx.svc.status().port}/manifest.webmanifest`)
    expect(res.status).toBe(200)
  })

  it('setExternalHost persists and re-derives the pairing URL', async () => {
    const ctx = await mkServiceV2({ ...ENABLED })
    await ctx.svc.regenerateToken()
    await ctx.svc.setExternalHost('other.host.example')
    expect((ctx.persisted() as { externalHost?: string } | undefined)?.externalHost).toBe('other.host.example')
    const out = await ctx.svc.pairingUrl()
    expect('pairingUrl' in out && new URL(out.pairingUrl).hostname).toBe('other.host.example')
  })
})

describe('TEST-2712 REQ-007 pairingUrl re-fetch: pairing a second device never revokes the first', () => {
  it('returns the SAME token without touching the persisted hash; a fresh restart reports unavailable', async () => {
    const ctx = await mkServiceV2({ ...ENABLED })
    const { pairingUrl } = await ctx.svc.regenerateToken()
    const tokenA = String(new URL(pairingUrl).searchParams.get('token'))
    const hashBefore = ctx.persisted()?.tokenHash
    const refetch = await ctx.svc.pairingUrl()
    expect('pairingUrl' in refetch).toBe(true)
    if ('pairingUrl' in refetch) {
      expect(String(new URL(refetch.pairingUrl).searchParams.get('token'))).toBe(tokenA)
    }
    expect(ctx.persisted()?.tokenHash, 're-fetch must NOT regenerate').toBe(hashBefore)

    const persisted = ctx.persisted()
    await ctx.svc.stop()
    const second = await mkServiceV2(persisted && { ...persisted, enabled: true, port: 0 })
    const out = await second.svc.pairingUrl()
    expect(out, 'after a restart the plaintext is gone — the UI must not claim a valid QR').toEqual({ unavailable: true })
  })
})

describe('TEST-2713 REQ-017 REAL transport: saturating a live ws yields a resync with NO test-invoked drain seam', () => {
  it('a paused client saturates past high water; resuming drains and a buffer-replacing resync arrives', async () => {
    const ctx = await mkServiceV2({ ...ENABLED })
    const { wsUrl } = await pairedClient(ctx)
    const client = await wsOpen(wsUrl)
    client.ws.send(JSON.stringify({ type: 'subscribe', paneId: 'A' }))
    await until(() => client.msgs.some((m) => m.type === 'snapshot' && m.paneId === 'A'))

    // stop reading: the server's socket buffer fills (the ONLY drain signal the test relies on
    // is the transport's own — no session/drain seam is invoked from test code)
    const sock = rawSocketOf(client.ws)
    sock.pause()
    const chunk = 'x'.repeat(65_536) + '\r\n'
    for (let i = 0; i < 64; i++) ctx.src.emitData('A', chunk) // ~4 MiB >> PHONE_WS_HIGH_WATER
    await new Promise((r) => setTimeout(r, 300))
    sock.resume()

    await until(() => client.msgs.some((m) => m.type === 'resync' && m.paneId === 'A'), 10_000)
    // and the stream is live again after the resync
    ctx.src.emitData('A', 'tail-after-resync\r\n')
    await until(() => client.msgs.some((m) => m.type === 'data' && String(m.data).includes('tail-after-resync')), 8_000)
    client.ws.close()
  })
})

describe('TEST-2714 REQ-017 keepalive + stall ceiling terminate a half-open/immortal client', () => {
  it('a peer that stops answering pings is terminated within the deadline', async () => {
    const ctx = await mkServiceV2({ ...ENABLED }, [TERM_PANE('A')], { timing: { pingIntervalMs: 60, pongTimeoutMs: 60 } })
    const { wsUrl } = await pairedClient(ctx)
    const client = await wsOpen(wsUrl)
    await until(() => client.msgs.some((m) => m.type === 'hello'))
    rawSocketOf(client.ws).pause() // a sleeping phone: no pongs come back
    await until(() => client.closed(), 8_000)
  })

  it('a connection saturated continuously past the stall timeout is terminated', async () => {
    const ctx = await mkServiceV2({ ...ENABLED }, [TERM_PANE('A')], { timing: { stallTimeoutMs: 400, pingIntervalMs: 100_000, pongTimeoutMs: 100_000 } })
    const { wsUrl } = await pairedClient(ctx)
    const client = await wsOpen(wsUrl)
    client.ws.send(JSON.stringify({ type: 'subscribe', paneId: 'A' }))
    await until(() => client.msgs.some((m) => m.type === 'snapshot'))
    rawSocketOf(client.ws).pause()
    const chunk = 'y'.repeat(65_536) + '\r\n'
    for (let i = 0; i < 64; i++) ctx.src.emitData('A', chunk)
    // never resumes: the buffer stays above high water — the server must cut it loose
    await until(() => client.closed(), 10_000)
  })
})

describe('TEST-2732 REQ-001 the enable-time registry is REBUILT from pane state, not standing bookkeeping', () => {
  it('while disabled, pane chunks trigger no list() rebuild and no mirror work; enable pulls the CURRENT pane set', async () => {
    let created = 0
    const factory: ReplayFactory = () => ({ feed: () => {}, resize: () => {}, snapshot: async () => '', dispose: () => {} })
    const counting: ReplayFactory = (opts) => { created++; return factory(opts) }
    const ctx = await mkServiceV2({ enabled: false, bind: 'localhost', port: 0 }, [TERM_PANE('A')], { replayFactory: counting })
    const listAfterInit = ctx.src.listCalls()
    for (let i = 0; i < 200; i++) ctx.src.emitData('A', 'chunk\r\n')
    await new Promise((r) => setTimeout(r, 30))
    expect(created, 'the disabled path performs no mirror work').toBe(0)
    expect(ctx.src.listCalls(), 'the disabled hot path must not consult/rebuild the pane registry per chunk').toBe(listAfterInit)

    // a pane appears while STILL disabled — no eager bookkeeping may be needed to find it later
    ctx.src.backing.push(TERM_PANE('B'))
    await ctx.svc.setEnabled(true)
    expect(created, 'enable rebuilds the registry from the CURRENT pane source state').toBe(2)
  })
})
