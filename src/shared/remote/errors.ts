/**
 * Structured, actionable errors for the remote wire protocol (REQ-015, CONV-001).
 *
 * Every failure this layer surfaces — thrown `ProtocolError`s, decoder error items,
 * handshake failures — carries a `reason` from the closed union below, machine-readable
 * `detail` fields naming the offending values, and a human message that states what
 * failed, the offending value, and the expectation. Never a bare "invalid input".
 *
 * Pure module: zero Node/Electron imports (REQ-001).
 */

/** The closed reason vocabulary (REQ-015). */
export type ProtocolReason =
  | 'frame-too-large'
  | 'decoder-dead'
  | 'bad-json'
  | 'bad-message'
  | 'unexpected-frame'
  | 'bad-hello'
  | 'proto-mismatch'
  | 'version-mismatch'
  | 'handshake-done'
  | 'tracker-closed'

/** A non-thrown failure record (decoder items, handshake results, parse rejections). */
export interface ProtocolFailure {
  reason: ProtocolReason
  message: string
  detail: Record<string, unknown>
}

/** Thrown form of the same information (encode errors, dead decoder, closed tracker …). */
export class ProtocolError extends Error {
  readonly reason: ProtocolReason
  readonly detail: Record<string, unknown>

  constructor(failure: ProtocolFailure) {
    super(failure.message)
    this.name = 'ProtocolError'
    this.reason = failure.reason
    this.detail = failure.detail
  }
}

/** Internal helper — build a ProtocolFailure. Not part of the public barrel surface. */
export const protocolFailure = (
  reason: ProtocolReason,
  message: string,
  detail: Record<string, unknown> = {}
): ProtocolFailure => ({ reason, message, detail })
