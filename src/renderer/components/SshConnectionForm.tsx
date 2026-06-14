import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useStore } from '../store'
import { api } from '../api'
import type { SshConnection } from '@shared/types'

export function SshConnectionForm() {
  const target = useStore(s => s.connectionFormFor)
  const setForm = useStore(s => s.setConnectionForm)
  const saveConnection = useStore(s => s.saveConnection)
  const launchConnection = useStore(s => s.launchConnection)

  const editing = target && target !== 'new' ? target : null
  const [name, setName] = useState(editing?.name ?? '')
  const [host, setHost] = useState(editing?.host ?? '')
  const [user, setUser] = useState(editing?.user ?? '')
  const [port, setPort] = useState(editing?.port ? String(editing.port) : '')
  const [identityFile, setIdentityFile] = useState(editing?.identityFile ?? '')

  if (!target) return null

  const valid = host.trim().length > 0 && user.trim().length > 0
  const close = () => setForm(null)

  const build = (): SshConnection => ({
    id: editing?.id ?? uuid(),
    name: name.trim() || `${user.trim()}@${host.trim()}`,
    host: host.trim(),
    user: user.trim(),
    ...(port.trim() ? { port: Number(port) } : {}),
    ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {})
  })

  const onSave = (connect: boolean) => {
    if (!valid) return
    const conn = build()
    saveConnection(conn)
    close()
    if (connect) launchConnection(conn.id)
  }

  const browse = async () => {
    const p = await api.openFile()
    if (p) setIdentityFile(p)
  }

  const field = (label: string, node: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
      <span style={{ opacity: 0.8 }}>{label}</span>{node}
    </label>
  )
  const inputStyle = { background: '#1e1e1e', color: '#eee', border: '1px solid #444',
    borderRadius: 4, padding: '6px 8px', fontSize: 13 } as const

  return (
    <div data-testid="connection-form-backdrop" onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div data-testid="connection-form" role="dialog" aria-modal aria-label="SSH connection"
        onClick={e => e.stopPropagation()}
        style={{ width: 420, background: '#252526', color: '#eee', border: '1px solid #444',
          borderRadius: 6, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{editing ? 'Edit SSH connection' : 'New SSH connection'}</h3>
        {field('Name', <input data-testid="conn-name" value={name}
          onChange={e => setName(e.target.value)} style={inputStyle} />)}
        {field('Host *', <input data-testid="conn-host" value={host}
          onChange={e => setHost(e.target.value)} style={inputStyle} />)}
        {field('User *', <input data-testid="conn-user" value={user}
          onChange={e => setUser(e.target.value)} style={inputStyle} />)}
        {field('Port (default 22)', <input data-testid="conn-port" value={port} inputMode="numeric"
          onChange={e => setPort(e.target.value.replace(/[^0-9]/g, ''))} style={inputStyle} />)}
        {field('Identity file', (
          <div style={{ display: 'flex', gap: 4 }}>
            <input data-testid="conn-identity" value={identityFile}
              onChange={e => setIdentityFile(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <button data-testid="conn-browse" onClick={browse}>Browse…</button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
          <button data-testid="conn-cancel" onClick={close}>Cancel</button>
          <button data-testid="conn-save" disabled={!valid} onClick={() => onSave(false)}>Save</button>
          <button data-testid="conn-save-connect" disabled={!valid} onClick={() => onSave(true)}>Save &amp; Connect</button>
        </div>
      </div>
    </div>
  )
}
