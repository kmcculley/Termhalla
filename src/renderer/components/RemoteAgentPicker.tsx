/**
 * The remote-agent picker (feature 0022 / F21, REQ-015): the single gesture behind
 * "New remote workspace…" — list the named agents, add one (manual fields or seeded from an SSH
 * favorite — connection config only, never a secret beyond an identity-file PATH), remove one,
 * and create a workspace homed to the selected agent.
 *
 * A11y per the standing conventions: focus lands in the first field on open (CONV-020/CONV-042
 * via the Modal substrate's autoFocus), Enter in the single-submit add-form submits (CONV-043),
 * a successful submit disarms the form (CONV-044), and the CREATE path closes the picker with
 * focus landing in the new workspace's terminal (CONV-055 — newRemoteWorkspace owns that).
 */
import { useEffect, useState } from 'react'
import { v4 as uuid } from 'uuid'
import type { NamedAgent } from '@shared/remote-agents'
import { seedNamedAgentFromConnection } from '@shared/remote-agents'
import { useStore } from '../store'
import { Modal, Z } from './Modal'

export function RemoteAgentPicker({ onClose }: { onClose: () => void }) {
  const namedAgents = useStore(s => s.namedAgents)
  const connections = useStore(s => s.quick.connections)
  const loadNamedAgents = useStore(s => s.loadNamedAgents)
  const saveNamedAgents = useStore(s => s.saveNamedAgents)
  const newRemoteWorkspace = useStore(s => s.newRemoteWorkspace)

  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('')
  const [identityFile, setIdentityFile] = useState('')

  useEffect(() => { void loadNamedAgents() }, [loadNamedAgents])

  const addDisabled = !name.trim() || !host.trim() || !user.trim()

  const addAgent = async () => {
    if (addDisabled) return
    const agent: NamedAgent = { id: uuid(), name: name.trim(), host: host.trim(), user: user.trim() }
    const p = Number(port)
    if (Number.isInteger(p) && p >= 1 && p <= 65535) agent.port = p
    if (identityFile.trim()) agent.identityFile = identityFile.trim()
    const ok = await saveNamedAgents([...namedAgents, agent])
    if (ok) {
      // CONV-044: the successful submit disarms the form; the new agent is pre-selected.
      setName(''); setHost(''); setUser(''); setPort(''); setIdentityFile('')
      setSelected(agent.id)
    }
  }

  const seedFrom = async (connId: string) => {
    const conn = connections.find(c => c.id === connId)
    if (!conn) return
    const agent = seedNamedAgentFromConnection(conn, uuid(), conn.name)
    const ok = await saveNamedAgents([...namedAgents, agent])
    if (ok) setSelected(agent.id)
  }

  const removeAgent = async (id: string) => {
    await saveNamedAgents(namedAgents.filter(a => a.id !== id))
    if (selected === id) setSelected(null)
  }

  const create = () => {
    if (!selected) return
    onClose() // close FIRST so the create path can land focus in the new workspace (CONV-055)
    void newRemoteWorkspace(selected)
  }

  const field = { display: 'flex', flexDirection: 'column' as const, gap: 2, fontSize: 12 }

  return (
    <Modal onClose={onClose} z={Z.paletteForm} backdropTestId="remote-agent-picker-backdrop">
      <div data-testid="remote-agent-picker" role="dialog" aria-modal="true" aria-label="New remote workspace"
        style={{ width: 460, maxWidth: '90vw', padding: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>New remote workspace</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
          {namedAgents.length === 0 && (
            <div style={{ color: 'var(--fg-dim, #aaa)', fontSize: 12 }}>
              No named agents yet — add one below (or seed from an SSH favorite).
            </div>
          )}
          {namedAgents.map(a => (
            <div key={a.id} data-testid="remote-agent-row"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 4,
                background: selected === a.id ? 'rgba(30, 136, 229, 0.25)' : 'transparent',
                border: selected === a.id ? '1px solid var(--accent, #1e88e5)' : '1px solid transparent'
              }}>
              <button type="button" data-testid={`remote-agent-select-${a.id}`}
                style={{ flex: 1, textAlign: 'left', minWidth: 0 }}
                title={`${a.user}@${a.host}${a.port ? `:${a.port}` : ''}`}
                aria-pressed={selected === a.id}
                onClick={() => setSelected(a.id)}>
                {a.name}
              </button>
              <span style={{ color: 'var(--fg-dim, #aaa)', fontSize: 11, whiteSpace: 'nowrap' }}>
                {a.user}@{a.host}
              </span>
              <button type="button" data-testid={`remote-agent-remove-${a.id}`} title={`Remove ${a.name}`}
                onClick={() => { void removeAgent(a.id) }}>✕</button>
            </div>
          ))}
        </div>

        {/* The add form: one submit — Enter anywhere in it adds (CONV-043). */}
        <form data-testid="remote-agent-add-form" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
          onSubmit={(e) => { e.preventDefault(); void addAgent() }}>
          <label style={field}>Name
            <input data-testid="remote-agent-name" autoFocus value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label style={field}>Host
            <input data-testid="remote-agent-host" value={host} onChange={e => setHost(e.target.value)} />
          </label>
          <label style={field}>User
            <input data-testid="remote-agent-user" value={user} onChange={e => setUser(e.target.value)} />
          </label>
          <label style={field}>Port (default 22)
            <input data-testid="remote-agent-port" value={port} onChange={e => setPort(e.target.value)} inputMode="numeric" />
          </label>
          <label style={{ ...field, gridColumn: '1 / -1' }}>Identity file path (optional — never key material)
            <input data-testid="remote-agent-identity" value={identityFile} onChange={e => setIdentityFile(e.target.value)} />
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" data-testid="remote-agent-add" disabled={addDisabled}
              title={addDisabled ? 'Name, host and user are required' : 'Add this agent to the registry'}>
              Add agent
            </button>
            {connections.length > 0 && (
              <select data-testid="remote-agent-seed" value="" aria-label="Seed from an SSH favorite"
                onChange={e => { if (e.target.value) void seedFrom(e.target.value) }}>
                <option value="">Seed from SSH favorite…</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" data-testid="remote-agent-cancel" onClick={onClose}>Cancel</button>
          <button type="button" data-testid="remote-agent-create" disabled={!selected}
            title={selected ? 'Create a workspace homed to the selected agent' : 'Select an agent first'}
            onClick={create}>
            Create workspace
          </button>
        </div>
      </div>
    </Modal>
  )
}
