import { v4 as uuid } from 'uuid'
import type { State, SliceDeps, Toast, ToastKind } from './types'

type ToastsSlice = Pick<State, 'toasts' | 'pushToast' | 'dismissToast'>

/** Ephemeral bottom-right notifications. Pure: auto-dismiss timers live in the Toasts
 *  component, never here, so the store has no side effects to test around. Capped so a
 *  burst of saves can't grow the stack unbounded. */
const MAX_TOASTS = 4

export function createToastsSlice({ set, get }: SliceDeps): ToastsSlice {
  return {
    toasts: [],
    pushToast: (text, kind: ToastKind = 'success') => {
      // Single global chokepoint (REQ-005/006/010): success/info toasts render only when explicitly
      // enabled (absent/false preference => suppressed), but `error`-kind toasts ALWAYS enqueue —
      // the disable preference must never swallow a failure signal (e.g. editor "Save failed").
      // The string-id return contract is preserved so no call site special-cases the disabled state.
      const id = uuid()
      if (kind !== 'error' && get().quick.toastsEnabled !== true) return id
      const toast: Toast = { id, kind, text }
      set(s => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }))
      return id
    },
    dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  }
}
