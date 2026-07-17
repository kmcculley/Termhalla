import { useState } from 'react'
import { useStore } from '../store'
import { toMs, scheduleLabel } from '@shared/schedule'
import type { ScheduleTrigger } from '@shared/types'
import { Modal } from './Modal'

const numStyle = { width: 56 }

type TimeUnit = 'sec' | 'min'
interface Duration { value: number; unit: TimeUnit }

/** A number + sec/min unit pair — the shared shape behind the delay / every / jitter inputs. */
function DurationInput({ value, onChange, tid, min }: { value: Duration; onChange: (d: Duration) => void; tid: string; min: number }) {
  return (
    <>
      <input data-testid={`${tid}-value`} type="number" min={min} value={value.value}
        onChange={e => onChange({ ...value, value: +e.target.value })} style={numStyle} />
      <select data-testid={`${tid}-unit`} value={value.unit} onChange={e => onChange({ ...value, unit: e.target.value as TimeUnit })}>
        <option value="sec">sec</option><option value="min">min</option>
      </select>
    </>
  )
}

export function ScheduleDialog({ paneId, onClose }: { paneId: string; onClose: () => void }) {
  const addSchedule = useStore(s => s.addSchedule)
  const cancelSchedule = useStore(s => s.cancelSchedule)
  const schedules = useStore(s => s.schedules)
  const pushToast = useStore(s => s.pushToast)
  const tasks = Object.values(schedules).filter(t => t.paneId === paneId)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'paste' | 'keys'>('keys')
  const [enter, setEnter] = useState(true)
  const [kind, setKind] = useState<'delay' | 'idle' | 'recurring'>('delay')
  const [delay, setDelay] = useState<Duration>({ value: 5, unit: 'sec' })
  const [every, setEvery] = useState<Duration>({ value: 30, unit: 'sec' })
  const [jitter, setJitter] = useState<Duration>({ value: 5, unit: 'sec' })

  const build = (): ScheduleTrigger =>
    kind === 'idle' ? { kind: 'idle' }
      : kind === 'delay' ? { kind: 'delay', ms: Math.max(1000, toMs(delay.value, delay.unit)) }
        : { kind: 'recurring', everyMs: Math.max(1000, toMs(every.value, every.unit)), jitterMs: Math.max(0, toMs(jitter.value, jitter.unit)) }

  const add = () => {
    const trigger = build()
    addSchedule({ paneId, text, mode, enter, trigger, label: scheduleLabel(trigger) })
    pushToast('Command scheduled')
    setText('')
  }

  return (
    <Modal onClose={onClose} backdropTestId="schedule-dialog" card={{ padding: 12, width: 480 }}>
        <div style={{ fontWeight: 600 }}>Schedule command for this terminal</div>
        <textarea data-testid="schedule-text" value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) { e.preventDefault(); add() } }}
          style={{ fontFamily: 'var(--mono)', fontSize: 13 }} />
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
          {kind === 'delay' && <DurationInput tid="schedule-delay" min={1} value={delay} onChange={setDelay} />}
          {kind === 'recurring' && <>
            every <DurationInput tid="schedule-every" min={1} value={every} onChange={setEvery} />
            ± <DurationInput tid="schedule-jitter" min={0} value={jitter} onChange={setJitter} />
          </>}
          <span style={{ flex: 1 }} />
          <button data-testid="schedule-close" onClick={onClose}>Close</button>
          <button data-testid="schedule-add" disabled={!text.trim()} title="Schedule (Ctrl+Enter)" onClick={add}>Schedule</button>
        </div>
        {tasks.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border, #444)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {tasks.map(t => (
              <div key={t.id} data-testid={`schedule-task-${t.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.label} — {t.text.split('\n')[0]}
                </span>
                <button data-testid={`schedule-cancel-${t.id}`} onClick={() => { cancelSchedule(t.id); pushToast('Schedule canceled') }}>×</button>
              </div>
            ))}
          </div>
        )}
    </Modal>
  )
}
