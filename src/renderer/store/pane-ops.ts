import type { ShellInfo, Workspace, MosaicDirection, SplitDir4, AiSession, TerminalStatus } from '@shared/types'

export type PaneKind = 'terminal' | 'editor' | 'explorer'

/** The store actions `dispatchAddPane` needs, narrowed so the helper is api-free and unit-testable
 *  (the renderer `api` module touches `window`, so anything importing it can't run under vitest). */
export interface PaneActions {
  workspaces: Record<string, Workspace>
  addTerminal: (wsId: string, target: string | null, dir: MosaicDirection, splitDir?: SplitDir4) => unknown
  addEditor: (wsId: string, target: string | null, dir: MosaicDirection, splitDir?: SplitDir4) => unknown
  addExplorer: (wsId: string, target: string | null, dir: MosaicDirection, root: string, splitDir?: SplitDir4) => unknown
}

/** The shell a new terminal should use: the user's explicit pick, else the first detected shell,
 *  else cmd. Centralizes the fallback chain that was copy-pasted across every launch action. */
export function defaultShellId(s: { newTerminalShellId: string | null; shells: ShellInfo[] }): string {
  return s.newTerminalShellId ?? s.shells[0]?.id ?? 'cmd'
}

/** The pane that `launch`/open-in-first actions split off: the first existing pane, or null when
 *  the workspace is empty (then the caller creates the first pane). */
export function firstTarget(ws: Workspace): string | null {
  return ws.layout ? Object.keys(ws.panes)[0] : null
}

/** Add a pane of `kind` to `wsId`, splitting off its first existing pane. No-ops for a missing
 *  workspace, and the explorer branch prompts for a folder first (and skips if cancelled).
 *  Centralizes the kind→action dispatch that was triplicated (and had drifted) across App,
 *  CommandPalette and WorkspaceTabs. */
export async function dispatchAddPane(
  s: PaneActions,
  wsId: string,
  kind: PaneKind,
  openFolder: () => Promise<string | null>
): Promise<void> {
  const ws = s.workspaces[wsId]
  if (!ws) return
  const target = firstTarget(ws)
  if (kind === 'terminal') s.addTerminal(wsId, target, 'row')
  else if (kind === 'editor') s.addEditor(wsId, target, 'row')
  else {
    const root = await openFolder()
    if (root) s.addExplorer(wsId, target, 'row', root)
  }
}

/** Fold the live AI-session map into terminal pane configs at save time: a pane currently running
 *  an AI tool (e.g. Claude) gets `resumeAi` stamped so it can auto-resume on the next launch; a pane
 *  that no longer runs one has any stale `resumeAi` cleared. Pure; returns the same ws when unchanged
 *  so it never forces a needless write. Mirrors applyCwds (kept here, api-free, so it's testable). */
export function applyResumeAi(ws: Workspace, aiSessions: Record<string, AiSession>): Workspace {
  let changed = false
  const panes = { ...ws.panes }
  for (const id of Object.keys(panes)) {
    const pane = panes[id]
    if (pane.config.kind !== 'terminal') continue
    const next = aiSessions[id]?.tool
    if (pane.config.resumeAi !== next) {
      panes[id] = { ...pane, config: { ...pane.config, resumeAi: next } }
      changed = true
    }
  }
  return changed ? { ...ws, panes } : ws
}

/** Display state for an AI session pane: 'working' when busy, 'awaiting' when quiet, null if not
 *  an AI session. */
export function aiState(
  s: { aiSessions: Record<string, AiSession>; statuses: Record<string, TerminalStatus> },
  paneId: string
): 'working' | 'awaiting' | null {
  if (!s.aiSessions[paneId]) return null
  return s.statuses[paneId]?.state === 'busy' ? 'working' : 'awaiting'
}
