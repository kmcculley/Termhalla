import type { GitStatus, Workspace } from './types'

/** The project a pane belongs to: git repo root if known, else the pane's live cwd, else its
 *  persisted terminal cwd, else '' (no project). Pure (inlines the cwd fallback rather than
 *  importing the renderer `paneCwd`, which transitively imports `../api`). */
export function resolveProjectKey(
  s: { gitStatus: Record<string, GitStatus>; cwds: Record<string, string>; workspaces: Record<string, Workspace> },
  paneId: string | null
): string {
  if (!paneId) return ''
  const root = s.gitStatus[paneId]?.root
  if (root) return root
  if (s.cwds[paneId]) return s.cwds[paneId]
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane?.config.kind === 'terminal') return pane.config.cwd
  }
  return ''
}
