/**
 * The session-survival wire vocabulary (REQ-009) — the reattach method strings and the result
 * shapes `pty:attach` / `pty:sessions` put on the wire.
 *
 * DEFINED here, inside the agent tree, and RE-EXPORTED by the shared surface
 * `src/shared/remote-agent-api.ts` (which F21's client imports) — the SAME two-door pattern as
 * `error-codes.ts`, for the same reason: the frozen TEST-752 (tests/agent-structure.test.ts)
 * reserves every `shared/remote`-containing import specifier under `src/agent/` for the F15
 * protocol barrel, and `@shared/remote-agent-api` contains that substring. One definition, two
 * doors — the agent imports `./session-api`, everyone else imports `@shared/remote-agent-api`,
 * and both see the SAME bindings. (CONV-032: this comment is load-bearing — inlining these into
 * the shared module would false-trip TEST-752.)
 *
 * The method strings are remote-ONLY verbs: there are no local `CH` channels for them (the
 * local app never needs a replay snapshot — its xterm instances stay mounted), so they are
 * hand-typed deliberately here (the frozen TEST-750 anti-literal pin covers only the four local
 * pty methods). Sorted, duplicate-free, disjoint from `AGENT_PTY_METHODS` (TEST-1908).
 */
import type { TerminalStatus } from '@shared/types'

/** The reattach surface: `pty:attach` (snapshot-bearing attach) + `pty:sessions` (inventory). */
export const AGENT_SESSION_METHODS = ['pty:attach', 'pty:sessions'] as const

export type AgentSessionMethod = (typeof AGENT_SESSION_METHODS)[number]

/**
 * The lease-revocation push channel (F20 / 0021-exclusive-attach-lease, locked decision 5 —
 * `tmux attach -d` semantics): `{ type: 'evt', channel: AGENT_LEASE_REVOKED_EVT, args: [] }`
 * is sent to a connection displaced by a lease steal as its FINAL frame; that connection then
 * ends (exit code 0). F21's client drops the workspace to its disconnected state on receipt.
 * Remote-only: no local `CH` channel exists for it (the local app has no lease concept), so
 * the literal is hand-typed deliberately here — the ONE definition site across `src/`
 * (TEST-2111 pins the confinement; both doors re-export this binding).
 */
export const AGENT_LEASE_REVOKED_EVT = 'lease:revoked' as const

/**
 * The wire re-shape of `TerminalStatus`: identical fields EXCEPT that an absent `lastExit` is a
 * DROPPED KEY, never `undefined` (F15's strict validator rejects `undefined` inside JSON
 * positions — the F16 `pty:status` push established this precedent; attach/inventory results
 * reuse it).
 */
export interface AgentStatusPayload {
  state: TerminalStatus['state']
  lastExit?: NonNullable<TerminalStatus['lastExit']>
  since: number
}

/**
 * `pty:attach` result: everything a client needs to repaint the pane EXACTLY.
 *
 * `cols`/`rows` are the CURRENT authoritative pty dims at res time; the `snapshot` repaints
 * content and — if a resize landed inside the attach window (FINDING-008) — may rewrap when
 * written at those dims (serialize output is dimension-free escape text). Clients size the
 * terminal from `cols`/`rows` first, then write the snapshot; F21 additionally resizes the
 * remote pty to its own viewport right after attach.
 */
export interface AgentAttachResult {
  /** The @xterm/addon-serialize snapshot of the pane's agent-side headless terminal. */
  snapshot: string
  cols: number
  rows: number
  /** The store's current resolved cwd (spawn-resolved, then OSC-tracked). */
  cwd: string
  status: AgentStatusPayload
}

/** One `pty:sessions` inventory entry (live panes only; the array is sorted by `id`). */
export interface AgentSessionInfo {
  id: string
  /** The shellId as requested at spawn (v1 backends resolve any id to the default shell). */
  shellId: string
  cwd: string
  cols: number
  rows: number
  /** Whether the ASKING connection is subscribed to this pane (spawned/adopted/attached it). */
  attached: boolean
  status: AgentStatusPayload
}

/** Re-shape a tracker status for the wire (drop an absent `lastExit` KEY — see above). */
export const toStatusPayload = (s: TerminalStatus): AgentStatusPayload =>
  s.lastExit === undefined
    ? { state: s.state, since: s.since }
    : { state: s.state, lastExit: s.lastExit, since: s.since }
