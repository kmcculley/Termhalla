/**
 * The remote wire protocol — public barrel (REQ-001, REQ-013).
 *
 * The ONE sanctioned import surface: `@shared/remote/protocol`. TEST-747 pins the
 * runtime export list to exactly the spec's Public interface, so scope creep (e.g. a
 * premature flow-control semantics API — that is F17's) is mechanically visible.
 *
 * Consumers in v1: vitest only. F16 (agent runtime) and later F21 (client routing)
 * are the sanctioned production consumers — see TEST-746's retirement path.
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
