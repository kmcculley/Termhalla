/**
 * Per-pane imperative-hook registry. Each mounted pane registers small imperative callbacks here
 * (serialize its xterm buffer, focus its terminal/editor); the store and overlays read them without
 * routing imperative DOM through serializable zustand state. Kept out of the store deliberately:
 * xterm/Monaco instances are imperative DOM, not serializable.
 */

/** One per-pane hook registry: paneId → imperative callback. The seven hook kinds below
 *  (serializers, focusers, dirty checks, redrawers, clearers, find openers, respawners) all share
 *  this map + register/unregister shape — only their invoke wrappers differ (a fallback value vs a
 *  ran/not-ran boolean), so those stay bespoke per kind. Exported for its unit test. */
export function createPaneHookRegistry<T>(): {
  register: (paneId: string, fn: T) => void
  unregister: (paneId: string) => void
  get: (paneId: string) => T | undefined
} {
  const hooks = new Map<string, T>()
  return {
    register: (paneId, fn) => { hooks.set(paneId, fn) },
    unregister: (paneId) => { hooks.delete(paneId) },
    get: (paneId) => hooks.get(paneId)
  }
}

const serializers = createPaneHookRegistry<() => string>()

export function registerSerializer(paneId: string, fn: () => string): void { serializers.register(paneId, fn) }
export function unregisterSerializer(paneId: string): void { serializers.unregister(paneId) }

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
const focusers = createPaneHookRegistry<() => boolean>()
export function registerFocuser(paneId: string, fn: () => boolean): void { focusers.register(paneId, fn) }
export function unregisterFocuser(paneId: string): void { focusers.unregister(paneId) }

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

/** The slice of a DOM element the focus-steal guard reads (kept structural so pure logic stays
 *  unit-testable without a DOM — the vitest convention for renderer modules). */
export interface FocusOwnerLike {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

/** True when keyboard focus is in an editable CHROME control — a text field OUTSIDE any pane body
 *  (the workspace rename input, dialog fields). Programmatic pane refocus must never steal from
 *  one: the retry loop would yank focus mid-typing, blur the field, and auto-commit it (the
 *  "cannot rename a workspace" bug). Pane-owned editables (xterm's helper textarea, Monaco's input)
 *  live under `.ws-mosaic` and do NOT count — switching workspaces away from a focused terminal
 *  still has to move focus. */
export function isEditableChromeFocus(el: FocusOwnerLike | null | undefined): boolean {
  if (!el) return false
  const tag = (el.tagName ?? '').toUpperCase()
  const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
  if (!editable) return false
  return !(el.closest?.('.ws-mosaic') ?? null)
}

// Via globalThis (like rafSchedule above): this module is also typechecked/imported under the
// node-env unit-test config, which has no DOM lib.
const gd = globalThis as unknown as { document?: { activeElement: FocusOwnerLike | null } }
const domActiveElement = (): FocusOwnerLike | null => gd.document?.activeElement ?? null

/** Focus a pane that may not be focusable yet: it might still be mounting (a just-created pane
 *  registers its focuser only after React commits the mount) or momentarily hidden (a workspace
 *  switch flips visibility on commit). Try now, and retry across the next frames until focus
 *  actually lands or we give up — but never steal from an editable chrome control (see
 *  isEditableChromeFocus), and stop the moment one takes focus mid-loop. */
export function requestPaneFocus(
  paneId: string,
  schedule: Schedule = rafSchedule,
  getActive: () => FocusOwnerLike | null = domActiveElement
): void {
  if (!paneId) return
  let tries = 0
  const attempt = () => {
    if (isEditableChromeFocus(getActive())) return
    if (!focusPane(paneId) && tries++ < FOCUS_RETRY_FRAMES) schedule(attempt)
  }
  attempt()
}

/**
 * Per-pane dirty checks. A mounted EditorPane registers a callback returning how many of its tabs
 * hold unsaved changes, so store.closePane can warn before a close discards them (closing the
 * PANE used to bypass the per-tab dirty confirm entirely — and delete the hot-exit drafts too).
 * Panes with nothing to lose (terminals, explorers) register none; 0 means "nothing at risk".
 */
const dirtyChecks = createPaneHookRegistry<() => number>()
export function registerDirtyCheck(paneId: string, fn: () => number): void { dirtyChecks.register(paneId, fn) }
export function unregisterDirtyCheck(paneId: string): void { dirtyChecks.unregister(paneId) }

/** How many unsaved buffers the pane would discard if closed now (0 when none / not mounted). */
export function paneDirtyCount(paneId: string): number { return dirtyChecks.get(paneId)?.() ?? 0 }

/**
 * Per-pane redraw hooks. A mounted TerminalPane registers a callback that re-fits and forces its
 * terminal (and any running TUI like Claude) to repaint — used by the "Redraw terminal" command to
 * fix a display garbled by a resize. Kept here with the other per-pane imperative hooks.
 */
const redrawers = createPaneHookRegistry<() => void>()
export function registerRedrawer(paneId: string, fn: () => void): void { redrawers.register(paneId, fn) }
export function unregisterRedrawer(paneId: string): void { redrawers.unregister(paneId) }

/** Redraw a pane now. Returns false if it has no live redrawer (not mounted / not a terminal). */
export function redrawPane(paneId: string): boolean {
  const fn = redrawers.get(paneId)
  if (!fn) return false
  fn()
  return true
}

/**
 * Per-pane clear hooks (QoL batch 2026-07-17): a mounted TerminalPane registers `term.clear()`
 * so the "Clear terminal" command/menu item can wipe the buffer + scrollback app-side (the shell's
 * own `clear` only scrolls the prompt to the top).
 */
const clearers = createPaneHookRegistry<() => void>()
export function registerClearer(paneId: string, fn: () => void): void { clearers.register(paneId, fn) }
export function unregisterClearer(paneId: string): void { clearers.unregister(paneId) }

/** Clear a pane's buffer + scrollback now. False if it has no live clearer (not a terminal). */
export function clearPane(paneId: string): boolean {
  const fn = clearers.get(paneId)
  if (!fn) return false
  fn()
  return true
}

/**
 * Per-pane find hooks (QoL batch 2026-07-17): a mounted TerminalPane registers an opener for its
 * in-pane find bar, so the "Find in terminal" command can raise it on the focused pane.
 */
const findOpeners = createPaneHookRegistry<() => void>()
export function registerFindOpener(paneId: string, fn: () => void): void { findOpeners.register(paneId, fn) }
export function unregisterFindOpener(paneId: string): void { findOpeners.unregister(paneId) }

/** Open a pane's find bar now. False if it has no live opener (not a terminal). */
export function openPaneFind(paneId: string): boolean {
  const fn = findOpeners.get(paneId)
  if (!fn) return false
  fn()
  return true
}

/**
 * Per-pane respawn hooks (the dead-pane restart affordance, phase1 M-3). When a shell exits on
 * its own the pane keeps its xterm and scrollback mounted — a restart is just a fresh PTY into
 * the same terminal, so a mounted TerminalPane registers a callback that re-issues its own
 * pty:spawn with the live grid. Kept here with the other imperative hooks.
 */
const respawners = createPaneHookRegistry<() => void>()
export function registerRespawner(paneId: string, fn: () => void): void { respawners.register(paneId, fn) }
export function unregisterRespawner(paneId: string): void { respawners.unregister(paneId) }

/** Respawn a dead pane's shell now. Returns false if it has no live respawner (not mounted /
 *  not a terminal). */
export function respawnPane(paneId: string): boolean {
  const fn = respawners.get(paneId)
  if (!fn) return false
  fn()
  return true
}
