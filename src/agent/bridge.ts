/**
 * The `--attach` mode: the byte-transparent bridge engine (REQ-004/007/009/010/011/018).
 *
 * On invocation: try the workspace-keyed socket; on no-listener (absent, or a stale/dead remnant)
 * spawn the daemon from THIS SAME artifact, detached (REQ-004, via `spawn-daemon.ts`), then
 * poll-connect bounded by `DAEMON_SPAWN_WAIT_MS`. The bridge NEVER removes any socket/metadata/lock
 * file (FINDING-016): an unguarded bridge-side check-then-remove can orphan a live daemon that has
 * bound but not yet written metadata — ALL reclaim lives inside the daemon's serialized claim
 * (`daemon-server.ts` `claimSocket`). A live-but-never-accepting recorded pid is NEVER reclaimed
 * (retries within the deadline, then a 96 failure naming the socket, the recorded pid, the ws-keyed
 * log, and the FINDING-018 manual escape hatch). On success, emit exactly ONE
 * `TERMHALLA_BRIDGE_V1 {...}` status line on stderr (reading the ws-keyed metadata for
 * daemonVersion/daemonProto/daemonPid; `null` when unreadable) BEFORE piping begins, then pipe
 * stdin<->socket with ZERO frame inspection, half-closing/ending the other side on either EOF
 * (exit 0), or exit `BRIDGE_DAEMON_UNREACHABLE_EXIT` (96) on an unreachable daemon.
 */
import { spawn as spawnChild } from 'node:child_process'
import { connect as netConnect, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, openSync, closeSync } from 'node:fs'
import {
  socketFileName, metadataFileName, logFileName, DAEMON_SPAWN_WAIT_MS,
  BRIDGE_DAEMON_UNREACHABLE_EXIT, BRIDGE_STATUS_PREFIX
} from './daemon-constants'
import { decideDaemonReach, validateDaemonMetadata } from './daemon-guard'
import { buildDaemonSpawnSpec } from './spawn-daemon'

export interface BridgeArgs {
  ptyBackend: 'node-pty' | 'fake'
  wsToken?: string
  socketPath?: string
  idleTimeoutMs?: number
}

interface BridgeMetadata { pid: number; version: string; proto: number; backend: string }

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const readMetadata = (metadataPath: string): BridgeMetadata | null => {
  try {
    if (!existsSync(metadataPath)) return null
    const raw: unknown = JSON.parse(readFileSync(metadataPath, 'utf8'))
    const r = validateDaemonMetadata(raw)
    return r.ok ? { pid: r.meta.pid, version: r.meta.version, proto: r.meta.proto, backend: r.meta.backend } : null
  } catch {
    return null
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const tryConnectOnce = (socketPath: string, timeoutMs: number): Promise<Socket | null> => new Promise((resolve) => {
  let settled = false
  const sock = netConnect(socketPath)
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    sock.destroy()
    resolve(null)
  }, timeoutMs)
  sock.once('connect', () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(sock)
  })
  sock.once('error', () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(null)
  })
})

/** Poll-connect bounded by an overall deadline — synchronized on observed connect success, never
 *  a fixed sleep (CONV-062). */
const pollConnect = async (socketPath: string, deadlineMs: number): Promise<Socket | null> => {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    const sock = await tryConnectOnce(socketPath, Math.min(300, Math.max(50, remaining)))
    if (sock) return sock
    if (Date.now() >= deadline) return null
    await delay(Math.min(50, Math.max(0, deadline - Date.now())))
  }
}

/** A bounded wait for metadata to settle right after a fresh connect: metadata is written
 *  strictly AFTER listen (REQ-003), so a just-accepted connect can briefly precede the metadata
 *  write. Returns null (never a throw) if metadata genuinely never appears — the Definitions
 *  contract for "unreadable". */
const waitForMetadata = async (metadataPath: string, deadlineMs: number): Promise<BridgeMetadata | null> => {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    const meta = readMetadata(metadataPath)
    if (meta !== null) return meta
    if (Date.now() >= deadline) return null
    await delay(20)
  }
}

const stderrLine = (text: string): void => { process.stderr.write(`${text}\n`) }

export const runBridge = async (args: BridgeArgs): Promise<void> => {
  const artifactPath = process.argv[1] ?? process.cwd()
  const agentDir = dirname(artifactPath)
  const ws = args.wsToken ?? 'default'
  const socketPath = args.socketPath ?? join(agentDir, socketFileName(ws))
  const metadataPath = join(agentDir, metadataFileName(ws))
  const logPath = join(agentDir, logFileName(ws))

  const failUnreachable = (diagnostic: string): void => {
    stderrLine(`bridge: could not reach a listening daemon at ${socketPath} — ${diagnostic} (daemon log: ${logPath})`)
    process.exitCode = BRIDGE_DAEMON_UNREACHABLE_EXIT
  }

  let sock = await tryConnectOnce(socketPath, 800)
  let spawned = false

  if (!sock) {
    const meta = readMetadata(metadataPath)
    const pidAlive = meta !== null && isAlive(meta.pid)
    const decision = decideDaemonReach({ connectable: false, metadataPid: meta?.pid ?? null, pidAlive })

    if (decision.kind === 'wait') {
      sock = await pollConnect(socketPath, DAEMON_SPAWN_WAIT_MS)
      if (!sock) {
        const pid = meta?.pid ?? 'unknown'
        failUnreachable(
          `a daemon (recorded pid ${pid}) is recorded at ${metadataPath} but never accepted a connection within ` +
          `${DAEMON_SPAWN_WAIT_MS}ms — it may be wedged (a known v1 limitation: the recorded pid could have been ` +
          `reused by an unrelated long-lived process, FINDING-018). NOTHING was removed while the pid is alive. ` +
          `Manual recovery: terminate the recorded pid ${pid}, or remove the named socket and metadata files ` +
          `(${socketPath}, ${metadataPath}) from any SSH shell on the host`
        )
        return
      }
    } else {
      // reclaim / absent: the bridge NEVER removes a file (FINDING-016) — it only spawns a fresh
      // daemon from THIS same artifact (REQ-011). The daemon's serialized claimSocket owns ALL
      // reclaim (probe → pid-liveness → remove-proven-remnants → re-bind, one guarded loop). The
      // detached child's stdout/stderr are routed to the ws-keyed daemon log fd (FINDING-011).
      let logFd: number
      try {
        logFd = openSync(logPath, 'a')
      } catch {
        // Can't open the log — still spawn (the daemon truncates/owns its own log), routing the
        // child's crash output to the process's own stderr fd as a last resort.
        logFd = 2
      }
      const spec = buildDaemonSpawnSpec({
        artifactPath,
        ptyBackend: args.ptyBackend,
        logFd,
        ...(args.wsToken !== undefined ? { wsToken: args.wsToken } : {}),
        ...(args.socketPath !== undefined ? { socketPath: args.socketPath } : {}),
        ...(args.idleTimeoutMs !== undefined ? { idleTimeoutMs: args.idleTimeoutMs } : {})
      })
      const child = spawnChild(spec.command, spec.args, spec.options)
      // A spawn-level failure (EPERM/EAGAIN on the node binary) emits 'error' asynchronously;
      // with zero listeners that is an uncaughtException killing the bridge with a raw stack
      // instead of the clean 96 path (pollConnect below times out and failUnreachable reports).
      child.once('error', (err) => { stderrLine(`bridge: failed to spawn the daemon: ${String(err)}`) })
      child.unref()
      if (logFd !== 2) {
        try {
          closeSync(logFd) // the child inherited its own dup; don't leak ours into the bridge
        } catch {
          /* already closed */
        }
      }
      spawned = true
      sock = await pollConnect(socketPath, DAEMON_SPAWN_WAIT_MS)
      if (!sock) {
        failUnreachable(`the freshly spawned daemon (pid ${child.pid ?? 'unknown'}) did not accept a connection within ${DAEMON_SPAWN_WAIT_MS}ms`)
        return
      }
    }
  }

  const meta = await waitForMetadata(metadataPath, 2000)
  if (meta !== null && meta.backend !== args.ptyBackend) {
    stderrLine(
      `bridge: attaching to a daemon running backend "${meta.backend}" while --pty=${args.ptyBackend} was requested ` +
      `— the daemon's backend governs; not respawning for a backend mismatch`
    )
  }
  const status = {
    spawned,
    daemonVersion: meta?.version ?? null,
    daemonProto: meta?.proto ?? null,
    daemonPid: meta?.pid ?? null
  }
  stderrLine(`${BRIDGE_STATUS_PREFIX}${JSON.stringify(status)}`)

  pipeBridge(sock)
}

/** Pure byte pipe, both directions, zero frame inspection: stdin -> socket, socket -> stdout.
 *  Exit 0 on either side's clean end (each half-closes/ends the other so neither peer waits on a
 *  dead pipe — REQ-010). Never `process.exit()` (pending stdio writes must flush — the repo's
 *  shutdown discipline, mirrored from `main.ts`). */
const pipeBridge = (sock: Socket): void => {
  let finished = false
  const finish = (code: number): void => {
    if (finished) return
    finished = true
    process.exitCode = code
    process.stdin.destroy()
    try {
      sock.destroy()
    } catch {
      /* already gone */
    }
  }

  process.stdin.on('data', (chunk: Buffer) => {
    try {
      sock.write(chunk)
    } catch {
      /* the daemon is gone; the socket's own close/error path settles this */
    }
  })
  process.stdin.on('end', () => {
    try {
      sock.end()
    } catch {
      /* already gone */
    }
  })
  process.stdin.on('error', () => { /* EPIPE on a dying peer; the socket path reports */ })
  // stdout write failures surface as an async 'error' event (EPIPE when the ssh channel dies),
  // not via the try/catch around write() below — zero listeners would be an uncaughtException.
  // A dead stdout means the client is gone: settle as a clean end, same as the socket paths.
  process.stdout.on('error', () => finish(0))

  sock.on('data', (chunk: Buffer) => {
    try {
      process.stdout.write(chunk)
    } catch {
      /* stdout is gone; nothing further to do */
    }
  })
  sock.on('end', () => finish(0))
  sock.on('close', () => finish(0))
  sock.on('error', () => finish(0))
}
