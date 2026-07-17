import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { SURFACE } from './Modal'
import type { Toast } from '../store/types'

const ACCENT: Record<Toast['kind'], string> = {
  success: 'var(--accent, #1e88e5)',
  error: 'var(--status-needs, #ff8f00)',
  info: 'var(--border, #444)'
}

/** How long a success/info toast stays before auto-dismissing. Error toasts never auto-dismiss:
 *  "Save failed" vanishing after 4s mid-read left no way to review the failure. */
const TOAST_DISMISS_MS = 4000

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore(s => s.dismissToast)
  const [hover, setHover] = useState(false)
  useEffect(() => {
    // Errors persist until dismissed; hovering pauses the timer (it restarts in full on leave).
    if (toast.kind === 'error' || hover) return
    const t = setTimeout(() => dismiss(toast.id), TOAST_DISMISS_MS)
    return () => clearTimeout(t)
  }, [toast.id, toast.kind, hover, dismiss])
  return (
    <div data-testid="toast" className="ui-pop-in" onClick={() => dismiss(toast.id)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...SURFACE, pointerEvents: 'auto', cursor: 'pointer', padding: '6px 10px',
        borderLeft: `3px solid ${ACCENT[toast.kind]}`, maxWidth: 320,
        fontSize: 'var(--font-size, 13px)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ flex: 1 }}>{toast.text}</span>
      <button data-testid="toast-dismiss" aria-label="Dismiss"
        onClick={e => { e.stopPropagation(); dismiss(toast.id) }}
        style={{ background: 'none', border: 'none', color: 'var(--fg-dim, #aaa)', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>✕</button>
    </div>
  )
}

/** Bottom-right transient notifications. The container ignores pointer events so it never
 *  blocks the app beneath; each card re-enables them to be click-dismissable. */
export function Toasts() {
  const toasts = useStore(s => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div data-testid="toasts" style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 2000,
      display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}
