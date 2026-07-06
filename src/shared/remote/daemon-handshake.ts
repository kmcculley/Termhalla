/**
 * The daemon-flow handshake variant (feature 0024-agent-daemonization, REQ-012 — locked D4′).
 *
 * ADDITIVE to the F15 exact-version machines in `handshake.ts` — those are UNTOUCHED (their
 * frozen suites pass unedited; the default stdio flow keeps its exact-version check). This
 * variant establishes on WIRE-PROTOCOL compatibility ONLY: a peer hello whose `proto` falls
 * within `DAEMON_PROTO_COMPAT` establishes regardless of the app-version string, which is
 * advertised for diagnostics only. That is exactly what makes the close → auto-update → reopen
 * flow survive — a routine Termhalla update bumps the APP version every time (auto-update on
 * quit) but rarely the wire protocol, so a protocol-compatible client reattaches to the
 * still-running old-app-version daemon and its sessions survive (FINDING-014).
 *
 * `DAEMON_PROTO_COMPAT` is DERIVED from `WIRE_PROTO` (never an independent numeric literal): a
 * genuinely protocol-breaking release bumps the ONE `WIRE_PROTO = n` literal in `handshake.ts`
 * and the compat range follows by construction.
 *
 * Pure module: zero Node/Electron imports (REQ-001).
 */
import { ProtocolError, protocolFailure, type ProtocolFailure } from './errors'
import { parseWireMessage, type HelloFrame } from './messages'
import { type CapabilityId } from './capabilities'
import { WIRE_PROTO } from './handshake'

/** The compatible wire-protocol range a daemon-flow endpoint accepts (REQ-012). v1: exactly the
 *  current wire proto. DERIVED from `WIRE_PROTO` — the drift substrate transforms only the
 *  `WIRE_PROTO` literal and relies on this range following it (04-tests.md). The RANGE machinery
 *  is itself the contract, so a future bump can keep a compatibility window. */
export const DAEMON_PROTO_COMPAT: readonly number[] = [WIRE_PROTO]

export interface DaemonAgentHandshakeInit {
  version: string
  capabilities: readonly CapabilityId[]
}

export interface DaemonClientHandshakeInit {
  version: string
}

export type DaemonAgentHandshakeResult =
  | { done: true; ok: true }
  | { done: true; ok: false; failure: ProtocolFailure }

export type DaemonClientHandshakeResult =
  | { done: true; ok: true; capabilities: CapabilityId[]; reply: HelloFrame }
  | { done: true; ok: false; failure: ProtocolFailure }

export interface DaemonAgentHandshake {
  /** The frame the daemon MUST send first on a new connection (proto = WIRE_PROTO). */
  helloFrame(): HelloFrame
  /** Consume the first inbound frame (expected: the client hello). Single-use. */
  onMessage(frame: unknown): DaemonAgentHandshakeResult
}

export interface DaemonClientHandshake {
  /** Consume the first inbound frame (expected: the daemon hello). Single-use. */
  onMessage(frame: unknown): DaemonClientHandshakeResult
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
    'this daemon handshake machine already completed — it is single-use; post-establishment frames belong to the session router',
    {}
  ))

/**
 * Validate an inbound frame as the expected peer hello, RELAXED on version (D4′): the app version
 * is ADVISORY (no exact-version check — the whole point), but `proto` MUST fall within
 * `DAEMON_PROTO_COMPAT`. On a proto mismatch the failure names BOTH protos AND BOTH app versions.
 */
const evaluateDaemonHello = (
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
        `expected a hello frame to open the daemon handshake, got "${receivedType}" — no other frame may precede establishment`,
        { received: receivedType }
      )
    }
  }

  const parsed = parseWireMessage(frame)
  if (!parsed.ok) {
    return { ok: false, failure: protocolFailure('bad-hello', `malformed hello: ${parsed.error.message}`, { cause: parsed.error.detail }) }
  }
  const hello = parsed.frame as HelloFrame
  if (hello.role !== expectedRole) {
    return {
      ok: false,
      failure: protocolFailure('bad-hello', `expected a ${expectedRole} hello, got role "${hello.role}"`, { role: hello.role, expectedRole })
    }
  }
  if (!DAEMON_PROTO_COMPAT.includes(hello.proto)) {
    return {
      ok: false,
      failure: protocolFailure(
        'proto-mismatch',
        `daemon-flow handshake: peer wire proto ${hello.proto} is outside this endpoint's compatible range ` +
        `[${DAEMON_PROTO_COMPAT.join(', ')}] (local proto ${WIRE_PROTO}) — peer app version "${hello.version}", ` +
        `local app version "${localVersion}". A protocol-breaking release must reattach with a protocol-compatible ` +
        `client, wait for the old daemon to idle out, or terminate it manually`,
        { received: hello.proto, compat: [...DAEMON_PROTO_COMPAT], localProto: WIRE_PROTO, peerVersion: hello.version, localVersion }
      )
    }
  }
  return { ok: true, hello }
}

/** The daemon-side machine: sends `helloFrame()` first, then establishes on protocol range. */
export const createDaemonAgentHandshake = (init: DaemonAgentHandshakeInit): DaemonAgentHandshake => {
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
    onMessage(frame: unknown): DaemonAgentHandshakeResult {
      if (done) throw alreadyDone()
      done = true
      const ev = evaluateDaemonHello(frame, 'client', init.version)
      if (!ev.ok) return { done: true, ok: false, failure: ev.failure }
      return { done: true, ok: true }
    }
  }
}

/** The client-side machine: emits nothing until the daemon hello arrives, establishes on range. */
export const createDaemonClientHandshake = (init: DaemonClientHandshakeInit): DaemonClientHandshake => {
  let done = false
  return {
    onMessage(frame: unknown): DaemonClientHandshakeResult {
      if (done) throw alreadyDone()
      done = true
      const ev = evaluateDaemonHello(frame, 'agent', init.version)
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
