/**
 * The `--daemon` mode composition root (REQ-002/003/004/005/006/007/008/012/018).
 *
 * Four layers:
 *  - `bootstrapDaemonEndpoint` — a pure-seam unit (REQ-003): 0600-FROM-CREATION via a temporarily
 *    restrictive umask around the bind (FINDING-005 — a chmod-after-listen ordering is
 *    non-compliant), metadata strictly-after-listen, an over-long AF_UNIX path (measured in BYTES,
 *    FINDING-007) named (never a raw EINVAL). Exercised directly by the frozen injected-seam unit.
 *  - `createDaemonLogSink` — the truncate-at-start, size-capped diagnostics sink (REQ-004,
 *    FINDING-010/015): a survival daemon's generation is wall-clock unbounded, so the file never
 *    grows past `DAEMON_LOG_MAX_BYTES` (ring-style truncation, latest diagnostics kept).
 *  - `createDaemonCore` — the in-process survival composition (REQ-002/REQ-008/REQ-012): ONE
 *    process-lifetime `AgentSessionStore`, each accepted connection an independent protocol
 *    connection handshaken by the DAEMON-FLOW relaxed machine (protocol-range acceptance, app
 *    version advisory — D4′), then delegated to the unchanged F16/F17/F18/F20 `createAgentSession`
 *    composition (the version fed to it is rewritten to the daemon's own so its exact-version
 *    machine accepts a protocol-compatible drifted client — session.ts is UNTOUCHED). A connection
 *    ending only detaches — never kills a pane, never stops the daemon.
 *  - `runDaemon` — the impure real-process entry `main.ts` calls: claims the workspace-keyed
 *    socket path (race-safe single-instance guard + all stale-crash reclaim INSIDE the serialized
 *    claim, REQ-005/007), truncates + size-caps + owns the ws-keyed daemon log (REQ-004),
 *    announces ws-keyed metadata (with `proto`), wires `daemon-lifecycle.ts` to real timers +
 *    SIGTERM, and runs the shared, OWNERSHIP-CHECKED cleanup on idle or signal.
 */
import { createServer, type Server, type Socket } from 'node:net'
import { writeFileSync, appendFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  createFrameDecoder, encodeFrame, createDaemonAgentHandshake, AGENT_V1_CAPABILITIES, WIRE_PROTO
} from '@shared/remote/protocol'
import type { WireFrame } from '@shared/remote/protocol'
import { createAgentSession } from './session'
import { createSessionStore } from './session-store'
import { AGENT_LEASE_REVOKED_EVT } from './session-api'
import type { AgentPtyBackend, AgentPtyHandle, AgentSpawnOpts } from './pty-backend'
import {
  socketFileName, metadataFileName, logFileName, DAEMON_LOG_MAX_BYTES
} from './daemon-constants'
import {
  decideDaemonReach, checkSocketPathLength, bindWithRestrictiveUmask, writeDaemonMetadata,
  type DaemonMetadataInput
} from './daemon-guard'
import { isAlive, delay, readDaemonMetadata, tryConnectOnce } from './daemon-io'
import { createDaemonLifecycle } from './daemon-lifecycle'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// bootstrapDaemonEndpoint — pure-seam endpoint bootstrap (REQ-003)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DaemonEndpointSeams {
  platform: NodeJS.Platform
  /** Set the process umask, returning the prior value (the save/restore seam, FINDING-005). */
  umask(mask: number): number
  listen(path: string): Promise<void>
  writeFile(path: string, text: string, mode: number): Promise<void>
}

export interface BootstrapDaemonEndpointInput {
  socketPath: string
  metadataPath: string
  metadata: DaemonMetadataInput
  seams: DaemonEndpointSeams
}

export type BootstrapDaemonEndpointResult = { ok: true } | { ok: false; message: string }

/** POSIX order EXACTLY umask(0o077) → listen → umask(prior) → write(metadata, 0600): the socket
 *  is CREATED owner-only by the restrictive umask in force during the bind, so no wider-mode
 *  window can exist by construction (FINDING-005). Metadata existence therefore implies a bound,
 *  owner-only listener at write time (REQ-003).
 *
 *  Audit 2026-07-17 finding 9: the discipline itself lives in `daemon-guard.ts`
 *  (`bindWithRestrictiveUmask` + `writeDaemonMetadata`) — the SAME implementations the
 *  production bind path (`listenOnce` / `runDaemon`) runs, so the frozen seam tests exercise the
 *  production unit, not a lookalike copy (the FINDING-022 unification, extended). */
export const bootstrapDaemonEndpoint = async (
  input: BootstrapDaemonEndpointInput
): Promise<BootstrapDaemonEndpointResult> => {
  const { socketPath, metadataPath, metadata, seams } = input
  // FINDING-022: the over-long-path guard is the ONE shared implementation (`daemon-guard.ts`) —
  // this seam calls it rather than re-deriving the byte comparison, so it can never diverge from
  // the production bind path below.
  const pathErr = checkSocketPathLength(socketPath, seams.platform)
  if (pathErr) return { ok: false, message: pathErr.message }
  await bindWithRestrictiveUmask(seams.platform, seams.umask, () => seams.listen(socketPath))
  await writeDaemonMetadata(seams.writeFile, metadataPath, metadata)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// createDaemonLogSink — truncate-at-start, in-generation size-capped diagnostics sink (REQ-004)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DaemonLogSink {
  append(text: string): void
}

/** Construction truncates the previous generation's log (CONV-003). Appends never grow the file
 *  past `maxBytes`, while the most recent diagnostics survive (FINDING-010/015). Best-effort — a
 *  broken diagnostics sink never crashes the daemon. NEVER routes PTY payload bytes (the caller
 *  only feeds diagnostics).
 *
 *  Audit 2026-07-17 finding 34: appends are INCREMENTAL (`appendFileSync` of just the new line,
 *  the on-disk size tracked) — the previous sink synchronously rewrote the whole capped buffer
 *  (up to `maxBytes`) on EVERY line, on the daemon's serving event loop, and its trim loop
 *  re-measured the whole buffer per dropped line (O(n²)). The retained ring is kept as whole
 *  lines with a running byte total; the file is compacted (truncate-and-rewrite of the ring)
 *  ONLY when an append would cross the cap, so the file never exceeds `maxBytes`. */
export const createDaemonLogSink = (logPath: string, maxBytes: number = DAEMON_LOG_MAX_BYTES): DaemonLogSink => {
  const lines: string[] = []
  const sizes: number[] = []
  let ringBytes = 0
  let diskBytes = 0
  try {
    writeFileSync(logPath, '')
  } catch {
    /* best-effort diagnostics sink */
  }
  return {
    append(text: string): void {
      let line = `${new Date().toISOString()} ${text}\n`
      let bytes = Buffer.byteLength(line, 'utf8')
      if (bytes > maxBytes) {
        // A single oversize line keeps its tail — byte-measured, so the cap invariant holds even
        // when the cut lands mid-multibyte-sequence (re-encoded replacement chars can regrow it).
        line = Buffer.from(line, 'utf8').subarray(bytes - maxBytes).toString('utf8')
        bytes = Buffer.byteLength(line, 'utf8')
        while (bytes > maxBytes && line.length > 0) {
          line = line.slice(1)
          bytes = Buffer.byteLength(line, 'utf8')
        }
      }
      // Ring-truncate: drop whole oldest lines first (incremental byte bookkeeping — never a
      // whole-buffer re-measure).
      while (lines.length > 0 && ringBytes + bytes > maxBytes) {
        ringBytes -= sizes.shift() ?? 0
        lines.shift()
      }
      lines.push(line)
      sizes.push(bytes)
      ringBytes += bytes
      try {
        if (diskBytes + bytes > maxBytes) {
          // The cap would be crossed: one compaction — rewrite the retained ring (≤ maxBytes).
          writeFileSync(logPath, lines.join(''))
          diskBytes = ringBytes
        } else {
          appendFileSync(logPath, line)
          diskBytes += bytes
        }
      } catch {
        /* best-effort */
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// createDaemonCore — the in-process survival composition (REQ-002/REQ-008/REQ-012)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DaemonCorePeer {
  send(bytes: Uint8Array): void
  end(): void
}

export interface DaemonCoreConnection {
  push(bytes: Uint8Array): void
  end(): void
}

/** Optional daemon-wide lifecycle observation hooks (used by `runDaemon` to wire
 *  `daemon-lifecycle.ts`; the frozen `createDaemonCore` unit tests pass them to observe counts).
 *  Establishment/end is derived by a FRONT daemon-flow handshake observer (protocol-range
 *  acceptance, D4′) WITHOUT touching `session.ts`/`session-store.ts`: `onConnectionEstablished`
 *  fires the moment the handshake completes, `onConnectionEnded` for EVERY end path of an
 *  established connection (clean EOF, fatal framing, failed send, lease displacement) and NEVER
 *  for a connection that failed its handshake (FINDING-008/012). Pane spawn/exit is derived by
 *  wrapping the BACKEND directly — a signal independent of which connection is bound. */
export interface DaemonCoreHooks {
  onConnectionEstablished?(): void
  onConnectionEnded?(): void
  onPaneSpawned?(): void
  onPaneExited?(): void
}

export interface DaemonCoreInit {
  version: string
  backend: AgentPtyBackend
  homeDir: string
  scrollback?: number
  diag?(text: string): void
  hooks?: DaemonCoreHooks
}

export interface DaemonCore {
  accept(peer: DaemonCorePeer): DaemonCoreConnection
  destroy(): void
}

const wrapBackendForLifecycle = (inner: AgentPtyBackend, hooks?: DaemonCoreHooks): AgentPtyBackend => {
  if (hooks?.onPaneSpawned === undefined && hooks?.onPaneExited === undefined) return inner
  return {
    spawn(opts: AgentSpawnOpts): AgentPtyHandle {
      const handle = inner.spawn(opts)
      hooks.onPaneSpawned?.()
      let exited = false
      return {
        ...handle,
        onExit(cb: (code: number) => void): void {
          handle.onExit((code) => {
            if (!exited) {
              exited = true
              hooks.onPaneExited?.()
            }
            cb(code)
          })
        }
      }
    }
  }
}

export const createDaemonCore = (init: DaemonCoreInit): DaemonCore => {
  const diag = init.diag ?? ((): void => {})
  const backend = wrapBackendForLifecycle(init.backend, init.hooks)
  const store = createSessionStore({
    backend,
    homeDir: init.homeDir,
    diag,
    ...(init.scrollback !== undefined ? { scrollback: init.scrollback } : {})
  })
  let destroyed = false

  return {
    accept(peer: DaemonCorePeer): DaemonCoreConnection {
      const decoder = createFrameDecoder()
      // A FRONT observer of the daemon-flow (relaxed) handshake: it does the REAL protocol-range
      // acceptance decision (app version advisory, D4′). session.ts keeps its own exact-version
      // machine internally, so on a protocol-compatible-but-version-drifted client we rewrite the
      // forwarded client hello's version to the daemon's own — a tautology for the exact machine.
      const frontHandshake = createDaemonAgentHandshake({ version: init.version, capabilities: AGENT_V1_CAPABILITIES })
      let handshakeSettled = false
      let established = false
      let connectionEnded = false

      const session = createAgentSession({
        version: init.version,
        sessions: store,
        send: (frame: WireFrame) => {
          try {
            peer.send(encodeFrame(frame))
          } catch (e) {
            diag(`daemon core: peer send failed: ${String(e)}`)
          }
        },
        diag,
        shutdown: (): void => {
          // EVERY end path of an ESTABLISHED connection decrements the count (incl. a lease
          // displacement) — FINDING-008. A never-established connection never counted.
          if (established) init.hooks?.onConnectionEnded?.()
          connectionEnded = true
          try {
            peer.end()
          } catch {
            /* already gone */
          }
        }
      })
      session.start()

      return {
        push(bytes: Uint8Array): void {
          if (connectionEnded) return
          let items
          try {
            items = decoder.push(bytes)
          } catch {
            return
          }
          for (const item of items) {
            if (!handshakeSettled && item.kind === 'message') {
              handshakeSettled = true
              const r = frontHandshake.onMessage(item.frame)
              if (r.ok) {
                established = true
                init.hooks?.onConnectionEstablished?.()
                // Rewrite the app version so session.ts's exact-version machine accepts a
                // protocol-compatible drifted client (REQ-012). The front machine already
                // enforced protocol-range compatibility, so item.frame is a valid client hello.
                const rewritten = { ...item.frame, version: init.version } as WireFrame
                session.onItem({ kind: 'message', frame: rewritten })
              } else {
                // proto-mismatch / bad hello: feed the ORIGINAL so session ends the connection
                // with the accurate diagnostic; never establish, never count.
                session.onItem(item)
              }
              continue
            }
            session.onItem(item)
          }
        },
        end(): void {
          if (connectionEnded) return
          session.endOfInput()
        }
      }
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      store.destroy()
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// runDaemon — the real `--daemon` process entry (REQ-004/005/006/007/018)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const safeUnlink = (p: string): void => {
  try {
    unlinkSync(p)
  } catch {
    /* already gone */
  }
}

/** Bind the socket path under a temporarily restrictive umask so the socket file is created 0600
 *  the instant it exists (FINDING-005 — no chmod-after-listen window). The prior umask is restored
 *  as soon as the bind settles (success or failure), on POSIX only (win32 pipes have no mode).
 *  The discipline is the SHARED `bindWithRestrictiveUmask` — the same implementation the frozen
 *  `bootstrapDaemonEndpoint` seam runs (audit 2026-07-17 finding 9). */
const listenOnce = (socketPath: string): Promise<Server> => bindWithRestrictiveUmask(
  process.platform,
  (mask) => process.umask(mask),
  () => new Promise<Server>((resolve, reject) => {
    const server = createServer()
    const onError = (e: unknown): void => { reject(e) }
    server.once('error', onError)
    server.listen(socketPath, () => {
      server.removeListener('error', onError)
      resolve(server)
    })
  })
)

/** Boolean claim-side probe, derived from the shared connect primitive (finding 32). */
const probeConnectable = async (socketPath: string, timeoutMs = 150): Promise<boolean> => {
  const sock = await tryConnectOnce(socketPath, timeoutMs)
  if (sock === null) return false
  sock.destroy()
  return true
}

/** Claim the workspace-scoped socket for THIS process, race-safe against concurrent first-starts
 *  (REQ-005) and crash remnants (REQ-007). ALL reclaim happens INSIDE this serialized critical
 *  section — the guarded probe → pid-liveness check → unlink-of-proven-remnants → immediate
 *  re-bind loop (FINDING-006/016: no unguarded check-then-unlink window exists anywhere, so a
 *  stale-remnant unlink can never remove a concurrent winner's live socket). `decideDaemonReach`
 *  never reclaims a live recorded pid (CONV-045). Returns the bound server on a win, or `null` on
 *  a concede (never disturbing the winner's socket/metadata). */
const claimSocket = async (socketPath: string, metadataPath: string): Promise<Server | null> => {
  const maxAttempts = 200
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await listenOnce(socketPath)
    } catch {
      let connectable = false
      for (let i = 0; i < 15 && !connectable; i++) {
        connectable = await probeConnectable(socketPath, 100)
        if (!connectable) await delay(25)
      }
      if (connectable) return null // a genuine listener won the race — concede, never disturb it
      const meta = readDaemonMetadata(metadataPath)
      const pidAlive = meta !== null && isAlive(meta.pid)
      const decision = decideDaemonReach({ connectable: false, metadataPid: meta?.pid ?? null, pidAlive })
      if (decision.kind === 'reclaim') {
        // Reclaim of the PROVEN-dead remnants, inside this same critical section (never on a
        // prior probe alone) — then retry the bind against the now-cleared path.
        safeUnlink(socketPath)
        safeUnlink(metadataPath)
        continue
      }
      // 'wait': a live pid is recorded but has not (yet) started accepting — give it more time.
      await delay(50)
    }
  }
  return null
}

export interface RunDaemonOptions {
  version: string
  backend: AgentPtyBackend
  ptyBackendName: 'node-pty' | 'fake'
  homeDir: string
  /** The workspace scope — derives the ws-keyed metadata/log (and, absent `socketPath`, the
   *  ws-keyed socket) names (locked D6′, REQ-018). */
  wsToken?: string
  socketPath?: string
  idleTimeoutMs?: number
}

/** The `--ws` token names metadata/log (and, absent a `--socket` override, the socket). A daemon
 *  without a `--ws` (bare `--socket`) falls back to a stable default name — no test exercises this
 *  shape (every daemon/attach invocation carries a scope), but the paths must still resolve. */
const resolveScope = (wsToken: string | undefined): string => wsToken ?? 'default'

/** The `--daemon` mode entry: claims the endpoint, announces metadata, serves connections over
 *  the survival composition, and runs the ONE shared, ownership-checked cleanup path on idle-out
 *  or SIGTERM. The returned promise resolves once the process is ready to exit naturally (no
 *  process.exit() — the repo's shutdown discipline: pending stdio/log writes must flush). */
export const runDaemon = (opts: RunDaemonOptions): Promise<void> => new Promise((resolveRun) => {
  const artifactPath = process.argv[1] ?? process.cwd()
  const agentDir = dirname(artifactPath)
  const ws = resolveScope(opts.wsToken)
  const socketPath = opts.socketPath ?? join(agentDir, socketFileName(ws))
  const metadataPath = join(agentDir, metadataFileName(ws))
  const logPath = join(agentDir, logFileName(ws))

  // FINDING-022: the shared over-long-path guard runs FIRST on the PRODUCTION bind path too —
  // before claimSocket's claim/reclaim loop ever starts. Thrown synchronously inside the
  // executor, this rejects the returned promise immediately (never a raw EINVAL/ENAMETOOLONG
  // swallowed into 200 attempts, never a silent exit 0); main.ts's existing daemon-mode catch
  // names the error on stderr when run directly (REQ-003) — when detached, the SAME error also
  // reaches the daemon log because the spawn spec routes the child's stderr fd there (REQ-004).
  const pathErr = checkSocketPathLength(socketPath, process.platform)
  if (pathErr) throw new Error(pathErr.message)

  void (async (): Promise<void> => {
    const server = await claimSocket(socketPath, metadataPath)
    if (!server) {
      // Conceded to a concurrent winner: exit cleanly without touching its files (REQ-005).
      process.exitCode = 0
      resolveRun()
      return
    }

    // We won the claim: the socket was created 0600 by the umask-wrapped bind (FINDING-005 — no
    // chmod needed). Truncate + size-cap THIS generation's log (CONV-003/FINDING-010/015), then
    // announce metadata (its existence implies a bound listener).
    const log = createDaemonLogSink(logPath)
    const appendLog = (text: string): void => log.append(text)

    // The announcement rides the SHARED `writeDaemonMetadata` (shape + mode 0600 in one place —
    // the same implementation the frozen `bootstrapDaemonEndpoint` seam runs, finding 9).
    try {
      await writeDaemonMetadata(
        (p, text, mode) => { writeFileSync(p, text, { mode }) },
        metadataPath,
        {
          pid: process.pid,
          version: opts.version,
          proto: WIRE_PROTO,
          backend: opts.ptyBackendName,
          startedAt: new Date().toISOString()
        }
      )
    } catch (e) {
      appendLog(`writing ${metadataPath} failed: ${String(e)}`)
    }

    const activeSockets = new Set<Socket>()
    let shuttingDown = false

    /** Ownership-checked file removal (FINDING-006c / CONV-045): only remove the socket/metadata
     *  if THIS daemon's pid is still the one recorded — a superseded daemon must never unlink a
     *  live successor's endpoint. */
    const removeOwnedFiles = (): void => {
      const meta = readDaemonMetadata(metadataPath)
      if (meta !== null && meta.pid === process.pid) {
        safeUnlink(socketPath)
        safeUnlink(metadataPath)
      }
    }

    const cleanup = (): void => {
      if (shuttingDown) return
      shuttingDown = true
      for (const s of [...activeSockets]) {
        try {
          s.destroy()
        } catch {
          /* already gone */
        }
      }
      try {
        core.destroy()
      } catch (e) {
        appendLog(`core.destroy() failed: ${String(e)}`)
      }
      try {
        server.close()
      } catch {
        /* already gone */
      }
      removeOwnedFiles()
      process.exitCode = 0
      resolveRun()
    }

    const lifecycle = createDaemonLifecycle({
      scheduler: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
      },
      signals: { on: (name, fn) => process.on(name as NodeJS.Signals, fn) },
      ...(opts.idleTimeoutMs !== undefined ? { idleTimeoutMs: opts.idleTimeoutMs } : {}),
      onShutdown: () => cleanup()
    })

    const core = createDaemonCore({
      version: opts.version,
      backend: opts.backend,
      homeDir: opts.homeDir,
      diag: appendLog,
      hooks: {
        onConnectionEstablished: () => lifecycle.onConnectionEstablished(),
        onConnectionEnded: () => lifecycle.onConnectionEnded(),
        onPaneSpawned: () => lifecycle.onPaneSpawned(),
        onPaneExited: () => lifecycle.onPaneExited()
      }
    })

    server.on('connection', (sock: Socket) => {
      activeSockets.add(sock)
      sock.on('close', () => activeSockets.delete(sock))
      const conn = core.accept({
        send: (bytes) => {
          try {
            sock.write(Buffer.from(bytes))
          } catch (e) {
            appendLog(`socket send failed: ${String(e)}`)
          }
        },
        end: () => {
          try {
            sock.end()
          } catch {
            /* already gone */
          }
        }
      })
      sock.on('data', (chunk: Buffer) => conn.push(chunk))
      sock.on('end', () => conn.end())
      sock.on('error', () => conn.end())
    })

    lifecycle.start()
  })().catch((e) => {
    try {
      const sink = createDaemonLogSink(logPath)
      sink.append(`runDaemon failed: ${String(e)}`)
    } catch {
      /* best-effort */
    }
    process.exitCode = 1
    resolveRun()
  })
})
