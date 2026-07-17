import { useStore } from '../store'
import { chipStatus, orkyChipStatus, type ChipState } from '@shared/chip-status'

/**
 * Per-workspace tray of restore chips for the minimized panes (REQ-004). Rendered as a workspace-body
 * sibling of <Mosaic> (NOT inside a mosaic tile), so it needs no portal (C4); its focus/hover styling
 * lives in index.css (CONV-007). One chip per minimized pane; clicking (or keyboard-activating) a chip
 * restores that pane (REQ-006/REQ-014). The tray is mounted only when ≥1 pane is minimized.
 */
export function MinimizedTray({ wsId, paneIds }: { wsId: string; paneIds: string[] }) {
  const restorePane = useStore(s => s.restorePane)
  return (
    <div data-testid={`min-tray-${wsId}`} className="min-tray">
      {paneIds.map(id => <MinChip key={id} wsId={wsId} paneId={id} />)}
      {paneIds.length >= 2 && (
        <button type="button" data-testid={`min-restore-all-${wsId}`} className="min-chip"
          title="Restore all minimized panes" aria-label="Restore all minimized panes"
          onClick={() => { for (const id of [...paneIds]) restorePane(wsId, id) }}>
          ⤢ all
        </button>
      )}
    </div>
  )
}

function MinChip({ wsId, paneId }: { wsId: string; paneId: string }) {
  const pane = useStore(s => s.workspaces[wsId]?.panes[paneId])
  const status = useStore(s => s.statuses[paneId])
  const recording = useStore(s => !!s.recording[paneId])
  const ai = useStore(s => !!s.aiSessions[paneId])
  const exited = useStore(s => !!s.exited[paneId])
  const orky = useStore(s => s.orky[paneId])
  const restorePane = useStore(s => s.restorePane)

  // Live background status (REQ-005): a blocked pane is marked so it is never a silent footgun, and a
  // dead shell shows a distinct `exited` indicator rather than reading as a live idle pane (DA-003).
  const cs = chipStatus({ state: status?.state ?? 'idle', recording, ai, exited })
  // Orky precedence (REQ-010 / FINDING-QUAL-005): when a minimized pane is a bound Orky run, the tray
  // chip reflects the Orky kind / needs-you (via the shared `orkyChipStatus` the toolbar chip also uses),
  // not only the byte-derived status. Absent an Orky run, the byte chip is unchanged.
  const ocs = orky ? orkyChipStatus(orky) : null
  const state: ChipState = ocs ? (ocs.kind === 'busy' ? 'busy' : ocs.needsInput ? 'needs-input' : 'idle') : cs.state
  const needsInput = ocs ? ocs.needsInput : cs.needsInput
  const failed = ocs ? ocs.failed : false
  const name = pane?.config.name ?? pane?.config.kind ?? 'Pane'
  const statusWord = failed ? 'failed' : (!ocs && cs.state === 'exited') ? 'exited' : needsInput ? 'needs input' : state
  const label = `Restore ${name} (${statusWord}` +
    `${cs.recording ? ', recording' : ''}${cs.ai ? ', AI' : ''})`
  const icon = failed ? '✖' : needsInput ? '🔔'
    : (!ocs && cs.state === 'exited') ? '⊘' : cs.recording ? '⏺' : cs.ai ? '✨' : '🗗'

  return (
    <button type="button" data-testid={`min-chip-${paneId}`} className="min-chip"
      data-status={state}
      data-needs-input={needsInput ? '1' : undefined}
      data-failed={failed ? '1' : undefined}
      aria-label={label} title={label}
      onClick={() => restorePane(wsId, paneId)}>
      <span aria-hidden style={{ marginRight: 4 }}>{icon}</span>{name}
    </button>
  )
}
