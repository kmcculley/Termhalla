/**
 * The remote wire protocol — public barrel (REQ-001, REQ-013).
 *
 * The ONE sanctioned import surface: `@shared/remote/protocol`. TEST-747 pins the
 * runtime export list to exactly the spec'd Public interface, so scope creep is
 * mechanically visible. F17 (0018-windowed-flow-control) extended that pinned list
 * with the flow-control semantics API through its own tests phase — the once-"premature"
 * API this header used to name is now the sanctioned surface (see flow-control.ts).
 *
 * Consumers: the agent runtime (F16+) and vitest; later F21 (client routing) —
 * see TEST-746's retirement path.
 *
 * Wire-protocol versioning rule (feature 0024-agent-daemonization, REQ-012 / locked D4′): the
 * wire protocol version (`WIRE_PROTO`, the hello `proto` field) is versioned SEPARATELY from the
 * app/bundle version. Any wire-visible protocol change (a frame type, a method, field semantics)
 * MUST bump `WIRE_PROTO`; an app release that does NOT change the wire MUST NOT. The daemon flow
 * establishes on protocol compatibility only (`createDaemonAgentHandshake` /
 * `createDaemonClientHandshake`, accepting any peer `proto` within `DAEMON_PROTO_COMPAT` — which
 * is DERIVED from `WIRE_PROTO`), so a routine Termhalla auto-update (app version bumps, `proto`
 * unchanged) reattaches to a still-running old-app-version daemon and its remote sessions survive
 * the update. The exact-version machines below are unchanged — the daemon-flow relaxation is a
 * strictly ADDITIVE export.
 */
export { ProtocolError } from './errors'
export type { ProtocolFailure, ProtocolReason } from './errors'

export { CAPABILITY_IDS, AGENT_V1_CAPABILITIES, isCapabilityId } from './capabilities'
export type { CapabilityId } from './capabilities'

export { parseWireMessage } from './messages'
export type {
  WireFrame,
  HelloFrame,
  ReqFrame,
  ResFrame,
  EvtFrame,
  AckFrame,
  WindowFrame,
  ParseResult
} from './messages'

export { encodeFrame, createFrameDecoder, FRAME_HEADER_BYTES, DEFAULT_MAX_FRAME_BYTES } from './framing'
export type { DecodedItem, FrameCodecOptions, FrameDecoder } from './framing'

export { createClientHandshake, createAgentHandshake, WIRE_PROTO } from './handshake'
export type {
  AgentHandshake,
  ClientHandshake,
  AgentHandshakeInit,
  ClientHandshakeInit,
  AgentHandshakeResult,
  ClientHandshakeResult
} from './handshake'

// Feature 0024-agent-daemonization (REQ-012 / REQ-014, locked D4′): the ADDITIVE daemon-flow
// handshake variant (protocol-range acceptance, app version advisory) + the compat range. The
// exact-version machines above are untouched.
export { createDaemonAgentHandshake, createDaemonClientHandshake, DAEMON_PROTO_COMPAT } from './daemon-handshake'
export type {
  DaemonAgentHandshake,
  DaemonClientHandshake,
  DaemonAgentHandshakeInit,
  DaemonClientHandshakeInit,
  DaemonAgentHandshakeResult,
  DaemonClientHandshakeResult
} from './daemon-handshake'

export { createRequestTracker } from './correlation'
export type { RequestTracker, SettleResult, FailedRequest, OpenedRequest } from './correlation'

export {
  flowPayloadSize,
  DEFAULT_FLOW_WINDOW_BYTES,
  DEFAULT_ACK_EVERY_BYTES,
  createAgentFlowGate,
  createClientAckPolicy
} from './flow-control'
export type {
  FlowDecision,
  AgentFlowGateInit,
  AgentFlowGate,
  ClientAckPolicyInit,
  ClientAckPolicy
} from './flow-control'
