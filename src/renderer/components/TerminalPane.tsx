import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import type { TerminalConfig } from '@shared/types'

export function TerminalPane({ paneId, config }: { paneId: string; config: TerminalConfig }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({ fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
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
    }
  // launch.args is an array; key the effect on a stable string of it (+ command) so an
  // SSH terminal re-spawns if its target changes, without re-running on unrelated renders.
  }, [paneId, config.shellId, config.cwd, config.launch?.command, JSON.stringify(config.launch?.args)])

  return <div data-testid={`terminal-${paneId}`} ref={hostRef} style={{ width: '100%', height: '100%' }} />
}
