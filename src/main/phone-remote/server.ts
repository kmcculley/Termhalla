/**
 * HTTP+WS listener lifecycle (feature 0026, REQ-002/REQ-019/REQ-020) — transport plumbing ONLY.
 * No mirror/auth/routing logic lives here; every accepted request/upgrade is delegated to
 * injected handlers. The listener and every accepted socket are `unref()`'d (a long-lived
 * process-blocking child is exactly the CLAUDE.md gotcha this whole feature must avoid), and the
 * listener keeps a whole-lifetime `'error'` handler (CONV-071) — never only a bind-time one-off —
 * so a post-bind runtime error (e.g. EMFILE) can never crash main via an unhandled 'error' event.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

export type BindMode = 'localhost' | 'lan'

export interface PhoneRemoteServerHandlers {
  onRequest(req: IncomingMessage, res: ServerResponse): void
  /** Fully owns the upgrade decision (auth + routing) — including writing a raw 401 and
   *  destroying the socket for a refused/unauthenticated upgrade (REQ-005). */
  onUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void
}

export interface PhoneRemoteServer {
  start(opts: { port: number; bind: BindMode }): Promise<{ port: number }>
  stop(): Promise<void>
  isRunning(): boolean
}

const bindHost = (bind: BindMode): string => (bind === 'lan' ? '0.0.0.0' : '127.0.0.1')

export function createPhoneRemoteServer(handlers: PhoneRemoteServerHandlers): PhoneRemoteServer {
  let httpServer: HttpServer | undefined
  const sockets = new Set<Socket>()

  return {
    async start(opts) {
      // v2 (FINDING-018): an already-running transport is NOT a bind failure — return the
      // existing bound port rather than rejecting, so a redundant/racing start() can never be
      // misclassified as an EADDRINUSE-style error by a caller that didn't itself serialize.
      if (httpServer) {
        const addr = httpServer.address()
        const boundPort = addr && typeof addr === 'object' ? addr.port : opts.port
        return { port: boundPort }
      }

      const srv = createServer((req, res) => {
        try { handlers.onRequest(req, res) } catch { try { res.writeHead(500); res.end() } catch { /* socket already gone */ } }
      })

      let pendingReject: ((err: Error) => void) | undefined
      // CONV-071: this ONE handler serves the whole listener lifetime. During the initial bind it
      // rejects start()'s promise (EADDRINUSE/EACCES surfaced as a typed failure, never thrown
      // into an unhandled 'error' event); after a successful bind it just swallows — a listener
      // MUST always carry an 'error' handler or Node treats an unhandled one as fatal.
      srv.on('error', (err) => {
        if (pendingReject) { const reject = pendingReject; pendingReject = undefined; reject(err) }
      })
      srv.on('connection', (socket) => {
        sockets.add(socket)
        socket.unref()
        socket.on('close', () => sockets.delete(socket))
      })
      srv.on('upgrade', (req, socket, head) => {
        try { handlers.onUpgrade(req, socket as Socket, head) } catch { try { (socket as Socket).destroy() } catch { /* gone */ } }
      })

      await new Promise<void>((resolve, reject) => {
        pendingReject = reject
        srv.once('listening', () => { pendingReject = undefined; resolve() })
        srv.listen(opts.port, bindHost(opts.bind))
      })
      srv.unref()
      httpServer = srv

      const addr = srv.address()
      const boundPort = addr && typeof addr === 'object' ? addr.port : opts.port
      return { port: boundPort }
    },

    async stop() {
      const srv = httpServer
      httpServer = undefined
      if (!srv) return
      for (const s of sockets) { try { s.destroy() } catch { /* already gone */ } }
      sockets.clear()
      await new Promise<void>((resolve) => srv.close(() => resolve()))
    },

    isRunning() {
      return httpServer !== undefined
    }
  }
}
