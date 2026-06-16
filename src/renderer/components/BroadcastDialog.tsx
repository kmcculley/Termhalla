import { useState } from 'react'
import { useStore } from '../store'
import { terminalPaneIds } from '@shared/broadcast'
import { Modal } from './Modal'

/** Common control sequences sent (raw keystrokes, no Enter) to all terminals on click. */
const QUICK_KEYS: { id: string; label: string; bytes: string }[] = [
  { id: 'esc', label: 'Esc', bytes: '\x1b' },
  { id: 'ctrl-c', label: 'Ctrl+C', bytes: '\x03' },
  { id: 'ctrl-d', label: 'Ctrl+D', bytes: '\x04' },
  { id: 'ctrl-z', label: 'Ctrl+Z', bytes: '\x1a' },
  { id: 'ctrl-l', label: 'Ctrl+L', bytes: '\x0c' },
  { id: 'tab', label: 'Tab', bytes: '\t' },
  { id: 'enter', label: 'Enter', bytes: '\r' },
  { id: 'up', label: '↑', bytes: '\x1b[A' },
  { id: 'down', label: '↓', bytes: '\x1b[B' }
]

export function BroadcastDialog() {
  const open = useStore(s => s.broadcastOpen)
  const setOpen = useStore(s => s.setBroadcastOpen)
  const broadcastInput = useStore(s => s.broadcastInput)
  const ws = useStore(s => (s.activeId ? s.workspaces[s.activeId] : null))
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'paste' | 'keys'>('keys')
  const [enter, setEnter] = useState(true)
  if (!open) return null
  const count = ws ? terminalPaneIds(ws).length : 0
  const send = () => { broadcastInput(text, mode, enter); setOpen(false); setText('') }
  return (
    <Modal onClose={() => setOpen(false)} backdropTestId="broadcast-dialog" card={{ padding: 12, width: 460 }}>
        <div style={{ fontWeight: 600 }}>Broadcast to all terminals</div>
        <textarea data-testid="broadcast-text" value={text} onChange={e => setText(e.target.value)} rows={4}
          autoFocus onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send() } }}
          style={{ fontFamily: 'var(--mono)', fontSize: 13 }} />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ opacity: 0.7 }}>Quick keys:</span>
          {QUICK_KEYS.map(k => (
            <button key={k.id} data-testid={`broadcast-key-${k.id}`} disabled={count === 0}
              title={`Send ${k.label} to all terminals`}
              onClick={() => broadcastInput(k.bytes, 'keys', false)}>{k.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label>Send as:&nbsp;
            <select data-testid="broadcast-mode" value={mode} onChange={e => setMode(e.target.value as 'paste' | 'keys')}>
              <option value="keys">Keystrokes</option>
              <option value="paste">Paste</option>
            </select>
          </label>
          <label><input data-testid="broadcast-enter" type="checkbox" checked={enter} onChange={e => setEnter(e.target.checked)} /> Send Enter after</label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ opacity: 0.7 }}>Send to {count} terminal{count === 1 ? '' : 's'}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setOpen(false)}>Cancel</button>
            <button data-testid="broadcast-send" disabled={count === 0} onClick={send}>Send</button>
          </span>
        </div>
    </Modal>
  )
}
