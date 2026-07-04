/**
 * Named-agent connection registry — the PURE model (REQ-003, feature 0020 / F19).
 *
 * A named agent is the unit a remote workspace homes to (locked decision 7): connection
 * config ONLY — host/user/port + an identity-file PATH. The identity-file path is the
 * closest thing to a credential this record may ever carry (baseline REQ-024 posture: no
 * secrets persisted); `normalizeNamedAgents` strips every unknown field so nothing secret
 * can ride along a load/save round-trip.
 *
 * Seeding copies exactly the connection fields from an SSH favorite — never the tmux
 * fields: the F19 transport is a stdio EXEC channel (no TTY, no tmux; locked decision 1).
 *
 * Pure module: zero Node/Electron imports (frozen TEST-2002 scans this file).
 */
import type { SshConnection } from './types'

export interface NamedAgent {
  id: string
  name: string
  host: string
  user: string
  port?: number          // default 22 (mirrors SshConnection)
  identityFile?: string  // path to a private key; optional — never key material
  remoteAgentDir?: string // override of the remote install dir (default ~/.termhalla/agent)
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

const isValidPort = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535

/** Normalize an untrusted value (a parsed registry file, an IPC payload) into the valid
 *  subset: unknown fields stripped, invalid optional fields dropped, records missing any
 *  required field dropped, non-array input → []. Never throws (CONV-002). */
export function normalizeNamedAgents(raw: unknown): NamedAgent[] {
  if (!Array.isArray(raw)) return []
  const out: NamedAgent[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const rec = item as Record<string, unknown>
    if (!isNonEmptyString(rec.id) || !isNonEmptyString(rec.name) ||
        !isNonEmptyString(rec.host) || !isNonEmptyString(rec.user)) continue
    const agent: NamedAgent = { id: rec.id, name: rec.name, host: rec.host, user: rec.user }
    if (isValidPort(rec.port)) agent.port = rec.port
    if (isNonEmptyString(rec.identityFile)) agent.identityFile = rec.identityFile
    if (isNonEmptyString(rec.remoteAgentDir)) agent.remoteAgentDir = rec.remoteAgentDir
    out.push(agent)
  }
  return out
}

/** Seed a named agent from an SSH favorite: copies exactly host/user/port/identityFile.
 *  tmuxSession/tmuxOptions are NEVER copied — the exec channel allocates no TTY (REQ-003). */
export function seedNamedAgentFromConnection(
  conn: SshConnection, id: string, name: string
): NamedAgent {
  const agent: NamedAgent = { id, name, host: conn.host, user: conn.user }
  if (isValidPort(conn.port)) agent.port = conn.port
  if (isNonEmptyString(conn.identityFile)) agent.identityFile = conn.identityFile
  return agent
}
