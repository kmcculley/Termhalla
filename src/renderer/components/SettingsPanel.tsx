import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Modal'
import type { SettingsSection } from '../store/types'
import { GeneralSettings } from './GeneralSettings'
import { ThemeSettings } from './ThemeSettings'
import { EnvSettings } from './EnvSettings'
import { TerminalAlertsSettings } from './TerminalAlertsSettings'

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'environment', label: 'Environment' },
  { id: 'terminal', label: 'Terminal' }
]

export function SettingsPanel() {
  const settings = useStore(s => s.settings)
  const close = useStore(s => s.closeSettings)
  const activeId = useStore(s => s.activeId)
  const [section, setSection] = useState<SettingsSection>('general')
  // Re-seed the section each time the panel is (re)opened with a new target.
  const [seededFor, setSeededFor] = useState<object | null>(null)
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
      </div>
      <div style={{ flex: 1, padding: 14, overflow: 'auto' }}>
        {section === 'general' && <GeneralSettings />}
        {section === 'appearance' && <ThemeSettings paneId={settings.paneId} />}
        {section === 'environment' && <EnvSettings wsId={settings.paneId ? activeId ?? undefined : undefined} paneId={settings.paneId} />}
        {section === 'terminal' && <TerminalAlertsSettings wsId={settings.paneId ? activeId ?? undefined : undefined} paneId={settings.paneId} />}
      </div>
    </Modal>
  )
}
