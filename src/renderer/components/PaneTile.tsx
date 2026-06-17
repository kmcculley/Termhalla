import { useLayoutEffect, useRef, useState } from 'react'
import { MosaicWindow, type MosaicBranch } from 'react-mosaic-component'
import { resolveAlerts } from '@shared/alerts'
import { themeCssVarsPartial } from '@shared/theme'
import { useStore, paneCwd } from '../store'
import { TerminalPane } from './TerminalPane'
import { EditorPane } from './EditorPane'
import { ExplorerPane } from './ExplorerPane'
import { ScheduleDialog } from './ScheduleDialog'
import { PaneToolbar } from './PaneToolbar'
import { PaneContextMenu } from './PaneContextMenu'
import { ProcessPopover } from './ProcessPopover'
import { CwdMenu } from './CwdMenu'

export type PaneMenu = 'proc' | 'cwd' | 'schedule'

const SHELL_CHIP_LABEL: Record<string, string> = {
  'Windows PowerShell': 'pwsh',
  'Command Prompt': 'cmd'
}

export function PaneTile({ wsId, paneId, path }: { wsId: string; paneId: string; path: MosaicBranch[] }) {
  const pane = useStore(s => s.workspaces[wsId]?.panes[paneId])
  const status = useStore(s => s.statuses[paneId])
  const procInfo = useStore(s => s.procs[paneId])
  const aiSession = useStore(s => s.aiSessions[paneId])
  const usage = useStore(s => s.usage[paneId])
  const recording = useStore(s => !!s.recording[paneId])
  const cwd = useStore(s => paneCwd(s, paneId))
  const shells = useStore(s => s.shells)
  const isMax = useStore(s => s.maximized[wsId] === paneId)
  const setFocusedPane = useStore(s => s.setFocusedPane)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)

  const [menu, setMenu] = useState<PaneMenu | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const toggle = (m: PaneMenu) => setMenu(cur => (cur === m ? null : m))
  const close = () => setMenu(null)
  const tileRef = useRef<HTMLDivElement>(null)

  const termCfg = pane?.config.kind === 'terminal' ? pane.config : undefined
  const rawShellLabel = termCfg ? (shells.find(sh => sh.id === termCfg.shellId)?.label ?? termCfg.shellId) : ''
  const shellLabel = SHELL_CHIP_LABEL[rawShellLabel] ?? rawShellLabel
  const chipText = aiSession ? `✨ ${aiSession.label}${usage ? ` ${usage.contextPct}%` : ''}`
    : procInfo && procInfo.foreground ? `▶ ${procInfo.foreground}` : shellLabel

  const alerts = resolveAlerts(termCfg?.alerts)
  const state = status?.state ?? 'idle'
  const statusClass = alerts.border ? `term-status term-${state}` : ''
  const needsInput = state === 'needs-input'
  const baseName = pane?.config.name ?? pane?.config.kind ?? 'Pane'
  const title = (needsInput ? '🔔 ' : '') + baseName

  // Maximize: mark this pane's mosaic tile so CSS can fill it and hide siblings. The attribute is
  // not React-managed, so it survives react-mosaic re-renders; !important CSS overrides the inline
  // tile geometry. Re-applied whenever the maximize flag changes.
  useLayoutEffect(() => {
    const tile = tileRef.current?.closest('.mosaic-tile') as HTMLElement | null
    if (!tile) return
    if (isMax) tile.setAttribute('data-max', '1')
    else tile.removeAttribute('data-max')
    return () => { tile.removeAttribute('data-max') }
  }, [isMax])

  const startRename = () => { setRenameText(pane?.config.name ?? '') ; setRenaming(true) }
  const commitRename = () => {
    const n = renameText.trim()
    updatePaneConfig(wsId, paneId, { name: n || undefined })
    setRenaming(false)
  }

  // MosaicWindow already wraps this return in `.mosaic-window-toolbar` and applies connectDragSource
  // to it, so drag-to-rearrange is preserved. Return a SINGLE element (no extra
  // `.mosaic-window-toolbar` class — that would double-nest and shift the strip height) carrying
  // onContextMenu over the whole bar.
  const renderToolbar = () => (
    <div data-testid={`titlebar-${paneId}`}
      onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }) }}
      style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      {renaming ? (
        <input data-testid={`pane-rename-${paneId}`} autoFocus value={renameText}
          onFocus={e => e.currentTarget.select()}
          onChange={e => setRenameText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenaming(false) }}
          onBlur={commitRename}
          style={{ flex: 1, minWidth: 0 }} />
      ) : (
        <div className="mosaic-window-title" title={title} style={{ flex: 1, minWidth: 0 }}>{title}</div>
      )}
      <div className="mosaic-window-controls" style={{ display: 'flex', alignItems: 'center' }}>
        <PaneToolbar wsId={wsId} paneId={paneId} isTerminal={!!termCfg} chipText={chipText}
          recording={recording} toggle={toggle} />
      </div>
    </div>
  )

  return (
    <MosaicWindow<string> path={path} title={title} className={statusClass} renderToolbar={renderToolbar}>
      <div ref={tileRef} className="term-tile" data-status={state}
        data-testid={`tile-${paneId}`} data-cwd={cwd}
        onMouseDownCapture={() => setFocusedPane(paneId)}
        style={{ ...themeCssVarsPartial(pane?.config.theme ?? {}), position: 'relative', height: '100%' }}>
        {menu === 'proc' && (
          <ProcessPopover paneId={paneId} procInfo={procInfo} aiSession={aiSession} usage={usage} onClose={close} />
        )}
        {menu === 'schedule' && <ScheduleDialog paneId={paneId} onClose={close} />}
        {menu === 'cwd' && <CwdMenu wsId={wsId} paneId={paneId} cwd={cwd} onClose={close} />}
        {pane?.config.kind === 'terminal' && termCfg && <TerminalPane paneId={paneId} wsId={wsId} config={termCfg} />}
        {pane?.config.kind === 'editor' && <EditorPane paneId={paneId} wsId={wsId} config={pane.config} />}
        {pane?.config.kind === 'explorer' && <ExplorerPane paneId={paneId} wsId={wsId} config={pane.config} />}
        {!pane && <div>missing pane</div>}
      </div>
      {ctx && <PaneContextMenu wsId={wsId} paneId={paneId} x={ctx.x} y={ctx.y}
        onRename={startRename} onClose={() => setCtx(null)} />}
    </MosaicWindow>
  )
}
