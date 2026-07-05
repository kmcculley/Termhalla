/**
 * File ▸ Reopen Closed Workspace… — lists workspaces that exist on disk but aren't open in this
 * window, and reopens one with all its panes restored (each terminal relaunches at its saved cwd,
 * reconnects SSH, and re-runs `claude --resume` where a Claude session was running). Also offers a
 * destructive Remove that prunes a closed workspace's on-disk record for good (the long-deferred
 * orphan cleanup).
 *
 * The list is loaded on open (async) so it always reflects the current on-disk set. Reopen closes
 * the dialog and lands focus in the reopened workspace's first pane (adoptWorkspace owns that).
 */
import { useEffect, useState } from 'react'
import type { ClosedWorkspaceInfo } from '../store/types'
import { useStore } from '../store'
import { Modal, Z } from './Modal'

export function ReopenWorkspaceModal({ onClose }: { onClose: () => void }) {
  const listClosedWorkspaces = useStore(s => s.listClosedWorkspaces)
  const reopenClosedWorkspace = useStore(s => s.reopenClosedWorkspace)
  const deleteClosedWorkspace = useStore(s => s.deleteClosedWorkspace)

  const [items, setItems] = useState<ClosedWorkspaceInfo[] | null>(null)
  const refresh = () => { void listClosedWorkspaces().then(setItems) }
  useEffect(refresh, [listClosedWorkspaces])

  const reopen = (id: string) => { onClose(); void reopenClosedWorkspace(id) }
  const remove = async (id: string) => { await deleteClosedWorkspace(id); refresh() }

  return (
    <Modal onClose={onClose} z={Z.dialog} backdropTestId="reopen-ws-backdrop">
      <div data-testid="reopen-ws" role="dialog" aria-modal="true" aria-label="Reopen closed workspace"
        style={{ width: 480, maxWidth: '90vw', padding: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>Reopen closed workspace</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
          {items === null && (
            <div style={{ color: 'var(--fg-dim, #aaa)', fontSize: 12 }}>Loading…</div>
          )}
          {items !== null && items.length === 0 && (
            <div data-testid="reopen-ws-empty" style={{ color: 'var(--fg-dim, #aaa)', fontSize: 12 }}>
              No closed workspaces — everything saved is already open.
            </div>
          )}
          {items?.map(w => (
            <div key={w.id} data-testid="reopen-ws-row"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4, border: '1px solid transparent' }}>
              <button type="button" data-testid={`reopen-ws-open-${w.id}`}
                style={{ flex: 1, textAlign: 'left', minWidth: 0 }}
                title={w.firstCwd ? `Reopen — ${w.firstCwd}` : 'Reopen this workspace'}
                onClick={() => reopen(w.id)}>
                <span style={{ fontWeight: 500 }}>{w.name}</span>
                <span style={{ color: 'var(--fg-dim, #aaa)', fontSize: 11, marginLeft: 8 }}>
                  {w.paneCount} {w.paneCount === 1 ? 'pane' : 'panes'}
                  {w.firstCwd ? ` · ${w.firstCwd}` : ''}
                </span>
              </button>
              <button type="button" data-testid={`reopen-ws-remove-${w.id}`} title={`Delete ${w.name} permanently`}
                onClick={() => { void remove(w.id) }}>✕</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" data-testid="reopen-ws-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  )
}
