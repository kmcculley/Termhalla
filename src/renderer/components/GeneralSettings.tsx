import { useStore } from '../store'
import { api } from '../api'

/** App-wide terminal/recording preferences (was scattered across the per-pane
 *  TerminalSettings popover and the tab-bar shell picker). */
export function GeneralSettings() {
  const shells = useStore(s => s.shells)
  const shellId = useStore(s => s.newTerminalShellId)
  const setShell = useStore(s => s.setNewTerminalShell)
  const recordByDefault = useStore(s => s.quick.recordByDefault)
  const setRecordByDefault = useStore(s => s.setRecordByDefault)
  const autoResumeClaude = useStore(s => s.quick.autoResumeClaude)
  const setAutoResumeClaude = useStore(s => s.setAutoResumeClaude)
  const copyOnSelect = useStore(s => s.quick.copyOnSelect)
  const setCopyOnSelect = useStore(s => s.setCopyOnSelect)
  const toastsEnabled = useStore(s => s.quick.toastsEnabled)
  const setToastsEnabled = useStore(s => s.setToastsEnabled)
  return (
    <div data-testid="settings-general" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Default shell for new terminals</span>
        <select data-testid="general-shell" value={shellId ?? ''} onChange={e => setShell(e.target.value)}>
          {shells.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="rec-default" type="checkbox" checked={!!recordByDefault}
          onChange={e => setRecordByDefault(e.target.checked)} />
        Record new terminals by default
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="auto-resume-claude" type="checkbox" checked={autoResumeClaude !== false}
          onChange={e => setAutoResumeClaude(e.target.checked)} />
        Resume Claude in restored terminals (claude --resume)
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="copy-on-select" type="checkbox" checked={copyOnSelect !== false}
          onChange={e => setCopyOnSelect(e.target.checked)} />
        Copy terminal selection to clipboard on select
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="toasts-enabled" type="checkbox" checked={toastsEnabled === true}
          onChange={e => setToastsEnabled(e.target.checked)} />
        Show success and info toast notifications (errors always show)
      </label>
      <div>
        <button data-testid="rec-folder" onClick={() => api.recReveal()}>Open recordings folder</button>
      </div>
    </div>
  )
}
