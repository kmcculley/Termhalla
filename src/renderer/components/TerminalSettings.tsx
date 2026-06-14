import type { TerminalConfig } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'

export function TerminalSettings(
  { config, onChange, onClose }: {
    config: TerminalConfig
    onChange: (patch: Partial<TerminalConfig>) => void
    onClose: () => void
  }
) {
  const a = resolveAlerts(config.alerts)
  const toggle = (key: keyof typeof a) => onChange({ alerts: { ...config.alerts, [key]: !a[key] } })
  return (
    <div data-testid="terminal-settings"
      style={{ position: 'absolute', right: 4, top: 28, zIndex: 10, background: '#252526',
        color: '#eee', border: '1px solid #444', borderRadius: 4, padding: 8, width: 220 }}
      onClick={e => e.stopPropagation()}>
      <label style={{ display: 'block', marginBottom: 6 }}>
        Name
        <input data-testid="setting-name" style={{ width: '100%' }}
          value={config.name ?? ''} placeholder="Terminal"
          onChange={e => onChange({ name: e.target.value })} />
      </label>
      {([['border', 'Status border'], ['tabBadge', 'Tab badge'],
         ['osNotification', 'OS notification'], ['needsInput', 'Needs-input detection']] as const)
        .map(([key, label]) => (
        <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" data-testid={`setting-${key}`}
            checked={a[key]} onChange={() => toggle(key)} />
          {label}
        </label>
      ))}
      <button data-testid="settings-close" style={{ marginTop: 8 }} onClick={onClose}>Close</button>
    </div>
  )
}
