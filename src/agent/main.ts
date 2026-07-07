/**
 * The agent entry — the ONLY impure shell (REQ-003, REQ-011, REQ-013 of 0017/0019/0022;
 * REQ-001 of 0024-agent-daemonization).
 *
 * Additive CLI modes (REQ-001 of 0024): with NO mode flag the process behaves byte-identically
 * to the shipped F16 stdio agent (below, unchanged). `--daemon` dispatches to
 * `daemon-server.ts`'s `runDaemon` (the persistent listener); `--attach` dispatches to
 * `bridge.ts`'s `runBridge` (the byte-transparent bridge). Usage errors (mutually exclusive mode
 * flags, a bad `--idle-timeout-ms`, an empty `--socket=`, unknown flags) stay exactly the
 * existing shape: usage on stderr, exit 2, nothing on stdout.
 *
 * Default-mode stdio contract (unchanged): stdin carries inbound protocol bytes; stdout carries
 * outbound frames and NOTHING else (every diagnostic goes to stderr). Exit codes: 0 clean (stdin
 * ended), 1 protocol-fatal (handshake failure / fatal framing / outbound encode-write failure),
 * 2 CLI usage.
 *
 * Shutdown never calls process.exit(): on Windows pipes, std stream writes are asynchronous
 * and process.exit() can drop them (the handshake-failure diagnostic would race the exit).
 * Instead the exit code is set, stdin is destroyed, and the process exits naturally once the
 * pending stdio writes flush (the StatusEngine tick is unref'd; panes were killed by the
 * session's shutdown path). `--daemon`/`--attach` mirror this discipline in their own modules.
 */
import { createFrameDecoder, encodeFrame } from '@shared/remote/protocol'
import type { WireFrame } from '@shared/remote/protocol'
import { parseAgentArgs } from './args'
import { AGENT_VERSION } from './version'
import { createAgentSession } from './session'
import { createFakePtyBackend } from './fake-backend'
import { createNodePtyBackend } from './node-pty-backend'
import type { AgentPtyBackend } from './pty-backend'
import { runDaemon } from './daemon-server'
import { runBridge } from './bridge'
import { BRIDGE_DAEMON_UNREACHABLE_EXIT } from './daemon-constants'

const stderrLine = (text: string): void => { process.stderr.write(`${text}\n`) }

const resolveHomeDir = (): string =>
  process.env.HOME && process.env.HOME.length > 0 ? process.env.HOME : process.cwd()

const main = async (): Promise<void> => {
  const parsed = parseAgentArgs(process.argv.slice(2))
  if (!parsed.ok) {
    stderrLine(parsed.usage)
    process.exitCode = 2
    return
  }

  if (parsed.mode === 'attach') {
    try {
      await runBridge({
        ptyBackend: parsed.ptyBackend,
        ...(parsed.wsToken !== undefined ? { wsToken: parsed.wsToken } : {}),
        ...(parsed.socketPath !== undefined ? { socketPath: parsed.socketPath } : {}),
        ...(parsed.idleTimeoutMs !== undefined ? { idleTimeoutMs: parsed.idleTimeoutMs } : {})
      })
    } catch (e) {
      stderrLine(`bridge failed: ${String(e)}`)
      process.exitCode = BRIDGE_DAEMON_UNREACHABLE_EXIT
    }
    return
  }

  let backend: AgentPtyBackend
  if (parsed.ptyBackend === 'fake') {
    backend = createFakePtyBackend()
  } else {
    try {
      backend = await createNodePtyBackend() // lazy node-pty load happens HERE, on selection only
    } catch (e) {
      stderrLine(`failed to load the node-pty backend: ${String(e)} - the v1 real backend targets Linux; use --pty=fake for the scripted backend`)
      process.exitCode = 1
      return
    }
  }

  if (parsed.mode === 'daemon') {
    try {
      await runDaemon({
        version: AGENT_VERSION,
        backend,
        ptyBackendName: parsed.ptyBackend,
        homeDir: resolveHomeDir(),
        ...(parsed.wsToken !== undefined ? { wsToken: parsed.wsToken } : {}),
        ...(parsed.socketPath !== undefined ? { socketPath: parsed.socketPath } : {}),
        ...(parsed.idleTimeoutMs !== undefined ? { idleTimeoutMs: parsed.idleTimeoutMs } : {})
      })
    } catch (e) {
      stderrLine(`daemon failed: ${String(e)}`)
      process.exitCode = 1
    }
    return
  }

  // Default mode: the F16 stdio agent, byte-identical.
  let exiting = false
  const finish = (code: number): void => {
    if (exiting) return
    exiting = true
    process.exitCode = code
    process.stdin.destroy() // release the loop; pending stdout/stderr writes still flush
  }

  const session = createAgentSession({
    version: AGENT_VERSION,
    backend,
    homeDir: resolveHomeDir(),
    send: (frame: WireFrame) => {
      try {
        process.stdout.write(encodeFrame(frame))
      } catch (e) {
        // An unencodable outbound frame is an agent bug and MUST be fatal, never silent.
        stderrLine(`fatal: failed to encode/write an outbound frame: ${String(e)}`)
        finish(1)
      }
    },
    diag: stderrLine,
    shutdown: finish
  })

  const decoder = createFrameDecoder()
  // stdout write failures surface as an async 'error' event (EPIPE when the client dies), not
  // via `send`'s try/catch — zero listeners would be an uncaughtException. A dead stdout means
  // the connection is over: end input, same as the stdin end/error paths below.
  process.stdout.on('error', () => session.endOfInput())
  session.start() // the agent hello is the first bytes on stdout (REQ-004)

  process.stdin.on('data', (chunk: Buffer) => {
    let items
    try {
      items = decoder.push(chunk)
    } catch {
      return // decoder-dead after a fatal item — the session already initiated shutdown
    }
    for (const item of items) session.onItem(item)
  })
  process.stdin.on('end', () => session.endOfInput())
  process.stdin.on('error', () => session.endOfInput())
}

void main()
