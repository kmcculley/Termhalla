import { useMemo } from 'react'
import { Mosaic } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import { useShallow } from 'zustand/react/shallow'
import type { MosaicNode as ModelNode, Workspace } from '@shared/types'
import { computeVisibleLayout } from '@shared/workspace-model'
import { useStore } from '../store'
import { api } from '../api'
import { PaneTile } from './PaneTile'
import { MinimizedPaneHost } from './MinimizedPaneHost'
import { MinimizedTray } from './MinimizedTray'

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
  const maximized = useStore(s => !!s.maximized[ws.id])
  // Live minimized set for this workspace (runtime source of truth; folded onto the record on save).
  const minimizedIds = useStore(useShallow(s => s.minimized[ws.id] ?? []))

  // The visible layout = the raw layout with every minimized leaf pruned, so the remaining panes
  // reflow to fill 100% of the freed area (C2/REQ-002). `null` ⇒ every pane is minimized.
  // computeVisibleLayout reads only `ws.layout` + `minimized`; depending on the whole `ws` keeps the
  // memo honest (lint-policed) without a blanket suppression — the walk is cheap (QUAL-005).
  const visible = useMemo(
    () => computeVisibleLayout({ ...ws, minimized: minimizedIds }),
    [ws, minimizedIds]
  )

  // A brand-new, truly empty workspace (no panes at all) — the add-a-pane prompt.
  if (ws.layout === null && minimizedIds.length === 0) {
    return (
      <div data-testid="empty-workspace" style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button data-testid="add-first-terminal" onClick={() => addTerminal(ws.id, null, 'row')}>+ Terminal</button>
          <button data-testid="add-first-editor" onClick={() => addEditor(ws.id, null, 'row')}>+ Editor</button>
          <button data-testid="add-first-explorer" onClick={async () => { const r = await api.openFolder(); if (r) addExplorer(ws.id, null, 'row', r) }}>+ Explorer</button>
        </div>
      </div>
    )
  }

  return (
    <div className={maximized ? 'ws-mosaic ws-max' : 'ws-mosaic'} data-testid={`ws-mosaic-${ws.id}`}
      style={{ position: 'relative', height: '100%' }}>
      {visible !== null ? (
        <Mosaic<string>
          value={visible as ModelNode & string}
          onChange={(node) => setLayout(ws.id, (node as ModelNode) ?? null)}
          renderTile={(paneId, path) => <PaneTile wsId={ws.id} paneId={paneId} path={path} />}
        />
      ) : (
        // Every pane is minimized — the all-minimized empty state (REQ-011). The bodies stay mounted
        // in the off-layout hosts below; the tray is the restore home, so nothing is unreachable.
        <div data-testid={`ws-empty-${ws.id}`}
          style={{ display: 'grid', placeItems: 'center', height: '100%', textAlign: 'center', color: 'var(--fg-dim, #aaa)', padding: 16 }}>
          <div>All panes are minimized.<br />Restore one from the tray below.</div>
        </div>
      )}

      {/* Minimized pane bodies: kept mounted off-layout (alive but hidden) — C1. */}
      {minimizedIds.map(id => <MinimizedPaneHost key={id} wsId={ws.id} paneId={id} />)}

      {/* The per-workspace tray of restore chips, only when ≥1 pane is minimized (REQ-004). */}
      {minimizedIds.length > 0 && <MinimizedTray wsId={ws.id} paneIds={minimizedIds} />}
    </div>
  )
}
