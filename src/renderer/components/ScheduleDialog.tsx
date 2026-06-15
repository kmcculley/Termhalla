import { useState } from 'react'
import { useStore } from '../store'
import { toMs, scheduleLabel } from '@shared/schedule'
import type { ScheduleTrigger } from '@shared/types'

const numStyle = { width: 56 }

export function ScheduleDialog({ paneId, onClose }: { paneId: string; onClose: () => void }) {
  const addSchedule = useStore(s => s.addSchedule)
  const cancelSchedule = useStore(s => s.cancelSchedule)
  const schedules = useStore(s => s.schedules)
  const tasks = Object.values(schedules).filter(t => t.paneId === paneId)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'paste' | 'keys'>('keys')
  const [enter, setEnter] = useState(true)
  const [kind, setKind] = useState<'delay' | 'idle' | 'recurring'>('delay')
  const [dV, setDV] = useState(5); const [dU, setDU] = useState<'sec' | 'min'>('sec')
  const [eV, setEV] = useState(30); const [eU, setEU] = useState<'sec' | 'min'>('sec')
  const [jV, setJV] = useState(5); const [jU, setJU] = useState<'sec' | 'min'>('sec')

  const build = (): ScheduleTrigger =>
    kind === 'idle' ? { kind: 'idle' }
      : kind === 'delay' ? { kind: 'delay', ms: Math.max(1000, toMs(dV, dU)) }
        : { kind: 'recurring', everyMs: Math.max(1000, toMs(eV, eU)), jitterMs: Math.max(0, toMs(jV, jU)) }

  const add = () => {
    const trigger = build()
    addSchedule({ paneId, text, mode, enter, trigger, label: scheduleLabel(trigger) })
    setText('')
  }

  const unit = (v: 'sec' | 'min', set: (u: 'sec' | 'min') => void, tid: string) => (
    <select data-testid={tid} value={v} onChange={e => set(e.target.value as 'sec' | 'min')}>
      <option value="sec">sec</option><option value="min">min</option>
    </select>
  )

  return (
    <div data-testid="schedule-dialog" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#252526', color: '#eee', border: '1px solid #444', borderRadius: 6, padding: 12, width: 480, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Schedule command for this terminal</div>
        <textarea data-testid="schedule-text" value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus
          style={{ fontFamily: 'Consolas, monospace', fontSize: 13 }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label>Send as:&nbsp;
            <select data-testid="schedule-mode" value={mode} onChange={e => setMode(e.target.value as 'paste' | 'keys')}>
              <option value="keys">Keystrokes</option><option value="paste">Paste</option>
            </select>
          </label>
          <label><input data-testid="schedule-enter" type="checkbox" checked={enter} onChange={e => setEnter(e.target.checked)} /> Send Enter</label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select data-testid="schedule-trigger" value={kind} onChange={e => setKind(e.target.value as 'delay' | 'idle' | 'recurring')}>
            <option value="delay">After delay</option>
            <option value="idle">When idle</option>
            <option value="recurring">Recurring</option>
          </select>
          {kind === 'delay' && <>
            <input data-testid="schedule-delay-value" type="number" min={1} value={dV} onChange={e => setDV(+e.target.value)} style={numStyle} />
            {unit(dU, setDU, 'schedule-delay-unit')}
          </>}
          {kind === 'recurring' && <>
            every <input data-testid="schedule-every-value" type="number" min={1} value={eV} onChange={e => setEV(+e.target.value)} style={numStyle} />
            {unit(eU, setEU, 'schedule-every-unit')}
            ± <input data-testid="schedule-jitter-value" type="number" min={0} value={jV} onChange={e => setJV(+e.target.value)} style={numStyle} />
            {unit(jU, setJU, 'schedule-jitter-unit')}
          </>}
          <span style={{ flex: 1 }} />
          <button data-testid="schedule-add" disabled={!text.trim()} onClick={add}>Schedule</button>
        </div>
        {tasks.length > 0 && (
          <div style={{ borderTop: '1px solid #444', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {tasks.map(t => (
              <div key={t.id} data-testid={`schedule-task-${t.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ flex: 1, fontFamily: 'Consolas, monospace', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.label} — {t.text.split('\n')[0]}
                </span>
                <button data-testid={`schedule-cancel-${t.id}`} onClick={() => cancelSchedule(t.id)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
