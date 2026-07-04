/**
 * The connect handshake (REQ-008, REQ-009).
 *
 * Sequence (fixed — F16 has no wire latitude here): the AGENT speaks first, sending its
 * hello (`proto`, `role: 'agent'`, `version`, `capabilities`). The CLIENT sends nothing
 * until it received and validated that hello; on an EXACT version match it replies with
 * its own hello (no capabilities — only the agent advertises), and the session is
 * established on both sides after that second message. On ANY failure neither side
 * emits a frame — the failure object is the local diagnostic (F19 consumes
 * `version-mismatch` vs the rest to decide provisioning).
 *
 * The version check is string IDENTITY (locked decision 2): the client provisions the
 * agent, so client and agent are version-locked — a version CHECK, never a
 * compatibility matrix. No semver parsing, no ranges, no normalization.
 *
 * Both machines are pure and single-use: no IO, no timers; `onMessage` after `done`
 * throws `handshake-done` (post-establishment routing is F16's).
 *
 * Pure module: zero Node/Electron imports (REQ-001).
 */
import { ProtocolError, protocolFailure, type ProtocolFailure } from './errors'
import { parseWireMessage, type HelloFrame } from './messages'
import { type CapabilityId } from './capabilities'

/** The wire-protocol sanity marker carried in every hello. Exact-equality checked. */
export const WIRE_PROTO = 1

export interface AgentHandshakeInit {
  version: string
  capabilities: readonly CapabilityId[]
}

export interface ClientHandshakeInit {
  version: string
}

export type AgentHandshakeResult =
  | { done: true; ok: true }
  | { done: true; ok: false; failure: ProtocolFailure }

export type ClientHandshakeResult =
  | { done: true; ok: true; capabilities: CapabilityId[]; reply: HelloFrame }
  | { done: true; ok: false; failure: ProtocolFailure }

export interface AgentHandshake {
  /** The frame the agent MUST send first on a new connection, before anything else. */
  helloFrame(): HelloFrame
  /** Consume the first inbound frame (expected: the client hello). Single-use. */
  onMessage(frame: unknown): AgentHandshakeResult
}

export interface ClientHandshake {
  /** Consume the first inbound frame (expected: the agent hello). Single-use. */
  onMessage(frame: unknown): ClientHandshakeResult
}

/** Validate an inbound frame as the expected peer hello; shared by both machines. */
const evaluateHello = (
  frame: unknown,
  expectedRole: 'agent' | 'client',
  localVersion: string
): { ok: true; hello: HelloFrame } | { ok: false; failure: ProtocolFailure } => {
  const receivedType =
    typeof frame === 'object' && frame !== null && !Array.isArray(frame) &&
    typeof (frame as Record<string, unknown>).type === 'string'
      ? ((frame as Record<string, unknown>).type as string)
      : describeNonFrame(frame)

  if (receivedType !== 'hello') {
    return {
      ok: false,
      failure: protocolFailure(
        'unexpected-frame',
        `expected a hello frame to open the handshake, got "${receivedType}" — no other frame may precede establishment`,
        { received: receivedType }
      )
    }
  }

  const parsed = parseWireMessage(frame)
  if (!parsed.ok) {
    return {
      ok: false,
      failure: protocolFailure(
        'bad-hello',
        `malformed hello: ${parsed.error.message}`,
        { cause: parsed.error.detail }
      )
    }
  }
  const hello = parsed.frame as HelloFrame
  if (hello.role !== expectedRole) {
    return {
      ok: false,
      failure: protocolFailure(
        'bad-hello',
        `expected a ${expectedRole} hello, got role "${hello.role}"`,
        { role: hello.role, expectedRole }
      )
    }
  }
  if (hello.proto !== WIRE_PROTO) {
    return {
      ok: false,
      failure: protocolFailure(
        'proto-mismatch',
        `hello proto ${hello.proto} does not match WIRE_PROTO ${WIRE_PROTO} — the peer is not speaking this protocol`,
        { received: hello.proto, expected: WIRE_PROTO }
      )
    }
  }
  if (hello.version !== localVersion) {
    return {
      ok: false,
      failure: protocolFailure(
        'version-mismatch',
        `peer version "${hello.version}" does not exactly match local version "${localVersion}" — client and agent are version-locked (a version check, not a compatibility matrix)`,
        { peerVersion: hello.version, localVersion }
      )
    }
  }
  return { ok: true, hello }
}

const describeNonFrame = (v: unknown): string => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object') return 'object-without-type'
  return typeof v
}

const alreadyDone = (): ProtocolError =>
  new ProtocolError(protocolFailure(
    'handshake-done',
    'this handshake machine already completed — it is single-use; post-establishment frames belong to the session router',
    {}
  ))

/** Create the agent-side machine. The agent sends `helloFrame()` first, unprompted. */
export const createAgentHandshake = (init: AgentHandshakeInit): AgentHandshake => {
  let done = false
  return {
    helloFrame(): HelloFrame {
      return {
        type: 'hello',
        proto: WIRE_PROTO,
        role: 'agent',
        version: init.version,
        capabilities: [...init.capabilities]
      }
    },
    onMessage(frame: unknown): AgentHandshakeResult {
      if (done) throw alreadyDone()
      done = true
      const ev = evaluateHello(frame, 'client', init.version)
      if (!ev.ok) return { done: true, ok: false, failure: ev.failure }
      return { done: true, ok: true }
    }
  }
}

/** Create the client-side machine. The client emits NOTHING until the agent hello arrives. */
export const createClientHandshake = (init: ClientHandshakeInit): ClientHandshake => {
  let done = false
  return {
    onMessage(frame: unknown): ClientHandshakeResult {
      if (done) throw alreadyDone()
      done = true
      const ev = evaluateHello(frame, 'agent', init.version)
      if (!ev.ok) return { done: true, ok: false, failure: ev.failure }
      const capabilities = [...(ev.hello.capabilities ?? [])].sort()
      return {
        done: true,
        ok: true,
        capabilities,
        reply: { type: 'hello', proto: WIRE_PROTO, role: 'client', version: init.version }
      }
    }
  }
}
