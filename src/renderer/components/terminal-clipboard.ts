export type ClipboardAction = 'copy' | 'paste' | null

/** Minimal shape of the key event we inspect — a real DOM `KeyboardEvent` satisfies it
 *  structurally. Kept DOM-free so this stays pure/unit-testable. */
export interface ClipboardKeyEvent {
  type: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  key: string
}

/** Decide what a terminal key event means for the clipboard.
 *  - Ctrl/Cmd+C with a selection -> 'copy'; without -> null (let ^C through to the PTY).
 *  - Ctrl/Cmd+V -> 'paste'.
 *  - Anything else (non-keydown, Alt or Shift held, other keys) -> null. */
export function clipboardKeyAction(e: ClipboardKeyEvent, hasSelection: boolean): ClipboardAction {
  if (e.type !== 'keydown') return null
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null
  const key = e.key.toLowerCase()
  if (key === 'c') return hasSelection ? 'copy' : null
  if (key === 'v') return 'paste'
  return null
}
