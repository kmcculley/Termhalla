/**
 * Composition: settings <-> the runtime server, the shared mirror registry, per-client WS
 * sessions, and the IPC-facing status/control surface (feature 0026, REQ-001/002/004/005/006/
 * 007/009/011/012/017/019/020/024/028/031). The service TRUSTS its injected settings —
 * normalization happens at the quick-store boundary (`normalizePhoneRemote`), not here.
 * `settings.port === 0` means OS-assigned (a test seam; production keeps the persisted/default
 * port); the ACTUAL bound port is reported back through `status().port`/`status().urls`.
 *
 * v2 (ESC-001 loopback) additions:
 *  - REQ-028 HttpOnly session cookie: the first token-authenticated response sets it; it is a
 *    first-class credential for every REQ-005 route (`auth.ts`/`cookie.ts`).
 *  - REQ-019 (FINDING-018): every lifecycle mutation is serialized through a single promise-chain
 *    op-queue, so two racing calls never interleave and a redundant `setEnabled(true)` is a no-op.
 *  - REQ-020 (FINDING-034/049): `status().error` persists the last startup failure for a
 *    late-subscribing window. v3 (FINDING-063/071): a failed start KEEPS `enabled: true` —
 *    `{ enabled: true, running: false, error }` is the reachable settled shape the REQ-029
 *    settings surface renders, and `App.tsx` pulls `status()` at root load to recover the
 *    pre-window error push.
 *  - REQ-028 v3 (FINDING-070): the session cookie is derived from the PRESENTED, verified
 *    pairing token at request time (`auth.token`), so token-authenticated requests keep issuing
 *    the cookie after a desktop restart, when `sessionToken` no longer exists.
 *  - REQ-009/REQ-017 v3 (FINDING-058/060): the per-connection burst queue shares one ordering
 *    domain with the session's snapshot barriers (`flushNow` before every frame/pong) and its
 *    saturation discard marks panes stale hold-window-safely (`session.markStale`).
 *  - REQ-011 (FINDING-022/038): `deps.panes.onSpawn` (membership-changed signal) re-pushes the
 *    inventory to every connected client; pane exit does too.
 *  - REQ-017 (FINDING-001/015/029/030, real transport): a per-connection poll samples
 *    `ws.bufferedAmount` on a real, actually-firing cadence and calls `session.socketDrained()` —
 *    never a listener on the `ws` library's nonexistent `'drain'` event. The SAME poll drives the
 *    REQ-017 stall ceiling (`PHONE_WS_STALL_TIMEOUT_MS`) and a real WS ping/pong keepalive
 *    (`PHONE_WS_PING_INTERVAL_MS`/`PHONE_WS_PONG_TIMEOUT_MS`) terminates unresponsive sockets.
 *  - REQ-031: `status().urls` is the deterministically-ranked reachable-URL list
 *    (`network-urls.ts`); `externalHost` overrides the pairing-URL host. v4 (ESC-004 —
 *    FINDING-082): a full http(s) ORIGIN override (the tailscale-serve public origin) builds the
 *    pairing URL from that origin verbatim — scheme preserved, no backend port appended; a bare
 *    hostname keeps the http + backend-port semantics.
 *  - REQ-007: `pairingUrl()` re-fetches the current session's pairing URL WITHOUT regenerating.
 */
import { networkInterfaces } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import type { ReplayFactory } from './replay-engine'
import { PHONE_WS_MAX_FRAME } from '@shared/phone-remote/protocol'
import { PHONE_REMOTE_PORT_DEFAULT, type PhoneRemoteSettings } from '@shared/phone-remote/settings'
import type { PhoneRemoteStatus } from '@shared/phone-remote/status'
import { createPhoneRemoteServer, type BindMode } from './server'

export type { BindMode }
import { authorizeRequest, isRequestAuthorized } from './auth'
import { issueSetCookie } from './cookie'
import { isAllowlisted, serveStaticFile } from './static-assets'
import { generateToken, hashToken, verifyToken } from './token'
import { createMirrorManager } from './mirror-manager'
import { createWsSession, type WsSession } from './ws-session'
import { buildInventory, type RawPaneInfo } from './inventory'
import { rankReachableUrls } from './network-urls'
import { createBackpressurePolicy } from './backpressure'
import { PHONE_WS_HIGH_WATER, PHONE_WS_PING_INTERVAL_MS, PHONE_WS_PONG_TIMEOUT_MS, PHONE_WS_STALL_TIMEOUT_MS } from './constants'

export interface PhoneRemotePaneRecord {
  paneId: string
  workspaceId: string
  workspaceName: string
  title: string
  kind: string
  cols: number
  rows: number
  status: string
}

export interface PhoneRemoteServiceDeps {
  loadSettings(): Promise<PhoneRemoteSettings | undefined>
  saveSettings(s: PhoneRemoteSettings | undefined): Promise<void>
  panes: {
    list(): PhoneRemotePaneRecord[]
    onData(cb: (paneId: string, chunk: string) => void): () => void
    onExit(cb: (paneId: string) => void): () => void
    onGrid(cb: (paneId: string, cols: number, rows: number) => void): () => void
    onStatus(cb: (paneId: string, status: string) => void): () => void
    /** Membership-changed signal (a pane spawned, or its metadata became known/changed) — the
     *  service re-pushes the inventory to every connected client (v2, REQ-011). The callback
     *  argument is advisory only; the service always re-reads `list()`. */
    onSpawn?(cb: (pane: unknown) => void): () => void
    write(paneId: string, data: string): void
  }
  /** Dir served as the web-client bundle (`out/phone-client` in production). */
  staticRoot?: string
  /** Routed to the error-severity toast chokepoint by the IPC layer — never suppressed by the
   *  `quick.toastsEnabled` opt-in (CONV-004). */
  notifyError(message: string): void
  /** Test seam; defaults to the real F18 `createPaneReplay`. */
  replayFactory?: ReplayFactory
  /** Test/e2e-seam timing overrides for the real-transport keepalive/stall wiring; defaults are
   *  the exported constants. */
  timing?: { pingIntervalMs?: number; pongTimeoutMs?: number; stallTimeoutMs?: number }
  /** Test/e2e-seam ONLY (REQ-025): seeds the in-memory plaintext session token (never exposed via
   *  IPC — this is main-process-internal construction wiring) so a harness-fixed token both
   *  authenticates (its hash must match the ALSO-seam-injected `settings.tokenHash`) AND drives
   *  REQ-028 cookie issuance exactly like a real `regenerateToken()` would, without minting a
   *  fresh random token the harness's fixed credential wouldn't match. */
  initialSessionToken?: string
}

export interface PhoneRemoteService {
  init(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setBind(mode: BindMode): Promise<void>
  setPort(port: number): Promise<void>
  setExternalHost(host: string | undefined): Promise<void>
  status(): PhoneRemoteStatus
  regenerateToken(): Promise<{ pairingUrl: string }>
  /** Re-fetch the CURRENT session's pairing URL — never regenerates (REQ-007: pairing a second
   *  device an hour later must not force a revoking regenerate of the first). */
  pairingUrl(): Promise<{ pairingUrl: string } | { unavailable: true }>
  stop(): Promise<void>
}

const DEFAULT_SETTINGS: PhoneRemoteSettings = { enabled: false, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT }

const BACKPRESSURE_POLL_MS = 50

export function createPhoneRemoteService(deps: PhoneRemoteServiceDeps): PhoneRemoteService {
  let settings: PhoneRemoteSettings = DEFAULT_SETTINGS
  let listening = false
  let boundPort: number | undefined
  /** The plaintext token, main-process memory only, for the CURRENT app session (REQ-004). */
  let sessionToken: string | undefined = deps.initialSessionToken
  /** The last startup failure, until a successful start clears it (v2, FINDING-049/034). */
  let lastError: string | undefined

  const timing = {
    pingIntervalMs: deps.timing?.pingIntervalMs ?? PHONE_WS_PING_INTERVAL_MS,
    pongTimeoutMs: deps.timing?.pongTimeoutMs ?? PHONE_WS_PONG_TIMEOUT_MS,
    stallTimeoutMs: deps.timing?.stallTimeoutMs ?? PHONE_WS_STALL_TIMEOUT_MS
  }

  const mirrors = createMirrorManager({ replayFactory: deps.replayFactory })
  const taps = new Map<string, (chunk: string) => void>()
  interface SessionEntry {
    ws: WsSocket
    session: WsSession
    dispose: () => void
    /** Per-connection pre-transport burst queue for pane data (REQ-017 v2 — see the connection
     *  handler below for the full rationale). */
    queueData: (paneId: string, chunk: string) => void
    /** Synchronously drains this connection's burst queue into the session (v3, FINDING-058/060)
     *  — invoked before every snapshot-barrier-capturing entry point so the mirror write barrier
     *  and the session hold-windows share one ordering domain. */
    flushNow: () => void
  }
  const sessions = new Set<SessionEntry>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: PHONE_WS_MAX_FRAME })

  const paneInfo = (paneId: string): PhoneRemotePaneRecord | undefined =>
    deps.panes.list().find((p) => p.paneId === paneId)

  const ensureTap = (rec: PhoneRemotePaneRecord): void => {
    if (taps.has(rec.paneId)) return
    const tap = mirrors.registerPane({ paneId: rec.paneId, cols: rec.cols, rows: rec.rows }, () => {})
    taps.set(rec.paneId, tap)
  }

  const toRawPaneInfo = (list: PhoneRemotePaneRecord[]): RawPaneInfo[] => list

  // ── Pairing URLs (REQ-031: deterministic reachable-URL ranking + externalHost override) ──────
  const rankedLanUrls = (port: number): string[] => rankReachableUrls(networkInterfaces(), port)

  const computeUrls = (): string[] => {
    if (!listening || boundPort === undefined) return []
    if (settings.bind === 'lan') {
      return [`http://127.0.0.1:${boundPort}`, ...rankedLanUrls(boundPort)]
    }
    return [`http://127.0.0.1:${boundPort}`]
  }

  // v4 (ESC-004 — FINDING-082): `externalHost` may be a FULL ORIGIN (`https://machine.tailnet.
  // ts.net`, optional explicit port), not only a bare hostname. The documented tailscale-serve
  // story publishes an HTTPS origin (normally :443) reverse-proxied to localhost:<backend port> —
  // forcing `http://` and appending the backend port bypassed that proxy entirely and can never
  // reach a 127.0.0.1 bind. When the override parses as an http(s) origin, the pairing URL is
  // built from it VERBATIM: scheme preserved, its own (or default) port, NO backend port appended.
  const externalOrigin = (): string | undefined => {
    const value = settings.externalHost
    if (!value || !/^https?:\/\//i.test(value)) return undefined
    try { return new URL(value).origin } catch { return undefined }
  }

  const pairingHost = (): string => {
    if (settings.externalHost) return settings.externalHost
    if (settings.bind === 'lan' && boundPort !== undefined) {
      const top = rankedLanUrls(boundPort)[0]
      if (top) { try { return new URL(top).hostname } catch { /* fall through */ } }
    }
    return '127.0.0.1'
  }

  const buildPairingUrl = (token: string): string => {
    const origin = externalOrigin()
    if (origin) return `${origin}/?token=${encodeURIComponent(token)}`
    // A bare hostname (or no override) keeps the existing semantics: http + the backend port.
    const host = pairingHost()
    const port = listening && boundPort !== undefined ? boundPort : settings.port
    return `http://${host}:${port}/?token=${encodeURIComponent(token)}`
  }

  // ── HTTP request routing ────────────────────────────────────────────────────────────────────
  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    let pathname = '/'
    try { pathname = new URL(req.url ?? '/', 'http://phone-remote.local').pathname } catch { /* keep '/' */ }

    if (isAllowlisted(pathname)) { void serveStaticFile(deps.staticRoot ?? '', pathname, res); return }
    const auth = authorizeRequest(req, settings.tokenHash)
    if (!auth.authorized) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('missing or invalid pairing token — open this page from the pairing QR in Termhalla Settings')
      return
    }
    // REQ-028: the FIRST token-authenticated response sets the durable session cookie so every
    // later token-less entry path (PWA relaunch, reload, restore) authenticates via the cookie.
    // The cookie is derived from the PRESENTED, just-verified token — NEVER the in-memory
    // `sessionToken`, which dies with the app (v3, FINDING-070): a valid pairing URL first
    // opened after a desktop restart must still yield the cookie, or the phone's later
    // token-less WS upgrade is refused while Settings claims the pairing works. Validity stays
    // a pure function of the persisted `tokenHash`, so regenerate still revokes every
    // outstanding cookie (REQ-006) and no new secret is persisted (REQ-004).
    if (auth.viaToken && auth.token !== undefined) {
      try { res.setHeader('Set-Cookie', issueSetCookie(auth.token)) } catch { /* headers already sent */ }
    }
    if (pathname === '/') { void serveStaticFile(deps.staticRoot ?? '', '/', res); return }
    res.writeHead(404); res.end()
  }

  // ── WS upgrade routing ──────────────────────────────────────────────────────────────────────
  const handleUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    let pathname = '/'
    try { pathname = new URL(req.url ?? '/', 'http://phone-remote.local').pathname } catch { /* keep '/' */ }
    if (pathname !== '/ws' || !isRequestAuthorized(req, settings.tokenHash)) {
      try { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n') } catch { /* gone */ }
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  }

  wss.on('connection', (ws: WsSocket) => {
    // v2 (FINDING-001/015/029/030, "port candidate B"): a genuinely unresponsive/paused peer (a
    // sleeping phone whose OS stops servicing its socket) never surfaces EITHER a graceful
    // `ws.terminate()` OR data written while paused — verified empirically (a paused Node
    // Readable defers ALL further event delivery, including a subsequent RST, until it is
    // resumed AND has drained whatever was already buffered). Two changes follow from that:
    //  (1) a synchronous producer burst is bounded BEFORE it ever reaches `ws.send()` (the
    //      queueData/flushBurst pair below, whose saturation discard marks the affected panes
    //      stale via `session.markStale` — hold-window-safe, FINDING-058/060), so a paused
    //      peer's kernel receive buffer never accumulates the multi-megabyte backlog that would
    //      strand a later `resetAndDestroy()`.
    //  (2) the drain-driven resync (`session.socketDrained()`) fires ONLY in response to a PONG
    //      (proof the peer is actually reading) rather than a blind timer sampling the transport
    //      buffer — a truly-paused peer never pongs, so `stale`/`held` state never spuriously
    //      "resolves" while nothing was ever delivered. A WALL-CLOCK `pendingSince` (independent
    //      of whatever `ws.bufferedAmount` reads at any instant, since the burst bound above can
    //      keep it near zero even while genuinely stuck) is what ultimately trips `forceTerminate`
    //      for a peer that never proves it is alive.
    const session = createWsSession({
      send: (msg) => {
        if (ws.readyState !== ws.OPEN) return
        ws.send(JSON.stringify(msg), (err) => {
          if (err) { forceTerminate(); return }
          armTransportWatch()
        })
      },
      bufferedAmount: () => ws.bufferedAmount,
      mirrors: { snapshot: (paneId) => mirrors.snapshot(paneId) },
      panes: {
        inventory: () => buildInventory(toRawPaneInfo(deps.panes.list())),
        isLive: (paneId) => paneInfo(paneId) !== undefined,
        write: (paneId, data) => deps.panes.write(paneId, data)
      }
    })

    // `resetAndDestroy()` forces an RST, which a peer's OS delivers as a socket-level error/reset
    // REGARDLESS of the JS-level pause (verified empirically on Windows) PROVIDED its own kernel
    // receive buffer stays near empty (see the burst bound above) — it falls back to `terminate()`
    // on a Node without the API (added Node 16.17/18.3).
    const forceTerminate = (): void => {
      const raw = (ws as unknown as { _socket?: { resetAndDestroy?: () => void } })._socket
      if (raw && typeof raw.resetAndDestroy === 'function') {
        try { raw.resetAndDestroy(); return } catch { /* fall through to terminate() */ }
      }
      try { ws.terminate() } catch { /* already gone */ }
    }

    let awaitingPong = false
    let pongDeadline: ReturnType<typeof setTimeout> | undefined
    const sendPing = (): void => {
      if (awaitingPong) return
      awaitingPong = true
      try { ws.ping() } catch { forceTerminate(); return }
      pongDeadline = setTimeout(() => { if (awaitingPong) forceTerminate() }, timing.pongTimeoutMs)
      pongDeadline.unref?.()
    }

    const pingTimer = setInterval(() => {
      if (awaitingPong) { forceTerminate(); return }
      sendPing()
    }, timing.pingIntervalMs)
    pingTimer.unref?.()

    // Continuous-saturation ceiling for the RAW transport (a peer that DOES read, just too slowly
    // for its bufferedAmount to ever fully drain) — independent of the pending/pong-gated path.
    const stallPolicy = createBackpressurePolicy()

    // "Armed only while pending" (CONV-036) — never an always-running poll: ticks only while the
    // session has outstanding backpressure state, re-arming itself; a wall-clock `pendingSince`
    // (set once, on first pending) plus a fresh "drain probe" ping each tick is what lets a
    // genuinely stuck (never-pongs) peer be detected and cut loose within `stallTimeoutMs`.
    let pendingSince: number | undefined
    let transportTimer: ReturnType<typeof setTimeout> | undefined
    const armTransportWatch = (): void => {
      if (transportTimer || !session.hasPending()) return
      if (pendingSince === undefined) pendingSince = Date.now()
      transportTimer = setTimeout(() => {
        transportTimer = undefined
        if (!session.hasPending()) { pendingSince = undefined; return }
        const now = Date.now()
        stallPolicy.onBuffered(now, ws.bufferedAmount)
        const pendingTooLong = pendingSince !== undefined && now - pendingSince >= timing.stallTimeoutMs
        if (stallPolicy.stalledPast(now, timing.stallTimeoutMs) || pendingTooLong) { forceTerminate(); return }
        sendPing() // a no-op if already awaiting one; a fresh pong is what unblocks socketDrained()
        armTransportWatch()
      }, BACKPRESSURE_POLL_MS)
      transportTimer.unref?.()
    }

    ws.on('pong', () => {
      awaitingPong = false
      if (pongDeadline) clearTimeout(pongDeadline)
      // Consistent boundary (v3, FINDING-058/060): parked chunks enter the session BEFORE
      // socketDrained() captures any resync snapshot barrier — a byte already in the mirror can
      // never be both inside the resync snapshot AND flushed into its hold window afterwards.
      flushNow()
      if (session.hasPending()) {
        session.socketDrained()
        if (!session.hasPending()) pendingSince = undefined
        else armTransportWatch()
      }
    })

    // Pre-transport burst bound (REQ-017 v2): a SYNCHRONOUS producer flood (many chunks fed in
    // one tick, e.g. a busy pane's onData firing in a tight loop) can outrun per-chunk
    // `bufferedAmount` sampling entirely — every chunk looks "under high water" right up until
    // libuv actually flushes the first one. Queuing chunks and checking the QUEUE's own byte
    // total closes that window: once a burst crosses `PHONE_WS_HIGH_WATER` before even one
    // chunk reached the real transport, the WHOLE queue is discarded (never handed to
    // `ws.send()`) and every affected pane is marked stale via `session.markStale` — which
    // records staleness in the backpressure policy even for a pane inside an attach/resync
    // hold-window (v3, FINDING-058/060: the old `paneData(id, '')` substitute was swallowed by
    // the window's pending queue, so the dropped bytes were never repaired). The mirror already
    // has the full content (fed unconditionally, REQ-015 purity), so the pane's eventual resync
    // is exactly as correct as if the bytes had been sent and dropped by the ordinary per-chunk
    // gate. A burst that stays under the threshold flushes normally on the next tick.
    //
    // Consistent boundary with the session's snapshot barriers (v3, FINDING-058/060): the shared
    // mirror is fed synchronously at onData time while this queue defers session delivery by one
    // macrotask — so a chunk could be INSIDE a subscribe/drain snapshot barrier yet still parked
    // here, and a later flush would push it into the very hold window that snapshot opened
    // (delivered twice). `flushNow()` drains the queue synchronously and is invoked BEFORE any
    // barrier-capturing entry point runs: every inbound frame (`doSubscribe`) and every
    // pong-driven `socketDrained()`. Neither can interleave with a synchronous producer flood
    // (single-threaded JS), so the burst bound above is untouched.
    let burstTimer: ReturnType<typeof setTimeout> | undefined
    let burstBytes = 0
    let burstQueue: Array<{ paneId: string; chunk: string }> = []
    let burstSaturated = false

    const flushBurst = (): void => {
      burstTimer = undefined
      if (burstSaturated) {
        burstSaturated = false
        burstQueue = []
        burstBytes = 0
        return
      }
      const queued = burstQueue
      burstQueue = []
      burstBytes = 0
      for (const item of queued) session.paneData(item.paneId, item.chunk)
      armTransportWatch()
    }

    const flushNow = (): void => {
      if (!burstTimer) return // queue empty and no saturation state pending (the timer is armed with both)
      clearTimeout(burstTimer)
      flushBurst()
    }

    const queueData = (paneId: string, chunk: string): void => {
      if (!burstTimer) { burstTimer = setTimeout(flushBurst, 0); burstTimer.unref?.() }
      if (burstSaturated) {
        session.markStale(paneId)
        armTransportWatch()
        return
      }
      burstQueue.push({ paneId, chunk })
      burstBytes += Buffer.byteLength(chunk)
      if (burstBytes <= PHONE_WS_HIGH_WATER) return
      burstSaturated = true
      for (const id of new Set(burstQueue.map((item) => item.paneId))) session.markStale(id)
      burstQueue = []
      burstBytes = 0
      armTransportWatch()
    }

    const dispose = (): void => {
      clearInterval(pingTimer)
      if (pongDeadline) clearTimeout(pongDeadline)
      if (transportTimer) clearTimeout(transportTimer)
      if (burstTimer) clearTimeout(burstTimer)
    }

    const entry: SessionEntry = { ws, session, dispose, queueData, flushNow }
    sessions.add(entry)
    ws.on('message', (data, isBinary) => {
      // Consistent boundary (v3, FINDING-058/060): any chunk already fed to the shared mirror but
      // still parked in this connection's burst queue is flushed into the session BEFORE the frame
      // is processed — a subscribe's snapshot barrier can therefore never cover a byte that a
      // later flush would ALSO push into the attach hold window it opens (delivered twice).
      flushNow()
      session.handleFrame(isBinary ? (data as Buffer) : Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
    })
    ws.on('close', () => { dispose(); sessions.delete(entry); session.close() })
    ws.on('error', () => { /* the 'close' event still fires; nothing else to do here */ })
    session.start()
  })

  const transport = createPhoneRemoteServer({ onRequest: handleRequest, onUpgrade: handleUpgrade })

  const attemptStart = async (): Promise<void> => {
    try {
      const { port } = await transport.start({ port: settings.port, bind: settings.bind })
      boundPort = port
      listening = true
      lastError = undefined
    } catch (e) {
      listening = false
      boundPort = undefined
      const err = e as NodeJS.ErrnoException
      const reason = err?.code === 'EADDRINUSE'
        ? 'that port is already in use'
        : err?.code === 'EACCES'
          ? 'that port requires elevated permissions'
          : (err?.message ?? 'failed to start')
      const message = `Phone remote could not start on port ${settings.port} — ${reason}. Free the port, or change it in Settings.`
      lastError = message
      deps.notifyError(message)
    }
  }

  const closeAllSessions = (): void => {
    for (const { ws, dispose } of [...sessions]) { dispose(); try { ws.terminate() } catch { /* already gone */ } }
    sessions.clear()
  }

  let unsubData: (() => void) | undefined
  let unsubExit: (() => void) | undefined
  let unsubGrid: (() => void) | undefined
  let unsubStatus: (() => void) | undefined
  let unsubSpawn: (() => void) | undefined

  const pushInventoryToAll = (): void => {
    for (const { session } of sessions) session.pushInventory()
  }

  const wireDataSources = (): void => {
    unsubData = deps.panes.onData((paneId, chunk) => {
      if (!listening) return
      let tap = taps.get(paneId)
      if (!tap) {
        const info = paneInfo(paneId)
        tap = mirrors.registerPane({ paneId, cols: info?.cols ?? 80, rows: info?.rows ?? 24 }, () => {})
        taps.set(paneId, tap)
      }
      tap(chunk)
      // Per-connection burst queue (REQ-017 v2) — see the connection handler for the full
      // rationale; this is what bounds a synchronous producer flood BEFORE it reaches `ws.send()`.
      for (const entry of sessions) entry.queueData(paneId, chunk)
    })
    unsubExit = deps.panes.onExit((paneId) => {
      taps.delete(paneId)
      // Flush parked chunks BEFORE the exit clears each session's subscription state (v3,
      // FINDING-058/060 class): paneExit drops the pane from live/hold-window maps, so a
      // still-parked final chunk (e.g. the shell's exit message) would otherwise be discarded.
      //
      // v4 (FINDING-083 / ESC-005 — final output must survive stale/saturation): the mirror is
      // the ONLY snapshot source for bytes a saturated session dropped (per-chunk high-water
      // gate) or discarded (pre-transport burst saturation), so it must NOT be disposed before
      // the exit fan-out — a session with such an outstanding obligation captures a final
      // write-flush-barrier snapshot inside `paneExit` (delivered as a buffer-replacing `resync`
      // ahead of the `paneExit` push) and returns a settle promise. Dispose the mirror only
      // after EVERY session's fan-out — including those pending final snapshots — has settled
      // (bounded: the snapshot barrier always resolves; the no-obligation path is synchronous).
      const settled: Array<void | Promise<void>> = []
      for (const entry of sessions) { entry.flushNow(); settled.push(entry.session.paneExit(paneId)) }
      // Re-check after the await (the repo's session-identity race pattern): if a tap was
      // re-registered for this paneId during the settle window, the registry entry is no longer
      // the exited pane's — disposing it would destroy the successor's live mirror.
      const disposeExited = (): void => { if (!taps.has(paneId)) mirrors.paneExited(paneId) }
      void Promise.all(settled).then(disposeExited, disposeExited)
      pushInventoryToAll()
    })
    unsubGrid = deps.panes.onGrid((paneId, cols, rows) => {
      mirrors.resizePane(paneId, cols, rows)
      for (const { session } of sessions) session.paneGrid(paneId, cols, rows)
    })
    unsubStatus = deps.panes.onStatus((paneId, status) => {
      for (const { session } of sessions) session.paneStatus(paneId, status)
    })
    unsubSpawn = deps.panes.onSpawn?.(() => {
      if (listening) for (const p of deps.panes.list()) ensureTap(p)
      pushInventoryToAll()
    })
  }
  wireDataSources()

  // ── Serialized, idempotent lifecycle (v2, FINDING-018) ─────────────────────────────────────
  // Every mutation is queued through a single promise chain so two racing calls (a double-toggle,
  // setPort racing setEnabled, …) never interleave — the reported state and the actual listening
  // state can never diverge, and there is never a zombie listener.
  let opQueue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = opQueue.then(fn, fn)
    opQueue = result.then(() => undefined, () => undefined)
    return result
  }

  const startIfEnabled = async (): Promise<void> => {
    await attemptStart()
    if (listening) {
      for (const p of deps.panes.list()) ensureTap(p)
      mirrors.setEnabled(true)
    }
    // A failed start KEEPS `settings.enabled` (v3, FINDING-063/071): enabled is the user's
    // persistent INTENT, the failure is runtime state — `status()` reports it as
    // `{ enabled: true, running: false, error }`, the exact shape the REQ-029 settings surface
    // keys its not-running cue on. Coercing enabled to false made that state unreachable
    // (the cue and `status().error` could never render) and left a relaunch silently off while
    // quick.json still claimed enabled.
  }

  const restart = async (): Promise<void> => {
    if (listening) {
      await transport.stop()
      listening = false
      boundPort = undefined
    } else if (!settings.enabled) {
      // Disabled: a bind/port change persists but starts nothing (REQ-002).
      return
    }
    // Enabled-but-errored falls through (v3, FINDING-063/071): the startup error's corrective
    // hint says "change it in Settings" — changing the port/bind while the intent is still
    // enabled must actually RETRY the start, not silently keep the server down.
    await startIfEnabled()
  }

  const doSetEnabled = async (enabled: boolean): Promise<void> => {
    // Idempotent: already in the target running state — a no-op, never a misclassified bind
    // failure (server.ts's own idempotent start() is the second line of defense).
    if (enabled === listening && enabled === settings.enabled) return
    settings = { ...settings, enabled }
    if (enabled) {
      await startIfEnabled()
    } else {
      await transport.stop()
      listening = false
      boundPort = undefined
      mirrors.setEnabled(false)
      taps.clear()
      closeAllSessions()
    }
    await deps.saveSettings(settings)
  }

  return {
    async init() {
      settings = (await deps.loadSettings()) ?? DEFAULT_SETTINGS
      if (settings.enabled) await enqueue(() => startIfEnabled())
    },

    setEnabled: (enabled) => enqueue(() => doSetEnabled(enabled)),

    setBind: (mode) => enqueue(async () => {
      settings = { ...settings, bind: mode }
      await deps.saveSettings(settings)
      await restart()
    }),

    setPort: (port) => enqueue(async () => {
      settings = { ...settings, port }
      await deps.saveSettings(settings)
      await restart()
    }),

    setExternalHost: (host) => enqueue(async () => {
      const trimmed = typeof host === 'string' ? host.trim() : ''
      settings = trimmed ? { ...settings, externalHost: trimmed } : { ...settings, externalHost: undefined }
      await deps.saveSettings(settings)
    }),

    status() {
      return {
        enabled: settings.enabled,
        bind: settings.bind,
        port: listening && boundPort !== undefined ? boundPort : settings.port,
        running: listening,
        urls: computeUrls(),
        hasToken: typeof settings.tokenHash === 'string' && settings.tokenHash.length > 0,
        tokenAvailableThisSession: sessionToken !== undefined,
        ...(lastError ? { error: lastError } : {}),
        ...(settings.externalHost ? { externalHost: settings.externalHost } : {})
      }
    },

    regenerateToken: () => enqueue(async () => {
      const token = generateToken()
      const hash = hashToken(token)
      settings = { ...settings, tokenHash: hash }
      sessionToken = token
      // REQ-006: atomically revoke — persist the new hash (which also invalidates every
      // outstanding REQ-028 cookie, a pure function of tokenHash), then drop every currently
      // connected client so the old token/cookie can never be used again on an already-open socket.
      await deps.saveSettings(settings)
      closeAllSessions()
      return { pairingUrl: buildPairingUrl(token) }
    }),

    pairingUrl: () => enqueue(async () => {
      if (sessionToken === undefined) return { unavailable: true as const }
      return { pairingUrl: buildPairingUrl(sessionToken) }
    }),

    async stop() {
      await enqueue(async () => {
        closeAllSessions()
        await transport.stop()
        listening = false
        boundPort = undefined
        mirrors.setEnabled(false)
        taps.clear()
        unsubData?.(); unsubExit?.(); unsubGrid?.(); unsubStatus?.(); unsubSpawn?.()
      })
    }
  }
}

// Re-exported so a caller can verify a presented token without duplicating the verification site.
export { verifyToken }
