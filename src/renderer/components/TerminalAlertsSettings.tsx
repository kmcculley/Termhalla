import type { TerminalConfig } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore } from '../store'

/** Per-pane terminal name + alert toggles (was the in-tile TerminalSettings popover).
 *  Needs a terminal pane in context; otherwise shows a hint. */
export function TerminalAlertsSettings({ wsId, paneId }: { wsId?: string; paneId?: string }) {
  const cfg = useStore(s => (wsId && paneId) ? s.workspaces[wsId]?.panes[paneId]?.config : undefined)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  if (!wsId || !paneId || !cfg || cfg.kind !== 'terminal') {
    return <div data-testid="settings-terminal" style={{ color: 'var(--fg-dim, #aaa)' }}>Right-click a terminal’s title bar → Settings to edit its name and alerts.</div>
  }
  const term = cfg as TerminalConfig
  const a = resolveAlerts(term.alerts)
  const change = (patch: Partial<TerminalConfig>) => updatePaneConfig(wsId, paneId, patch)
  const toggle = (key: keyof typeof a) => change({ alerts: { ...term.alerts, [key]: !a[key] } })
  return (
    <div data-testid="settings-terminal" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ display: 'block' }}>Name
        <input data-testid="setting-name" style={{ width: '100%' }} value={term.name ?? ''} placeholder="Terminal"
          onChange={e => change({ name: e.target.value })} />
      </label>
      {([['border', 'Status border'], ['tabBadge', 'Tab badge'],
         ['osNotification', 'OS notification'], ['needsInput', 'Needs-input detection']] as const).map(([key, label]) => (
        <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" data-testid={`setting-${key}`} checked={a[key]} onChange={() => toggle(key)} />
          {label}
        </label>
      ))}
    </div>
  )
}
