import { Notification } from 'electron'
import type { Services } from '../services'
import type { WindowManager } from '../window-manager'
import type { PtyManager } from '../pty/pty-manager'
import type { OrkyPaneStatus, OrkyRegistrySnapshot } from '@shared/types'
import { CH } from '@shared/ipc-contract'
import type { Disposer } from './types'
import { OrkyStreamStatusBridge } from '../orky/orky-stream-status'
import { OrkyNeedsYouNotifier } from '../orky/orky-needs-you-notifier'
import { registerPty } from './register-pty'
import { registerFs } from './register-fs'
import { registerWorkspaces } from './register-workspaces'
import { registerWorkspaceDoc } from './register-workspace-doc'
import { registerDrafts } from './register-drafts'
import { registerNotes } from './register-notes'
import { registerCloud } from './register-cloud'
import { registerUsage } from './register-usage'
import { registerOrky } from './register-orky'
import { registerRegistry } from './register-registry'
import { registerOrkyAction } from './register-orky-action'
import { registerRecording } from './register-recording'
import { registerEnv } from './register-env'
import { registerClipboard } from './register-clipboard'
import { registerShell } from './register-shell'
import { registerPreview } from './register-preview'
import { registerGit } from './register-git'
import { registerRemote, createRemoteAgentsIo } from './register-remote'
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
  const { store, quick, shells, recorder, envVault, scriptDir, dir, searchService, orkyEngine, orkyRegistry, orkyActionDispatcher, remoteManager } = services

  const send = (channel: string, ...args: unknown[]): void => {
    const paneId = typeof args[0] === 'string' ? args[0] : null
    if (paneId && wm.isPaneScoped(channel)) wm.routeToPane(paneId, channel, ...args)
    else wm.broadcast(channel, ...args)
  }
  // Remote workspaces (feature 0022): the manager's pushes ride the SAME routed pane-scoped send —
  // remote pty:data/status/cwd/exit inherit window ownership + transit buffering; remote:state is
  // app-global and broadcasts (REQ-010).
  services.setRemoteSend(send)

  // Startup invariant: prepare() always yields a main window. An explicit throw here beats the
  // old `!`-assertion crash surfacing later at notify/dialog time.
  const win = wm.mainWindow()
  if (!win) throw new Error('registerHandlers: no main window — WindowManager.prepare() must run first')
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
    onOrkyHeartbeat: (id, hb) => orkyBridge.setStreamHeartbeat(id, hb),
    remote: remoteManager
  })
  // Feature 0013 — app-wide needs-you-notifications opt-in mirror. The production `shouldNotify` gate
  // is SYNCHRONOUS, but the preference is written renderer-side via fire-and-forget quickSave; so the
  // composition root holds ONE mutable in-memory mirror, initialized from disk at startup and refreshed
  // synchronously from the full QuickStore payload flowing through the EXISTING quickSave handler — no
  // new IPC channel, no async re-read on the notify hot path, no restart (REQ-005 Wiring / FINDING-002).
  let needsYouNotificationsMirror = (await quick.load()).orkyNeedsYouNotifications !== false
  registerWorkspaces({
    store, quick, shells,
    onQuickSave: (data) => { needsYouNotificationsMirror = data.orkyNeedsYouNotifications !== false }
  })
  registerEnv(win, envVault, send)
  registerClipboard()
  registerShell()
  // Drafts/notes persist live; their flush is the shutdown safety net, run on EVERY window's close
  // (main or floating) so a floating window closing before main still flushes its in-memory state.
  const flushDrafts = registerDrafts(dir)
  const flushNotes = registerNotes(dir)
  // Workspace-document (File menu) handlers + the persisted wsId->doc-path binding map. Its store
  // flush joins drafts/notes on every window close so a floating window closing first still persists.
  const flushWorkspaceDoc = registerWorkspaceDoc(win, dir)
  wm.onWindowClose(() => { flushDrafts(); flushNotes(); flushWorkspaceDoc() })

  const disposeSearch = registerSearch({ searchService, indexer })
  // Cross-project registry (feature 0005): pane-root membership is fed by the SAME watch/unwatch
  // resolution registerOrky already performs (no second findOrkyRoot walk) via onPaneRoot; the shared
  // orkyEngine instance is what makes a root tracked by both panes and the persisted list cost exactly
  // ONE chokidar watcher (REQ-014/REQ-020). registerOrky now recognizes ANY known app window, not just
  // this composition root's `win` (REQ-002/REQ-020 cross-window widening).
  const onPaneRoot = (id: string, root: string | null): void => orkyRegistry.trackPaneRoot(id, root)
  await orkyRegistry.init()

  // Feature 0013 — the cross-project OS needs-you notifier. A SECOND, independent subscription on the
  // SAME registry aggregate `register-registry.ts` already broadcasts from (no new engine consumer —
  // REQ-001). The observer's diff/dedupe/throttle logic is pure and lives in orky-needs-you-notifier.ts;
  // the production sinks below construct the real Notification and, on click, bring the main window
  // forward and hand off via the one new `orkyNotify:focus` channel (0004's register-pty.ts:85-92
  // pattern). Strictly read-only: no .orky write, no action, no registry mutation (REQ-006/007/008).
  const focusMainWindow = (root: string | null): void => {
    const mw = wm.mainWindow()
    if (!mw || mw.isDestroyed()) return
    mw.show()
    mw.focus()
    if (!mw.webContents.isDestroyed()) mw.webContents.send(CH.orkyNotifyFocus, root)
  }
  // TEST-ONLY seam (the TERMHALLA_SAVE_PATH e2e-hook precedent, register-fs.ts): when
  // TERMHALLA_E2E_NOTIFY_SPY === '1' the two sinks below RECORD each would-be notification on a
  // main-process global — including a `click` callable that dispatches the SAME focusMainWindow
  // handoff the real Notification's click handler would — instead of constructing a real OS toast.
  // out/main is ESM (static `import { Notification } from 'electron'`), so a Playwright
  // app.evaluate cannot patch the import binding; this seam is the only observable surface
  // (tests/e2e/orky-notify.spec.ts). Inert without the env var: notifySpy stays null and the
  // production sinks are byte-identical.
  type NotifySpyRecord = { title: string; body: string; projectRoot?: string; projectCount?: number; click: () => void }
  const notifySpy: NotifySpyRecord[] | null = process.env.TERMHALLA_E2E_NOTIFY_SPY === '1'
    ? ((globalThis as unknown as { __nyToasts?: NotifySpyRecord[] }).__nyToasts = [])
    : null
  const needsYouNotifier = new OrkyNeedsYouNotifier({
    now: () => Date.now(),
    shouldNotify: () => needsYouNotificationsMirror,
    notifyOne: ({ title, body, projectRoot }) => {
      if (notifySpy) { notifySpy.push({ title, body, projectRoot, click: () => focusMainWindow(projectRoot) }); return }
      if (!Notification.isSupported()) return
      const n = new Notification({ title, body })
      n.on('click', () => focusMainWindow(projectRoot))
      n.show()
    },
    notifyDigest: ({ title, body, projectCount }) => {
      if (notifySpy) { notifySpy.push({ title, body, projectCount, click: () => focusMainWindow(null) }); return }
      if (!Notification.isSupported()) return
      const n = new Notification({ title, body })
      n.on('click', () => focusMainWindow(null))
      n.show()
    },
    // FINDING-005: the production window-close driver. The observer arms this at window open for
    // windowOpenedAt + COALESCE_WINDOW_MS and clears it on roll/flush/dispose, so a burst-then-quiet
    // digest fires at the boundary instead of stranding until the next transition or app teardown.
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  })
  const unsubscribeNeedsYou = orkyRegistry.onSnapshot((snapshot: OrkyRegistrySnapshot) => needsYouNotifier.onSnapshot(snapshot))

  const disposers: Disposer[] = [
    registerFs(win, send),
    registerPreview(),
    registerCloud(win, send),
    registerUsage(send),
    registerOrky(orkySend, (sender) => wm.isKnownWindowSender(sender), onPaneRoot, orkyEngine),
    registerRegistry(orkyRegistry, send, (sender) => wm.isKnownWindowSender(sender)),
    // orkyAction:* (feature 0007) — Termhalla's first write-capable IPC surface. Unlike the shared
    // orkyEngine/orkyRegistry above, this dispatcher is owned SOLELY by this registrar; its dispose()
    // is called once here (own entry below), mirroring the composition-root disposal style already
    // used for orkyRegistry/orkyEngine.
    registerOrkyAction(orkyActionDispatcher, (sender) => wm.isKnownWindowSender(sender)),
    registerRecording({ pty, recorder, userDataDir: dir, send }),
    // Remote workspaces (feature 0022): the remote:* registrar + the manager's shutdown (aborts
    // in-flight connects, kills live ssh wires — the long-lived-child gotcha).
    registerRemote({
      manager: remoteManager,
      agentsIo: createRemoteAgentsIo(services.remoteAgentsPath),
      // FINDING-001: the write-capable remote surface serves only tracked app windows.
      isKnownWindowSender: (sender) => wm.isKnownWindowSender(sender)
    }),
    () => services.disposeRemote(),
    disposeGit,
    disposeSearch,
    // The shared OrkyRootEngine/OrkyRegistry lifecycle is owned ONCE here — neither registerOrky's nor
    // registerRegistry's own disposer closes it (risk note #3: a double-close of the same watchers).
    () => { orkyRegistry.dispose(); orkyEngine.dispose() },
    () => { orkyActionDispatcher.dispose() },
    // Feature 0013 — single-owner teardown: drop the second aggregate subscription and flush any
    // pending coalesced digest exactly once (REQ-012).
    () => { unsubscribeNeedsYou(); needsYouNotifier.dispose() }
  ]
  wm.onAllWindowsClosed(() => { for (const dispose of disposers) dispose() })

  return pty
}
