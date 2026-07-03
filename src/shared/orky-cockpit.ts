// Pure cockpit blueprint generator for the per-project Orky workspace template (feature 0011,
// REQ-001). PURE and renderer-safe — a function of its arguments ONLY (the orky-pane.ts
// discipline): no DOM, no Electron, no node builtins, no `path` module, no ambient platform
// read, no clock, no randomness, and no id generation — fresh pane ids are the
// `workspaceFromTemplate` seam's job (feature 0011 rides that ONE seam, which also applies
// F9's `normalizeOrkyBindings` coercion — CONV-026). This module builds a `WorkspaceTemplate`
// VALUE and nothing else: no store reach, no bridge reach, no persistence reach.
import type { WorkspaceTemplate } from './types'

/** Fixed sentinel id for the ephemeral cockpit blueprint. The blueprint is instantiated
 *  directly and never persisted to `quick.json` — saving a cockpit as a reusable template stays
 *  the user's explicit `saveTemplate` gesture (D3/REQ-006). */
export const ORKY_COCKPIT_TEMPLATE_ID = 'orky-cockpit-blueprint'

// Fixed placeholder pane keys: deterministic (same input → deep-equal blueprint) and remapped to
// fresh uuids by `remapPaneIds` inside `workspaceFromTemplate` at instantiation time.
const ORKY_LEAF = 'orky-cockpit-pane'
const TERMINAL_LEAF = 'orky-cockpit-terminal'

/** `'Orky: <last non-empty path segment of root>'`, splitting on BOTH separator styles — never
 *  the `path` module, never a platform read. Total on ANY string input (CONV-002): a
 *  segmentless/separator-only root falls back to the VERBATIM root string. Deterministic; names
 *  are not unique in Termhalla (the `Workspace N` precedent) — duplicates are fine. */
export function orkyCockpitName(root: string): string {
  const segments = root.split(/[\\/]+/).filter(s => s.length > 0)
  return `Orky: ${segments.length > 0 ? segments[segments.length - 1] : root}`
}

/** The deterministic cockpit blueprint: EXACTLY two panes — an Orky pane bound to `root`
 *  (byte-verbatim, never re-cased/re-slashed/re-resolved) and a terminal pane
 *  `{ kind, shellId, cwd: root }` (cwd byte-verbatim, NO other config key: a plain shell at the
 *  project root — D4's no-auto-typed-command posture) — in a row split, Orky first, terminal
 *  second, default 50/50 (no splitPercentage key at all). Same args → deep-equal result. */
export function orkyCockpitTemplate(o: { root: string; shellId: string }): WorkspaceTemplate {
  return {
    id: ORKY_COCKPIT_TEMPLATE_ID,
    name: orkyCockpitName(o.root),
    layout: { direction: 'row', first: ORKY_LEAF, second: TERMINAL_LEAF },
    panes: {
      [ORKY_LEAF]: { paneId: ORKY_LEAF, config: { kind: 'orky', root: o.root } },
      [TERMINAL_LEAF]: { paneId: TERMINAL_LEAF, config: { kind: 'terminal', shellId: o.shellId, cwd: o.root } }
    }
  }
}
