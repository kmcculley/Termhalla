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

/** The bounded line-aware window (chars) the incremental scanner retains for a line still in
 *  flight — generous against the ~120-char status line, tiny against the 0023 probe cap (the
 *  sibling bounded-accumulator posture, FINDING-010). */
export const BRIDGE_STATUS_WINDOW_CHARS = 8192

export interface BridgeStatusScanner {
  /** Feed one raw (newline-preserving) stderr chunk. A no-op once a status line has latched. */
  push(text: string): void
  /** The FIRST valid status line observed so far, or null. */
  status(): BridgeStatus | null
}

/** Incremental, bounded equivalent of re-running `parseBridgeStatus` over an ever-growing raw
 *  accumulation (2026-07-17 quality audit finding 31 — the daemon connect leg accumulated stderr
 *  unboundedly in the privileged Electron main process and full-rescanned it per chunk while a
 *  handshake failure was pending). Same parse semantics, applied streamwise: each completed line
 *  is scanned once through the same `tryParseOne` and discarded; the trailing partial line is
 *  itself scan-eligible (the terminating newline may land in a later chunk than the JSON, and
 *  `parseBridgeStatus` treats the tail as a line too) and is retained bounded at `windowChars`.
 *  The first VALID status line latches; from then on nothing accumulates. */
export const createBridgeStatusScanner = (windowChars: number = BRIDGE_STATUS_WINDOW_CHARS): BridgeStatusScanner => {
  let found: BridgeStatus | null = null
  let pending = ''
  const scanLine = (line: string): void => {
    if (found !== null || !line.startsWith(BRIDGE_STATUS_PREFIX)) return
    found = tryParseOne(line.slice(BRIDGE_STATUS_PREFIX.length))
  }
  return {
    push(text: string): void {
      if (found !== null || typeof text !== 'string' || text.length === 0) return
      pending += text
      for (let nl = pending.indexOf('\n'); nl !== -1 && found === null; nl = pending.indexOf('\n')) {
        scanLine(pending.slice(0, nl))
        pending = pending.slice(nl + 1)
      }
      if (found === null) scanLine(pending)
      if (found !== null) {
        pending = ''
        return
      }
      if (pending.length > windowChars) pending = pending.slice(pending.length - windowChars)
    },
    status: (): BridgeStatus | null => found
  }
}
