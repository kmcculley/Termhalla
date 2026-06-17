import { v4 as uuid } from 'uuid'
import type { Workspace, PaneConfig, MosaicDirection, Theme } from '@shared/types'
import { resolveTheme } from '@shared/theme'
import { addFirstPane, splitPane } from '@shared/workspace-model'
import { api } from '../api'
import type { State } from './types'

export function findPaneConfig(s: { workspaces: Record<string, Workspace> }, paneId: string): PaneConfig | undefined {
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane) return pane.config
  }
  return undefined
}

export function applyCwds(ws: Workspace, cwds: Record<string, string>): Workspace {
  let changed = false
  const panes = { ...ws.panes }
  for (const id of Object.keys(panes)) {
    const pane = panes[id]
    if (pane.config.kind === 'terminal' && cwds[id] && cwds[id] !== pane.config.cwd) {
      panes[id] = { ...pane, config: { ...pane.config, cwd: cwds[id] } }
      changed = true
    }
  }
  return changed ? { ...ws, panes } : ws
}

/** Drop every per-pane runtime entry for `paneIds`. The runtime is spread across several maps
 *  all keyed by pane id; clearing them in one helper (rather than duplicating the deletes in
 *  closePane and closeWorkspace, where they had already drifted) means a new per-pane map only
 *  needs to be added in one place. */
export function clearPaneRuntime(s: State, paneIds: string[]): Pick<State, 'statuses' | 'cwds' | 'procs' | 'aiSessions' | 'usage' | 'recording' | 'gitStatus'> {
  const statuses = { ...s.statuses }, cwds = { ...s.cwds }, procs = { ...s.procs }
  const aiSessions = { ...s.aiSessions }, usage = { ...s.usage }, recording = { ...s.recording }, gitStatus = { ...s.gitStatus }
  for (const pid of paneIds) { delete statuses[pid]; delete cwds[pid]; delete procs[pid]; delete aiSessions[pid]; delete usage[pid]; delete recording[pid]; delete gitStatus[pid] }
  return { statuses, cwds, procs, aiSessions, usage, recording, gitStatus }
}

/** Stop the main-side resources for the given panes: PTY, usage watch, recording. All three
 *  are no-ops for non-terminal panes, so callers don't need to filter by kind. Pair with
 *  clearPaneRuntime to also drop the renderer-side runtime state. */
export function teardownPanes(paneIds: string[]) {
  for (const pid of paneIds) { api.ptyKill(pid); api.usageUnwatch(pid); api.recStop(pid) }
}

/** Add a pane holding `cfg` to a workspace: the first pane when the layout is empty or no
 *  split target is given, otherwise split `target` in `dir`. Centralizes the branch that was
 *  copy-pasted across every "open a pane" action. */
export function placePane(ws: Workspace, cfg: PaneConfig, target: string | null, dir: MosaicDirection) {
  return ws.layout === null || target === null
    ? addFirstPane(ws, cfg, uuid)
    : splitPane(ws, target, dir, cfg, uuid)
}

// `firstTarget` lives in the api-free `pane-ops` module (so it's unit-testable); re-exported here
// because existing call sites import it from `./internals`.
export { firstTarget } from './pane-ops'

export function paneCwd(
  s: { cwds: Record<string, string>; workspaces: Record<string, Workspace> },
  paneId: string
): string {
  if (s.cwds[paneId]) return s.cwds[paneId]
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane?.config.kind === 'terminal') return pane.config.cwd
  }
  return ''
}

export function resolvedPaneTheme(s: { quick: { theme?: Partial<Theme> }; workspaces: Record<string, Workspace> }, wsId: string, paneId: string): Theme {
  const ws = s.workspaces[wsId]
  return resolveTheme(s.quick.theme, ws?.theme, ws?.panes[paneId]?.config.theme)
}

// aiState lives in the api-free `pane-ops` module (so the tab-badge helper can import it without
// pulling in `../api`); re-exported here because store.ts re-exports it from `./internals`.
export { aiState } from './pane-ops'
