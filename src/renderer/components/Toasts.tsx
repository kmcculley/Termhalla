import { useEffect } from 'react'
import { useStore } from '../store'
import { SURFACE } from './Modal'
import type { Toast } from '../store/types'

const ACCENT: Record<Toast['kind'], string> = {
  success: 'var(--accent, #1e88e5)',
  error: 'var(--status-needs, #ff8f00)',
  info: 'var(--border, #444)'
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore(s => s.dismissToast)
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id, dismiss])
  return (
    <div data-testid="toast" className="ui-pop-in" onClick={() => dismiss(toast.id)}
      style={{ ...SURFACE, pointerEvents: 'auto', cursor: 'pointer', padding: '6px 10px',
        borderLeft: `3px solid ${ACCENT[toast.kind]}`, maxWidth: 320,
        fontSize: 'var(--font-size, 13px)' }}>
      {toast.text}
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
