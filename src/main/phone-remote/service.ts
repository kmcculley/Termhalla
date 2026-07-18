/**
 * Composition: settings <-> the runtime server, the shared mirror registry, per-client WS
 * sessions, and the IPC-facing status/control surface (feature 0026, REQ-001/002/004/005/006/
 * 007/009/011/012/019/020/024). The service TRUSTS its injected settings — normalization happens
 * at the quick-store boundary (`normalizePhoneRemote`), not here. `settings.port === 0` means
 * OS-assigned (a test seam; production keeps the persisted/default port); the ACTUAL bound port
 * is reported back through `status().port`/`status().urls`.
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
import { extractTokenFromRequest, isRequestAuthorized } from './auth'
import { isAllowlisted, serveStaticFile } from './static-assets'
import { generateToken, hashToken, verifyToken } from './token'
import { createMirrorManager } from './mirror-manager'
import { createWsSession, type WsSession } from './ws-session'
import { buildInventory, type RawPaneInfo } from './inventory'

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
    write(paneId: string, data: string): void
  }
  /** Dir served as the web-client bundle (`out/phone-client` in production). */
  staticRoot?: string
  /** Routed to the error-severity toast chokepoint by the IPC layer — never suppressed by the
   *  `quick.toastsEnabled` opt-in (CONV-004). */
  notifyError(message: string): void
  /** Test seam; defaults to the real F18 `createPaneReplay`. */
  replayFactory?: ReplayFactory
}

export interface PhoneRemoteService {
  init(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setBind(mode: BindMode): Promise<void>
  setPort(port: number): Promise<void>
  status(): PhoneRemoteStatus
  regenerateToken(): Promise<{ pairingUrl: string }>
  stop(): Promise<void>
}

const DEFAULT_SETTINGS: PhoneRemoteSettings = { enabled: false, bind: 'localhost', port: PHONE_REMOTE_PORT_DEFAULT }

const primaryLanAddress = (): string | undefined => {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return undefined
}

export function createPhoneRemoteService(deps: PhoneRemoteServiceDeps): PhoneRemoteService {
  let settings: PhoneRemoteSettings = DEFAULT_SETTINGS
  let listening = false
  let boundPort: number | undefined
  /** The plaintext token, main-process memory only, for the CURRENT app session (REQ-004). */
  let sessionToken: string | undefined

  const mirrors = createMirrorManager({ replayFactory: deps.replayFactory })
  const taps = new Map<string, (chunk: string) => void>()
  const sessions = new Set<{ ws: WsSocket; session: WsSession }>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: PHONE_WS_MAX_FRAME })

  const paneInfo = (paneId: string): PhoneRemotePaneRecord | undefined =>
    deps.panes.list().find((p) => p.paneId === paneId)

  const ensureTap = (rec: PhoneRemotePaneRecord): void => {
    if (taps.has(rec.paneId)) return
    const tap = mirrors.registerPane({ paneId: rec.paneId, cols: rec.cols, rows: rec.rows }, () => {})
    taps.set(rec.paneId, tap)
  }

  const toRawPaneInfo = (list: PhoneRemotePaneRecord[]): RawPaneInfo[] => list

  const computeUrls = (): string[] => {
    if (!listening || boundPort === undefined) return []
    if (settings.bind === 'lan') {
      const lan = primaryLanAddress()
      return lan ? [`http://127.0.0.1:${boundPort}/`, `http://${lan}:${boundPort}/`] : [`http://127.0.0.1:${boundPort}/`]
    }
    return [`http://127.0.0.1:${boundPort}/`]
  }

  const buildPairingUrl = (token: string): string => {
    const host = settings.bind === 'lan' ? (primaryLanAddress() ?? '127.0.0.1') : '127.0.0.1'
    const port = listening && boundPort !== undefined ? boundPort : settings.port
    return `http://${host}:${port}/?token=${encodeURIComponent(token)}`
  }

  // ── HTTP request routing ────────────────────────────────────────────────────────────────────
  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    let pathname = '/'
    try { pathname = new URL(req.url ?? '/', 'http://phone-remote.local').pathname } catch { /* keep '/' */ }

    if (isAllowlisted(pathname)) { void serveStaticFile(deps.staticRoot ?? '', pathname, res); return }
    if (!isRequestAuthorized(req, settings.tokenHash)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('unauthorized')
      return
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
    const session = createWsSession({
      send: (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)) },
      bufferedAmount: () => ws.bufferedAmount,
      mirrors: { snapshot: (paneId) => mirrors.snapshot(paneId) },
      panes: {
        inventory: () => buildInventory(toRawPaneInfo(deps.panes.list())),
        isLive: (paneId) => paneInfo(paneId) !== undefined,
        write: (paneId, data) => deps.panes.write(paneId, data)
      }
    })
    const entry = { ws, session }
    sessions.add(entry)
    ws.on('message', (data, isBinary) => {
      session.handleFrame(isBinary ? (data as Buffer) : Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
    })
    ws.on('drain', () => session.socketDrained())
    ws.on('close', () => { sessions.delete(entry); session.close() })
    ws.on('error', () => { /* the 'close' event still fires; nothing else to do here */ })
    session.start()
  })

  const transport = createPhoneRemoteServer({ onRequest: handleRequest, onUpgrade: handleUpgrade })

  const attemptStart = async (): Promise<void> => {
    try {
      const { port } = await transport.start({ port: settings.port, bind: settings.bind })
      boundPort = port
      listening = true
    } catch (e) {
      listening = false
      boundPort = undefined
      const err = e as NodeJS.ErrnoException
      const reason = err?.code === 'EADDRINUSE'
        ? 'that port is already in use'
        : err?.code === 'EACCES'
          ? 'that port requires elevated permissions'
          : (err?.message ?? 'failed to start')
      deps.notifyError(
        `Phone remote could not start on port ${settings.port} — ${reason}. Free the port, or change it in Settings.`
      )
    }
  }

  const closeAllSessions = (): void => {
    for (const { ws } of [...sessions]) { try { ws.terminate() } catch { /* already gone */ } }
    sessions.clear()
  }

  let unsubData: (() => void) | undefined
  let unsubExit: (() => void) | undefined
  let unsubGrid: (() => void) | undefined
  let unsubStatus: (() => void) | undefined

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
      for (const { session } of sessions) session.paneData(paneId, chunk)
    })
    unsubExit = deps.panes.onExit((paneId) => {
      taps.delete(paneId)
      mirrors.paneExited(paneId)
      for (const { session } of sessions) session.paneExit(paneId)
    })
    unsubGrid = deps.panes.onGrid((paneId, cols, rows) => {
      mirrors.resizePane(paneId, cols, rows)
      for (const { session } of sessions) session.paneGrid(paneId, cols, rows)
    })
    unsubStatus = deps.panes.onStatus((paneId, status) => {
      for (const { session } of sessions) session.paneStatus(paneId, status)
    })
  }
  wireDataSources()

  return {
    async init() {
      settings = (await deps.loadSettings()) ?? DEFAULT_SETTINGS
      if (settings.enabled) {
        await attemptStart()
        if (listening) {
          for (const p of deps.panes.list()) ensureTap(p)
          mirrors.setEnabled(true)
        } else {
          settings = { ...settings, enabled: false }
        }
      }
    },

    async setEnabled(enabled) {
      settings = { ...settings, enabled }
      if (enabled) {
        await attemptStart()
        if (listening) {
          for (const p of deps.panes.list()) ensureTap(p)
          mirrors.setEnabled(true)
        } else {
          settings = { ...settings, enabled: false }
        }
      } else {
        await transport.stop()
        listening = false
        boundPort = undefined
        mirrors.setEnabled(false)
        taps.clear()
        closeAllSessions()
      }
      await deps.saveSettings(settings)
    },

    async setBind(mode) {
      settings = { ...settings, bind: mode }
      await deps.saveSettings(settings)
      if (listening) {
        await transport.stop()
        listening = false
        boundPort = undefined
        await attemptStart()
      }
    },

    async setPort(port) {
      settings = { ...settings, port }
      await deps.saveSettings(settings)
      if (listening) {
        await transport.stop()
        listening = false
        boundPort = undefined
        await attemptStart()
      }
    },

    status() {
      return {
        enabled: settings.enabled,
        bind: settings.bind,
        port: listening && boundPort !== undefined ? boundPort : settings.port,
        running: listening,
        urls: computeUrls(),
        hasToken: typeof settings.tokenHash === 'string' && settings.tokenHash.length > 0,
        tokenAvailableThisSession: sessionToken !== undefined
      }
    },

    async regenerateToken() {
      const token = generateToken()
      const hash = hashToken(token)
      settings = { ...settings, tokenHash: hash }
      sessionToken = token
      // REQ-006: atomically revoke — persist the new hash, then drop every currently connected
      // client so the old token can never be used again on an already-open socket.
      await deps.saveSettings(settings)
      closeAllSessions()
      return { pairingUrl: buildPairingUrl(token) }
    },

    async stop() {
      closeAllSessions()
      await transport.stop()
      listening = false
      boundPort = undefined
      mirrors.setEnabled(false)
      taps.clear()
      unsubData?.(); unsubExit?.(); unsubGrid?.(); unsubStatus?.()
    }
  }
}

// Re-exported so a caller can verify a presented token without duplicating the verification site.
export { verifyToken }
