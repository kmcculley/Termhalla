import type { ShellInfo, Workspace, MosaicDirection, SplitDir4, AiSession, AiTool, TerminalStatus } from '@shared/types'

export type PaneKind = 'terminal' | 'editor' | 'explorer' | 'orky'

/** The store actions `dispatchAddPane` needs, narrowed so the helper is api-free and unit-testable
 *  (the renderer `api` module touches `window`, so anything importing it can't run under vitest). */
export interface PaneActions {
  workspaces: Record<string, Workspace>
  addTerminal: (wsId: string, target: string | null, dir: MosaicDirection, splitDir?: SplitDir4) => unknown
  addEditor: (wsId: string, target: string | null, dir: MosaicDirection, splitDir?: SplitDir4) => unknown
  addExplorer: (wsId: string, target: string | null, dir: MosaicDirection, root: string, splitDir?: SplitDir4) => unknown
  addOrky: (wsId: string, target: string | null, dir: MosaicDirection, root: string, splitDir?: SplitDir4) => unknown
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
 *  workspace; the explorer branch prompts for a folder first (and skips if cancelled), and the
 *  orky branch (feature 0009, REQ-004) prompts through its OWN injected, api-free root-picker
 *  callback — ONE callback per concept, no primary+override pair (CONV-006) — committing the
 *  picked root VERBATIM (REQ-005) and nothing at all on cancel. Centralizes the kind→action
 *  dispatch that was triplicated (and had drifted) across App, CommandPalette and WorkspaceTabs. */
export async function dispatchAddPane(
  s: PaneActions,
  wsId: string,
  kind: PaneKind,
  openFolder: () => Promise<string | null>,
  pickOrkyRoot?: () => Promise<string | null>
): Promise<void> {
  const ws = s.workspaces[wsId]
  if (!ws) return
  const target = firstTarget(ws)
  if (kind === 'terminal') s.addTerminal(wsId, target, 'row')
  else if (kind === 'editor') s.addEditor(wsId, target, 'row')
  else if (kind === 'orky') {
    const root = await pickOrkyRoot?.()
    if (root) s.addOrky(wsId, target, 'row', root)
  } else {
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

/** Whether a freshly-mounted terminal pane should auto-type `claude --resume`. TRUE only for a
 *  genuinely fresh shell spawn of a pane that had Claude at last save (`resumeAi === 'claude'`) with
 *  the setting on. MUST be FALSE for a re-adoption of a still-running PTY — minimize/restore, a
 *  same-window cross-workspace move, or a multi-window handoff — because Claude is still alive there
 *  and the command would land as a prompt into the live agent (the restore-types-`claude --resume`
 *  bug). The caller passes `isReadoption` = "a stashed scrollback snapshot was consumed on this
 *  mount", which is exactly the re-adoption signal (a fresh spawn has no stash). Pure + api-free. */
export function shouldAutoResumeClaude(
  o: { resumeAi?: AiTool; autoResumeEnabled: boolean; isReadoption: boolean }
): boolean {
  return o.resumeAi === 'claude' && o.autoResumeEnabled && !o.isReadoption
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
