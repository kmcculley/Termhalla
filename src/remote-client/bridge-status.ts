/**
 * Pure parser for the daemon-flow bridge's ONE machine-parseable stderr line (REQ-009):
 * `TERMHALLA_BRIDGE_V1 {"spawned":bool,"daemonVersion":string|null,"daemonProto":number|null,"daemonPid":number|null}`.
 *
 * The `daemonProto` field (D4′) carries the daemon's WIRE-protocol version so the client can name
 * the drift honestly (REQ-012). A pre-revision-2 THREE-field line (no `daemonProto`) is NOT the
 * Definitions contract and parses as malformed ⇒ `null`.
 *
 * Tolerant by design (REQ-009/REQ-012: "unreadable" is itself a value the classifier consumes,
 * never a thrown error): a missing, malformed, or mistyped line yields `null`.
 *
 * `BRIDGE_STATUS_PREFIX` is intentionally duplicated here rather than imported from
 * `src/agent/daemon-constants.ts` — the client tree never imports the agent tree (REQ-014; the
 * bridge is the only socket consumer, and `tests/agent-daemon-structure.test.ts` /
 * `tests/remote-client-structure.test.ts` both pin the isolation from their respective sides).
 */

export const BRIDGE_STATUS_PREFIX = 'TERMHALLA_BRIDGE_V1 '

export interface BridgeStatus {
  spawned: boolean
  daemonVersion: string | null
  daemonProto: number | null
  daemonPid: number | null
}

const tryParseOne = (jsonText: string): BridgeStatus | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.spawned !== 'boolean') return null
  if (typeof obj.daemonVersion !== 'string' && obj.daemonVersion !== null) return null
  if (typeof obj.daemonProto !== 'number' && obj.daemonProto !== null) return null
  if (typeof obj.daemonPid !== 'number' && obj.daemonPid !== null) return null
  return {
    spawned: obj.spawned,
    daemonVersion: obj.daemonVersion as string | null,
    daemonProto: obj.daemonProto as number | null,
    daemonPid: obj.daemonPid as number | null
  }
}

/** Scans every line of the given stderr text for the first VALID status line — a malformed
 *  match keeps scanning rather than failing the whole parse (never throws). */
export const parseBridgeStatus = (stderrText: string): BridgeStatus | null => {
  if (typeof stderrText !== 'string') return null
  for (const line of stderrText.split('\n')) {
    if (!line.startsWith(BRIDGE_STATUS_PREFIX)) continue
    const result = tryParseOne(line.slice(BRIDGE_STATUS_PREFIX.length))
    if (result !== null) return result
  }
  return null
}
