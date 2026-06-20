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

/** Handle a terminal keydown for clipboard copy/paste, for use as xterm's custom key handler.
 *  Returns `false` when the key is a clipboard action (so xterm ignores it) and `true` otherwise
 *  (xterm processes the key normally).
 *
 *  Crucially, for a copy/paste it calls `e.preventDefault()`. Returning `false` from xterm's
 *  `attachCustomKeyEventHandler` makes xterm skip the key WITHOUT preventing the browser default —
 *  so Ctrl+V would still fire a native `paste` DOM event, which xterm's own built-in paste listener
 *  then handles, pasting the clipboard a SECOND time. preventDefault stops that native event. (Copy
 *  has the mirror problem: a native `copy` event would run after we've cleared the selection.) */
export function handleClipboardKey(
  e: ClipboardKeyEvent & { preventDefault(): void },
  hasSelection: boolean,
  handlers: { copy(): void; paste(): void }
): boolean {
  const action = clipboardKeyAction(e, hasSelection)
  if (!action) return true
  e.preventDefault()
  if (action === 'copy') handlers.copy()
  else handlers.paste()
  return false
}
