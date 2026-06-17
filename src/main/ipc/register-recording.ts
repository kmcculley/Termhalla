import { ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { CH } from '@shared/ipc-contract'
import type { PtyManager } from '../pty/pty-manager'
import type { Recorder } from '../recording/recorder'
import type { Send, Disposer } from './types'

/** Fallback recording grid size when a pane's PTY size isn't known yet. */
const DEFAULT_REC_SIZE = { cols: 80, rows: 24 }

/** Asciinema-style session recording. `recorder` is shared with the PTY stack (it taps pty data
 *  + resize), so its lifecycle is owned here via the returned disposer. */
export function registerRecording(
  deps: { pty: PtyManager; recorder: Recorder; userDataDir: string; send: Send }
): Disposer {
  const { pty, recorder, userDataDir, send } = deps

  ipcMain.on(CH.recStart, (_e, id: string) => {
    const sz = pty.sizeOf(id) ?? DEFAULT_REC_SIZE
    const file = recorder.start(id, sz.cols, sz.rows, userDataDir)
    send(CH.recState, id, { recording: true, file })
  })
  ipcMain.on(CH.recStop, (_e, id: string) => { const f = recorder.stop(id); send(CH.recState, id, { recording: false, file: f }) })
  ipcMain.on(CH.recReveal, () => { void shell.openPath(join(userDataDir, 'recordings')) })

  return () => recorder.dispose()
}
