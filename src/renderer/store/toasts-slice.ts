import { v4 as uuid } from 'uuid'
import type { State, SliceDeps, Toast, ToastKind } from './types'

type ToastsSlice = Pick<State, 'toasts' | 'pushToast' | 'dismissToast'>

/** Ephemeral bottom-right notifications. Pure: auto-dismiss timers live in the Toasts
 *  component, never here, so the store has no side effects to test around. Capped so a
 *  burst of saves can't grow the stack unbounded. */
const MAX_TOASTS = 4

export function createToastsSlice({ set }: SliceDeps): ToastsSlice {
  return {
    toasts: [],
    pushToast: (text, kind: ToastKind = 'success') => {
      const id = uuid()
      const toast: Toast = { id, kind, text }
      set(s => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }))
      return id
    },
    dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  }
}
