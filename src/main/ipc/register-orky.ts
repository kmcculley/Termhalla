import { ipcMain, type IpcMainEvent, type WebContents } from 'electron'
import { CH } from '@shared/ipc-contract'
import { OrkyTracker } from '../orky/orky-tracker'
import type { OrkyRootEngine } from '../orky/orky-root-engine'
import type { Send, Disposer } from './types'

/** Orky `.orky/` status watcher. Mirrors `registerUsage`: the tracker emits a pane-scoped
 *  `orky:status` push (routed to the owning window by `send`), and the returned disposer tears down
 *  every watcher this tracker owns on shutdown (CLAUDE.md long-lived-watcher obligation).
 *
 *  Hardened at the IPC boundary (REQ-024 / 0004): each handler (a) rejects a non-string `id`/`cwd` BEFORE
 *  touching the tracker — so a malformed IPC message cannot become an unhandled rejection that kills the
 *  main process (FINDING-SEC-001) — and (b) acts ONLY for events whose `sender` belongs to a
 *  currently-known app window (`isKnownWindowSender`, `WindowManager.isKnownWindowSender` in
 *  production), so a truly foreign/destroyed sender cannot open/cancel/leak a watcher.
 *
 *  Feature 0005 (TASK-009) widens 0004's "exactly one owning window" rule to "ANY known app window" —
 *  REQ-002/REQ-020 require pane-root membership aggregated across ALL windows, not just the single one
 *  0004 happened to scope to (the original FINDING-SEC-002 intent — reject a truly unrecognized sender —
 *  survives, just widened in scope; see 03-plan.md risk note #2). Every successful `watch()` resolution
 *  (including a `null` — no `.orky` ancestor) AND every `unwatch()` additionally calls `onPaneRoot(id,
 *  root)`, mirroring EXACTLY what `OrkyTracker.watch()` resolved — so the cross-project registry's pane
 *  membership needs no second `findOrkyRoot` walk (REQ-002/REQ-003). An optional shared `engine` lets the
 *  composition root wire ONE `OrkyRootEngine` instance across this tracker AND `OrkyRegistry`
 *  (REQ-014/REQ-020); omitted (e.g. in isolation/tests), the tracker owns and disposes a private one. */
export function registerOrky(
  send: Send,
  isKnownWindowSender: (sender: WebContents) => boolean,
  onPaneRoot: (id: string, root: string | null) => void,
  engine?: OrkyRootEngine
): Disposer {
  const orky = new OrkyTracker((id, status) => send(CH.orkyStatus, id, status), {}, engine)

  const onWatch = (e: IpcMainEvent, id: unknown, cwd: unknown): void => {
    if (!isKnownWindowSender(e.sender)) return
    if (typeof id !== 'string' || typeof cwd !== 'string') return
    void orky.watch(id, cwd).then((root) => onPaneRoot(id, root))
  }
  const onUnwatch = (e: IpcMainEvent, id: unknown): void => {
    if (!isKnownWindowSender(e.sender)) return
    if (typeof id !== 'string') return
    orky.unwatch(id)
    onPaneRoot(id, null)
  }
  ipcMain.on(CH.orkyWatch, onWatch)
  ipcMain.on(CH.orkyUnwatch, onUnwatch)
  return () => {
    ipcMain.removeListener(CH.orkyWatch, onWatch)
    ipcMain.removeListener(CH.orkyUnwatch, onUnwatch)
    orky.dispose()
  }
}
