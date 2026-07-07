/**
 * The ONE ssh connect pump (0024 FINDING-001, fixed in the 2026-07-06 quality-audit Group C
 * pass): `connectAgent` (direct-exec) and `connectDaemonAgent` (bridge/daemon flow) used to be
 * ~140-line near-identical copies of the same spawn → decode → F15-handshake → session-handle
 * pump, already drifting (the single-use handshake guard existed only in the daemon copy). This
 * module owns the pump once; the two connect legs differ ONLY in the launch command, the
 * handshake machine (exact-version vs daemon-relaxed), the failure classifier, and the daemon's
 * stderr status-line plumbing — all injected through `ConnectPumpSpec`.
 *
 * The protocol machinery is REUSED from the one sanctioned barrel — never re-derived: the
 * client emits NOTHING until the agent hello arrives, and the reply frame comes from the
 * injected handshake machine (no hand-built hellos anywhere in this tree; frozen TEST-2005).
 */
import { createFrameDecoder, encodeFrame } from '@shared/remote/protocol'
import type { WireFrame, DecodedItem, ClientHandshake } from '@shared/remote/protocol'
import { spawnSsh, DEFAULT_SSH_PROGRAM } from './ssh-spawn'
import type { SshProgramOverride } from './ssh-spawn'
import { LAUNCH_ABSENT_EXIT } from './ssh-command'
import { STDERR_TAIL_CHARS, sanitizeStderr, errText } from './exec-channel'

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

/** Decode-level failure reasons whose classic real-world cause is a shell rc file printing
 *  to stdout on non-interactive exec, corrupting the frame stream (FINDING-006). */
const FRAMING_REASONS = new Set(['bad-json', 'bad-message', 'frame-too-large', 'decoder-dead'])

const RC_NOISE_HINT =
  ' (a classic cause: the remote login shell prints to stdout on non-interactive exec — e.g. an echo in a shell rc file — corrupting the frame stream before the agent hello; silence the rc output for non-interactive shells)'

/** The failure context the pump observes: the handshake machine's failure kind and/or the
 *  child's exit code (one of the two is always present). */
export interface FailureExtra {
  handshakeFailureKind?: string
  exitCode?: number | null
}

/** Map a connect-outcome classification to the standard `ConnectResult` wording shared by both
 *  connect legs: the provisionable rows (`absent` / `version-mismatch`) get the F19 wording,
 *  the daemon's `daemon-protocol-drift` folds into `fatal` verbatim (REQ-013: the kind union
 *  never widens), and a framing-class handshake failure gets the rc-noise hint. */
export function connectFailureResult(
  c:
    | { kind: 'absent' }
    | { kind: 'version-mismatch' }
    | { kind: 'fatal'; diagnostic: string }
    | { kind: 'daemon-protocol-drift'; diagnostic: string },
  handshakeFailureKind: string | undefined,
  installPath: string,
  version: string
): ConnectResult {
  if (c.kind === 'absent') {
    return {
      ok: false, kind: 'absent',
      diagnostic: `no agent artifact at ${installPath} (launch probe exited ${LAUNCH_ABSENT_EXIT} with no output) — provisioning will upload the bundled build`
    }
  }
  if (c.kind === 'version-mismatch') {
    return {
      ok: false, kind: 'version-mismatch',
      diagnostic: `the installed agent does not string-match client version "${version}" (version-locked handshake) — provisioning will upload the matching build`
    }
  }
  if (c.kind === 'daemon-protocol-drift') {
    // Non-destructive: no daemon kill, no socket removal, no upload retry (0024 REQ-012).
    return { ok: false, kind: 'fatal', diagnostic: c.diagnostic }
  }
  const hint = handshakeFailureKind !== undefined && FRAMING_REASONS.has(handshakeFailureKind)
    ? RC_NOISE_HINT
    : ''
  return { ok: false, kind: 'fatal', diagnostic: `${c.diagnostic}${hint}` }
}

export interface ConnectPumpSpec {
  argv: string[]
  ssh?: SshProgramOverride
  signal?: AbortSignal
  /** The client's own version — stamped on the session handle (string-identical to the agent's
   *  under the exact-version handshake; advisory under the daemon-relaxed one). */
  version: string
  onDiagnostic?: (line: string) => void
  /** The single-use F15 client handshake machine (exact-version or daemon-relaxed — the two
   *  interfaces are structurally identical). */
  handshake: ClientHandshake
  /** Map an observed failure to the settle result (each leg runs its own classifier over the
   *  bounded sanitized stderr tail; `connectFailureResult` owns the shared wording). */
  classifyFailure: (extra: FailureExtra, obs: { sawAnyFrame: boolean; stderrTail: string }) => ConnectResult
  /** Daemon seam: when a HANDSHAKE failure lands and this returns true, classification WAITS —
   *  re-consulted on every stderr chunk, force-classified after `deferMs` — so the daemon flow
   *  can classify proto drift from the REAL bridge status line (stdout and stderr are
   *  independent pipes; the hello can beat the status line). Exit-code failures never defer. */
  deferHandshakeFailure?: () => boolean
  deferMs?: number
  /** RAW (unsanitized, newline-preserving) stderr observer — called only until settle (the
   *  daemon flow accumulates its status-line parse input here; 2026-07-06 audit Group B #7). */
  onStderrText?: (text: string) => void
  /** Per-line stderr diagnostic filter over the sanitized+trimmed line (default: surface every
   *  non-empty line; the daemon flow filters its bridge status line out). */
  diagLineFilter?: (trimmedLine: string) => boolean
}

/** Launch an agent over one ssh exec channel and run the F15 client handshake to a live
 *  session handle (or a classified failure). Owns the full pump: child spawn, abort wiring,
 *  bounded stderr tail + per-line diagnostics, frame decode, single-use handshake, session
 *  construction, exit fan-out, teardown-on-failure. */
export async function runConnectPump(spec: ConnectPumpSpec): Promise<ConnectResult> {
  if (spec.signal?.aborted) {
    return { ok: false, kind: 'aborted', diagnostic: 'connect aborted by the caller before the ssh child was spawned' }
  }

  return await new Promise<ConnectResult>((resolvePromise) => {
    const child = spawnSsh(spec.ssh, spec.argv)
    const decoder = createFrameDecoder()
    const frameSubs = new Set<(frame: WireFrame) => void>()
    const exitSubs = new Set<(code: number | null) => void>()
    let stderrTail = ''
    let sawAnyFrame = false
    let established = false
    let settled = false
    // The handshake machine is single-use: once its one inbound frame is consumed (ok OR
    // failed), no later stdout frame may re-feed it (load-bearing when a failure defers).
    let handshakeConsumed = false
    // A deferred handshake failure waiting on `deferHandshakeFailure` (the daemon's bridge
    // status line); the stderr handler settles it the moment the gate opens, the timer is only
    // the backstop.
    let pendingFail: FailureExtra | null = null
    let failTimer: ReturnType<typeof setTimeout> | null = null

    const diag = (line: string): void => {
      try { spec.onDiagnostic?.(line) } catch { /* a consumer error never breaks the tunnel */ }
    }

    const teardownChild = (): void => {
      try { child.kill() } catch { /* already gone */ }
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }

    const removeAbort = (): void => { spec.signal?.removeEventListener('abort', onAbort) }
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
    spec.signal?.addEventListener('abort', onAbort, { once: true })

    const classifyAndSettle = (extra: FailureExtra): void => {
      settle(spec.classifyFailure(extra, { sawAnyFrame, stderrTail }))
    }

    const failFrom = (extra: FailureExtra): void => {
      if (settled) return
      if (extra.handshakeFailureKind !== undefined && spec.deferHandshakeFailure?.() === true) {
        pendingFail = extra
        if (failTimer === null) {
          failTimer = setTimeout(() => {
            failTimer = null
            const p = pendingFail
            pendingFail = null
            if (p !== null) classifyAndSettle(p)
          }, spec.deferMs ?? 1000)
        }
        return
      }
      classifyAndSettle(extra)
    }

    child.on('error', (e) => {
      settle({
        ok: false, kind: 'fatal',
        diagnostic: `failed to spawn the ssh program "${spec.ssh?.program ?? DEFAULT_SSH_PROGRAM}": ${errText(e)} — is it on PATH?`
      })
    })
    child.stdin.on('error', () => { /* EPIPE on a dying child; the exit path reports */ })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (!settled) spec.onStderrText?.(text)
      stderrTail = (stderrTail + sanitizeStderr(text)).slice(-STDERR_TAIL_CHARS)
      // A deferred handshake failure settles the moment its gate opens (the daemon's bridge
      // status line just landed on this chunk).
      if (pendingFail !== null && spec.deferHandshakeFailure?.() !== true) {
        const p = pendingFail
        pendingFail = null
        if (failTimer !== null) { clearTimeout(failTimer); failTimer = null }
        classifyAndSettle(p)
      }
      for (const line of text.split('\n')) {
        const trimmed = sanitizeStderr(line).trim()
        if (trimmed.length > 0 && (spec.diagLineFilter?.(trimmed) ?? true)) diag(trimmed)
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
          // Single-use machine; a deferred failure must not re-feed it with a later frame.
          if (handshakeConsumed) continue
          handshakeConsumed = true
          if (item.kind === 'message') {
            const r = spec.handshake.onMessage(item.frame)
            if (r.ok) {
              try {
                child.stdin.write(encodeFrame(r.reply))
              } catch (e) {
                settle({ ok: false, kind: 'fatal', diagnostic: `failed to send the handshake reply: ${errText(e)}` })
                return
              }
              established = true
              const session: AgentSessionHandle = {
                version: spec.version,
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
