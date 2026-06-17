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
import { Scheduler } from './components/Scheduler'
import { Toasts } from './components/Toasts'
import { matchShortcut } from '@shared/keymap'
import { api } from './api'

export default function App() {
  const init = useStore(s => s.init)
  // Scope the subscription: a bare useStore() re-renders the root (and every workspace host)
  // on ANY store change — cwd/proc/usage/status churn included. Only these three drive App.
  const { activeId, workspaces, order } = useStore(
    useShallow(s => ({ activeId: s.activeId, workspaces: s.workspaces, order: s.order }))
  )
  const isMainWindow = useStore(s => s.isMainWindow)
  const connectionFormFor = useStore(s => s.connectionFormFor)
  useEffect(() => { init() }, [init])
  useEffect(() => {
    const flush = () => { const s = useStore.getState(); void s.saveAll(); s.flushQuick() }
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
      api.onPtyCwd((id, cwd) => s().setCwd(id, cwd)),
      api.onPtyProcs((id, info) => s().setProcs(id, info)),
      api.onCloudStatus(statuses => s().setCloud(statuses)),
      api.onAiSession((id, ai) => s().setAiSession(id, ai)),
      api.onUsageMetrics((id, m) => s().setUsage(id, m)),
      api.onRecState((id, state) => s().setRecording(id, state.recording)),
      api.onEnvState(state => s().setEnvState(state)),
      api.onWinAssignment(a => { void s().applyAssignment(a) }),
      api.onTermSerialize(wsId => s().serializeWorkspace(wsId))
    ]
    // Now that win:assignment is subscribed, ask main for this window's assignment (avoids losing
    // a push that fired on did-finish-load before React mounted this listener).
    api.winReady()
    return () => offs.forEach(off => off())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = matchShortcut(e)
      if (!sc) return
      e.preventDefault()
      const s = useStore.getState()
      const activeId = s.activeId
      const order = s.order
      const idx = activeId ? order.indexOf(activeId) : -1
      switch (sc.type) {
        case 'toggle-palette': s.setPaletteOpen(!s.paletteOpen); break
        case 'toggle-broadcast': s.setBroadcastOpen(!s.broadcastOpen); break
        case 'new-terminal': {
          if (!activeId) break
          const ws = s.workspaces[activeId]
          const target = ws?.layout ? Object.keys(ws.panes)[0] : null
          s.addTerminal(activeId, target, 'row'); break
        }
        case 'close-workspace': {
          if (!activeId) break
          const ws = s.workspaces[activeId]
          const ok = !ws || Object.keys(ws.panes).length === 0 ||
            window.confirm(`Close workspace "${ws.name}"? Its terminals will be closed.`)
          if (ok) s.closeWorkspace(activeId); break
        }
        case 'next-workspace': if (order.length) s.setActive(order[(idx + 1 + order.length) % order.length]); break
        case 'prev-workspace': if (order.length) s.setActive(order[(idx - 1 + order.length) % order.length]); break
        case 'jump-workspace': if (order[sc.index]) s.setActive(order[sc.index]); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg, #1e1e1e)' }}>
      <ThemeProvider />
      {isMainWindow ? <WorkspaceTabs /> : <FloatingHeader />}
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
              style={{ ...themeCssVarsPartial(ws.theme ?? {}), position: 'absolute', inset: 0, visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none', zIndex: isActive ? 1 : 0 }}>
              <WorkspaceView ws={ws} />
            </div>
          )
        })}
      </div>
      <StatusBar />
      <UsageWatcher />
      <Scheduler />
      <Toasts />
      <BroadcastDialog />
      <CommandPalette />
      <SshConnectionForm key={connectionFormFor === null ? 'none' : connectionFormFor === 'new' ? 'new' : connectionFormFor.id} />
    </div>
  )
}
