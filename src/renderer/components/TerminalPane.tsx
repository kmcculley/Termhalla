import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import type { TerminalConfig } from '@shared/types'
import { resolveTheme } from '@shared/theme'
import { useStore } from '../store'
import { useResolvedPaneTheme } from '../use-resolved-theme'
import { clipboardKeyAction } from './terminal-clipboard'
import { registerSerializer, unregisterSerializer } from './terminal-registry'

/** Scrollback lines captured when serializing a terminal for a window-handoff replay. */
const HANDOFF_SCROLLBACK_LINES = 1000

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
    termRef.current = term; fitRef.current = fit
    term.open(hostRef.current!)
    fit.fit()

    let disposed = false
    api.ptySpawn({
      id: paneId, shellId: config.shellId, cwd: config.cwd,
      cols: term.cols, rows: term.rows, launch: config.launch, envId: config.envId
    })
    if (useStore.getState().quick.recordByDefault) api.recStart(paneId)

    const offData = api.onPtyData((id, data) => { if (id === paneId) term.write(data) })
    const offExit = api.onPtyExit((id) => { if (id === paneId && !disposed) term.write('\r\n[process exited]\r\n') })
    const inputDisp = term.onData(d => api.ptyWrite({ id: paneId, data: d }))

    // Clipboard: Ctrl+C copies a selection (else ^C falls through), Ctrl+V / right-click paste.
    // Paste goes through term.paste() so it honors bracketed-paste mode (multi-line pastes into a
    // shell or TUI don't auto-run); it flows out via the inputDisp onData handler above.
    const paste = async () => { const text = await api.clipboardRead(); if (text) term.paste(text) }
    term.attachCustomKeyEventHandler(e => {
      const action = clipboardKeyAction(e, term.hasSelection())
      if (action === 'copy') { api.clipboardWrite(term.getSelection()); term.clearSelection(); return false }
      if (action === 'paste') { void paste(); return false }
      return true
    })
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); void paste() }
    hostRef.current!.addEventListener('contextmenu', onContextMenu)

    let lastCols = term.cols, lastRows = term.rows
    const ro = new ResizeObserver(() => {
      fit.fit()
      // Only resize the PTY when the grid actually changed. A redundant resize makes
      // ConPTY repaint, which can corrupt the status tail and break needs-input detection.
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols; lastRows = term.rows
        api.ptyResize({ id: paneId, cols: term.cols, rows: term.rows })
      }
    })
    ro.observe(hostRef.current!)

    return () => {
      disposed = true
      hostRef.current?.removeEventListener('contextmenu', onContextMenu)
      unregisterSerializer(paneId)
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
