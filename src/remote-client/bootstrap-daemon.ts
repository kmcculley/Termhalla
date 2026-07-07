/**
 * The daemon-flow connect leg (feature 0024-agent-daemonization, REQ-009/010/011/012/013): the
 * SAME F15 client-handshake machinery `connectAgent` uses, over the REQ-009 daemon-flow launch
 * command instead of the F19 direct-exec probe, folding the extended `daemon-version-drift`
 * classification into the EXISTING `ConnectResult`/`ConnectFailureKind` vocabulary (REQ-013:
 * `ConnectFailureKind` itself stays unchanged). `opts.signal` aborts cover the bridge launch and
 * the daemon spawn-wait exactly like `connectAgent`/`provisionAgent`'s abort seams.
 *
 * Mirrors `connectAgent` closely by necessity (same F15 sequencing, same abort/teardown
 * discipline) — the ONLY behavioral differences are the launch command (REQ-009) and the
 * classifier (REQ-012, via the parsed `TERMHALLA_BRIDGE_V1` status line).
 */
import { createFrameDecoder, createDaemonClientHandshake, encodeFrame, WIRE_PROTO } from '@shared/remote/protocol'
import type { WireFrame, DecodedItem } from '@shared/remote/protocol'
import {
  buildDaemonAgentLaunchCommand, buildSshExecArgv, remoteAgentInstallPath, LAUNCH_ABSENT_EXIT
} from './ssh-command'
import { deriveWsToken } from './ws-token'
import { spawnSsh, DEFAULT_SSH_PROGRAM } from './ssh-spawn'
import { parseBridgeStatus, BRIDGE_STATUS_PREFIX } from './bridge-status'
import { classifyDaemonConnectOutcome } from './classify'
import type { AgentSessionHandle, BootstrapOptions, ConnectResult } from './bootstrap'

const STDERR_TAIL_CHARS = 400

/** Strip C0/C1 control bytes (including ESC) so remote stderr can never smuggle terminal
 *  escape sequences into diagnostic strings (the F19 FINDING-001 posture). Built from char
 *  codes rather than a literal escape range in source text (kept identical in spirit to
 *  bootstrap.ts's own helper; duplicated rather than imported to avoid a runtime circular
 *  import between bootstrap.ts and this module). */
const CONTROL_CHARS_RE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]+`,
  'g'
)
const sanitizeStderr = (text: string): string => text.replace(CONTROL_CHARS_RE, ' ')

const FRAMING_REASONS = new Set(['bad-json', 'bad-message', 'frame-too-large', 'decoder-dead'])

const RC_NOISE_HINT =
  ' (a classic cause: the remote login shell prints to stdout on non-interactive exec — e.g. an echo in a shell rc file — corrupting the frame stream before the agent hello; silence the rc output for non-interactive shells)'

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Launch the daemon-flow bridge (spawn-then-attach OR attach-to-existing, decided remotely by
 *  the bridge itself) and run the F15 client handshake over it (REQ-009/010/011). */
export async function connectDaemonAgent(opts: BootstrapOptions): Promise<ConnectResult> {
  // The workspace scope (locked D6′): the same workspace derives the same token on every
  // reconnect ⇒ the same ws-keyed socket. Distinct workspaces ⇒ distinct daemons (REQ-018).
  const wsToken = deriveWsToken(opts.daemon?.workspaceId ?? '')
  let installPath: string
  let argv: string[]
  try {
    installPath = remoteAgentInstallPath(opts.agent.remoteAgentDir, opts.version)
    argv = buildSshExecArgv(opts.agent, buildDaemonAgentLaunchCommand(installPath, opts.ptyBackend ?? 'node-pty', wsToken))
  } catch (e) {
    return { ok: false, kind: 'fatal', diagnostic: errText(e) }
  }
  if (opts.signal?.aborted) {
    return { ok: false, kind: 'aborted', diagnostic: 'connect aborted by the caller before the ssh child was spawned' }
  }

  return await new Promise<ConnectResult>((resolvePromise) => {
    const child = spawnSsh(opts.ssh, argv)
    const decoder = createFrameDecoder()
    // The daemon-flow (relaxed) client handshake: establishes on wire-protocol compatibility only,
    // app version advisory (D4′) — a routine auto-update reattaches, and only a genuine
    // proto-mismatch surfaces (routed to the daemon-protocol-drift classification).
    const handshake = createDaemonClientHandshake({ version: opts.version })
    const frameSubs = new Set<(frame: WireFrame) => void>()
    const exitSubs = new Set<(code: number | null) => void>()
    let stderrTail = ''
    // FINDING-017: the bridge status line is parsed from a RAW, newline-preserving accumulation —
    // never the sanitized `stderrTail` (whose control-char stripping collapses newlines, which
    // would merge the status line with a preceding diagnostic and blank the parse).
    let stderrRaw = ''
    let sawAnyFrame = false
    let established = false
    let settled = false
    // The handshake machine is single-use: once its one inbound frame is consumed (ok OR failed),
    // no later stdout frame may re-feed it.
    let handshakeConsumed = false
    // A handshake failure whose classification is WAITING for the bridge status line to arrive on
    // stderr (the daemon-flow status line is written before the first stdout byte, but stdout and
    // stderr are independent pipes — the daemon hello can reach us first). REQ-012/FINDING-017: the
    // proto-drift diagnostic must name the REAL daemon proto/version, not the "unknown" fallback.
    let pendingFail: { handshakeFailureKind?: string; exitCode?: number | null } | null = null
    let failTimer: ReturnType<typeof setTimeout> | null = null

    const diag = (line: string): void => {
      try {
        opts.onDiagnostic?.(line)
      } catch {
        /* a consumer error never breaks the tunnel */
      }
    }

    const teardownChild = (): void => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }

    const removeAbort = (): void => { opts.signal?.removeEventListener('abort', onAbort) }
    const settle = (r: ConnectResult): void => {
      if (settled) return
      settled = true
      if (failTimer !== null) { clearTimeout(failTimer); failTimer = null }
      pendingFail = null
      removeAbort()
      if (!r.ok) teardownChild()
      resolvePromise(r)
    }
    function onAbort(): void {
      settle({
        ok: false, kind: 'aborted',
        diagnostic: 'connect aborted by the caller before establishment — the ssh child was killed; nothing was written remotely'
      })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    /** Classify the observed outcome and settle. Reads the bridge status line from the RAW,
     *  newline-preserving stderr accumulation (FINDING-017). */
    const classifyAndSettle = (extra: { handshakeFailureKind?: string; exitCode?: number | null }): void => {
      const bridgeStatus = parseBridgeStatus(stderrRaw)
      const c = classifyDaemonConnectOutcome({
        sawAnyFrame,
        exitCode: extra.exitCode ?? null,
        stderrExcerpt: stderrTail,
        bridgeStatus,
        expectedVersion: opts.version,
        expectedProto: WIRE_PROTO,
        wsToken,
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
      } else if (c.kind === 'daemon-protocol-drift') {
        // Folded into the EXISTING `fatal` row (REQ-012/REQ-013: `ConnectFailureKind` stays
        // unchanged) — non-destructive: no daemon kill, no socket removal, no upload retry.
        settle({ ok: false, kind: 'fatal', diagnostic: c.diagnostic })
      } else {
        const hint = extra.handshakeFailureKind !== undefined && FRAMING_REASONS.has(extra.handshakeFailureKind)
          ? RC_NOISE_HINT
          : ''
        settle({ ok: false, kind: 'fatal', diagnostic: `${c.diagnostic}${hint}` })
      }
    }

    /** A HANDSHAKE failure whose status line hasn't arrived on stderr yet waits a bounded window
     *  (the status line is written before the first stdout byte, but the pipes are independent) so
     *  proto-drift is classified from the REAL daemon proto/version. The stderr handler settles it
     *  the moment the line lands; this timer is only the backstop. Exit-code failures classify
     *  immediately (there is no status line to wait for). */
    const failFrom = (extra: { handshakeFailureKind?: string; exitCode?: number | null }): void => {
      if (settled) return
      if (extra.handshakeFailureKind !== undefined && parseBridgeStatus(stderrRaw) === null) {
        pendingFail = extra
        if (failTimer === null) {
          failTimer = setTimeout(() => {
            failTimer = null
            const p = pendingFail
            pendingFail = null
            if (p !== null) classifyAndSettle(p)
          }, 1000)
        }
        return
      }
      classifyAndSettle(extra)
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
      const clean = sanitizeStderr(text)
      // RAW, newline-preserving — the bridge status-line parse input (FINDING-017). Consulted
      // only until the connect settles, so STOP accumulating then: this stream is
      // remote-controlled and the established connection lives for days (2026-07-06
      // quality-audit Group B #7 — the probe-stdout FINDING-010 posture).
      if (!settled) stderrRaw += text
      stderrTail = (stderrTail + clean).slice(-STDERR_TAIL_CHARS)
      // A handshake failure was deferred waiting for the status line — settle it now that it landed.
      if (pendingFail !== null && parseBridgeStatus(stderrRaw) !== null) {
        const p = pendingFail
        pendingFail = null
        if (failTimer !== null) { clearTimeout(failTimer); failTimer = null }
        classifyAndSettle(p)
      }
      for (const line of text.split('\n')) {
        const trimmed = sanitizeStderr(line).trim()
        if (trimmed.length > 0 && !trimmed.startsWith(BRIDGE_STATUS_PREFIX.trim())) diag(trimmed)
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
          // The handshake machine is single-use; a deferred failure (awaiting the stderr status
          // line) must not re-feed it with a later frame.
          if (handshakeConsumed) continue
          handshakeConsumed = true
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
