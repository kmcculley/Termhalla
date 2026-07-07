import { ipcMain, Notification, BrowserWindow, type WebContents } from 'electron'
import { CH, type PtySpawnArgs, type PtyWriteArgs, type PtyResizeArgs, type NotifyArgs } from '@shared/ipc-contract'
import type { ShellInfo } from '@shared/types'
import { PtyManager } from '../pty/pty-manager'
import { StatusEngine } from '../status/status-engine'
import type { OrkyHeartbeat } from '../status/orky-osc-parser'
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
  deps: {
    shells: ShellInfo[]; recorder: Recorder; envVault: EnvVault; scriptDir: string; send: Send
    // Multi-window: associate a pane with the window that spawned it, and (when a moved pane
    // re-spawns into a new window) adopt the live pty by replaying its snapshot instead of respawning.
    claimPane?: (paneId: string, sender: WebContents) => void
    replayInto?: (paneId: string) => void
    // Same-window minimize/restore: arm the buffered transit so gap-window pty:data isn't dropped.
    // Takes the sender so main can verify the caller actually owns the pane (C5 / FINDING-SEC-003).
    beginTransit?: (paneId: string, sender: WebContents) => void
    // Git status hooks: forward the cwd + command-done + pane-gone signals the engine already emits.
    onCwd?: (paneId: string, cwd: string) => void
    onCommandDone?: (paneId: string) => void
    onPaneGone?: (paneId: string) => void
    // feature 0014: forward each validated Orky OSC heartbeat StatusEngine decodes from PTY output
    // (a pure pass-through — the fs/stream combine + orky:status emit happens in the bridge this is
    // wired to at the composition root, never here).
    onOrkyHeartbeat?: (paneId: string, hb: OrkyHeartbeat) => void
    indexer: import('../search/indexer').Indexer
    // feature 0022: the remote-workspace router. A spawn carrying args.remote is delegated to it
    // (short-circuiting the ENTIRE local stack: no StatusEngine/tracker/ai/recorder/indexer —
    // REQ-011); write/resize/kill probe remote.owns(id) first. When no remote workspace exists the
    // probe is a Map miss and the local path is byte-identical (REQ-019).
    remote?: import('../remote/remote-workspace-manager').RemoteWorkspaceManager
  }
): PtyManager {
  const { shells, recorder, envVault, scriptDir, send } = deps

  // `ai` only needs send (and `engine`, referenced lazily — see below), so it can be constructed
  // up front. `tracker` is in a genuine cycle (it needs pty.pidOf; pty needs engine; engine needs
  // tracker), so it stays a `let` assigned after pty — but the closures below only run on PTY
  // activity, long after assignment, so they reference it directly without `?.`/`!`.
  // The AI session also drives `engine.setAiActive` so the status tracker reads a quiet AI agent
  // as idle/awaiting (it sits at its own TUI prompt with markers latched busy). `engine` is
  // assigned just below; this closure only fires on process activity, after assignment.
  const ai = new AiSessionTracker((id, session) => {
    send(CH.aiSession, id, session)
    engine.setAiActive(id, session !== null)
  })
  let tracker: ProcessTracker
  const engine = new StatusEngine(
    (id, status) => { send(CH.ptyStatus, id, status); tracker.setBusy(id, status.state === 'busy') },
    (id, cwd) => { send(CH.ptyCwd, id, cwd); deps.onCwd?.(id, cwd); deps.indexer.setCwd(id, cwd) },
    undefined,
    (id) => { ai.commandDone(id); deps.onCommandDone?.(id) },
    (id, hb) => deps.onOrkyHeartbeat?.(id, hb)
  )
  const pty = new PtyManager(
    (id, data) => { send(CH.ptyData, id, data); recorder.data(id, data); deps.indexer.data(id, data) },
    (id, code) => { send(CH.ptyExit, id, code); tracker.unregister(id); ai.unregister(id); recorder.stop(id); send(CH.recState, id, { recording: false, file: null }); deps.onPaneGone?.(id); deps.indexer.remove(id) },
    engine, scriptDir
  )
  tracker = new ProcessTracker(
    (id) => pty.pidOf(id),
    (id, info) => { send(CH.ptyProcs, id, info); ai.onProcs(id, info) }
  )

  ipcMain.handle(CH.ptySpawn, (e, a: PtySpawnArgs) => {
    deps.claimPane?.(a.id, e.sender)   // record which window owns this pane (also re-affirmed after a move)
    if (a.remote) {
      // Remote-home workspace (feature 0022): delegate to the manager BEFORE any local machinery.
      // A pane already tracked on the live connection is a same-process remount (minimize/restore,
      // cross-workspace move, undock) — flush its transit buffer and adopt, exactly the local
      // pty.has branch below; otherwise the manager attach-or-spawns against its inventory.
      if (deps.remote?.isAdoptable(a.id)) { deps.replayInto?.(a.id); return true }
      return deps.remote ? deps.remote.spawn(a) : false
    }
    // Moved pane: adopt the live pty, don't respawn. Adoption also re-delivers the pane's sticky
    // AI session to the (possibly NEW) owning window: aiSession pushes are pane-scoped and the
    // tracker's set-only dedup never re-emits for a QUIET agent, so an undocked Claude pane's
    // destination window would otherwise stay ✨-dark for the session's remainder (the survival
    // observable undock-resume.spec.ts pins; see AiSessionTracker.reemit).
    if (pty.has(a.id)) { deps.replayInto?.(a.id); ai.reemit(a.id); return true }
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    tracker.register(a.id)   // register BEFORE spawn: a failed spawn calls onExit->unregister synchronously, keeping the registry clean
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows, a.launch, envVault.envFor(a.envId))
    return false   // fresh spawn (adopted=true above) — the renderer's auto-resume gate needs this distinction
  })
  ipcMain.on(CH.ptyWrite, (_e, a: PtyWriteArgs) => {
    if (deps.remote?.owns(a.id)) { deps.remote.write(a.id, a.data); return }
    pty.write(a.id, a.data)
  })
  ipcMain.on(CH.ptyResize, (_e, a: PtyResizeArgs) => {
    if (deps.remote?.owns(a.id)) { deps.remote.resize(a.id, a.cols, a.rows); return }
    pty.resize(a.id, a.cols, a.rows); recorder.resize(a.id, a.cols, a.rows)
  })
  // ai/tracker unregister here is synchronous; the async pty onExit fires them again but
  // both are idempotent (Map.delete returns false), so the renderer sees a single clear.
  ipcMain.on(CH.ptyKill, (_e, id: string) => {
    if (deps.remote?.owns(id)) { deps.remote.kill(id); return }
    pty.kill(id); tracker.unregister(id); ai.unregister(id); deps.onPaneGone?.(id); deps.indexer.remove(id)
  })
  // Same-window minimize/restore: arm the buffered transit BEFORE the source TerminalPane unmounts,
  // so pty:data emitted during the unmount→remount gap is buffered and replayed on re-adoption.
  ipcMain.on(CH.ptyTransitBegin, (e, id: string) => deps.beginTransit?.(id, e.sender))

  ipcMain.on(CH.notify, (e, a: NotifyArgs) => {
    if (!Notification.isSupported()) return
    // Focus the window that raised the notification (an undocked window, not always main) — but
    // capture only its id, never the BrowserWindow: OS toasts persist in the Action Center past
    // the window's life (a floating window destroyed on redock), and .show() on a destroyed
    // window throws uncaught in the click listener — the modal-freeze failure mode. Re-resolve
    // at click time, falling back to any live window.
    const raiser = BrowserWindow.fromWebContents(e.sender)
    const targetId = raiser && !raiser.isDestroyed() ? raiser.id
      : !win.isDestroyed() ? win.id : null
    const n = new Notification({ title: a.title, body: a.body })
    n.on('click', () => {
      const t = (targetId !== null ? BrowserWindow.fromId(targetId) : null)
        ?? BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
      if (t && !t.isDestroyed()) { t.show(); t.focus() }
    })
    n.show()
  })

  return pty
}
