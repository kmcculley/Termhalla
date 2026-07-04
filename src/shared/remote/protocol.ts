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
