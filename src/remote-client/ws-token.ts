/**
 * Deterministic workspace-scope token derivation (feature 0024-agent-daemonization,
 * REQ-013/REQ-018 — locked D6′). Pure.
 *
 * The token names the workspace-keyed daemon socket/metadata/log (`agent-<token>.sock` etc.) and
 * is interpolated into a remote shell command AND a filesystem path, so it must match
 * `^[A-Za-z0-9_-]{1,64}$` (the injection/traversal guard). A workspace id that already conforms is
 * used AS-IS — so the same workspace resolves the SAME socket on every reconnect. A non-conforming
 * id (empty / too long / out-of-charset) maps DETERMINISTICALLY into the charset via a stable
 * SHA-256 (hex is a subset of the allowed alphabet): same input ⇒ same token always, distinct
 * inputs ⇒ distinct tokens (collision probability is out of scope for v1 — a plan detail, not a
 * spec contract), so two same-host workspaces never share a daemon.
 */
import { createHash } from 'node:crypto'

const WS_TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/

/** A conforming id round-trips unchanged; anything else maps into the charset deterministically. */
export const deriveWsToken = (workspaceId: string): string => {
  if (typeof workspaceId === 'string' && WS_TOKEN_RE.test(workspaceId)) return workspaceId
  // sha256 hex ∈ [0-9a-f] ⊂ the allowed charset; 'ws-' + 61 hex = 64 chars, always conforming.
  const hex = createHash('sha256').update(String(workspaceId)).digest('hex')
  return `ws-${hex.slice(0, 61)}`
}
