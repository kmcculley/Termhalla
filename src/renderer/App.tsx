import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from './store'
import { ThemeProvider } from './components/ThemeProvider'
import { themeCssVarsPartial } from '@shared/theme'
import { WorkspaceTabs } from './components/WorkspaceTabs'
import { FloatingHeader } from './components/FloatingHeader'
import { WorkspaceView } from './components/WorkspaceView'
import { BroadcastDialog } from './components/BroadcastDialog'
import { CommandPalette } from './components/CommandPalette'
import { SshConnectionForm } from './components/SshConnectionForm'
import { StatusBar } from './components/StatusBar'
import { UsageWatcher } from './components/UsageWatcher'
import { OrkyWatcher } from './components/OrkyWatcher'
import { Scheduler } from './components/Scheduler'
import { Toasts } from './components/Toasts'
import { ImageLightbox } from './components/ImageLightbox'
import { SettingsPanel } from './components/SettingsPanel'
import { NotesPanel } from './components/NotesPanel'
import { DecisionQueuePanel } from './components/DecisionQueuePanel'
import { OrkyRootPicker } from './components/OrkyRootPicker'
import { OrkyCaptureModal } from './components/OrkyCaptureModal'
import { RemoteAgentPicker } from './components/RemoteAgentPicker'
import { ReopenWorkspaceModal } from './components/ReopenWorkspaceModal'
import { SearchHistory } from './components/SearchHistory'
import { matchShortcut, resolveBindings } from '@shared/keymap'
import { chordPaneTarget, busyPaneCount, dispatchCommand } from './store/pane-ops'
import { closeWorkspaceConfirmText } from '@shared/remote-home'
import { redrawPane, clearPane, openPaneFind, requestPaneFocus } from './components/terminal-registry'
import { directionalPaneTarget, type NavDir } from './components/pane-nav'
import { mergeTheme } from '@shared/theme'
import { nextFontSize } from '@shared/font-zoom'
import { focusProjectPane, revealQueueGroup } from './components/pane-reveal'
import { api } from './api'

export default function App() {
  const init = useStore(s => s.init)
  // Scope the subscription: a bare useStore() re-renders the root (and every workspace host)
  // on ANY store change — cwd/proc/usage/status churn included. Only these three drive App.
  const { activeId, workspaces, order, notesOpen, queueOpen } = useStore(
    useShallow(s => ({ activeId: s.activeId, workspaces: s.workspaces, order: s.order, notesOpen: s.notesOpen, queueOpen: s.queueOpen }))
  )
  const isMainWindow = useStore(s => s.isMainWindow)
  const connectionFormFor = useStore(s => s.connectionFormFor)
  // The shared OrkyRootPicker request (feature 0009, REQ-004): opened by pickOrkyRoot() from any
  // creation affordance; resolveOrkyRootPick settles the pending promise (null = cancel).
  const orkyRootPickOpen = useStore(s => s.orkyRootPickOpen)
  // The F11-owned cockpit picker request (feature 0011, REQ-003): a SEPARATE one-shot flag (the
  // OrkyCaptureModal pattern) so the F9 request above stays default-labelled for its callers.
  const orkyCockpitPickOpen = useStore(s => s.orkyCockpitPickOpen)
  // The quick-capture request (feature 0012, REQ-002): conditionally hosted so every close path
  // unmounts the modal and a reopen starts with a fresh draft (decision #8).
  const orkyCaptureRequest = useStore(s => s.orkyCaptureRequest)
  // Remote workspaces (feature 0022): the agent-picker request flag (the cockpit-picker pattern).
  const remoteAgentPickerOpen = useStore(s => s.remoteAgentPickerOpen)
  // File ▸ Reopen Closed Workspace… (conditionally hosted so it reloads the list each open).
  const reopenOpen = useStore(s => s.reopenOpen)
  useEffect(() => { init() }, [init])
  // The OS window title tracks the active workspace (QoL 2026-07-17) — taskbar/Alt-Tab used to
  // read a permanent "Termhalla" regardless of what the window held. document.title propagates to
  // the BrowserWindow title; each window (main or undocked) names its own active workspace.
  const activeWsName = activeId ? workspaces[activeId]?.name : undefined
  useEffect(() => {
    document.title = activeWsName ? `${activeWsName} — Termhalla` : 'Termhalla'
  }, [activeWsName])
  useEffect(() => {
    const flush = () => {
      const s = useStore.getState()
      // A toast can't render during unload — swallow the rejection with a console.warn so a
      // failed flush is at least visible in devtools and never an unhandled rejection.
      s.saveAll().catch(e => console.warn('beforeunload workspace flush failed', e))
      s.flushQuick()
      s.flushNotes()
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])
  // One subscription pass for every main->renderer push event. Each callback reads the live
  // store imperatively via getState() (not a reactive selector), so the empty dep array is
  // correct — the listeners are wired once on mount and torn down together on unmount.
  useEffect(() => {
    const s = () => useStore.getState()
    const offs = [
      api.onPtyStatus((id, status) => s().setStatus(id, status)),
      // A minimized terminal isn't auto-closed on shell exit; record it so its tray chip can show an
      // `exited` indicator distinct from a live idle pane (REQ-005 / FINDING-DA-003).
      api.onPtyExit(id => s().setExited(id, true)),
      api.onPtyCwd((id, cwd) => s().setCwd(id, cwd)),
      api.onPtyProcs((id, info) => s().setProcs(id, info)),
      api.onGitStatus((id, g) => s().setGitStatus(id, g)),
      api.onCloudStatus(statuses => s().setCloud(statuses)),
      api.onAiSession((id, ai) => s().setAiSession(id, ai)),
      api.onUsageMetrics((id, m) => s().setUsage(id, m)),
      api.onOrkyStatus((id, st) => s().setOrky(id, st)),
      // Cross-project registry aggregate (feature 0006, REQ-003): app-level so the decision-queue
      // badge stays live while the drawer is closed. Routed through the slice's single ingestion
      // chokepoint (deep-equal short-circuit + generation stamp).
      api.onRegistryStatus(snapshot => s().setRegistrySnapshot(snapshot)),
      // Per-root change notification (feature 0009, REQ-022): routed into ONE store action whose
      // fan-out is per-root targeted — only OrkyPanes bound to a matching root fetch/re-render.
      api.onRegistryRootChanged(root => s().notifyOrkyRootChanged(root)),
      // Remote workspaces (feature 0022, REQ-014): per-workspace connection state pushes.
      api.onRemoteState(st => s().ingestRemoteState(st)),
      api.onRecState((id, state) => s().setRecording(id, state.recording)),
      api.onEnvState(state => s().setEnvState(state)),
      // Phone web remote (feature 0026 v2, REQ-020 — closes FINDING-034): an app-wide, always-
      // subscribed error push — independent of whether the phone-remote Settings section is even
      // mounted, so a startup failure (persisted enabled=true, port occupied before any window
      // loads) still reaches a user-visible toast with the error severity that bypasses the
      // quick.toastsEnabled opt-in (CONV-004).
      api.onPhoneRemoteError(message => s().pushToast(message, 'error')),
      api.onWinAssignment(a => { void s().applyAssignment(a) }),
      api.onTermSerialize(wsId => s().serializeWorkspace(wsId)),
      // Native Edit ▸ Settings… opens the Settings modal at the General section.
      api.onOpenSettings(() => s().openSettings({ section: 'general' })),
      // Native File menu: the renderer owns live workspace state, so it performs each action.
      api.onFileNew(() => { s().newWorkspace(`Workspace ${s().order.length + 1}`) }),
      api.onFileOpen(() => { void s().openWorkspaceFromFile() }),
      api.onFileReopen(() => s().setReopenOpen(true)),
      api.onFileSave(() => { void s().saveActiveWorkspace() }),
      api.onFileSaveAs(() => { void s().saveActiveWorkspaceAs() }),
      // Feature 0013: a needs-you OS notification was clicked. The main process already brought this
      // window forward; here we hand off to where the human acts — focus the matching pane via F6's
      // reused matcher, else open the decision-queue drawer scrolled to the project (a digest click,
      // root === null, just opens the drawer). Read-side only: no action/registry mutation (REQ-006/007).
      api.onOrkyNotifyFocus(root => {
        const st = s()
        if (root !== null && focusProjectPane(st, root)) return
        st.setQueueOpen(true)
        if (root !== null) revealQueueGroup(root)
      }),
      // Main asks us to flush before it quits. Persist workspaces (cwd) + quick (SSH) and AWAIT the
      // disk writes, then confirm — so the quit/auto-update install can't race our writes to exit.
      api.onAppFlush(async () => {
        const st = s()
        try { await Promise.all([st.saveAll(), api.saveQuick(st.quick)]) }
        finally { api.appFlushDone() }
      })
    ]
    // Now that win:assignment is subscribed, ask main for this window's assignment (avoids losing
    // a push that fired on did-finish-load before React mounted this listener).
    api.winReady()
    // Same hazard for cloud:status (fire-and-forget, no re-send): if its push fired before the
    // onCloudStatus listener above was attached, it's lost and dedup blocks a re-send, leaving the
    // chip stuck on "cloud status…". Pull the current status now to recover it.
    // A failed recovery pull silently recreated the stuck-chip state it exists to fix (2026-07-17
    // audit Finding 24b) — surface it in devtools; a toast would be noise, a retry loop overkill.
    void api.cloudCurrent().then(statuses => s().setCloud(statuses)).catch(e => console.warn('[cloud] recovery pull failed:', e))
    // Same missed-push recovery for the registry aggregate (feature 0006, REQ-003/REQ-011) — ONE
    // pull, generation-guarded: the generation is captured at ISSUE time, so a stale late-settling
    // result is discarded if any snapshot (push or pull) was applied after the pull was issued.
    // The rejection path is explicit (an error state, REQ-013), never swallowed silently.
    // Remote workspaces (feature 0022): the remote:current recovery pull (missed-push recovery).
    void s().seedRemoteStates()
    const issuedAtGeneration = s().snapshotGeneration
    void api.registryCurrent()
      .then(snapshot => s().applyRecoveryPull(snapshot, issuedAtGeneration))
      .catch(() => s().recoveryPullFailed())
    // Phone web remote (feature 0026 v3, REQ-020 — FINDING-063/071): the phoneRemote:error push
    // fires from registerHandlers during startup, BEFORE any window has loaded — webContents.send
    // into an unloaded window is dropped, so a startup failure (persisted enabled:true, port
    // occupied) reached no listener and surfaced nowhere. Same missed-push recovery as the
    // cloud/registry pulls above: pull status() once at root load and route a carried error
    // through the store toast chokepoint exactly once (the error severity bypasses the
    // quick.toastsEnabled opt-in, CONV-004).
    void api.phoneRemoteStatus()
      .then(st => { if (st.error) s().pushToast(st.error, 'error') })
      .catch(e => console.warn('[phone-remote] startup status recovery pull failed:', e))
    return () => offs.forEach(off => off())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const sc = matchShortcut(e, resolveBindings(s.quick.keybindings))
      if (!sc) return
      e.preventDefault()
      const activeId = s.activeId
      const order = s.order
      const idx = activeId ? order.indexOf(activeId) : -1
      switch (sc.type) {
        case 'toggle-palette': s.setPaletteOpen(!s.paletteOpen); break
        case 'toggle-broadcast': s.setBroadcastOpen(!s.broadcastOpen); break
        case 'close-workspace': {
          if (!activeId) break
          const ws = s.workspaces[activeId]
          const ok = !ws || Object.keys(ws.panes).length === 0 ||
            window.confirm(closeWorkspaceConfirmText(ws.name, ws.home, busyPaneCount(ws, s.procs, s.aiSessions)))
          if (ok) s.closeWorkspace(activeId); break
        }
        case 'next-workspace': if (order.length) s.setActive(order[(idx + 1 + order.length) % order.length]); break
        case 'prev-workspace': if (order.length) s.setActive(order[(idx - 1 + order.length) % order.length]); break
        case 'jump-workspace': if (order[sc.index]) s.setActive(order[sc.index]); break
        case 'toggle-search': s.setSearchOpen(!s.searchOpen); break
        case 'toggle-orky-queue': s.setQueueOpen(!s.queueOpen); break
        // Global capture chrome (feature 0012, REQ-001): reads NO active-workspace state — the
        // chord works with zero workspaces (the toggle-orky-queue precedent above). This case and
        // toggle-orky-queue stay at this site verbatim (frozen TEST-495/TEST-360 pin their shapes)
        // rather than riding the shared dispatcher below.
        case 'capture-orky-work': s.openOrkyCapture(); break
        case 'focus-pane-left': case 'focus-pane-right': case 'focus-pane-up': case 'focus-pane-down': {
          if (!activeId || s.maximized[activeId]) break // siblings are hidden under maximize
          const ws = s.workspaces[activeId]
          // chordPaneTarget: the focused pane when it's in THIS workspace, else the first pane —
          // focusedPaneId is only seeded on mouse-down, so the chord must not be a silent no-op
          // in a workspace the user hasn't clicked into yet (or after a tab switch).
          const from = chordPaneTarget(ws, s.focusedPaneId)
          if (!ws || !from) break
          // Measure the visible tiles; the geometry pick itself is pure (pane-nav.ts).
          const min = new Set(s.minimized[activeId] ?? [])
          const rects = Object.keys(ws.panes).filter(id => !min.has(id)).flatMap(id => {
            const el = document.querySelector(`[data-testid="tile-${id}"]`)
            if (!el) return []
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0 ? [{ id, left: r.left, top: r.top, width: r.width, height: r.height }] : []
          })
          const dir = sc.type.slice('focus-pane-'.length) as NavDir
          const target = directionalPaneTarget(dir, from, rects)
          if (target) { s.setFocusedPane(target); requestPaneFocus(target) }
          break
        }
        case 'font-zoom-in': case 'font-zoom-out': {
          const cur = mergeTheme(s.quick.theme).termFontSize
          const next = nextFontSize(cur, sc.type === 'font-zoom-in' ? -1 : 1)
          if (next !== cur) s.setTheme({ termFontSize: next })
          break
        }
        default:
          // Every remaining pane-scoped / window-chrome command (new-terminal, open-settings,
          // maximize/minimize/close pane, notes, font-zoom-reset, clear/find/redraw terminal,
          // restore-last-minimized) is shared with the palette's activate() through the ONE
          // dispatcher in store/pane-ops.ts (2026-07-17 audit Finding 28). The chord side redraws
          // the focused pane exactly ('focused' — the shipped divergence from the palette).
          dispatchCommand(sc.type, s, { clearPane, redrawPane, openPaneFind }, { redrawTarget: 'focused' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg, #1e1e1e)' }}>
      <ThemeProvider />
      {isMainWindow ? <WorkspaceTabs /> : <FloatingHeader />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative' }} className="mosaic-blueprint-theme">
          {order.length === 0 && <div data-testid="app-title">Termhalla</div>}
          {/* Every workspace stays mounted; only the active one is shown. Switching tabs must NOT
              unmount inactive panes — that would dispose their xterm instances (losing scrollback
              and freezing live TUIs like Claude until the next write) and Monaco models (losing
              unsaved edits). `visibility: hidden` (not `display: none`) keeps each host at full
              size, so xterm's FitAddon and the PTY grid never resize on switch. */}
          {order.map(id => {
            const ws = workspaces[id]
            if (!ws) return null
            const isActive = id === activeId
            return (
              <div key={id} data-testid="workspace-host" data-ws={id} data-active={isActive ? 'true' : 'false'}
                aria-hidden={!isActive}
                // Opaque background: a descendant of a HIDDEN sibling host can override
                // `visibility: hidden` (e.g. the maximize punch-through) — the active host must
                // mask whatever paints beneath it even where its own content is transparent.
                style={{ ...themeCssVarsPartial(ws.theme ?? {}), position: 'absolute', inset: 0, visibility: isActive ? 'visible' : 'hidden',
                  background: 'var(--bg, #1e1e1e)',
                  pointerEvents: isActive ? 'auto' : 'none', zIndex: isActive ? 1 : 0 }}>
                <WorkspaceView ws={ws} />
              </div>
            )
          })}
        </div>
        {notesOpen && <NotesPanel />}
        {queueOpen && <DecisionQueuePanel />}
      </div>
      <StatusBar />
      <UsageWatcher />
      <OrkyWatcher />
      <Scheduler />
      <Toasts />
      <ImageLightbox />
      <SettingsPanel />
      <BroadcastDialog />
      <CommandPalette />
      {orkyRootPickOpen && (
        <OrkyRootPicker
          onSelect={root => useStore.getState().resolveOrkyRootPick(root)}
          onCancel={() => useStore.getState().resolveOrkyRootPick(null)} />
      )}
      {orkyCockpitPickOpen && (
        <OrkyRootPicker
          ariaLabel="Open a project cockpit workspace"
          heading="Open a cockpit workspace for a tracked Orky project"
          onSelect={root => useStore.getState().resolveOrkyCockpitPick(root)}
          onCancel={() => useStore.getState().resolveOrkyCockpitPick(null)} />
      )}
      {orkyCaptureRequest !== null && <OrkyCaptureModal initialRoot={orkyCaptureRequest.root} />}
      {/* Remote workspaces (feature 0022): the agent picker behind the new-remote-workspace gesture. */}
      {remoteAgentPickerOpen && (
        <RemoteAgentPicker onClose={() => useStore.getState().closeRemoteAgentPicker()} />
      )}
      {/* File ▸ Reopen Closed Workspace… */}
      {reopenOpen && <ReopenWorkspaceModal onClose={() => useStore.getState().setReopenOpen(false)} />}
      <SearchHistory />
      <SshConnectionForm key={connectionFormFor === null ? 'none' : connectionFormFor === 'new' ? 'new' : connectionFormFor.id} />
    </div>
  )
}
