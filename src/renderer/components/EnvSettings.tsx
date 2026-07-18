import { useEffect, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useStore } from '../store'
import { api } from '../api'
import { runOp } from '../op'
import type { EnvVaultData } from '@shared/types'

// Encrypted env vault settings section: create/unlock/lock, global vars, and (when scoped to
// a pane) that terminal's own vars. Extracted from the former EnvManager modal.

// A single variable row with a reveal (👁) toggle. `testid` namespaces it so the same row serves
// both the global ("env") and per-terminal ("env-term") sections.
function EnvRow({ name, value, onRemove, testid }: { name: string; value: string; onRemove: () => void; testid: string }) {
  const [show, setShow] = useState(false)
  const row = { display: 'flex', alignItems: 'center', gap: 8 } as const
  return (
    <div data-testid={`${testid}-row-${name}`} style={row}>
      <span style={{ flex: '0 0 140px', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <input type={show ? 'text' : 'password'} value={value} readOnly style={{ flex: 1 }} />
      <button title="Reveal" onClick={() => setShow(s => !s)}>👁</button>
      <button data-testid={`${testid}-del-${name}`} onClick={onRemove}>×</button>
    </div>
  )
}

export function EnvSettings({ wsId, paneId }: { wsId?: string; paneId?: string }) {
  const env = useStore(s => s.envVault)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const pushToast = useStore(s => s.pushToast)
  const paneConfig = useStore(s => (wsId && paneId) ? s.workspaces[wsId]?.panes[paneId]?.config : undefined)
  const envId = (paneConfig && paneConfig.kind === 'terminal') ? paneConfig.envId : undefined
  const scoped = !!(wsId && paneId)

  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState(false)
  const [data, setData] = useState<EnvVaultData | null>(null)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [tName, setTName] = useState('')
  const [tValue, setTValue] = useState('')

  const refresh = async (): Promise<void> => {
    // A rejected read must not become an unhandled rejection (2026-07-17 audit Finding 30);
    // the previous values simply stay on screen.
    try { setData(await api.envGet()) }
    catch (e) { console.warn('[env] refresh failed:', e) }
  }

  // Load values whenever the vault becomes unlocked.
  useEffect(() => { if (env.unlocked) void refresh() }, [env.unlocked])

  const create = async (): Promise<void> => {
    if (!await runOp(() => api.envCreate(passphrase), pushToast, "Couldn't create vault")) return
    pushToast('Vault created'); setPassphrase('')
  }
  const unlock = async (): Promise<void> => {
    const ok = await api.envUnlock(passphrase)
    if (!ok) { setError(true); return }
    setError(false); setPassphrase('')
  }
  const add = async (): Promise<void> => {
    if (!newName.trim()) return
    if (!await runOp(() => api.envSetGlobal(newName, newValue), pushToast, "Couldn't add variable")) return
    pushToast('Variable added')
    setNewName(''); setNewValue('')
    void refresh()
  }
  const addTerminalVar = async (): Promise<void> => {
    if (!tName.trim() || !wsId || !paneId) return
    let id = envId
    if (!id) { id = uuid(); updatePaneConfig(wsId, paneId, { envId: id }) }
    if (!await runOp(() => api.envSetTerminal(id!, tName, tValue), pushToast, "Couldn't add variable")) return
    pushToast('Variable added')
    setTName(''); setTValue(''); void refresh()
  }

  const row = { display: 'flex', alignItems: 'center', gap: 8 } as const

  return (
    <div data-testid="settings-environment" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Environment variables</div>

        {!env.exists && (
          <>
            <div>Set a passphrase to create an encrypted vault</div>
            <input data-testid="env-passphrase" type="password" autoFocus value={passphrase}
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
            <input data-testid="env-passphrase" type="password" autoFocus value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void unlock() }} />
            {error && <div data-testid="env-error" style={{ color: '#ff6b6b' }}>Incorrect passphrase</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button data-testid="env-unlock" disabled={!passphrase} onClick={() => void unlock()}>Unlock</button>
            </div>
          </>
        )}

        {env.unlocked && (
          <>
            <div style={{ fontWeight: 600, borderTop: '1px solid var(--border, #444)', paddingTop: 8 }}>Global variables</div>
            {data === null && <div data-testid="env-loading" style={{ color: 'var(--fg-dim, #aaa)' }}>Loading…</div>}
            {/* Removes route through runOp like every other action here (2026-07-17 audit
                Finding 30): a failed remove toasts instead of silently leaving the row, and
                refresh() only runs AFTER the remove settled (no race against the delete). */}
            {Object.entries(data?.global ?? {}).map(([name, value]) => (
              <EnvRow key={name} testid="env" name={name} value={value}
                onRemove={async () => {
                  if (await runOp(() => api.envRemoveGlobal(name), pushToast, "Couldn't remove variable")) void refresh()
                }} />
            ))}
            <div style={row}>
              <input data-testid="env-name" placeholder="NAME" value={newName}
                onChange={e => setNewName(e.target.value)} style={{ flex: '0 0 140px', fontFamily: 'var(--mono)' }} />
              <input data-testid="env-value" placeholder="value" value={newValue}
                onChange={e => setNewValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void add() }} style={{ flex: 1 }} />
              <button data-testid="env-add" disabled={!newName.trim()} onClick={() => void add()}>Add</button>
            </div>
            {scoped && (
              <>
                <div data-testid="env-term-section" style={{ fontWeight: 600, borderTop: '1px solid var(--border, #444)', paddingTop: 8 }}>This terminal</div>
                {Object.entries((envId && data?.terminals[envId]) ? data!.terminals[envId] : {}).map(([name, value]) => (
                  <EnvRow key={name} testid="env-term" name={name} value={value}
                    onRemove={async () => {
                      if (!envId) return
                      if (await runOp(() => api.envRemoveTerminal(envId, name), pushToast, "Couldn't remove variable")) void refresh()
                    }} />
                ))}
                <div style={row}>
                  <input data-testid="env-term-name" placeholder="NAME" value={tName}
                    onChange={e => setTName(e.target.value)} style={{ flex: '0 0 140px', fontFamily: 'var(--mono)' }} />
                  <input data-testid="env-term-value" placeholder="value" value={tValue}
                    onChange={e => setTValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void addTerminalVar() }} style={{ flex: 1 }} />
                  <button data-testid="env-term-add" disabled={!tName.trim()} onClick={() => void addTerminalVar()}>Add</button>
                </div>
                <div style={{ color: 'var(--fg-dim, #aaa)', fontSize: '0.85em' }}>Applies the next time this terminal is spawned (e.g. after reopening the workspace) while the vault is unlocked.</div>
              </>
            )}
            <div style={{ display: 'flex', borderTop: '1px solid var(--border, #444)', paddingTop: 8 }}>
              <button data-testid="env-lock" onClick={() => api.envLock()}>Lock</button>
            </div>
          </>
        )}
    </div>
  )
}
