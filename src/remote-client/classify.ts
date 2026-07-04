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
