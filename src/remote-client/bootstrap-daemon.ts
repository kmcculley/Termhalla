/**
 * The daemon-flow connect leg (feature 0024-agent-daemonization, REQ-009/010/011/012/013): the
 * SAME shared connect pump `connectAgent` uses (`connect-pump.ts` — the 0024 FINDING-001
 * consolidation), over the REQ-009 daemon-flow launch command instead of the F19 direct-exec
 * probe, folding the extended `daemon-version-drift` classification into the EXISTING
 * `ConnectResult`/`ConnectFailureKind` vocabulary (REQ-013: `ConnectFailureKind` itself stays
 * unchanged). `opts.signal` aborts cover the bridge launch and the daemon spawn-wait exactly
 * like `connectAgent`/`provisionAgent`'s abort seams.
 *
 * The ONLY behavioral differences from `connectAgent` are injected through the pump spec: the
 * launch command (REQ-009), the daemon-relaxed handshake machine, the classifier (REQ-012, via
 * the parsed `TERMHALLA_BRIDGE_V1` status line), and the stderr status-line plumbing below.
 */
import { createDaemonClientHandshake, WIRE_PROTO } from '@shared/remote/protocol'
import {
  buildDaemonAgentLaunchCommand, buildSshExecArgv, remoteAgentInstallPath
} from './ssh-command'
import { deriveWsToken } from './ws-token'
import { errText } from './exec-channel'
import { runConnectPump, connectFailureResult } from './connect-pump'
import { parseBridgeStatus, BRIDGE_STATUS_PREFIX } from './bridge-status'
import { classifyDaemonConnectOutcome } from './classify'
import type { BootstrapOptions, ConnectResult } from './bootstrap'

/** How long a HANDSHAKE failure waits for the bridge status line to land on stderr before
 *  classification falls back to the "unknown daemon proto/version" wording (the status line is
 *  written before the first stdout byte, but stdout and stderr are independent pipes — the
 *  daemon hello can reach us first; REQ-012/FINDING-017). */
const BRIDGE_STATUS_WAIT_MS = 1000

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

  // FINDING-017: the bridge status line is parsed from a RAW, newline-preserving accumulation —
  // never the pump's sanitized stderr tail (whose control-char stripping collapses newlines,
  // which would merge the status line with a preceding diagnostic and blank the parse). The pump
  // feeds it only until the connect settles (2026-07-06 quality-audit Group B #7 — the
  // probe-stdout FINDING-010 posture: the stream is remote-controlled and an established
  // connection lives for days).
  let stderrRaw = ''

  return await runConnectPump({
    argv, ssh: opts.ssh, signal: opts.signal, version: opts.version, onDiagnostic: opts.onDiagnostic,
    // The daemon-flow (relaxed) client handshake: establishes on wire-protocol compatibility only,
    // app version advisory (D4′) — a routine auto-update reattaches, and only a genuine
    // proto-mismatch surfaces (routed to the daemon-protocol-drift classification).
    handshake: createDaemonClientHandshake({ version: opts.version }),
    onStderrText: (text) => { stderrRaw += text },
    // A HANDSHAKE failure waits (bounded) for the status line so proto-drift is classified from
    // the REAL daemon proto/version, not the "unknown" fallback. Exit-code failures classify
    // immediately (there is no status line to wait for).
    deferHandshakeFailure: () => parseBridgeStatus(stderrRaw) === null,
    deferMs: BRIDGE_STATUS_WAIT_MS,
    // The status line is protocol plumbing, not a diagnostic for the consumer.
    diagLineFilter: (trimmed) => !trimmed.startsWith(BRIDGE_STATUS_PREFIX.trim()),
    classifyFailure: (extra, obs) => connectFailureResult(
      classifyDaemonConnectOutcome({
        sawAnyFrame: obs.sawAnyFrame,
        exitCode: extra.exitCode ?? null,
        stderrExcerpt: obs.stderrTail,
        bridgeStatus: parseBridgeStatus(stderrRaw),
        expectedVersion: opts.version,
        expectedProto: WIRE_PROTO,
        wsToken,
        ...(extra.handshakeFailureKind !== undefined ? { handshakeFailureKind: extra.handshakeFailureKind } : {})
      }),
      extra.handshakeFailureKind, installPath, opts.version
    )
  })
}
