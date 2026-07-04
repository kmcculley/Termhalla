/**
 * The agent entry — the ONLY impure shell (REQ-003, REQ-011, REQ-013).
 *
 * stdio contract: stdin carries inbound protocol bytes; stdout carries outbound frames and
 * NOTHING else (every diagnostic goes to stderr). Exit codes: 0 clean (stdin ended), 1
 * protocol-fatal (handshake failure / fatal framing / outbound encode-write failure), 2 CLI
 * usage.
 *
 * Shutdown never calls process.exit(): on Windows pipes, std stream writes are asynchronous
 * and process.exit() can drop them (the handshake-failure diagnostic would race the exit).
 * Instead the exit code is set, stdin is destroyed, and the process exits naturally once the
 * pending stdio writes flush (the StatusEngine tick is unref'd; panes were killed by the
 * session's shutdown path).
 */
import { createFrameDecoder, encodeFrame } from '@shared/remote/protocol'
import type { WireFrame } from '@shared/remote/protocol'
import { parseAgentArgs } from './args'
import { AGENT_VERSION } from './version'
import { createAgentSession } from './session'
import { createFakePtyBackend } from './fake-backend'
import { createNodePtyBackend } from './node-pty-backend'
import type { AgentPtyBackend } from './pty-backend'

const stderrLine = (text: string): void => { process.stderr.write(`${text}\n`) }

const main = async (): Promise<void> => {
  const parsed = parseAgentArgs(process.argv.slice(2))
  if (!parsed.ok) {
    stderrLine(parsed.usage)
    process.exitCode = 2
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
    homeDir: process.env.HOME && process.env.HOME.length > 0 ? process.env.HOME : process.cwd(),
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
