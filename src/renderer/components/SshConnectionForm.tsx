import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useStore } from '../store'
import { api } from '../api'
import type { SshConnection } from '@shared/types'
import { Modal, Z } from './Modal'

export function SshConnectionForm() {
  const target = useStore(s => s.connectionFormFor)
  const setForm = useStore(s => s.setConnectionForm)
  const saveConnection = useStore(s => s.saveConnection)
  const pushToast = useStore(s => s.pushToast)
  const launchConnection = useStore(s => s.launchConnection)

  const editing = target && target !== 'new' ? target : null
  const [name, setName] = useState(editing?.name ?? '')
  const [host, setHost] = useState(editing?.host ?? '')
  const [user, setUser] = useState(editing?.user ?? '')
  const [port, setPort] = useState(editing?.port ? String(editing.port) : '')
  const [identityFile, setIdentityFile] = useState(editing?.identityFile ?? '')

  if (!target) return null

  const portNum = Number(port)
  const portOk = !port.trim() || (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535)
  const valid = host.trim().length > 0 && user.trim().length > 0 && portOk
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
    pushToast('Connection saved')
    close()
    if (connect) launchConnection(conn.id)
  }

  const browse = async () => {
    const p = await api.openFile()
    if (p) setIdentityFile(p)
  }

  const field = (label: string, node: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
      <span style={{ color: 'var(--fg-dim, #aaa)' }}>{label}</span>{node}
    </label>
  )
  const inputStyle = { background: 'var(--panel, #1e1e1e)', color: 'var(--fg, #eee)', border: '1px solid var(--border, #444)',
    borderRadius: 4, padding: '6px 8px', fontSize: 13 } as const

  return (
    <Modal onClose={close} align="top" z={Z.paletteForm}
      backdropTestId="connection-form-backdrop" cardTestId="connection-form"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': 'SSH connection',
        onKeyDown: e => { if (e.key === 'Escape') close() } }}
      card={{ width: 420, padding: 16, gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{editing ? 'Edit SSH connection' : 'New SSH connection'}</h3>
        {field('Name', <input data-testid="conn-name" autoFocus value={name}
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
          <button data-testid="conn-save-connect" disabled={!valid} onClick={() => onSave(true)}>Save & Connect</button>
        </div>
    </Modal>
  )
}
