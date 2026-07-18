import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Modal'
import type { SettingsSection } from '../store/types'
import { GeneralSettings } from './GeneralSettings'
import { ThemeSettings } from './ThemeSettings'
import { EnvSettings } from './EnvSettings'
import { TerminalAlertsSettings } from './TerminalAlertsSettings'
import { KeybindingsSettings } from './KeybindingsSettings'
import { PhoneRemoteSettings } from './PhoneRemoteSettings'

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'environment', label: 'Environment' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'keybindings', label: 'Keybindings' },
  // Feature 0026 v2 (REQ-029 — closes FINDING-010/024): the phone-remote settings/pairing surface
  // must be reachable through the REAL Settings navigation, not just built-and-unmounted.
  { id: 'phoneRemote', label: 'Phone' }
]

export function SettingsPanel() {
  const settings = useStore(s => s.settings)
  const close = useStore(s => s.closeSettings)
  const activeId = useStore(s => s.activeId)
  const [section, setSection] = useState<SettingsSection>('general')
  const [seededFor, setSeededFor] = useState<object | null>(null)
  // Snap to the requested section when the panel is re-targeted *while already open* (e.g. a pane's
  // 🎨 button while Settings shows General). React's sanctioned "adjust state during render" pattern
  // (no effect, no extra paint): each openSettings yields a fresh `settings` object, so an identity
  // change means a new open. (A fully closed→open cycle remounts and resets via useState anyway.)
  if (settings && settings !== seededFor) { setSection(settings.section); setSeededFor(settings) }
  if (!settings) return null

  return (
    <Modal onClose={close} backdropTestId="settings-backdrop" cardTestId="settings-panel"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': 'Settings' }}
      card={{ width: 680, height: '70vh', padding: 0, gap: 0, flexDirection: 'row' }}>
      <div style={{ width: 160, borderRight: '1px solid var(--border, #444)', padding: 8,
        display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECTIONS.map(s => (
          <button key={s.id} data-testid={`settings-nav-${s.id}`}
            onClick={() => setSection(s.id)}
            style={{ textAlign: 'left', background: section === s.id ? 'var(--sel-bg)' : 'transparent' }}>
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button data-testid="settings-close" onClick={close}>Close</button>
      </div>
      <div style={{ flex: 1, padding: 14, overflow: 'auto' }}>
        {section === 'general' && <GeneralSettings />}
        {section === 'appearance' && <ThemeSettings paneId={settings.paneId} />}
        {section === 'environment' && <EnvSettings wsId={settings.paneId ? activeId ?? undefined : undefined} paneId={settings.paneId} />}
        {section === 'terminal' && <TerminalAlertsSettings wsId={settings.paneId ? activeId ?? undefined : undefined} paneId={settings.paneId} />}
        {section === 'keybindings' && <KeybindingsSettings />}
        {section === 'phoneRemote' && <PhoneRemoteSettings />}
      </div>
    </Modal>
  )
}
