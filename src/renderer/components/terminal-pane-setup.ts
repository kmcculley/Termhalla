/**
 * The separable concerns of TerminalPane's single mount effect, extracted as named `setup*`
 * functions (quality audit 2026-07-17, finding 8 — a pure mechanical extraction, zero behavior
 * change). Each wires ONE concern of a freshly-constructed terminal and returns a {@link Dispose};
 * TerminalPane's effect stays the single mount/unmount owner and calls them in the exact
 * pre-extraction order — the concerns were NOT split into per-concern effects with their own dep
 * arrays, which would fight the documented invariants (one mount, one spawn, one teardown).
 *
 * This module must never import `../api` (it reads `window.termhalla` at module load and throws
 * under vitest's node env) or the store (which imports it transitively) — every side effect is
 * injected by TerminalPane, the same convention `redraw.ts` / `grid-sync.ts` / `terminal-clipboard.ts`
 * already prove, so the trickiest pieces (the auto-resume quiet timer, the alt-screen repaint
 * debounce) are unit-testable with fakes.
 */
import type { Terminal } from '@xterm/xterm'
import { nextFontSize } from '@shared/font-zoom'
import { handleClipboardKey } from './terminal-clipboard'

/** Undo one setup concern. TerminalPane's teardown runs these in its pre-extraction order; each
 *  dispose keeps its own concern's internal teardown order. */
export type Dispose = () => void

/** How long the visual-bell border flash stays visible. */
export const BELL_FLASH_MS = 450

/** Output-quiet window after a restored shell's prompt before auto-typing `claude --resume`. */
export const RESUME_QUIET_MS = 700

/** Output-quiet window after entering the alternate screen (tmux/TUI launch) before a one-shot repaint. */
export const ALT_SCREEN_REFRESH_MS = 200

/** The auto-resume quiet-timer mechanics. The fresh-spawn GATING stays with the spawn in
 *  TerminalPane (see the comment there and `shouldAutoResumeClaude`) — it calls `arm(want)` once
 *  when the spawn resolves, and `onData()` on every output chunk. Once armed true, the timer types
 *  the resume command exactly once after {@link RESUME_QUIET_MS} of output quiet; each chunk
 *  re-arms it, so it fires shortly after the restored shell's prompt appears — not before the
 *  shell is ready. Before `arm`, `onData` is a no-op (nothing is wanted yet); armed false never
 *  fires. */
export function setupAutoResume(deps: {
  /** Type `claude --resume\r` into the PTY (`api.ptyWrite`). */
  typeResume: () => void
}): { arm: (want: boolean) => void; onData: () => void; dispose: Dispose } {
  let wantResume = false
  let resumeTimer: ReturnType<typeof setTimeout> | undefined
  let resumed = false
  const scheduleResume = () => {
    if (!wantResume || resumed) return
    if (resumeTimer) clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => { resumed = true; deps.typeResume() }, RESUME_QUIET_MS)
  }
  return {
    arm: (want) => { wantResume = want; scheduleResume() },
    onData: scheduleResume,
    dispose: () => { if (resumeTimer) clearTimeout(resumeTimer) }
  }
}

/** Clipboard: Ctrl(+Shift)+C copies a selection (else ^C falls through), Ctrl(+Shift)+V /
 *  right-click / middle-click paste. Paste goes through term.paste() so it honors bracketed-
 *  paste mode (multi-line pastes into a shell or TUI don't auto-run); when the program has NOT
 *  enabled bracketed paste, a multi-line paste runs line-by-line — confirm it first.
 *  Returns the shared `paste` so the middle-click concern ({@link setupMiddleClickPaste}) reuses
 *  the same closure; the dispose removes the right-click listener (the custom key handler dies
 *  with the terminal). */
export function setupClipboard(term: Terminal, host: HTMLElement, deps: {
  /** `api.clipboardRead`. */
  readClipboard: () => Promise<string>
  /** `api.clipboardWrite`. */
  writeClipboard: (text: string) => void
  /** Clean a selection before it hits the clipboard (the cleanCopy-gated closure — see TerminalPane). */
  cleanCopy: (s: string) => string
  /** Whether a keydown matches an app-global shortcut (reads the live keybindings from the store). */
  isAppShortcut: (e: KeyboardEvent) => boolean
}): { paste: () => Promise<void>; dispose: Dispose } {
  const paste = async () => {
    const text = await deps.readClipboard()
    if (!text) return
    const lines = text.split('\n').length
    if (lines > 1 && !term.modes.bracketedPasteMode
        && !window.confirm(`Paste ${lines} lines? Bracketed paste is off, so each line will run as it lands.`)) return
    term.paste(text)
  }
  term.attachCustomKeyEventHandler(e => {
    // Let app-global shortcuts (command palette, workspace switch, …) reach App's window-level
    // keydown handler instead of being consumed by the terminal. xterm otherwise swallows e.g.
    // Ctrl+K when a terminal is focused — which, now that new panes auto-focus, would be most of
    // the time. Returning false makes xterm ignore the key without preventing/stopping it, so the
    // original event still bubbles to window. Only keydown matches; keyup/press fall through.
    if (e.type === 'keydown' && deps.isAppShortcut(e)) return false
    // handleClipboardKey calls e.preventDefault() for copy/paste so the browser's native
    // copy/paste DOM event doesn't ALSO fire xterm's built-in handler (which double-pastes).
    return handleClipboardKey(e, term.hasSelection(), {
      copy: () => { deps.writeClipboard(deps.cleanCopy(term.getSelection())); term.clearSelection() },
      paste: () => { void paste() }
    })
  })
  const onContextMenu = (e: MouseEvent) => { e.preventDefault(); void paste() }
  host.addEventListener('contextmenu', onContextMenu)
  return { paste, dispose: () => host.removeEventListener('contextmenu', onContextMenu) }
}

/** Copy-on-select: the instant a selection gesture ends (mouseup after a drag or multi-click),
 *  copy it to the clipboard — BEFORE incoming terminal output can clear the xterm selection out
 *  from under a later Ctrl+C (in a live pane, e.g. Claude printing, that race is what made copy
 *  "sometimes" fail). Ctrl+C stays as a manual copy/interrupt. The selection is left intact (not
 *  cleared) so it stays visible and re-copyable. Gated by the copyOnSelect setting (default on). */
export function setupCopyOnSelect(term: Terminal, host: HTMLElement, deps: {
  /** The copyOnSelect setting, read live per gesture. */
  enabled: () => boolean
  /** `api.clipboardWrite`. */
  writeClipboard: (text: string) => void
  /** The same cleanCopy-gated closure the clipboard keys use. */
  cleanCopy: (s: string) => string
}): Dispose {
  const onMouseUp = () => {
    if (!deps.enabled()) return
    const sel = term.getSelection()
    if (sel) deps.writeClipboard(deps.cleanCopy(sel))
  }
  host.addEventListener('mouseup', onMouseUp)
  return () => host.removeEventListener('mouseup', onMouseUp)
}

/** Middle-click pastes (the X11/terminal-emulator convention; sourced from the clipboard —
 *  Chromium has no primary-selection buffer). `paste` is the shared closure from
 *  {@link setupClipboard}. */
export function setupMiddleClickPaste(host: HTMLElement, paste: () => Promise<void>): Dispose {
  const onAuxClick = (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); void paste() } }
  host.addEventListener('auxclick', onAuxClick)
  return () => host.removeEventListener('auxclick', onAuxClick)
}

/** Dropping files pastes their quoted paths; dropping text pastes the text. preventDefault on
 *  dragover is what makes the drop land here instead of Electron navigating to the file. */
export function setupDragDrop(term: Terminal, host: HTMLElement, deps: {
  /** `api.pathForFile` — absolute filesystem path for a dropped DOM File. */
  pathForFile: (f: File) => string
}): Dispose {
  const onDragOver = (e: DragEvent) => { e.preventDefault() }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const dt = e.dataTransfer
    if (!dt) return
    const files = Array.from(dt.files ?? [])
    if (files.length) {
      const paths = files.map(f => deps.pathForFile(f)).filter(Boolean)
        .map(p => /\s/.test(p) ? `"${p}"` : p)
      if (paths.length) { term.paste(paths.join(' ')); term.focus() }
      return
    }
    const text = dt.getData('text/plain')
    if (text) { term.paste(text); term.focus() }
  }
  host.addEventListener('dragover', onDragOver)
  host.addEventListener('drop', onDrop)
  return () => {
    host.removeEventListener('dragover', onDragOver)
    host.removeEventListener('drop', onDrop)
  }
}

/** The slice of Terminal the visual bell watches (structural so the flash timing is unit-testable
 *  without xterm — the vitest convention for renderer modules). */
export interface BellTerm {
  onBell(cb: () => void): { dispose(): void }
}

/** Visual bell: BEL used to be silently dropped — flash a paint-only inset border (an overlay,
 *  never a box change — the ConPTY-repaint gotcha). */
export function setupVisualBell(term: BellTerm, deps: {
  /** Toggle the `term-bell-flash` class on the pane wrapper (React state). */
  setBell: (on: boolean) => void
}): Dispose {
  let bellTimer: ReturnType<typeof setTimeout> | undefined
  const bellDisp = term.onBell(() => {
    deps.setBell(true)
    if (bellTimer) clearTimeout(bellTimer)
    bellTimer = setTimeout(() => deps.setBell(false), BELL_FLASH_MS)
  })
  return () => {
    if (bellTimer) clearTimeout(bellTimer)
    bellDisp.dispose()
  }
}

/** "New output ▼" pill: when the user has scrolled up to read history and fresh output lands
 *  below, give them a cue + a one-click jump back. DOM scroll position is the ground truth.
 *  Returns `atBottom` for the pty:data handler (which sets the pill when output lands while
 *  scrolled up); the dispose removes the viewport scroll listener. */
export function setupNewOutputPill(host: HTMLElement, deps: {
  /** Show/hide the pill (React state). */
  setNewOutput: (on: boolean) => void
}): { atBottom: () => boolean; dispose: Dispose } {
  const viewportEl = host.querySelector('.xterm-viewport') as HTMLElement | null
  const atBottom = () => !viewportEl || viewportEl.scrollTop + viewportEl.clientHeight >= viewportEl.scrollHeight - 4
  const onViewportScroll = () => { if (atBottom()) deps.setNewOutput(false) }
  viewportEl?.addEventListener('scroll', onViewportScroll)
  return { atBottom, dispose: () => viewportEl?.removeEventListener('scroll', onViewportScroll) }
}

/** Ctrl/Cmd + wheel zooms the terminal font (like editors/browsers). Capture phase + stop so
 *  xterm doesn't also scroll the buffer; writes the global termFontSize, which TerminalPane's
 *  theme effect re-applies and re-fits across every terminal. passive:false so preventDefault
 *  sticks. */
export function setupWheelZoom(term: Terminal, host: HTMLElement, deps: {
  /** Write the global termFontSize (store `setTheme`). */
  setTermFontSize: (size: number) => void
}): Dispose {
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault(); e.stopPropagation()
    const cur = term.options.fontSize ?? 13
    const next = nextFontSize(cur, e.deltaY)
    if (next !== cur) deps.setTermFontSize(next)
  }
  host.addEventListener('wheel', onWheel, { passive: false, capture: true })
  return () => host.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
}

/** The slice of Terminal the alt-screen repaint watches (structural so the debounce is
 *  unit-testable without xterm). */
export interface AltScreenTerm {
  buffer: { onBufferChange(cb: (b: { type: string }) => void): { dispose(): void } }
  onWriteParsed(cb: () => void): { dispose(): void }
}

/** tmux/vim/less… switch to the alternate screen when they launch; under xterm's DOM renderer that
 *  first full-screen frame occasionally draws garbled (a known renderer miss that a repaint cures
 *  — the same thing the manual Redraw does; subsequent frames are fine). So when we enter the
 *  alternate buffer, repaint once after the initial draw settles. Over ssh the remote tmux isn't in
 *  the local process tree, but the alt-screen switch IS in the byte stream xterm parses, so this
 *  catches it. Re-arms on each alt entry (detach/reattach, another TUI); harmless no-op otherwise. */
export function setupAltScreenRepaint(term: AltScreenTerm, deps: {
  /** Repaint xterm from its own buffer (`term.refresh`) — never changes the grid. */
  repaint: () => void
}): Dispose {
  let altPending = false
  let altTimer: ReturnType<typeof setTimeout> | undefined
  const bumpAlt = () => {
    if (!altPending) return
    if (altTimer) clearTimeout(altTimer)
    altTimer = setTimeout(() => { altPending = false; deps.repaint() }, ALT_SCREEN_REFRESH_MS)
  }
  const offBufferChange = term.buffer.onBufferChange(b => {
    if (b.type === 'alternate') { altPending = true; bumpAlt() }
    else { altPending = false; if (altTimer) clearTimeout(altTimer) }
  })
  const offWriteParsed = term.onWriteParsed(() => bumpAlt())  // debounce the one-shot until output quiets
  return () => {
    if (altTimer) clearTimeout(altTimer)
    offBufferChange.dispose()
    offWriteParsed.dispose()
  }
}
