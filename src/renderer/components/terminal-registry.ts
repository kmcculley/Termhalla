/**
 * Per-pane imperative-hook registry. Each mounted pane registers small imperative callbacks here
 * (serialize its xterm buffer, focus its terminal/editor); the store and overlays read them without
 * routing imperative DOM through serializable zustand state. Kept out of the store deliberately:
 * xterm/Monaco instances are imperative DOM, not serializable.
 */
const serializers = new Map<string, () => string>()

export function registerSerializer(paneId: string, fn: () => string): void { serializers.set(paneId, fn) }
export function unregisterSerializer(paneId: string): void { serializers.delete(paneId) }

/** The pane's current snapshot, or '' if it has no live terminal (not yet mounted / not a terminal). */
export function readPaneSnapshot(paneId: string): string { return serializers.get(paneId)?.() ?? '' }

/** Scrollback handed off when a pane moves between workspaces in the same window. The source
 *  TerminalPane's serialized ANSI is stashed here just before the layout move unmounts it, then
 *  consumed (once) by the destination TerminalPane on mount so the move keeps full scrollback. */
const pendingRestore = new Map<string, string>()
export function stashSnapshot(paneId: string, data: string): void { pendingRestore.set(paneId, data) }
export function consumeSnapshot(paneId: string): string {
  const d = pendingRestore.get(paneId)
  pendingRestore.delete(paneId)
  return d ?? ''
}

/**
 * Per-pane focus hooks. A mounted TerminalPane registers `term.focus()` and an EditorPane registers
 * `editor.focus()`, so the app can put the keyboard back where the user expects it — into the pane
 * they just created, the first pane of a workspace they switched to, or the active pane after a
 * dialog closes. Without this nothing ever calls focus(), so a fresh pane (or a pane behind a
 * just-closed overlay) silently swallows typing until the user clicks it.
 */
// A focuser returns whether focus actually landed: it calls term/editor focus() and reports back
// (e.g. document.activeElement === term.textarea). Reporting failure — not just absence — lets
// requestPaneFocus retry through a transient where the pane exists but can't take focus yet, such as
// a workspace mid-switch whose host is still `visibility: hidden` until React commits the change.
const focusers = new Map<string, () => boolean>()
export function registerFocuser(paneId: string, fn: () => boolean): void { focusers.set(paneId, fn) }
export function unregisterFocuser(paneId: string): void { focusers.delete(paneId) }

/** Focus a pane now. Returns false if it has no live focuser (not mounted) or focus didn't land
 *  (e.g. the pane is still hidden) — either way the caller should retry. */
export function focusPane(paneId: string): boolean {
  return focusers.get(paneId)?.() ?? false
}

/** Frames to keep retrying a focus request before giving up (~a few hundred ms at 60fps). */
const FOCUS_RETRY_FRAMES = 20
type Schedule = (cb: () => void) => void
const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number }
const rafSchedule: Schedule = (cb) =>
  (typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame(cb) : setTimeout(cb, 16))

/** Focus a pane that may not be focusable yet: it might still be mounting (a just-created pane
 *  registers its focuser only after React commits the mount) or momentarily hidden (a workspace
 *  switch flips visibility on commit). Try now, and retry across the next frames until focus
 *  actually lands or we give up. */
export function requestPaneFocus(paneId: string, schedule: Schedule = rafSchedule): void {
  if (!paneId) return
  let tries = 0
  const attempt = () => { if (!focusPane(paneId) && tries++ < FOCUS_RETRY_FRAMES) schedule(attempt) }
  attempt()
}
