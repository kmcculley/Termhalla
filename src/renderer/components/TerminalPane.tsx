import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import type { TerminalConfig } from '@shared/types'
import { mergeTheme } from '@shared/theme'
import { useStore } from '../store'

export function TerminalPane({ paneId, config }: { paneId: string; config: TerminalConfig }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const t0 = mergeTheme(useStore.getState().quick.theme)
    const term = new Terminal({
      fontFamily: t0.termFontFamily, fontSize: t0.termFontSize, cursorBlink: true,
      theme: { background: t0.termBg, foreground: t0.termFg }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    termRef.current = term; fitRef.current = fit
    term.open(hostRef.current!)
    fit.fit()

    let disposed = false
    api.ptySpawn({
      id: paneId, shellId: config.shellId, cwd: config.cwd,
      cols: term.cols, rows: term.rows, launch: config.launch
    })

    const offData = api.onPtyData((id, data) => { if (id === paneId) term.write(data) })
    const offExit = api.onPtyExit((id) => { if (id === paneId && !disposed) term.write('\r\n[process exited]\r\n') })
    const inputDisp = term.onData(d => api.ptyWrite({ id: paneId, data: d }))

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
      ro.disconnect(); inputDisp.dispose(); offData(); offExit(); term.dispose()
      termRef.current = null; fitRef.current = null
    }
  // launch.args is an array; key the effect on a stable string of it (+ command) so an
  // SSH terminal re-spawns if its target changes, without re-running on unrelated renders.
  }, [paneId, config.shellId, config.cwd, config.launch?.command, JSON.stringify(config.launch?.args)])

  const quickTheme = useStore(s => s.quick.theme)
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const t = mergeTheme(quickTheme)
    term.options.theme = { background: t.termBg, foreground: t.termFg }
    term.options.fontFamily = t.termFontFamily
    term.options.fontSize = t.termFontSize
    fitRef.current?.fit()
  }, [quickTheme])

  return <div data-testid={`terminal-${paneId}`} ref={hostRef} style={{ width: '100%', height: '100%' }} />
}
