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

/** The v1 agent's implemented method surface — exactly the local pty IPC channel values. */
export const AGENT_PTY_METHODS = [CH.ptySpawn, CH.ptyWrite, CH.ptyResize, CH.ptyKill] as const

export type AgentPtyMethod = (typeof AGENT_PTY_METHODS)[number]
