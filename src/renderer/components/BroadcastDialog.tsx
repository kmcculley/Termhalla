import { useState } from 'react'
import { useStore } from '../store'
import { terminalPaneIds } from '@shared/broadcast'

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
    <div data-testid="broadcast-dialog" onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#252526', color: '#eee', border: '1px solid #444', borderRadius: 6, padding: 12, width: 460, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Broadcast to all terminals</div>
        <textarea data-testid="broadcast-text" value={text} onChange={e => setText(e.target.value)} rows={4}
          autoFocus style={{ fontFamily: 'Consolas, monospace', fontSize: 13 }} />
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
      </div>
    </div>
  )
}
