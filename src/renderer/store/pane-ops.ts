import type { ShellInfo, Workspace, MosaicDirection } from '@shared/types'

export type PaneKind = 'terminal' | 'editor' | 'explorer'

/** The store actions `dispatchAddPane` needs, narrowed so the helper is api-free and unit-testable
 *  (the renderer `api` module touches `window`, so anything importing it can't run under vitest). */
export interface PaneActions {
  workspaces: Record<string, Workspace>
  addTerminal: (wsId: string, target: string | null, dir: MosaicDirection) => unknown
  addEditor: (wsId: string, target: string | null, dir: MosaicDirection) => unknown
  addExplorer: (wsId: string, target: string | null, dir: MosaicDirection, root: string) => unknown
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
