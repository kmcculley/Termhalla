import { useState } from 'react'
import { MosaicWindow, type MosaicBranch } from 'react-mosaic-component'
import { resolveAlerts } from '@shared/alerts'
import { themeCssVarsPartial } from '@shared/theme'
import { useStore, paneCwd } from '../store'
import { TerminalPane } from './TerminalPane'
import { EditorPane } from './EditorPane'
import { ExplorerPane } from './ExplorerPane'
import { ScheduleDialog } from './ScheduleDialog'
import { PaneToolbar } from './PaneToolbar'
import { ProcessPopover } from './ProcessPopover'
import { CwdMenu } from './CwdMenu'

/** Which single in-tile overlay (if any) is open. One pane shows at most one at a time.
 *  (Theme/env/terminal settings now live in the unified Settings panel.) */
export type PaneMenu = 'proc' | 'cwd' | 'schedule'

/** Short, compact names for the idle process chip. */
const SHELL_CHIP_LABEL: Record<string, string> = {
  'Windows PowerShell': 'pwsh',
  'Command Prompt': 'cmd'
}

/** One mosaic tile: its toolbar, status chrome, in-tile menus, and the pane body (terminal /
 *  editor / explorer). Each tile owns its own menu state and subscribes only to the slices of
 *  store state for *its* pane, so per-pane runtime churn doesn't re-render sibling tiles. */
export function PaneTile({ wsId, paneId, path }: { wsId: string; paneId: string; path: MosaicBranch[] }) {
  const pane = useStore(s => s.workspaces[wsId]?.panes[paneId])
  const status = useStore(s => s.statuses[paneId])
  const procInfo = useStore(s => s.procs[paneId])
  const aiSession = useStore(s => s.aiSessions[paneId])
  const usage = useStore(s => s.usage[paneId])
  const recording = useStore(s => !!s.recording[paneId])
  const cwd = useStore(s => paneCwd(s, paneId))
  const shells = useStore(s => s.shells)
  const [menu, setMenu] = useState<PaneMenu | null>(null)
  const toggle = (m: PaneMenu) => setMenu(cur => (cur === m ? null : m))
  const close = () => setMenu(null)

  const termCfg = pane?.config.kind === 'terminal' ? pane.config : undefined
  const rawShellLabel = termCfg ? (shells.find(sh => sh.id === termCfg.shellId)?.label ?? termCfg.shellId) : ''
  const shellLabel = SHELL_CHIP_LABEL[rawShellLabel] ?? rawShellLabel
  const chipText = aiSession ? `✨ ${aiSession.label}${usage ? ` ${usage.contextPct}%` : ''}`
    : procInfo && procInfo.foreground ? `▶ ${procInfo.foreground}` : shellLabel

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
      toolbarControls={
        <PaneToolbar wsId={wsId} paneId={paneId} isTerminal={!!termCfg} chipText={chipText}
          recording={recording} envActive={!!termCfg?.envId} toggle={toggle} />
      }
    >
      <div className="term-tile" data-status={state}
        data-testid={`tile-${paneId}`} data-cwd={cwd}
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
    </MosaicWindow>
  )
}
