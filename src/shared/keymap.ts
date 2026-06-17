export type Shortcut =
  | { type: 'toggle-palette' }
  | { type: 'toggle-broadcast' }
  | { type: 'new-terminal' }
  | { type: 'close-workspace' }
  | { type: 'next-workspace' }
  | { type: 'prev-workspace' }
  | { type: 'jump-workspace'; index: number }

interface KeyEvent { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

/** Map a keyboard event to a Shortcut, or null. Ctrl OR Meta satisfies "ctrl" for mac
 *  parity. Chords are chosen to avoid common shell/readline bindings; callers should
 *  preventDefault ONLY when this returns non-null so unmatched keys reach the terminal. */
export function matchShortcut(e: KeyEvent): Shortcut | null {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return null
  const k = e.key.toLowerCase()
  if (k === 'k' && !e.shiftKey) return { type: 'toggle-palette' }
  if (k === 'enter' && e.shiftKey) return { type: 'toggle-broadcast' }
  if (k === 't' && e.shiftKey) return { type: 'new-terminal' }
  if (k === 'w' && e.shiftKey) return { type: 'close-workspace' }
  if (k === 'tab') return { type: e.shiftKey ? 'prev-workspace' : 'next-workspace' }
  if (!e.shiftKey && k.length === 1 && k >= '1' && k <= '9') return { type: 'jump-workspace', index: Number(k) - 1 }
  return null
}
