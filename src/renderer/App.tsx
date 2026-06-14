import { useEffect } from 'react'
import { useStore } from './store'
import { WorkspaceTabs } from './components/WorkspaceTabs'
import { WorkspaceView } from './components/WorkspaceView'
import { api } from './api'

export default function App() {
  const init = useStore(s => s.init)
  const { activeId, workspaces } = useStore()
  useEffect(() => { init() }, [init])
  useEffect(() => {
    const flush = () => { void useStore.getState().saveAll() }
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

  const active = activeId ? workspaces[activeId] : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <WorkspaceTabs />
      <div style={{ flex: 1, position: 'relative' }} className="mosaic-blueprint-theme">
        {active ? <WorkspaceView ws={active} /> : <div data-testid="app-title">Termhalla</div>}
      </div>
    </div>
  )
}
