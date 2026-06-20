import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import type { TerminalConfig } from '@shared/types'
import { resolveTheme } from '@shared/theme'
import { nextFontSize } from '@shared/font-zoom'
import { matchShortcut, resolveBindings } from '@shared/keymap'
import { useStore } from '../store'
import { useResolvedPaneTheme } from '../use-resolved-theme'
import { handleClipboardKey } from './terminal-clipboard'
import { registerSerializer, unregisterSerializer, consumeSnapshot, registerFocuser, unregisterFocuser, registerRedrawer, unregisterRedrawer } from './terminal-registry'

/** Scrollback lines captured when serializing a terminal for a window-handoff replay. */
const HANDOFF_SCROLLBACK_LINES = 1000

/** Quiet window after the last resize before we repaint xterm once, so a drag doesn't repaint per frame. */
const RESIZE_SETTLE_MS = 150

/** Output-quiet window after a restored shell's prompt before auto-typing `claude --resume`. */
const RESUME_QUIET_MS = 700

/** Output-quiet window after entering the alternate screen (tmux/TUI launch) before a one-shot repaint. */
const ALT_SCREEN_REFRESH_MS = 200

export function TerminalPane({ paneId, wsId, config }: { paneId: string; wsId: string; config: TerminalConfig }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const t0 = resolveTheme(useStore.getState().quick.theme, useStore.getState().workspaces[wsId]?.theme, config.theme)
    const term = new Terminal({
      fontFamily: t0.termFontFamily, fontSize: t0.termFontSize, cursorBlink: true,
      theme: { background: t0.termBg, foreground: t0.termFg }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Serialize the screen + scrollback to ANSI on demand, so this terminal's visible content can
    // be replayed into a new window when its workspace is torn off / re-docked (see WindowManager).
    const serialize = new SerializeAddon()
    term.loadAddon(serialize)
    registerSerializer(paneId, () => serialize.serialize({ scrollback: HANDOFF_SCROLLBACK_LINES }))
    // Report whether focus actually landed: term.focus() is a no-op while the pane is hidden
    // (e.g. its workspace is mid-switch), and requestPaneFocus retries until it sticks.
    registerFocuser(paneId, () => { term.focus(); return document.activeElement === term.textarea })
    termRef.current = term; fitRef.current = fit
    term.open(hostRef.current!)
    fit.fit()

    // A cross-workspace move stashed this pane's prior scrollback; write it before spawn so it lands
    // ahead of any live output. For a fresh terminal this is '' (no-op). The PTY itself is re-adopted
    // by main (pty:spawn sees pty.has) — this only restores the renderer-side buffer.
    const restored = consumeSnapshot(paneId)
    if (restored) term.write(restored)

    let disposed = false
    api.ptySpawn({
      id: paneId, shellId: config.shellId, cwd: config.cwd,
      cols: term.cols, rows: term.rows, launch: config.launch, envId: config.envId
    })
    api.searchSetMuted(paneId, !!config.historyMuted)
    if (useStore.getState().quick.recordByDefault) api.recStart(paneId)

    // Auto-resume Claude: a pane that had Claude running at last save (config.resumeAi) types
    // `claude --resume` once — after the restored shell has printed its prompt and gone quiet. Using
    // an output-quiet timer (reset on each data chunk) is shell-agnostic: it fires shortly after the
    // prompt appears, not before the shell is ready. Off when the setting is disabled.
    const wantResume = config.resumeAi === 'claude' && useStore.getState().quick.autoResumeClaude !== false
    let resumeTimer: ReturnType<typeof setTimeout> | undefined
    let resumed = false
    const scheduleResume = () => {
      if (!wantResume || resumed) return
      if (resumeTimer) clearTimeout(resumeTimer)
      resumeTimer = setTimeout(() => { resumed = true; api.ptyWrite({ id: paneId, data: 'claude --resume\r' }) }, RESUME_QUIET_MS)
    }
    scheduleResume()

    const offData = api.onPtyData((id, data) => { if (id === paneId) { term.write(data); scheduleResume() } })
    const offExit = api.onPtyExit((id) => { if (id === paneId && !disposed) term.write('\r\n[process exited]\r\n') })
    const inputDisp = term.onData(d => api.ptyWrite({ id: paneId, data: d }))

    // Clipboard: Ctrl+C copies a selection (else ^C falls through), Ctrl+V / right-click paste.
    // Paste goes through term.paste() so it honors bracketed-paste mode (multi-line pastes into a
    // shell or TUI don't auto-run); it flows out via the inputDisp onData handler above.
    const paste = async () => { const text = await api.clipboardRead(); if (text) term.paste(text) }
    term.attachCustomKeyEventHandler(e => {
      // Let app-global shortcuts (command palette, workspace switch, …) reach App's window-level
      // keydown handler instead of being consumed by the terminal. xterm otherwise swallows e.g.
      // Ctrl+K when a terminal is focused — which, now that new panes auto-focus, would be most of
      // the time. Returning false makes xterm ignore the key without preventing/stopping it, so the
      // original event still bubbles to window. Only keydown matches; keyup/press fall through.
      if (e.type === 'keydown' && matchShortcut(e, resolveBindings(useStore.getState().quick.keybindings))) return false
      // handleClipboardKey calls e.preventDefault() for copy/paste so the browser's native
      // copy/paste DOM event doesn't ALSO fire xterm's built-in handler (which double-pastes).
      return handleClipboardKey(e, term.hasSelection(), {
        copy: () => { api.clipboardWrite(term.getSelection()); term.clearSelection() },
        paste: () => { void paste() }
      })
    })
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); void paste() }
    hostRef.current!.addEventListener('contextmenu', onContextMenu)

    // Ctrl/Cmd + wheel zooms the terminal font (like editors/browsers). Capture phase + stop so
    // xterm doesn't also scroll the buffer; writes the global termFontSize, which the theme effect
    // below re-applies and re-fits across every terminal. passive:false so preventDefault sticks.
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault(); e.stopPropagation()
      const cur = term.options.fontSize ?? 13
      const next = nextFontSize(cur, e.deltaY)
      if (next !== cur) useStore.getState().setTheme({ termFontSize: next })
    }
    hostRef.current!.addEventListener('wheel', onWheel, { passive: false, capture: true })

    // Repaint xterm from its own buffer — fixes xterm-side render glitches WITHOUT changing the grid,
    // so it can never desync xterm's size from the remote (which would jumble a TUI like tmux).
    const repaint = () => term.refresh(0, term.rows - 1)
    // Manual "Redraw terminal": re-fit, repaint, then nudge the PTY size so a running TUI (Claude,
    // tmux, …) redraws via SIGWINCH/ConPTY. The nudge's final resize re-syncs the PTY to the fitted
    // grid, so this stays size-consistent. It's a deliberate redundant resize (safe — the status tail
    // is ANSI-stripped), reserved for the explicit command, never the per-resize auto path.
    const redraw = () => {
      fit.fit()
      repaint()
      const { cols, rows } = term
      api.ptyResize({ id: paneId, cols: Math.max(cols - 1, 1), rows })
      api.ptyResize({ id: paneId, cols, rows })
    }
    registerRedrawer(paneId, redraw)

    // tmux/vim/less… switch to the alternate screen when they launch; under xterm's DOM renderer that
    // first full-screen frame occasionally draws garbled (a known renderer miss that a repaint cures
    // — the same thing the manual Redraw does; subsequent frames are fine). So when we enter the
    // alternate buffer, repaint once after the initial draw settles. Over ssh the remote tmux isn't in
    // the local process tree, but the alt-screen switch IS in the byte stream xterm parses, so this
    // catches it. Re-arms on each alt entry (detach/reattach, another TUI); harmless no-op otherwise.
    let altPending = false
    let altTimer: ReturnType<typeof setTimeout> | undefined
    const bumpAlt = () => {
      if (!altPending) return
      if (altTimer) clearTimeout(altTimer)
      altTimer = setTimeout(() => { altPending = false; repaint() }, ALT_SCREEN_REFRESH_MS)
    }
    const offBufferChange = term.buffer.onBufferChange(b => {
      if (b.type === 'alternate') { altPending = true; bumpAlt() }
      else { altPending = false; if (altTimer) clearTimeout(altTimer) }
    })
    const offWriteParsed = term.onWriteParsed(() => bumpAlt())  // debounce the one-shot until output quiets

    let lastCols = term.cols, lastRows = term.rows
    let settle: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      fit.fit()
      // Only resize the PTY when the grid actually changed. A redundant resize makes
      // ConPTY repaint, which can corrupt the status tail and break needs-input detection.
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols; lastRows = term.rows
        api.ptyResize({ id: paneId, cols: term.cols, rows: term.rows })
      }
      // After the user stops dragging, repaint once so xterm rendering self-corrects. Repaint only —
      // the RO above already fit + resized the PTY; calling fit() again here without a matching
      // ptyResize could desync xterm's grid from the remote and jumble a TUI (e.g. tmux over ssh).
      if (settle) clearTimeout(settle)
      settle = setTimeout(repaint, RESIZE_SETTLE_MS)
    })
    ro.observe(hostRef.current!)

    return () => {
      disposed = true
      hostRef.current?.removeEventListener('contextmenu', onContextMenu)
      hostRef.current?.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
      unregisterSerializer(paneId)
      unregisterFocuser(paneId)
      unregisterRedrawer(paneId)
      if (settle) clearTimeout(settle)
      if (resumeTimer) clearTimeout(resumeTimer)
      if (altTimer) clearTimeout(altTimer)
      offBufferChange.dispose(); offWriteParsed.dispose()
      ro.disconnect(); inputDisp.dispose(); offData(); offExit(); term.dispose()
      termRef.current = null; fitRef.current = null
    }
  // launch.args is an array; key the effect on a stable string of it (+ command) so an
  // SSH terminal re-spawns if its target changes, without re-running on unrelated renders.
  }, [paneId, config.shellId, config.cwd, config.launch?.command, JSON.stringify(config.launch?.args)])

  const theme = useResolvedPaneTheme(wsId, config.theme)
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = { background: theme.termBg, foreground: theme.termFg }
    term.options.fontFamily = theme.termFontFamily
    term.options.fontSize = theme.termFontSize
    fitRef.current?.fit()
  }, [theme])

  return <div data-testid={`terminal-${paneId}`} ref={hostRef} style={{ width: '100%', height: '100%' }} />
}
