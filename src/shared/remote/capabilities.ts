/**
 * The capability vocabulary of the remote protocol (REQ-010, REQ-011).
 *
 * Locked decision 6 (Remote Agent v1 roadmap): the per-domain IPC registrar names ARE
 * the capability partition — every `src/main/ipc/register-<name>.ts` (excluding the
 * `register.ts` composition root) contributes `<name>` verbatim — and the v1 agent
 * advertises only `pty + status`.
 *
 * RECONCILIATION NOTE (spec REQ-010): `status` is the ONE id that is not a registrar
 * file name. The status domain (the `pty:status` / `pty:cwd` / `pty:procs` push family
 * and the `src/main/status/` detection stack) locally rides `register-pty.ts` rather
 * than owning a registrar file, but the epic names it as its own advertised agent
 * domain ("v1 agent = pty + status only"), so the vocabulary makes it expressible as
 * the 18th id. TEST-741 pins this list against the actual registrar file set; see its
 * header for the CONV-022 amendment path when a future feature adds a registrar.
 *
 * Pure module: zero Node/Electron imports (REQ-001).
 */

/** Closed, sorted, duplicate-free capability id vocabulary (20 registrar names + 'status').
 *  'remote' joined when feature 0022 added register-remote.ts (the connection-lifecycle
 *  registrar); 'workspace-doc' joined when the File-menu workspace-document feature added
 *  register-workspace-doc.ts (portable .thws save/open); 'phone-remote' joined when feature
 *  0026 added register-phone-remote.ts (the phone/web remote server settings surface) — each
 *  extended through its own tests phase per this file's TEST-741 amendment path. No agent ever
 *  advertises any of the three (an agent has no remote-of-remote, workspace documents are a
 *  local File-menu concern, and the phone-remote server is a desktop-local listener); they
 *  exist because the vocabulary IS the registrar-name partition (locked decision 6). */
export const CAPABILITY_IDS = [
  'clipboard',
  'cloud',
  'drafts',
  'env',
  'fs',
  'git',
  'notes',
  'orky',
  'orky-action',
  'phone-remote',
  'preview',
  'pty',
  'recording',
  'registry',
  'remote',
  'search',
  'shell',
  'status',
  'usage',
  'workspace-doc',
  'workspaces'
] as const

export type CapabilityId = (typeof CAPABILITY_IDS)[number]

/** Runtime guard for the closed union. Case-sensitive, exact membership only. */
export const isCapabilityId = (x: unknown): x is CapabilityId =>
  typeof x === 'string' && (CAPABILITY_IDS as readonly string[]).includes(x)

/**
 * What the v1 agent advertises (locked decision 6: tmux parity — the agent implements
 * only the pty + status domains). F16 advertises THIS constant, never a hand-typed list.
 */
export const AGENT_V1_CAPABILITIES: readonly CapabilityId[] = ['pty', 'status']
