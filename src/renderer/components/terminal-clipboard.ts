export type ClipboardAction = 'copy' | 'paste' | null

/** Decide what a terminal key event means for the clipboard.
 *  - Ctrl/Cmd+C with a selection -> 'copy'; without -> null (let ^C through to the PTY).
 *  - Ctrl/Cmd+V -> 'paste'.
 *  - Anything else (non-keydown, Alt or Shift held, other keys) -> null. */
export function clipboardKeyAction(
  e: Pick<KeyboardEvent, 'type' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key'>,
  hasSelection: boolean
): ClipboardAction {
  if (e.type !== 'keydown') return null
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null
  const key = e.key.toLowerCase()
  if (key === 'c') return hasSelection ? 'copy' : null
  if (key === 'v') return 'paste'
  return null
}
