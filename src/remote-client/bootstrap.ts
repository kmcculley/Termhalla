/**
 * Client-provisioned agent bootstrap over the system-ssh exec channel (REQ-010..REQ-016).
 *
 * connect → F15 client handshake over the child's stdio → classify any failure →
 * (provision: stream the bundled artifact, size-verified, atomically promoted → retry
 * exactly ONCE) → a live session handle or a specific, actionable failure.
 *
 * Version-lock (REQ-015, locked decision 2): ONE canonical `version` input drives BOTH
 * the handshake identity check and the remote install path. The caller injects it
 * together with the artifact path (in production: the repo manifest version paired with
 * the `out/agent/termhalla-agent.cjs` bundle, whose AGENT_VERSION was inlined from the
 * same manifest at build time — the artifact is the unit of version-locking). This module
 * never reads the manifest itself.
 *
 * The F15 machinery is REUSED from the one sanctioned barrel — never re-derived: the
 * client emits NOTHING until the agent hello arrives, and the reply frame comes from the
 * handshake machine (no hand-built hellos anywhere in this tree; frozen TEST-2005).
 */
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createFrameDecoder, createClientHandshake, encodeFrame } from '@shared/remote/protocol'
import type { WireFrame, DecodedItem } from '@shared/remote/protocol'
import {
  buildAgentLaunchCommand, buildAgentUploadCommand, buildSshExecArgv,
  remoteAgentInstallPath, LAUNCH_ABSENT_EXIT, UPLOAD_SIZE_MISMATCH_EXIT
} from './ssh-command'
import type { SshExecSeed } from './ssh-command'
import { spawnSsh, DEFAULT_SSH_PROGRAM } from './ssh-spawn'
import type { SshProgramOverride } from './ssh-spawn'
import { classifyConnectOutcome } from './classify'

const STDERR_TAIL_CHARS = 400

/** Strip C0/C1 control bytes (including ESC) so remote stderr can never smuggle terminal
 *  escape sequences into diagnostic strings a UI will later render (FINDING-001). The
 *  printable remainder of a stripped sequence is harmless residue. */
const sanitizeStderr = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')

/** Decode-level failure reasons whose classic real-world cause is a shell rc file printing
 *  to stdout on non-interactive exec, corrupting the frame stream (FINDING-006). */
const FRAMING_REASONS = new Set(['bad-json', 'bad-message', 'frame-too-large', 'decoder-dead'])

const RC_NOISE_HINT =
  ' (a classic cause: the remote login shell prints to stdout on non-interactive exec — e.g. an echo in a shell rc file — corrupting the frame stream before the agent hello; silence the rc output for non-interactive shells)'

/** Crypto-random temp-file nonce (REQ-013); injectable via `options.nonce` for
 *  deterministic tests. 16 lowercase hex chars. */
export const defaultNonce = (): string => randomBytes(8).toString('hex')

export interface AgentSessionHandle {
  /** The agent's version — string-identical to the injected client version. */
  version: string
  capabilities: string[]
  send(frame: WireFrame): void
  onFrame(cb: (frame: WireFrame) => void): () => void
  onExit(cb: (code: number | null) => void): () => void
  kill(): void
}

export type ConnectFailureKind =
  | 'absent' | 'version-mismatch' | 'fatal' | 'aborted' | 'provision-ineffective'

export type ConnectResult =
  | { ok: true; session: AgentSessionHandle }
  | { ok: false; kind: ConnectFailureKind; diagnostic: string; indeterminate?: boolean }

export type ProvisionResult =
  | { ok: true }
  | {
      ok: false
      kind: 'size-mismatch' | 'transport' | 'aborted' | 'other'
      exitCode: number | null
      diagnostic: string
      indeterminate?: boolean
    }

export interface BootstrapOptions {
  agent: SshExecSeed
  /** The ONE canonical version: handshake identity AND install path (REQ-015). */
  version: string
  /** Local path of the bundled agent artifact (required for provisioning). */
  artifactPath?: string
  /** Backend flag passed to the agent CLI (F16 contract). Default: the real backend. */
  ptyBackend?: 'node-pty' | 'fake'
  /** Test seam: substitute the ssh program (default: the system `ssh` on PATH). */
  ssh?: SshProgramOverride
  nonce?: () => string
  signal?: AbortSignal
  onDiagnostic?: (line: string) => void
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Launch the (expected) installed agent and run the F15 client handshake (REQ-010/011). */
export async function connectAgent(opts: BootstrapOptions): Promise<ConnectResult> {
  let installPath: string
  let argv: string[]
  try {
    installPath = remoteAgentInstallPath(opts.agent.remoteAgentDir, opts.version)
    argv = buildSshExecArgv(opts.agent, buildAgentLaunchCommand(installPath, opts.ptyBackend ?? 'node-pty'))
  } catch (e) {
    return { ok: false, kind: 'fatal', diagnostic: errText(e) }
  }
  if (opts.signal?.aborted) {
    return { ok: false, kind: 'aborted', diagnostic: 'connect aborted by the caller before the ssh child was spawned' }
  }

  return await new Promise<ConnectResult>((resolvePromise) => {
    const child = spawnSsh(opts.ssh, argv)
    const decoder = createFrameDecoder()
    const handshake = createClientHandshake({ version: opts.version })
    const frameSubs = new Set<(frame: WireFrame) => void>()
    const exitSubs = new Set<(code: number | null) => void>()
    let stderrTail = ''
    let sawAnyFrame = false
    let established = false
    let settled = false

    const diag = (line: string): void => {
      try { opts.onDiagnostic?.(line) } catch { /* a consumer error never breaks the tunnel */ }
    }

    const teardownChild = (): void => {
      try { child.kill() } catch { /* already gone */ }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }

    const removeAbort = (): void => { opts.signal?.removeEventListener('abort', onAbort) }
    const settle = (r: ConnectResult): void => {
      if (settled) return
      settled = true
      removeAbort()
      if (!r.ok) teardownChild()
      resolvePromise(r)
    }
    function onAbort(): void {
      settle({ ok: false, kind: 'aborted', diagnostic: 'connect aborted by the caller before establishment — the ssh child was killed; nothing was written remotely' })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const failFrom = (extra: { handshakeFailureKind?: string; exitCode?: number | null }): void => {
      const c = classifyConnectOutcome({
        sawAnyFrame,
        exitCode: extra.exitCode ?? null,
        stderrExcerpt: stderrTail,
        ...(extra.handshakeFailureKind !== undefined ? { handshakeFailureKind: extra.handshakeFailureKind } : {})
      })
      if (c.kind === 'absent') {
        settle({
          ok: false, kind: 'absent',
          diagnostic: `no agent artifact at ${installPath} (launch probe exited ${LAUNCH_ABSENT_EXIT} with no output) — provisioning will upload the bundled build`
        })
      } else if (c.kind === 'version-mismatch') {
        settle({
          ok: false, kind: 'version-mismatch',
          diagnostic: `the installed agent does not string-match client version "${opts.version}" (version-locked handshake) — provisioning will upload the matching build`
        })
      } else {
        const hint = extra.handshakeFailureKind !== undefined && FRAMING_REASONS.has(extra.handshakeFailureKind)
          ? RC_NOISE_HINT
          : ''
        settle({ ok: false, kind: 'fatal', diagnostic: `${c.diagnostic}${hint}` })
      }
    }

    child.on('error', (e) => {
      settle({
        ok: false, kind: 'fatal',
        diagnostic: `failed to spawn the ssh program "${opts.ssh?.program ?? DEFAULT_SSH_PROGRAM}": ${errText(e)} — is it on PATH?`
      })
    })
    child.stdin.on('error', () => { /* EPIPE on a dying child; the exit path reports */ })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderrTail = (stderrTail + sanitizeStderr(text)).slice(-STDERR_TAIL_CHARS)
      for (const line of text.split('\n')) {
        const clean = sanitizeStderr(line).trim()
        if (clean.length > 0) diag(clean)
      }
    })

    child.stdout.on('data', (chunk: Buffer) => {
      let items: DecodedItem[]
      try {
        items = decoder.push(chunk)
      } catch {
        return // decoder is dead after a fatal item — that item already routed to failFrom
      }
      for (const item of items) {
        sawAnyFrame = true
        if (settled && !established) continue
        if (!established) {
          if (item.kind === 'message') {
            const r = handshake.onMessage(item.frame)
            if (r.ok) {
              try {
                child.stdin.write(encodeFrame(r.reply))
              } catch (e) {
                settle({ ok: false, kind: 'fatal', diagnostic: `failed to send the handshake reply: ${errText(e)}` })
                return
              }
              established = true
              const session: AgentSessionHandle = {
                version: opts.version,
                capabilities: [...r.capabilities],
                send: (frame: WireFrame): void => {
                  try {
                    child.stdin.write(encodeFrame(frame))
                  } catch (e) {
                    diag(`send failed (session likely closed): ${errText(e)}`)
                  }
                },
                onFrame: (cb) => { frameSubs.add(cb); return () => { frameSubs.delete(cb) } },
                onExit: (cb) => { exitSubs.add(cb); return () => { exitSubs.delete(cb) } },
                kill: teardownChild
              }
              settle({ ok: true, session })
            } else {
              failFrom({ handshakeFailureKind: r.failure.reason })
            }
          } else {
            failFrom({ handshakeFailureKind: item.error.reason })
          }
        } else if (item.kind === 'message') {
          for (const cb of [...frameSubs]) cb(item.frame)
        } else {
          diag(`dropped a malformed post-establishment item (${item.error.reason}): ${item.error.message}`)
        }
      }
    })

    child.on('exit', (code) => {
      if (!settled) failFrom({ exitCode: code })
      for (const cb of [...exitSubs]) cb(code)
    })
  })
}

/** Stream the artifact over a second exec channel; size-verified atomic promote (REQ-012). */
export async function provisionAgent(opts: BootstrapOptions): Promise<ProvisionResult> {
  if (opts.artifactPath === undefined || opts.artifactPath.length === 0) {
    return { ok: false, kind: 'other', exitCode: null, diagnostic: 'no artifactPath was provided — provisioning needs the local path of the bundled agent build' }
  }
  let bytes: Buffer
  try {
    bytes = await readFile(opts.artifactPath)
  } catch (e) {
    return { ok: false, kind: 'other', exitCode: null, diagnostic: `could not read the agent artifact at ${opts.artifactPath}: ${errText(e)}` }
  }
  let argv: string[]
  try {
    const installPath = remoteAgentInstallPath(opts.agent.remoteAgentDir, opts.version)
    const nonce = (opts.nonce ?? defaultNonce)()
    argv = buildSshExecArgv(opts.agent, buildAgentUploadCommand(installPath, bytes.length, nonce))
  } catch (e) {
    return { ok: false, kind: 'other', exitCode: null, diagnostic: errText(e) }
  }
  if (opts.signal?.aborted) {
    return { ok: false, kind: 'aborted', exitCode: null, diagnostic: 'provision aborted by the caller before the ssh child was spawned — nothing was written remotely' }
  }

  return await new Promise<ProvisionResult>((resolvePromise) => {
    const child = spawnSsh(opts.ssh, argv)
    let stderrTail = ''
    let settled = false

    const removeAbort = (): void => { opts.signal?.removeEventListener('abort', onAbort) }
    const settle = (r: ProvisionResult): void => {
      if (settled) return
      settled = true
      removeAbort()
      if (!r.ok) {
        try { child.kill() } catch { /* already gone */ }
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
      }
      resolvePromise(r)
    }
    function onAbort(): void {
      settle({
        ok: false, kind: 'aborted', exitCode: null, indeterminate: true,
        diagnostic: 'upload aborted before the remote outcome was observed — the atomic promote may or may not have completed, so the remote artifact state is INDETERMINATE (the install path holds either the previous artifact or the complete new one, never a tear); reconnect to find out'
      })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (e) => {
      settle({
        ok: false, kind: 'other', exitCode: null,
        diagnostic: `failed to spawn the ssh program "${opts.ssh?.program ?? DEFAULT_SSH_PROGRAM}" for the upload: ${errText(e)}`
      })
    })
    child.stdin.on('error', () => { /* EPIPE from an early-exiting child; exit path reports */ })
    child.stdout.on('data', () => { /* the upload command produces no stdout */ })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + sanitizeStderr(chunk.toString('utf8'))).slice(-STDERR_TAIL_CHARS)
    })
    child.on('exit', (code) => {
      if (code === 0) settle({ ok: true })
      else if (code === UPLOAD_SIZE_MISMATCH_EXIT) {
        settle({
          ok: false, kind: 'size-mismatch', exitCode: code,
          diagnostic: `the remote received a byte count different from the ${bytes.length}-byte artifact — nothing was promoted (the temp file was removed); retry the provision${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
        })
      } else if (code === 255) {
        settle({
          ok: false, kind: 'transport', exitCode: code,
          diagnostic: `ssh transport failure during the upload (exit 255) — check host reachability and auth${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
        })
      } else {
        settle({
          ok: false, kind: 'other', exitCode: code,
          diagnostic: `the upload command exited ${code === null ? 'by signal' : code}${stderrTail ? ` — stderr: ${stderrTail}` : ''}`
        })
      }
    })

    child.stdin.write(bytes)
    child.stdin.end()
  })
}

/** The bootstrap policy (REQ-014): classify → provision → retry exactly ONCE. */
export async function connectWithProvisioning(opts: BootstrapOptions): Promise<ConnectResult> {
  const first = await connectAgent(opts)
  if (first.ok) return first
  if (first.kind === 'fatal' || first.kind === 'aborted') return first

  const provision = await provisionAgent(opts)
  if (!provision.ok) {
    if (provision.kind === 'aborted') {
      return {
        ok: false, kind: 'aborted', diagnostic: provision.diagnostic,
        ...(provision.indeterminate === true ? { indeterminate: true } : {})
      }
    }
    return {
      ok: false, kind: 'fatal',
      diagnostic: `provisioning after a "${first.kind}" connect failure did not complete: ${provision.diagnostic}`
    }
  }

  const second = await connectAgent(opts)
  if (second.ok) return second
  if (second.kind === 'fatal' || second.kind === 'aborted') return second
  return {
    ok: false, kind: 'provision-ineffective',
    diagnostic: `still ${second.kind} after provisioning (first attempt: ${first.kind}; exactly one upload was applied and reported success) — the uploaded artifact did not take effect at the install path; no further attempts will be made. If both attempts classified "absent", also verify the remote host exposes a node binary on the login shell's PATH — a missing node exits ${LAUNCH_ABSENT_EXIT} exactly like a missing artifact (FINDING-004)`
  }
}
