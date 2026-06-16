import { ipcMain, Notification, type BrowserWindow } from 'electron'
import { CH, type PtySpawnArgs, type PtyWriteArgs, type PtyResizeArgs, type NotifyArgs } from '@shared/ipc-contract'
import type { ShellInfo } from '@shared/types'
import { PtyManager } from '../pty/pty-manager'
import { StatusEngine } from '../status/status-engine'
import { ProcessTracker } from '../proc/process-tracker'
import { AiSessionTracker } from '../ai/ai-session-tracker'
import type { EnvVault } from '../env-vault/env-vault'
import type { Recorder } from '../recording/recorder'
import type { Send } from './types'

/** Build the PTY/status/process/ai stack (which is in a genuine construction cycle — see below)
 *  and register the terminal IPC handlers. Returns the PtyManager so the recording handlers can
 *  read pane sizes. */
export function registerPty(
  win: BrowserWindow,
  deps: { shells: ShellInfo[]; recorder: Recorder; envVault: EnvVault; scriptDir: string; send: Send }
): PtyManager {
  const { shells, recorder, envVault, scriptDir, send } = deps

  // `ai` only needs send, so it can be constructed up front. `tracker` is in a genuine cycle (it
  // needs pty.pidOf; pty needs engine; engine needs tracker), so it stays a `let` assigned after
  // pty — but the closures below only run on PTY activity, long after assignment, so they
  // reference it directly without `?.`/`!`.
  const ai = new AiSessionTracker((id, session) => send(CH.aiSession, id, session))
  let tracker: ProcessTracker
  const engine = new StatusEngine(
    (id, status) => { send(CH.ptyStatus, id, status); tracker.setBusy(id, status.state === 'busy') },
    (id, cwd) => send(CH.ptyCwd, id, cwd),
    undefined,
    (id) => ai.commandDone(id)
  )
  const pty = new PtyManager(
    (id, data) => { send(CH.ptyData, id, data); recorder.data(id, data) },
    (id, code) => { send(CH.ptyExit, id, code); tracker.unregister(id); ai.unregister(id); recorder.stop(id); send(CH.recState, id, { recording: false, file: null }) },
    engine, scriptDir
  )
  tracker = new ProcessTracker(
    (id) => pty.pidOf(id),
    (id, info) => { send(CH.ptyProcs, id, info); ai.onProcs(id, info) }
  )

  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    tracker.register(a.id)   // register BEFORE spawn: a failed spawn calls onExit->unregister synchronously, keeping the registry clean
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows, a.launch, envVault.envFor(a.envId))
  })
  ipcMain.on(CH.ptyWrite, (_e, a: PtyWriteArgs) => pty.write(a.id, a.data))
  ipcMain.on(CH.ptyResize, (_e, a: PtyResizeArgs) => { pty.resize(a.id, a.cols, a.rows); recorder.resize(a.id, a.cols, a.rows) })
  // ai/tracker unregister here is synchronous; the async pty onExit fires them again but
  // both are idempotent (Map.delete returns false), so the renderer sees a single clear.
  ipcMain.on(CH.ptyKill, (_e, id: string) => { pty.kill(id); tracker.unregister(id); ai.unregister(id) })

  ipcMain.on(CH.notify, (_e, a: NotifyArgs) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: a.title, body: a.body })
    n.on('click', () => { win.show(); win.focus() })
    n.show()
  })

  return pty
}
