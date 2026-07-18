import { Notification } from 'electron'
import type { Services } from '../services'
import { raisesOsSurfaces } from '../e2e-presentation'
import { e2ePhoneRemoteOverride } from '../e2e-phone-remote'
import type { WindowManager } from '../window-manager'
import type { PtyManager } from '../pty/pty-manager'
import type { OrkyPaneStatus, OrkyRegistrySnapshot, TerminalStatus, Workspace } from '@shared/types'
import { CH } from '@shared/ipc-contract'
import type { Disposer } from './types'
import { OrkyStreamStatusBridge } from '../orky/orky-stream-status'
import { OrkyNeedsYouNotifier } from '../orky/orky-needs-you-notifier'
import { createPhoneRemoteService, type PhoneRemoteService, type PhoneRemotePaneRecord } from '../phone-remote/service'
import { hashToken as hashPhoneRemoteSeamToken } from '../phone-remote/token'
import { registerPhoneRemote } from './register-phone-remote'
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

  // Phone web remote (feature 0026): a tap on the pty-shaped data/exit/status/grid traffic — LOCAL
  // and remote-workspace panes both ride the pty:* channels (the architecture's "remote pty/status
  // traffic rides the existing pty:* surface" contract), so wrapping `send` HERE, before it is
  // threaded into both registerPty and the remote manager below, makes the tap source-agnostic
  // (REQ-008) with zero duplicated wiring. Every call is forwarded to the real `send` completely
  // unchanged (same channel, same args, same order) — REQ-015's byte-identical renderer path — this
  // wrapper only ALSO notifies whichever listeners the phone-remote service installs below.
  interface PhoneRemoteLivePane { cols: number; rows: number; status: string; workspaceId?: string }
  const phoneRemoteLivePanes = new Map<string, PhoneRemoteLivePane>()
  const phoneRemoteDataListeners = new Set<(id: string, chunk: string) => void>()
  const phoneRemoteExitListeners = new Set<(id: string) => void>()
  const phoneRemoteGridListeners = new Set<(id: string, cols: number, rows: number) => void>()
  const phoneRemoteStatusListeners = new Set<(id: string, status: string) => void>()
  // Membership-changed signal (feature 0026 v2, REQ-011/FINDING-022/038): fired on a fresh pane
  // spawn AND whenever a workspace autosave lands with real name/title metadata, so the phone's
  // inventory catches up to the REAL grouping shortly after a pane appears — never only a
  // synthetic placeholder (FINDING-011/017/027).
  const phoneRemoteMembershipListeners = new Set<(pane: unknown) => void>()

  // v2 (REQ-011): REAL workspace id/name + human-readable per-pane title/kind, threaded from
  // main-owned state — never the rejected single-synthetic-workspace stub. `workspaceNames` is
  // fed by every `ws:save` (even before a workspace has any panes, so the name is usually already
  // known by the time a pane spawns); `paneMeta` is fed by the SAME event, keyed per pane. The
  // spawning pane's `workspaceId` (an additive `PtySpawnArgs` field, `TerminalPane.tsx`) also seeds
  // `phoneRemoteLivePanes` immediately at spawn time, so the very first inventory push after a
  // spawn is already correctly grouped without waiting on the next autosave.
  const phoneRemoteWorkspaceNames = new Map<string, string>()
  interface PhoneRemotePaneMeta { workspaceId: string; title: string; kind: string }
  const phoneRemotePaneMeta = new Map<string, PhoneRemotePaneMeta>()
  const onPhoneRemoteWorkspaceSaved = (ws: Workspace): void => {
    phoneRemoteWorkspaceNames.set(ws.id, ws.name)
    // Prune pane entries that used to belong to this workspace but no longer do (moved/removed).
    for (const [paneId, meta] of [...phoneRemotePaneMeta]) {
      if (meta.workspaceId === ws.id && !ws.panes[paneId]) phoneRemotePaneMeta.delete(paneId)
    }
    for (const [paneId, node] of Object.entries(ws.panes)) {
      if (node.config.kind !== 'terminal') continue // v1 inventory excludes non-terminal kinds
      phoneRemotePaneMeta.set(paneId, { workspaceId: ws.id, title: node.config.name ?? '', kind: node.config.kind })
    }
    // A more-accurate grouping/title just landed — re-push so a pane spawned before its owning
    // workspace's autosave settled still ends up correctly grouped, without reconnecting.
    for (const cb of phoneRemoteMembershipListeners) cb(undefined)
  }
  const phoneRemotePaneRecord = (paneId: string, p: PhoneRemoteLivePane): PhoneRemotePaneRecord => {
    const meta = phoneRemotePaneMeta.get(paneId)
    const workspaceId = meta?.workspaceId ?? p.workspaceId ?? 'unassigned'
    return {
      paneId, workspaceId,
      workspaceName: phoneRemoteWorkspaceNames.get(workspaceId) ?? 'Workspace',
      title: meta?.title ?? '', kind: meta?.kind ?? 'terminal',
      cols: p.cols, rows: p.rows, status: p.status
    }
  }

  const phoneRemoteSend = (channel: string, ...args: unknown[]): void => {
    if (channel === CH.ptyData) {
      const [id, chunk] = args as [string, string]
      if (!phoneRemoteLivePanes.has(id)) phoneRemoteLivePanes.set(id, { cols: 80, rows: 24, status: 'idle' })
      for (const cb of phoneRemoteDataListeners) cb(id, chunk)
    } else if (channel === CH.ptyExit) {
      const [id] = args as [string, number]
      phoneRemoteLivePanes.delete(id)
      phoneRemotePaneMeta.delete(id)
      for (const cb of phoneRemoteExitListeners) cb(id)
    } else if (channel === CH.ptyStatus) {
      const [id, status] = args as [string, TerminalStatus]
      const rec = phoneRemoteLivePanes.get(id)
      if (rec) rec.status = status.state
      for (const cb of phoneRemoteStatusListeners) cb(id, status.state)
    }
    send(channel, ...args)
  }

  // Remote workspaces (feature 0022): the manager's pushes ride the SAME routed pane-scoped send —
  // remote pty:data/status/cwd/exit inherit window ownership + transit buffering; remote:state is
  // app-global and broadcasts (REQ-010).
  services.setRemoteSend(phoneRemoteSend)

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
    shells, recorder, envVault, scriptDir, send: phoneRemoteSend, indexer,
    claimPane: (id, sender) => wm.claimPane(id, sender),
    replayInto: (id) => wm.replayInto(id),
    beginTransit: (id, sender) => wm.beginSameWindowTransit(id, sender),
    onCwd: (id, cwd) => { void git.setCwd(id, cwd) },
    onCommandDone: (id) => git.onCommandDone(id),
    onPaneGone: (id) => { git.removePane(id); orkyBridge.clearPane(id) },
    onOrkyHeartbeat: (id, hb) => orkyBridge.setStreamHeartbeat(id, hb),
    remote: remoteManager,
    onSpawn: (id, cols, rows, workspaceId) => {
      phoneRemoteLivePanes.set(id, { cols, rows, status: 'idle', workspaceId })
      for (const cb of phoneRemoteGridListeners) cb(id, cols, rows)
      for (const cb of phoneRemoteMembershipListeners) cb(undefined)
    },
    onResize: (id, cols, rows) => {
      const rec = phoneRemoteLivePanes.get(id)
      if (rec) { rec.cols = cols; rec.rows = rows } else phoneRemoteLivePanes.set(id, { cols, rows, status: 'idle' })
      for (const cb of phoneRemoteGridListeners) cb(id, cols, rows)
    }
  })

  // Phone web remote (feature 0026, v2 — ESC-001): the opt-in HTTP+WS mirror server. Settings ride
  // quick.json (additive optional field, no SCHEMA_VERSION bump); `panes` is sourced from the taps
  // wired into registerPty/the remote manager above (real-time cols/rows/status) COMBINED with the
  // REAL workspace id/name + human-readable per-pane title threaded from `ws:save` above (never the
  // rejected single-synthetic-workspace stub — FINDING-011/017/027). `notifyError` re-broadcasts the
  // fresh status (with the specific failure text) over `phoneRemote:changed` AND the dedicated
  // app-wide `phoneRemote:error` push (REQ-020 v2, FINDING-034) so a start failure surfaces even
  // with Settings closed — errors are never suppressed by the toasts opt-in (CONV-004; enforced
  // renderer-side by the App.tsx root consumer's pushToast('error', …) call, not here). The REQ-025
  // e2e seam (unset ⇒ inert) can force the service on at a fixed port/token for the mandated specs.
  let phoneRemoteServiceRef: PhoneRemoteService | undefined
  const phoneRemoteSeam = e2ePhoneRemoteOverride()
  const phoneRemoteService = createPhoneRemoteService({
    loadSettings: async () => {
      if (phoneRemoteSeam) {
        return {
          enabled: phoneRemoteSeam.enabled === true,
          bind: 'localhost',
          port: phoneRemoteSeam.port ?? 0,
          ...(phoneRemoteSeam.token ? { tokenHash: hashPhoneRemoteSeamToken(phoneRemoteSeam.token) } : {})
        }
      }
      return (await quick.load()).phoneRemote
    },
    saveSettings: async (s) => {
      if (phoneRemoteSeam) return // the e2e seam never persists to the real userData quick.json
      const cur = await quick.load(); await quick.save({ ...cur, phoneRemote: s })
    },
    panes: {
      list: (): PhoneRemotePaneRecord[] => [...phoneRemoteLivePanes.entries()].map(([paneId, p]) => phoneRemotePaneRecord(paneId, p)),
      onData: (cb) => { phoneRemoteDataListeners.add(cb); return () => phoneRemoteDataListeners.delete(cb) },
      onExit: (cb) => { phoneRemoteExitListeners.add(cb); return () => phoneRemoteExitListeners.delete(cb) },
      onGrid: (cb) => { phoneRemoteGridListeners.add(cb); return () => phoneRemoteGridListeners.delete(cb) },
      onStatus: (cb) => { phoneRemoteStatusListeners.add(cb); return () => phoneRemoteStatusListeners.delete(cb) },
      onSpawn: (cb) => { phoneRemoteMembershipListeners.add(cb); return () => phoneRemoteMembershipListeners.delete(cb) },
      write: (id, data) => { if (remoteManager.owns(id)) remoteManager.write(id, data); else pty.write(id, data) }
    },
    staticRoot: services.phoneClientStaticRoot,
    notifyError: (message) => {
      send(CH.phoneRemoteChanged, { ...phoneRemoteServiceRef?.status(), error: message })
      send(CH.phoneRemoteError, message)
    },
    ...(phoneRemoteSeam?.token ? { initialSessionToken: phoneRemoteSeam.token } : {}),
    ...(phoneRemoteSeam?.timing ? { timing: phoneRemoteSeam.timing } : {})
  })
  phoneRemoteServiceRef = phoneRemoteService
  await phoneRemoteService.init()
  const disposePhoneRemote = registerPhoneRemote(phoneRemoteService, send, (sender) => wm.isKnownWindowSender(sender))

  // Feature 0013 — app-wide needs-you-notifications opt-in mirror. The production `shouldNotify` gate
  // is SYNCHRONOUS, but the preference is written renderer-side via fire-and-forget quickSave; so the
  // composition root holds ONE mutable in-memory mirror, initialized from disk at startup and refreshed
  // synchronously from the full QuickStore payload flowing through the EXISTING quickSave handler — no
  // new IPC channel, no async re-read on the notify hot path, no restart (REQ-005 Wiring / FINDING-002).
  let needsYouNotificationsMirror = (await quick.load()).orkyNeedsYouNotifications !== false
  registerWorkspaces({
    store, quick, shells,
    onQuickSave: (data) => { needsYouNotificationsMirror = data.orkyNeedsYouNotifications !== false },
    onWorkspaceSaved: onPhoneRemoteWorkspaceSaved
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
    // Raising is the one thing an e2e run must not do: TEST-573 invokes this very handler through
    // the notify spy below, and `show()` would present a window the harness deliberately never
    // presented. The drawer handoff underneath is the behavior under test; the raise is not.
    if (raisesOsSurfaces()) { mw.show(); mw.focus() }
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
    // The spy check stays FIRST: it is the observable surface TEST-573/574 assert on, and it already
    // returns before constructing a real toast. `raisesOsSurfaces` then keeps every OTHER e2e spec —
    // any that seeds a needs-you root without arming the spy — from raising a real desktop toast.
    notifyOne: ({ title, body, projectRoot }) => {
      if (notifySpy) { notifySpy.push({ title, body, projectRoot, click: () => focusMainWindow(projectRoot) }); return }
      if (!raisesOsSurfaces() || !Notification.isSupported()) return
      const n = new Notification({ title, body })
      n.on('click', () => focusMainWindow(projectRoot))
      n.show()
    },
    notifyDigest: ({ title, body, projectCount }) => {
      if (notifySpy) { notifySpy.push({ title, body, projectCount, click: () => focusMainWindow(null) }); return }
      if (!raisesOsSurfaces() || !Notification.isSupported()) return
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
    // The write-capable fs:* handlers serve only tracked app windows (the FINDING-SEC-002
    // write-capable-surface precedent — wired exactly like registerRegistry below).
    registerFs(win, send, (sender) => wm.isKnownWindowSender(sender)),
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
    // Phone web remote (feature 0026): drop the IPC handlers, then stop the listener/every WS
    // client (unref'd sockets already can't block shutdown, but a clean stop is still owed).
    disposePhoneRemote,
    () => { void phoneRemoteService.stop() },
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
