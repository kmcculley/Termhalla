import { useEffect, useState } from 'react'
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import type { MosaicNode as ModelNode, Workspace } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore } from '../store'
import { api } from '../api'
import { TerminalPane } from './TerminalPane'
import { EditorPane } from './EditorPane'
import { ExplorerPane } from './ExplorerPane'
import { TerminalSettings } from './TerminalSettings'
import { ScheduleDialog } from './ScheduleDialog'

/** Compact token count: 999 -> "999", 1234 -> "1.2k", 156000 -> "156k". */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
}

/** Short, compact names for the idle process chip. */
const SHELL_CHIP_LABEL: Record<string, string> = {
  'Windows PowerShell': 'pwsh',
  'Command Prompt': 'cmd'
}

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
  const closePane = useStore(s => s.closePane)
  const statuses = useStore(s => s.statuses)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const cwds = useStore(s => s.cwds)
  const openExplorerHere = useStore(s => s.openExplorerHere)
  const procs = useStore(s => s.procs)
  const shells = useStore(s => s.shells)
  const aiSessions = useStore(s => s.aiSessions)
  const usages = useStore(s => s.usage)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [cwdMenuFor, setCwdMenuFor] = useState<string | null>(null)
  const [procsMenuFor, setProcsMenuFor] = useState<string | null>(null)
  const [scheduleFor, setScheduleFor] = useState<string | null>(null)

  // Auto-dismiss the process popover 2s after it opens on a terminal with no child
  // processes. If a process appears within that window, procs changes, the effect
  // re-runs, sees a non-empty tree, and cancels the close.
  useEffect(() => {
    if (procsMenuFor === null) return
    const info = procs[procsMenuFor]
    if (info && info.tree.length > 0) return
    const t = setTimeout(() => setProcsMenuFor(null), 2000)
    return () => clearTimeout(t)
  }, [procsMenuFor, procs])

  if (ws.layout === null) {
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
    <Mosaic<string>
      value={ws.layout as ModelNode & string}
      onChange={(node) => setLayout(ws.id, (node as ModelNode) ?? null)}
      renderTile={(paneId, path) => {
        const pane = ws.panes[paneId]
        const cwd = cwds[paneId] ?? (pane?.config.kind === 'terminal' ? pane.config.cwd : '')
        const termCfg = pane?.config.kind === 'terminal' ? pane.config : undefined
        const procInfo = procs[paneId]
        const rawShellLabel = termCfg ? (shells.find(sh => sh.id === termCfg.shellId)?.label ?? termCfg.shellId) : ''
        const shellLabel = SHELL_CHIP_LABEL[rawShellLabel] ?? rawShellLabel
        const aiSession = aiSessions[paneId]
        const usage = usages[paneId]
        const chipText = aiSession ? `✨ ${aiSession.label}${usage ? ` ${usage.contextPct}%` : ''}`
          : procInfo && procInfo.foreground ? `▶ ${procInfo.foreground}` : shellLabel
        const status = statuses[paneId]
        const alerts = resolveAlerts(termCfg?.alerts)
        const state = status?.state ?? 'idle'
        const statusClass = alerts.border ? `term-status term-${state}` : ''
        const needsInput = state === 'needs-input'
        const title = (needsInput ? '🔔 ' : '') + (termCfg?.name ?? pane?.config.kind ?? 'Pane')
        return (
          <MosaicWindow<string>
            path={path}
            title={title}
            className={statusClass}
            toolbarControls={[
              ...(termCfg ? [
                <button key="proc" type="button" data-testid={`proc-chip-${paneId}`} title="Running process"
                  style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => setProcsMenuFor(procsMenuFor === paneId ? null : paneId)}>{chipText}</button>,
                <button key="sched" type="button" data-testid={`schedule-chip-${paneId}`} title="Schedule a command"
                  onClick={() => setScheduleFor(scheduleFor === paneId ? null : paneId)}>⏱</button>
              ] : []),
              <button key="cwd" data-testid={`cwd-${paneId}`} title="Folder actions"
                onClick={() => setCwdMenuFor(cwdMenuFor === paneId ? null : paneId)}>📁</button>,
              <button key="gear" data-testid={`gear-${paneId}`} title="Terminal settings"
                onClick={() => setSettingsFor(settingsFor === paneId ? null : paneId)}>⚙</button>,
              <button key="split-row" data-testid={`split-${paneId}`} title="Split right"
                onClick={() => addTerminal(ws.id, paneId, 'row')}>⬌</button>,
              <button key="split-col" data-testid={`split-col-${paneId}`} title="Split down"
                onClick={() => addTerminal(ws.id, paneId, 'column')}>⬍</button>,
              <button key="close" data-testid={`close-${paneId}`}
                onClick={() => closePane(ws.id, paneId)}>✕</button>
            ]}
          >
            <div className="term-tile" data-status={state}
              data-testid={`tile-${paneId}`} data-cwd={cwd} style={{ position: 'relative', height: '100%' }}>
              {settingsFor === paneId && pane && termCfg && (
                <TerminalSettings config={termCfg}
                  onChange={patch => updatePaneConfig(ws.id, paneId, patch)}
                  onClose={() => setSettingsFor(null)} />
              )}
              {procsMenuFor === paneId && (
                <div data-testid="proc-menu" onClick={e => e.stopPropagation()}
                  style={{ position: 'absolute', left: 4, top: 28, zIndex: 10, background: 'var(--elevated, #252526)',
                    color: 'var(--fg, #eee)', border: '1px solid var(--border, #444)', borderRadius: 4, padding: 6, maxWidth: 460,
                    maxHeight: 240, overflow: 'auto', fontSize: 12, fontFamily: 'Consolas, monospace' }}>
                  {aiSession && usage && (
                    <div data-testid={`usage-${paneId}`}
                      style={{ borderBottom: '1px solid var(--border, #444)', paddingBottom: 4, marginBottom: 4 }}>
                      <div>context {fmtTokens(usage.contextTokens)} / {fmtTokens(usage.contextWindow)} · {usage.contextPct}%</div>
                      <div style={{ opacity: 0.7 }}>
                        in {fmtTokens(usage.input)} · out {fmtTokens(usage.output)} · cache r {fmtTokens(usage.cacheRead)} / w {fmtTokens(usage.cacheCreation)}
                      </div>
                    </div>
                  )}
                  {(!procInfo || procInfo.tree.length === 0) && <div style={{ opacity: 0.6 }}>No child processes.</div>}
                  {procInfo && procInfo.tree.map(n => (
                    <div key={n.pid} data-testid={`proc-row-${n.pid}`}
                      style={{ paddingLeft: n.depth * 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ opacity: 0.7 }}>{n.name}</span>
                      <span style={{ opacity: 0.45 }}>  {n.command}</span>
                    </div>
                  ))}
                </div>
              )}
              {scheduleFor === paneId && <ScheduleDialog paneId={paneId} onClose={() => setScheduleFor(null)} />}
              {cwdMenuFor === paneId && (
                <div data-testid="cwd-menu" onClick={e => e.stopPropagation()}
                  style={{ position: 'absolute', right: 4, top: 28, zIndex: 10, background: 'var(--elevated, #252526)',
                    color: 'var(--fg, #eee)', border: '1px solid var(--border, #444)', borderRadius: 4, padding: 4,
                    display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button data-testid={`open-explorer-here-${paneId}`} disabled={!cwd}
                    onClick={() => { openExplorerHere(ws.id, paneId); setCwdMenuFor(null) }}>Open Explorer here</button>
                  <button data-testid={`reveal-here-${paneId}`} disabled={!cwd}
                    onClick={() => { void api.revealPath(cwd); setCwdMenuFor(null) }}>Reveal in File Explorer</button>
                </div>
              )}
              {pane?.config.kind === 'terminal' && termCfg && <TerminalPane paneId={paneId} config={termCfg} />}
              {pane?.config.kind === 'editor' && <EditorPane paneId={paneId} wsId={ws.id} config={pane.config} />}
              {pane?.config.kind === 'explorer' && <ExplorerPane paneId={paneId} wsId={ws.id} config={pane.config} />}
              {!pane && <div>missing pane</div>}
            </div>
          </MosaicWindow>
        )
      }}
    />
  )
}
