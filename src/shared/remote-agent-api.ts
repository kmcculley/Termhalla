/**
 * The shared agent API vocabulary (REQ-014) — what a client needs to speak to the v1 agent
 * beyond F15's protocol layer itself: the closed error-code union the agent puts in
 * `res.error.code`, and the four pty method strings (derived from the `CH` channel constants,
 * never re-typed).
 *
 * The error codes are DEFINED in `src/agent/error-codes.ts` and re-exported here — see the
 * header there for why (frozen TEST-752 reserves `shared/remote`-containing specifiers inside
 * `src/agent/` for the F15 barrel). F21's client imports THIS module; the agent imports the
 * sibling. Both bindings are identical.
 *
 * Environment-pure (F15 REQ-001 standard): no Node/Electron imports, no environment globals.
 */
import { CH } from './ipc-contract'

export { AGENT_ERROR_CODES } from '../agent/error-codes'
export type { AgentErrorCode } from '../agent/error-codes'

// Session survival + replay (F18 / 0019) and the exclusive-attach lease (F20 / 0021): the
// reattach method strings, result shapes, and the lease-revocation evt channel are DEFINED in
// `src/agent/session-api.ts` and re-exported here — the same two-door pattern (and reason) as
// the error codes above: the frozen TEST-752 reserves `shared/remote`-containing specifiers
// inside `src/agent/` for the F15 barrel, so the agent cannot import THIS module.
export { AGENT_SESSION_METHODS, AGENT_LEASE_REVOKED_EVT } from '../agent/session-api'
export type {
  AgentSessionMethod,
  AgentStatusPayload,
  AgentAttachResult,
  AgentSessionInfo
} from '../agent/session-api'

/** The v1 agent's implemented method surface — exactly the local pty IPC channel values. */
export const AGENT_PTY_METHODS = [CH.ptySpawn, CH.ptyWrite, CH.ptyResize, CH.ptyKill] as const

export type AgentPtyMethod = (typeof AGENT_PTY_METHODS)[number]
