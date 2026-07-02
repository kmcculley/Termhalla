import { useMemo, useRef } from 'react'
import { useStore } from '../store'
import { caseFoldFromPlatform, matchPaneRootFromCandidates, selectPaneCandidates } from '@shared/decision-queue'
import { focusMruPaneMatch } from './pane-reveal'
import { useRegistryLoadState } from './use-registry-load-state'
import { useOpenFocusRestore } from './use-open-focus-restore'

/** Right-side Orky decision-queue drawer (feature 0006): a window-chrome sibling of the notes
 *  drawer, NOT a mosaic pane kind (REQ-001). Renders the cross-project needs-a-human-now queue off
 *  the store's registry slice — it never recomputes membership/count locally and wires no IPC of
 *  its own (the subscription is app-level so the badge stays live while this drawer is closed).
 *  Strictly read-only: clicking an item focuses a matching pane; the pane-less fallback spawns a
 *  terminal at the project root via the existing launchDir path (REQ-009/REQ-010/REQ-017). */
export function DecisionQueuePanel() {
  // The shared load-state derivation (feature 0009, FINDING-019): loading/failed come from the ONE
  // exported rule, never a per-component restatement of the slice's derived-loading contract.
  const { registrySnapshot, registryError, loading, failed } = useRegistryLoadState()
  const groups = useStore(s => s.queueGroups())
  const setQueueOpen = useStore(s => s.setQueueOpen)
  const workspaces = useStore(s => s.workspaces)
  const order = useStore(s => s.order)
  const cwds = useStore(s => s.cwds)
  const gitStatus = useStore(s => s.gitStatus)
  const setActive = useStore(s => s.setActive)
  const setFocusedPane = useStore(s => s.setFocusedPane)
  const launchDir = useStore(s => s.launchDir)
  const newWorkspace = useStore(s => s.newWorkspace)

  // Focus management (FINDING-010): opening the drawer (chord, palette, or toggle) moves keyboard
  // focus INTO it — otherwise a keyboard open leaves focus in an xterm pane, which consumes Tab,
  // making the drawer keyboard-unreachable. Closing restores focus — but ONLY when focus actually
  // collapsed out of the removed drawer (activeElement fell to body/null). This drawer is
  // NON-modal and its headline gesture (click-to-focus) deliberately moves focus to a pane while
  // the drawer stays open; an unconditional restore would later yank focus away from that pane,
  // splitting the visual focus indicator from where keystrokes land (FINDING-023).
  const closeRef = useRef<HTMLButtonElement>(null)
  useOpenFocusRestore(closeRef, '[data-testid="orky-queue-toggle"]')

  // Fold mode for the pane↔root matcher (REQ-009 / FINDING-003): derived ONCE from the DOM-standard
  // navigator global — the one platform signal that exists in the contextIsolated main world.
  const caseFold = caseFoldFromPlatform(navigator.platform)

  // The aggregate's member roots — the set the shared matcher resolves pane paths against.
  const memberRoots = useMemo(() => (registrySnapshot ?? [])
    .map(e => (e && typeof e.root === 'string' ? e.root : ''))
    .filter(r => r.length > 0), [registrySnapshot])

  // Every pane in THIS window resolved to its member root (or none), on the aggregate's own binding
  // signal. Candidate AVAILABILITY is gated by the pure selectPaneCandidates seam (REQ-009 /
  // FINDING-020): the live tracked cwd when known — even if it will not match — else the persisted
  // terminal config.cwd, else gitStatus.root; the first VALID candidate is decisive, so a pane that
  // cd'd out of every member root shows the fallback instead of matching via a stale signal.
  // Memoized (FINDING-012): recomputed only when an input map changes, not on every render.
  const paneMatches = useMemo(() => {
    const matches: { paneId: string; wsId: string; workspaceIndex: number; root: string }[] = []
    order.forEach((wsId, workspaceIndex) => {
      const ws = workspaces[wsId]
      if (!ws) return
      for (const paneId of Object.keys(ws.panes)) {
        const cfg = ws.panes[paneId].config
        const root = matchPaneRootFromCandidates(
          selectPaneCandidates({
            liveCwd: cwds[paneId],
            configCwd: cfg.kind === 'terminal' ? cfg.cwd : undefined,
            gitRoot: gitStatus[paneId]?.root
          }),
          memberRoots, { caseFold }
        )
        if (root) matches.push({ paneId, wsId, workspaceIndex, root })
      }
    })
    return matches
  }, [order, workspaces, cwds, gitStatus, memberRoots, caseFold])

  /** Click-to-focus (REQ-009): the most-recently-focused matching pane in this window — the
   *  revealPaneFromSearch pattern (setActive + setFocusedPane). No match → no focus change (the
   *  open-terminal fallback is the path instead). paneFocusSeq is handler-only state, read
   *  imperatively at event time — never subscribed with a render hook (FINDING-012). Routes through the
   *  SHARED `focusMruPaneMatch` tail (FINDING-006) — the same helper the notification click uses, so
   *  the MRU-pick + focus-dispatch logic has one source of truth. The panel keeps its OWN
   *  selectPaneCandidates walk above (paneMatches / frozen TEST-370); only the tail is shared. */
  const focusProject = (projectRoot: string): void => {
    const matching = paneMatches.filter(p => p.root === projectRoot)
    focusMruPaneMatch(matching, useStore.getState().paneFocusSeq, { setActive, setFocusedPane })
  }

  /** Pane-less fallback (REQ-010): spawn a terminal at the project ROOT via the existing launchDir
   *  pane-spawn path, creating a workspace first when this window has none. Never a throw, never a
   *  silent no-op, never an Orky write or file open. */
  const openTerminalAt = (projectRoot: string): void => {
    if (!useStore.getState().activeId) newWorkspace('Workspace 1')
    launchDir(projectRoot)
  }

  return (
    <div data-testid="decision-queue-panel" role="complementary" aria-label="Orky decision queue"
      style={{ width: 340, flex: '0 0 340px', display: 'flex', flexDirection: 'column',
        background: 'var(--panel, #1e1e1e)', borderLeft: '1px solid var(--border, #333)', color: 'var(--fg, #eee)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
        borderBottom: '1px solid var(--border, #333)' }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--fg-dim, #aaa)', whiteSpace: 'nowrap' }}>
          Orky decision queue
        </span>
        <button ref={closeRef} data-testid="decision-queue-close" type="button" title="Close decision queue"
          aria-label="Close decision queue" onClick={() => setQueueOpen(false)}>✕</button>
      </div>
      {loading && (
        <div data-testid="decision-queue-loading" style={{ padding: 12, fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>
          Waiting for the Orky registry snapshot…
        </div>
      )}
      {failed && (
        <div data-testid="decision-queue-error" style={{ padding: 12, fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>
          {registryError}
        </div>
      )}
      {!loading && !failed && groups.length === 0 && (
        <div data-testid="decision-queue-empty" style={{ padding: 12, fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>
          Nothing needs you right now — no tracked project is waiting on a decision.
        </div>
      )}
      {!loading && !failed && groups.length > 0 && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {groups.map(g => {
            const hasPane = paneMatches.some(p => p.root === g.projectRoot)
            return (
              <div key={g.projectRoot} data-testid={`decision-queue-group-${g.projectRoot}`}
                data-project-root={g.projectRoot}
                style={{ borderBottom: '1px solid var(--border, #333)', paddingBottom: 4 }}>
                <div title={g.projectRoot}
                  style={{ padding: '6px 8px 2px', fontSize: 12, fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {g.projectName}
                </div>
                {g.items.map(it => {
                  const body = (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span>{it.featureSlug}</span>
                        {it.status.reason && (
                          <span style={{ marginLeft: 6, color: 'var(--status-needs-input, #e0a030)' }}>
                            {it.status.reason}
                          </span>
                        )}
                        <span style={{ marginLeft: 6, color: 'var(--fg-dim, #aaa)' }}>
                          {it.status.phase ?? '—'} · {it.status.gateN}/{it.status.gateM}
                        </span>
                      </div>
                      <div title={it.status.detail} style={{ fontSize: 11, color: 'var(--fg-dim, #aaa)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {it.status.detail}
                      </div>
                    </div>
                  )
                  // The item row: a generic focusable container when a pane match makes click/Enter/
                  // Space meaningful (REQ-009). No ARIA button role anywhere in this panel — that is
                  // a Children-Presentational role, which would strip nested controls from the
                  // accessibility tree (FINDING-008). The keydown target-guards so a bubbled key
                  // event from a nested control is never preventDefault()ed into a silent no-op.
                  return hasPane ? (
                    <div key={it.featureSlug} data-testid="decision-queue-item" tabIndex={0}
                      data-project-root={it.projectRoot} data-feature={it.featureSlug}
                      className="dq-row"
                      onClick={() => focusProject(it.projectRoot)}
                      onKeyDown={e => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusProject(it.projectRoot) }
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', cursor: 'pointer' }}>
                      {body}
                    </div>
                  ) : (
                    // Pane-less: the row itself is NON-interactive (no focus, no cursor, no hover —
                    // an inert row that swallowed activation was FINDING-011's dead affordance); the
                    // native fallback <button> IS the activation surface, keyboard-activatable and
                    // AT-exposed by construction (REQ-010/REQ-014).
                    <div key={it.featureSlug} data-testid="decision-queue-item"
                      data-project-root={it.projectRoot} data-feature={it.featureSlug}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px' }}>
                      {body}
                      <button type="button" data-testid="decision-queue-open-terminal"
                        data-project-root={it.projectRoot}
                        title="Open a terminal at this project root"
                        onClick={() => openTerminalAt(it.projectRoot)}
                        style={{ flex: 'none', fontSize: 11 }}>
                        open terminal here
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
