import type { Services } from '../services'
import type { WindowManager } from '../window-manager'
import type { PtyManager } from '../pty/pty-manager'
import type { OrkyPaneStatus } from '@shared/types'
import { CH } from '@shared/ipc-contract'
import type { Disposer } from './types'
import { OrkyStreamStatusBridge } from '../orky/orky-stream-status'
import { registerPty } from './register-pty'
import { registerFs } from './register-fs'
import { registerWorkspaces } from './register-workspaces'
import { registerDrafts } from './register-drafts'
import { registerNotes } from './register-notes'
import { registerCloud } from './register-cloud'
import { registerUsage } from './register-usage'
import { registerOrky } from './register-orky'
import { registerRegistry } from './register-registry'
import { registerRecording } from './register-recording'
import { registerEnv } from './register-env'
import { registerClipboard } from './register-clipboard'
import { registerShell } from './register-shell'
import { registerPreview } from './register-preview'
import { registerGit } from './register-git'
import { Indexer } from '../search/indexer'
import { registerSearch } from './register-search'

/** Composition root: register every IPC handler ONCE against the build-once service layer. Push
 *  events go through `send`, which routes pane-scoped channels (their first arg is a paneId) to the
 *  window that owns the pane and broadcasts app-global channels to all windows. The interactive
 *  registrars (notify/dialogs/drafts) take the main window, which already exists after
 *  `WindowManager.prepare()`. Returns the PtyManager so the app can kill PTYs on quit.
 *
 *  Async (feature 0005): `orkyRegistry.init()` is awaited here, BEFORE `registerRegistry` wires the
 *  first `registry:status` push, so a restart's persisted roots are members from the first snapshot
 *  (REQ-004). */
export async function registerHandlers(services: Services, wm: WindowManager): Promise<PtyManager> {
  const { store, quick, shells, recorder, envVault, scriptDir, dir, searchService, orkyEngine, orkyRegistry } = services

  const send = (channel: string, ...args: unknown[]): void => {
    const paneId = typeof args[0] === 'string' ? args[0] : null
    if (paneId && wm.isPaneScoped(channel)) wm.routeToPane(paneId, channel, ...args)
    else wm.broadcast(channel, ...args)
  }

  const win = wm.mainWindow()
  const { service: git, dispose: disposeGit } = registerGit(send)
  const indexer = new Indexer(searchService)

  // feature 0014: combine the filesystem-derived (OrkyTracker, fed below via the `send` shim passed
  // to registerOrky) and stream-derived (StatusEngine's OSC heartbeat parser, fed via onOrkyHeartbeat)
  // Orky status sources per pane (filesystem wins — REQ-009), emitting the combined result over the
  // SAME `orky:status` channel `registerOrky` already sent on directly (no new channel — REQ-008).
  const orkyBridge = new OrkyStreamStatusBridge((id, status) => send(CH.orkyStatus, id, status))
  // registerOrky's OrkyTracker calls `send(CH.orkyStatus, id, status)` directly; intercept just that
  // channel and route it through the bridge instead, so a filesystem-derived update is combined with
  // any stream-derived status for the same pane rather than racing it on the wire. `orky-tracker.ts`
  // itself is untouched (REQ-009) — only this composition-root wiring changes.
  const orkySend: typeof send = (channel, ...args) => {
    if (channel === CH.orkyStatus) {
      const [id, status] = args as [string, OrkyPaneStatus | null]
      orkyBridge.setFsStatus(id, status)
      return
    }
    send(channel, ...args)
  }

  const pty = registerPty(win, {
    shells, recorder, envVault, scriptDir, send, indexer,
    claimPane: (id, sender) => wm.claimPane(id, sender),
    replayInto: (id) => wm.replayInto(id),
    beginTransit: (id, sender) => wm.beginSameWindowTransit(id, sender),
    onCwd: (id, cwd) => { void git.setCwd(id, cwd) },
    onCommandDone: (id) => git.onCommandDone(id),
    onPaneGone: (id) => { git.removePane(id); orkyBridge.clearPane(id) },
    onOrkyHeartbeat: (id, hb) => orkyBridge.setStreamHeartbeat(id, hb)
  })
  registerWorkspaces({ store, quick, shells })
  registerEnv(win, envVault, send)
  registerClipboard()
  registerShell()
  // Drafts/notes persist live; their flush is the shutdown safety net, run on EVERY window's close
  // (main or floating) so a floating window closing before main still flushes its in-memory state.
  const flushDrafts = registerDrafts(dir)
  const flushNotes = registerNotes(dir)
  wm.onWindowClose(() => { flushDrafts(); flushNotes() })

  const disposeSearch = registerSearch({ searchService, indexer })
  // Cross-project registry (feature 0005): pane-root membership is fed by the SAME watch/unwatch
  // resolution registerOrky already performs (no second findOrkyRoot walk) via onPaneRoot; the shared
  // orkyEngine instance is what makes a root tracked by both panes and the persisted list cost exactly
  // ONE chokidar watcher (REQ-014/REQ-020). registerOrky now recognizes ANY known app window, not just
  // this composition root's `win` (REQ-002/REQ-020 cross-window widening).
  const onPaneRoot = (id: string, root: string | null): void => orkyRegistry.trackPaneRoot(id, root)
  await orkyRegistry.init()
  const disposers: Disposer[] = [
    registerFs(win, send),
    registerPreview(),
    registerCloud(win, send),
    registerUsage(send),
    registerOrky(orkySend, (sender) => wm.isKnownWindowSender(sender), onPaneRoot, orkyEngine),
    registerRegistry(orkyRegistry, send, (sender) => wm.isKnownWindowSender(sender)),
    registerRecording({ pty, recorder, userDataDir: dir, send }),
    disposeGit,
    disposeSearch,
    // The shared OrkyRootEngine/OrkyRegistry lifecycle is owned ONCE here — neither registerOrky's nor
    // registerRegistry's own disposer closes it (risk note #3: a double-close of the same watchers).
    () => { orkyRegistry.dispose(); orkyEngine.dispose() }
  ]
  wm.onAllWindowsClosed(() => { for (const dispose of disposers) dispose() })

  return pty
}
