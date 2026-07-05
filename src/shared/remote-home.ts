/**
 * The per-workspace HOME model (feature 0022 / F21, locked decision 7): a workspace lives either
 * locally (no `home` field — the byte-identical default) or on a named agent (F19's connection
 * registry unit). Every pane in a workspace lives at its home; ONE agent connection per workspace.
 *
 * Pure module: zero Node/Electron imports (the F15 REQ-001 standard; TEST-746's successor pins
 * the renderer/preload trees, and this model is consumed on both sides of the bridge).
 */
import type { RemoteWorkspaceState } from './remote-workspace'

export type WorkspaceHome = { kind: 'agent'; agentId: string; agentName: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Normalize an untrusted persisted `home` value (a workspace file, a template in quick.json) into
 * the valid subset (REQ-001). Applied at EVERY deserialization path of the persisted workspace
 * shape (CONV-026): `deserializeWorkspace` AND `workspaceFromTemplate`.
 *
 * - not a plain object, or `kind !== 'agent'` → `undefined` (local);
 * - `kind === 'agent'` with malformed string fields → COERCED to `''`, kept REMOTE: a workspace
 *   meant for a remote machine must NEVER silently fall back to spawning local shells — the
 *   connection layer refuses an empty agentId with an actionable diagnostic instead (REQ-006);
 * - unknown extra keys stripped (the no-secrets round-trip posture);
 * - a well-formed home passes through VALUE-identical. Never throws (CONV-002).
 */
export function normalizeWorkspaceHome(raw: unknown): WorkspaceHome | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  if (rec.kind !== 'agent') return undefined
  return { kind: 'agent', agentId: str(rec.agentId), agentName: str(rec.agentName) }
}

/**
 * The capability set a workspace's UI affordances may offer (REQ-017, locked decision 6):
 * - local (no home) → 'all' (every domain — the pre-F21 reality, byte-identical);
 * - remote + connected → exactly the handshake-advertised capability set;
 * - remote + anything else (no state yet / connecting / disconnected) → ['pty'] — the terminal
 *   gesture stays reachable (it is the connection trigger); everything else is greyed until the
 *   agent's advertised set is known.
 */
export function remoteAllowedDomains(
  home: WorkspaceHome | undefined,
  state: RemoteWorkspaceState | undefined
): 'all' | readonly string[] {
  if (!home) return 'all'
  if (state && state.phase === 'connected') return state.capabilities
  return ['pty']
}

/**
 * The cross-home pane-move refusal predicate (REQ-018, locked decision 7): `null` = allowed.
 * A running PTY cannot teleport machines, and even two workspaces homed to the SAME agent hold
 * two distinct connections (one per workspace) in v1 — so only local→local moves are allowed.
 */
export function paneMoveRefusalReason(
  from: WorkspaceHome | undefined,
  to: WorkspaceHome | undefined
): string | null {
  if (!from && !to) return null
  if (from && to) {
    return 'Panes cannot move between remote workspaces: each remote workspace holds its own agent ' +
      'connection, and a running remote PTY cannot change connections. Open a new terminal in the ' +
      'destination workspace instead.'
  }
  return from
    ? `This pane runs on the remote agent "${from.agentName}" and cannot move into a local workspace ` +
      '(a running PTY cannot teleport machines). Open a new local terminal instead.'
    : `This pane runs locally and cannot move into a workspace homed to the remote agent "${to!.agentName}" ` +
      '(a running PTY cannot teleport machines). Open a new terminal in that workspace instead.'
}
