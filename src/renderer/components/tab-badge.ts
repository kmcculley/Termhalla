import type { Workspace, AiSession, TerminalStatus } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { aiState } from '../store/pane-ops'

/** The alert/AI signals a workspace tab's badge summarizes, separated from how they're rendered. */
export interface BadgeState {
  needs: number       // count of terminal panes wanting input (and opted into the tab badge)
  busy: boolean       // any badge-opted pane is busy
  ai: boolean         // any pane runs a detected AI agent
  aiAwaiting: boolean // an AI agent is idle, waiting for the user
}

/** Aggregate a workspace's terminal panes into a badge descriptor. Pure: `alerts` config gates
 *  whether a pane contributes the needs/busy dot, while the AI sparkle always shows. */
export function workspaceBadgeState(
  ws: Workspace,
  statuses: Record<string, TerminalStatus>,
  aiSessions: Record<string, AiSession>
): BadgeState {
  let needs = 0, busy = false, ai = false, aiAwaiting = false
  for (const paneId of Object.keys(ws.panes)) {
    const cfg = ws.panes[paneId].config
    if (cfg.kind !== 'terminal') continue
    const as = aiState({ aiSessions, statuses }, paneId)
    if (as) { ai = true; if (as === 'awaiting') aiAwaiting = true }
    if (!resolveAlerts(cfg.alerts).tabBadge) continue
    const st = statuses[paneId]?.state
    if (st === 'needs-input') needs++
    else if (st === 'busy') busy = true
  }
  return { needs, busy, ai, aiAwaiting }
}

/** Render a badge descriptor to its tab-suffix string (sparkle, then needs/busy indicator). */
export function formatBadge(s: BadgeState): string {
  const aiPart = s.ai ? (s.aiAwaiting ? ' ✨⏳' : ' ✨') : ''
  if (s.needs > 0) return `${aiPart} 🔔${s.needs}`
  if (s.busy) return `${aiPart} •`
  return aiPart
}

/** The badge suffix for a workspace tab (empty when nothing to show). */
export function tabBadge(
  ws: Workspace,
  statuses: Record<string, TerminalStatus>,
  aiSessions: Record<string, AiSession>
): string {
  return formatBadge(workspaceBadgeState(ws, statuses, aiSessions))
}
