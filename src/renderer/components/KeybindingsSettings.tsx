import { useEffect, useState } from 'react'
import { useStore } from '../store'
import {
  COMMANDS, resolveBindings, eventToChord, formatChord, isValidRebind, findConflict, type CommandId
} from '@shared/keybindings'

/** View + rebind keyboard shortcuts. Overrides live on `quick` (per-machine). Capture mode reads
 *  the next keydown (capture-phase, so it pre-empts the app's global handler), validates it must
 *  include Ctrl/⌘, warns on conflict, then saves. Ctrl+1–9 (jump) is reserved/read-only. */
export function KeybindingsSettings() {
  const overrides = useStore(s => s.quick.keybindings)
  const setBinding = useStore(s => s.setBinding)
  const unbindCommand = useStore(s => s.unbindCommand)
  const resetBinding = useStore(s => s.resetBinding)
  const resetAllBindings = useStore(s => s.resetAllBindings)
  const [capturing, setCapturing] = useState<CommandId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resolved = resolveBindings(overrides)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setCapturing(null); setError(null); return }
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return // wait for the non-modifier key
      const chord = eventToChord(e)
      if (!isValidRebind(chord)) { setError('Shortcut must include Ctrl and cannot be Ctrl+1–9.'); return }
      const conflict = findConflict(resolved, chord, capturing)
      if (conflict) {
        const other = COMMANDS.find(c => c.id === conflict)!
        if (!window.confirm(`${formatChord(chord)} is already bound to "${other.label}". Reassign it? "${other.label}" will be unbound.`)) return
        unbindCommand(conflict)
      }
      setBinding(capturing, chord)
      setCapturing(null); setError(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, resolved, setBinding, unbindCommand])

  return (
    <div data-testid="settings-keybindings" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--fg-dim)' }}>Click Change, then press the new shortcut (must include Ctrl). Esc cancels.</span>
        <button data-testid="kb-reset-all" onClick={() => resetAllBindings()}>Reset all</button>
      </div>
      {error && <div data-testid="kb-error" style={{ color: 'var(--status-needs, #ff8f00)' }}>{error}</div>}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {COMMANDS.map(cmd => {
            const ch = resolved[cmd.id]
            return (
              <tr key={cmd.id} data-testid={`kb-row-${cmd.id}`}>
                <td style={{ padding: '3px 8px 3px 0' }}>{cmd.label}</td>
                <td data-testid={`kb-chord-${cmd.id}`} style={{ padding: '3px 8px', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                  {capturing === cmd.id ? 'Press shortcut…' : ch ? formatChord(ch) : 'Unbound'}
                </td>
                <td style={{ padding: '3px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button data-testid={`kb-change-${cmd.id}`}
                    onClick={() => { setError(null); setCapturing(capturing === cmd.id ? null : cmd.id) }}>
                    {capturing === cmd.id ? 'Cancel' : 'Change'}
                  </button>{' '}
                  <button data-testid={`kb-reset-${cmd.id}`} onClick={() => resetBinding(cmd.id)}>Reset</button>
                </td>
              </tr>
            )
          })}
          <tr data-testid="kb-row-jump">
            <td style={{ padding: '3px 8px 3px 0', color: 'var(--fg-dim)' }}>Jump to workspace 1–9</td>
            <td style={{ padding: '3px 8px', fontFamily: 'var(--mono)', color: 'var(--fg-dim)' }}>Ctrl+1…9</td>
            <td style={{ padding: '3px 0', textAlign: 'right', color: 'var(--fg-dim)' }}>reserved</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
