/**
 * Connect-failure classification (REQ-011) — the pure truth table F19's provisioning
 * policy hangs on. Only two outcomes are provisionable:
 *
 *   absent           — the launch probe exited with the reserved sentinel 127 having
 *                      produced ZERO decoded frames (the artifact is not at the install
 *                      path; REQ-009 guarantees nothing was written to stdout).
 *   version-mismatch — the F15 client handshake failed with EXACTLY the kind
 *                      'version-mismatch' (the handshake header names F19 as this
 *                      consumer; the check is string identity — locked decision 2).
 *
 * EVERYTHING else is fatal and must never trigger an upload: an ssh transport/auth
 * failure (OpenSSH exits 255), any other handshake failure kind (proto-mismatch,
 * bad-hello, unexpected-frame, framing errors), a 127 that arrived AFTER frames (the
 * artifact ran — 127 came from something else), or any unexpected exit. Provisioning
 * never "fixes" an auth failure.
 *
 * Pure module: no IO — unit-tested without processes (frozen TEST-2018).
 */

export interface ConnectObservation {
  /** The F15 failure kind when the handshake machine (or the frame decoder) rejected —
   *  absent when the child died before any handshake verdict. */
  handshakeFailureKind?: string
  /** True once ANY decoded item (message or framing error) arrived on stdout. */
  sawAnyFrame: boolean
  /** The child's exit code, when it exited (null while alive / on signal). */
  exitCode: number | null
  /** Bounded tail of the child's stderr (the caller bounds it; CONV-001 diagnostics). */
  stderrExcerpt: string
}

export type ConnectClassification =
  | { kind: 'absent' }
  | { kind: 'version-mismatch' }
  | { kind: 'fatal'; diagnostic: string }

const stderrPart = (o: ConnectObservation): string =>
  o.stderrExcerpt.length > 0 ? ` — stderr: ${o.stderrExcerpt}` : ''

export const classifyConnectOutcome = (o: ConnectObservation): ConnectClassification => {
  if (o.handshakeFailureKind === 'version-mismatch') return { kind: 'version-mismatch' }
  if (o.handshakeFailureKind !== undefined && o.handshakeFailureKind.length > 0) {
    return {
      kind: 'fatal',
      diagnostic: `handshake failed (${o.handshakeFailureKind}) — the peer is not a compatible agent; provisioning cannot fix this${stderrPart(o)}`
    }
  }
  if (o.exitCode === 127 && !o.sawAnyFrame) return { kind: 'absent' }
  if (o.exitCode === 255) {
    return {
      kind: 'fatal',
      diagnostic: `ssh transport failure (exit 255) — check host reachability, auth, and ~/.ssh/config for this destination${stderrPart(o)}`
    }
  }
  return {
    kind: 'fatal',
    diagnostic: `the agent launch ended before a hello (exit ${o.exitCode === null ? 'by signal' : o.exitCode}${o.sawAnyFrame ? ', after partial output' : ''})${stderrPart(o)}`
  }
}

// ── daemon-flow classification (feature 0024, REQ-012 — locked D4′) ──────────────────────────
//
// The socket is version-stable and the daemon-flow handshake establishes on WIRE-PROTOCOL
// compatibility ONLY (`createDaemonClientHandshake`): an app-version string difference NO LONGER
// fails the handshake at all — it establishes, so a routine auto-update reattaches (FINDING-014).
// Classification therefore keys on a `proto-mismatch` handshake failure, split by
// `bridgeStatus.spawned`:
//  - spawned:false (attach-to-existing) ⇒ `daemon-protocol-drift`: a DISTINCT, honest,
//    NON-destructive outcome — no daemon kill, no socket removal, no upload, no F19 provision-retry
//    loop (a running process is not a provisionable artifact). The diagnostic names both
//    proto/version pairs, the ws-keyed metadata file, and both recovery paths (idle-out / manual
//    pid termination), and states the live sessions keep running unharmed.
//  - spawned:true (a torn/wrong artifact at the versioned path) ⇒ falls through to the F19
//    provisionable `version-mismatch` row unchanged (re-uploading the client's own artifact is the
//    correct remedy there).
// A `version-mismatch` handshake kind (which the relaxed machine no longer produces) is NEVER
// drift — it reduces to `classifyConnectOutcome`'s existing rows.

export interface BridgeConnectStatus {
  spawned: boolean
  daemonVersion: string | null
  daemonProto: number | null
  daemonPid: number | null
}

export interface DaemonConnectObservation extends ConnectObservation {
  /** The parsed `TERMHALLA_BRIDGE_V1` status line, or `null` when unreadable. */
  bridgeStatus: BridgeConnectStatus | null
  /** The client's own (expected) app version — named in the drift diagnostic (advisory). */
  expectedVersion: string
  /** The client's own (expected) wire-protocol version — the compatibility axis (REQ-012). */
  expectedProto: number
  /** The workspace scope token — names the ws-keyed metadata file in the drift diagnostic. */
  wsToken: string
}

export type DaemonConnectClassification =
  | ConnectClassification
  | { kind: 'daemon-protocol-drift'; diagnostic: string }

const driftDiagnostic = (o: DaemonConnectObservation): string => {
  const knownDaemon = o.bridgeStatus !== null && o.bridgeStatus.daemonProto !== null
  const daemonDesc = knownDaemon
    ? `the running daemon speaks wire protocol ${o.bridgeStatus!.daemonProto} ` +
      `(app version "${o.bridgeStatus!.daemonVersion ?? 'unknown'}")`
    : 'the running daemon speaks an unknown daemon protocol/version (its bridge status line was unreadable)'
  return (
    `${daemonDesc}, which is incompatible with this client's wire protocol ${o.expectedProto} ` +
    `(app version "${o.expectedVersion}"). Its live remote sessions keep running unharmed; this ` +
    `client cannot reach them right now. No daemon kill, no socket removal, and no upload was ` +
    `attempted (a running daemon is not a provisionable artifact). Recovery: the daemon will idle ` +
    `out and exit on its own once its sessions end, or you may manually terminate the pid recorded ` +
    `in <agentDir>/daemon-${o.wsToken}.json from any SSH shell on the host.`
  )
}

/** Additive: the daemon-flow's extended classifier. Reduces to `classifyConnectOutcome`'s exact
 *  rows for everything except a `proto-mismatch` handshake failure, which it further splits by
 *  `bridgeStatus.spawned`. */
export const classifyDaemonConnectOutcome = (o: DaemonConnectObservation): DaemonConnectClassification => {
  if (o.handshakeFailureKind === 'proto-mismatch') {
    if (o.bridgeStatus !== null && o.bridgeStatus.spawned === true) {
      // A fresh spawn that mismatches proto = a torn/wrong artifact at the versioned path: the F19
      // provisionable row (re-upload the client's own build is the correct remedy).
      return { kind: 'version-mismatch' }
    }
    return { kind: 'daemon-protocol-drift', diagnostic: driftDiagnostic(o) }
  }
  return classifyConnectOutcome(o)
}
