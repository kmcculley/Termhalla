import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { api } from '../api'
import type { EnvVaultData } from '@shared/types'

// Manages the encrypted env vault: create/unlock/lock + global variables.
// NOTE: per-terminal var editing (api.envSetTerminal / api.envRemoveTerminal keyed
// on a pane's config.envId) is a deferred follow-up; this modal handles global
// vars + the create/unlock/lock flow only.

// A single global-variable row with a reveal (👁) toggle.
function EnvRow({ name, value, onRemove }: { name: string; value: string; onRemove: () => void }) {
  const [show, setShow] = useState(false)
  const row = { display: 'flex', alignItems: 'center', gap: 8 } as const
  return (
    <div data-testid={`env-row-${name}`} style={row}>
      <span style={{ flex: '0 0 140px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <input type={show ? 'text' : 'password'} value={value} readOnly style={{ flex: 1 }} />
      <button title="Reveal" onClick={() => setShow(s => !s)}>👁</button>
      <button data-testid={`env-del-${name}`} onClick={onRemove}>×</button>
    </div>
  )
}

export function EnvManager({ onClose }: { onClose: () => void }) {
  const env = useStore(s => s.envVault)

  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState(false)
  const [data, setData] = useState<EnvVaultData | null>(null)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')

  const refresh = async (): Promise<void> => setData(await api.envGet())

  // Load values whenever the vault becomes unlocked.
  useEffect(() => { if (env.unlocked) void refresh() }, [env.unlocked])

  const create = async (): Promise<void> => { await api.envCreate(passphrase); setPassphrase('') }
  const unlock = async (): Promise<void> => {
    const ok = await api.envUnlock(passphrase)
    if (!ok) { setError(true); return }
    setError(false); setPassphrase('')
  }
  const add = (): void => {
    if (!newName.trim()) return
    api.envSetGlobal(newName, newValue)
    setNewName(''); setNewValue('')
    void refresh()
  }

  const row = { display: 'flex', alignItems: 'center', gap: 8 } as const

  return createPortal(
    <div data-testid="env-manager" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 60 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--elevated, #252526)', color: 'var(--fg, #eee)', border: '1px solid var(--border, #444)',
          borderRadius: 6, padding: 14, width: 480, maxHeight: '86vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--font-size, 13px)' }}>
        <div style={{ fontWeight: 600 }}>Environment variables</div>

        {!env.exists && (
          <>
            <div>Set a passphrase to create an encrypted vault</div>
            <input data-testid="env-passphrase" type="password" value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void create() }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button data-testid="env-create" disabled={!passphrase} onClick={() => void create()}>Create</button>
            </div>
          </>
        )}

        {env.exists && !env.unlocked && (
          <>
            <div>Unlock the vault</div>
            <input data-testid="env-passphrase" type="password" value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void unlock() }} />
            {error && <div data-testid="env-error" style={{ color: 'var(--status-needs-input, #e55)' }}>Incorrect passphrase</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button data-testid="env-unlock" disabled={!passphrase} onClick={() => void unlock()}>Unlock</button>
            </div>
          </>
        )}

        {env.unlocked && (
          <>
            <div style={{ fontWeight: 600, borderTop: '1px solid var(--border, #444)', paddingTop: 8 }}>Global variables</div>
            {Object.entries(data?.global ?? {}).map(([name, value]) => (
              <EnvRow key={name} name={name} value={value}
                onRemove={() => { api.envRemoveGlobal(name); void refresh() }} />
            ))}
            <div style={row}>
              <input data-testid="env-name" placeholder="NAME" value={newName}
                onChange={e => setNewName(e.target.value)} style={{ flex: '0 0 140px', fontFamily: 'monospace' }} />
              <input data-testid="env-value" placeholder="value" value={newValue}
                onChange={e => setNewValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') add() }} style={{ flex: 1 }} />
              <button data-testid="env-add" disabled={!newName.trim()} onClick={add}>Add</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border, #444)', paddingTop: 8 }}>
              <button data-testid="env-lock" onClick={() => api.envLock()}>Lock</button>
              <button onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {!env.unlocked && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
