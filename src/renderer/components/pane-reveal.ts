// Feature 0013 — the click-to-focus / drawer-reveal path shared by the decision-queue drawer (F6) and
// the OS needs-you notification handler (App.tsx's onOrkyNotifyFocus). It REUSES F6's shared matcher +
// MRU pick from `@shared/decision-queue` (never a forked matching implementation — REQ-006) so a
// notification click lands on the same most-recently-focused matching pane the drawer would focus, and
// falls back to opening the drawer scrolled to the project when no pane matches (REQ-007).
import { caseFoldFromPlatform, matchPaneRootFromCandidates, selectMruPane, selectPaneCandidates } from '@shared/decision-queue'
import { requestPaneFocus } from './terminal-registry'
import type { State } from '../store/types'

/** Every pane in THIS window resolved to its member root via the shared matcher, on the aggregate's
 *  own binding signals (the SAME derivation `DecisionQueuePanel` uses — REQ-006 reuse). */
function paneMatchesFor(s: State, projectRoot: string): { paneId: string; wsId: string; workspaceIndex: number }[] {
  const caseFold = caseFoldFromPlatform(navigator.platform)
  const memberRoots = (s.registrySnapshot ?? [])
    .map(e => (e && typeof e.root === 'string' ? e.root : ''))
    .filter(r => r.length > 0)
  const matches: { paneId: string; wsId: string; workspaceIndex: number }[] = []
  s.order.forEach((wsId, workspaceIndex) => {
    const ws = s.workspaces[wsId]
    if (!ws) return
    for (const paneId of Object.keys(ws.panes)) {
      const cfg = ws.panes[paneId].config
      const root = matchPaneRootFromCandidates(
        selectPaneCandidates({
          liveCwd: s.cwds[paneId],
          configCwd: cfg.kind === 'terminal' ? cfg.cwd : undefined,
          gitRoot: s.gitStatus[paneId]?.root
        }),
        memberRoots, { caseFold }
      )
      if (root === projectRoot) matches.push({ paneId, wsId, workspaceIndex })
    }
  })
  return matches
}

/** The MRU-pick + focus-dispatch TAIL, shared by BOTH the drawer (`DecisionQueuePanel.focusProject`)
 *  and the notification handler (`focusProjectPane` below) — ONE source of truth, never two hand-synced
 *  copies (REQ-006 / FINDING-006). Given the caller's own locally-derived `matching` array (each caller
 *  keeps its OWN selectPaneCandidates walk — the panel's is pinned inside its file by frozen TEST-370),
 *  it selects the most-recently-focused pane and dispatches setActive + setFocusedPane + requestPaneFocus.
 *  Returns `true` iff a pane was focused; `false` means the caller should fall back to the drawer. */
export function focusMruPaneMatch(
  matching: readonly { paneId: string; wsId: string; workspaceIndex: number }[],
  paneFocusSeq: Readonly<Record<string, number>>,
  dispatch: { setActive: (id: string) => void; setFocusedPane: (paneId: string) => void }
): boolean {
  const pick = selectMruPane(matching.map(p => ({ paneId: p.paneId, workspaceIndex: p.workspaceIndex })), paneFocusSeq)
  if (!pick) return false
  const target = matching.find(p => p.paneId === pick.paneId)
  if (!target) return false
  dispatch.setActive(target.wsId)
  dispatch.setFocusedPane(target.paneId)
  requestPaneFocus(target.paneId)
  return true
}

/** Focus the most-recently-focused open pane in this window matching `projectRoot` (F6's
 *  `focusProject` semantics). Returns `true` iff a pane was focused; `false` means the caller should
 *  fall back to the drawer reveal (REQ-006/REQ-007). Routes through the shared `focusMruPaneMatch` tail. */
export function focusProjectPane(s: State, projectRoot: string): boolean {
  const matching = paneMatchesFor(s, projectRoot)
  return focusMruPaneMatch(matching, s.paneFocusSeq, { setActive: s.setActive, setFocusedPane: s.setFocusedPane })
}

/** Scroll the decision-queue drawer's group for `projectRoot` into view once it has rendered (REQ-007).
 *  Reuses F6's `data-testid="decision-queue-group-<root>"` group elements; matched on the exact
 *  `data-project-root` dataset value so a path with CSS-special characters needs no escaping.
 *  FINDING-010: `DecisionQueuePanel` mounts only AFTER `setQueueOpen(true)` commits, so on the primary
 *  closed→open path the target group is not in the DOM by the first frame. A single give-up rAF would
 *  query an empty tree and silently no-op; instead we RETRY across frames (bounded) until the group
 *  appears, then scroll it once. */
const REVEAL_MAX_FRAMES = 30
export function revealQueueGroup(projectRoot: string): void {
  let frames = 0
  const tick = (): void => {
    frames++
    const groups = document.querySelectorAll<HTMLElement>('[data-testid^="decision-queue-group-"]')
    for (const el of groups) {
      if (el.dataset.projectRoot === projectRoot) { el.scrollIntoView({ block: 'nearest' }); return }
    }
    if (frames < REVEAL_MAX_FRAMES) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
