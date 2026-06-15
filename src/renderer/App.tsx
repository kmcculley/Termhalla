import { useEffect } from 'react'
import { useStore } from './store'
import { WorkspaceTabs } from './components/WorkspaceTabs'
import { WorkspaceView } from './components/WorkspaceView'
import { CommandPalette } from './components/CommandPalette'
import { SshConnectionForm } from './components/SshConnectionForm'
import { StatusBar } from './components/StatusBar'
import { api } from './api'

export default function App() {
  const init = useStore(s => s.init)
  const { activeId, workspaces } = useStore()
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
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        const s = useStore.getState()
        s.setPaletteOpen(!s.paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const active = activeId ? workspaces[activeId] : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <WorkspaceTabs />
      <div style={{ flex: 1, position: 'relative' }} className="mosaic-blueprint-theme">
        {active ? <WorkspaceView ws={active} /> : <div data-testid="app-title">Termhalla</div>}
      </div>
      <StatusBar />
      <CommandPalette />
      <SshConnectionForm key={connectionFormFor === null ? 'none' : connectionFormFor === 'new' ? 'new' : connectionFormFor.id} />
    </div>
  )
}
