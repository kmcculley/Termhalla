/**
 * The closed agent error-code vocabulary (REQ-014).
 *
 * DEFINED here, inside the agent tree, and RE-EXPORTED by the shared surface
 * `src/shared/remote-agent-api.ts` (which F21's client imports). The definition cannot live
 * in the shared file directly-imported from the agent: the frozen TEST-752
 * (tests/agent-structure.test.ts) reserves every `shared/remote`-containing import specifier
 * under `src/agent/` for the F15 protocol barrel, and the specifier
 * `@shared/remote-agent-api` contains that substring. One definition, two doors — the agent
 * imports `./error-codes`, everyone else imports `@shared/remote-agent-api`, and both see the
 * SAME binding. (Comment kept deliberately: a future inline of this file into the shared
 * module would false-trip TEST-752 — CONV-032.)
 *
 * Sorted ascending, duplicate-free, pinned by TEST-749.
 */
export const AGENT_ERROR_CODES = [
  'bad-params',
  'internal',
  'spawn-failed',
  'unknown-method',
  'unknown-pane'
] as const

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number]
