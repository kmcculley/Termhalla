import { useEffect } from 'react'
import { useStore } from './store'
import { ThemeProvider } from './components/ThemeProvider'
import { WorkspaceTabs } from './components/WorkspaceTabs'
import { WorkspaceView } from './components/WorkspaceView'
import { BroadcastDialog } from './components/BroadcastDialog'
import { CommandPalette } from './components/CommandPalette'
import { SshConnectionForm } from './components/SshConnectionForm'
import { StatusBar } from './components/StatusBar'
import { UsageWatcher } from './components/UsageWatcher'
import { Scheduler } from './components/Scheduler'
import { api } from './api'

export default function App() {
  const init = useStore(s => s.init)
  const { activeId, workspaces, order } = useStore()
  const connectionFormFor = useStore(s => s.connectionFormFor)
  useEffect(() => { init() }, [init])
  useEffect(() => {
    const flush = () => { const s = useStore.getState(); void s.saveAll(); s.flushQuick() }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])
  useEffect(() => {
    const off = api.onPtyStatus((id, status) => useStore.getState().setStatus(id, status))
    return off
  }, [])
  useEffect(() => {
    const off = api.onPtyCwd((id, cwd) => useStore.getState().setCwd(id, cwd))
    return off
  }, [])
  useEffect(() => {
    const off = api.onPtyProcs((id, info) => useStore.getState().setProcs(id, info))
    return off
  }, [])
  useEffect(() => {
    const off = api.onCloudStatus((statuses) => useStore.getState().setCloud(statuses))
    return off
  }, [])
  useEffect(() => {
    const off = api.onAiSession((id, ai) => useStore.getState().setAiSession(id, ai))
    return off
  }, [])
  useEffect(() => {
    const off = api.onUsageMetrics((id, m) => useStore.getState().setUsage(id, m))
    return off
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        const s = useStore.getState()
        s.setPaletteOpen(!s.paletteOpen)
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        const s = useStore.getState()
        s.setBroadcastOpen(!s.broadcastOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <ThemeProvider />
      <WorkspaceTabs />
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
              style={{ position: 'absolute', inset: 0, visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none', zIndex: isActive ? 1 : 0 }}>
              <WorkspaceView ws={ws} />
            </div>
          )
        })}
      </div>
      <StatusBar />
      <UsageWatcher />
      <Scheduler />
      <BroadcastDialog />
      <CommandPalette />
      <SshConnectionForm key={connectionFormFor === null ? 'none' : connectionFormFor === 'new' ? 'new' : connectionFormFor.id} />
    </div>
  )
}
