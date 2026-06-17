import { useState } from 'react'
import { useStore } from '../store'
import type { CloudState, CloudStatus } from '@shared/types'
import { Z, SURFACE } from './Modal'

const GLYPH: Record<CloudState, string> = {
  'checking': '…', 'logged-in': '✓', 'logged-out': '⚠', 'not-installed': '∅', 'error': '!'
}
const COLOR: Record<CloudState, string> = {
  'checking': '#888', 'logged-in': '#7ec97e', 'logged-out': '#d6a14a', 'not-installed': '#666', 'error': '#d6694a'
}

/** Trailing label after the provider name: the account when known, else the state in parens
 *  (suppressed for a plain logged-in provider). */
function accountLabel(c: CloudStatus): string {
  if (c.account) return `: ${c.account}`
  return c.state === 'logged-in' ? '' : ` (${c.state})`
}

export function StatusBar() {
  const cloud = useStore(s => s.cloud)
  const refreshCloud = useStore(s => s.refreshCloud)
  const launchCommand = useStore(s => s.launchCommand)
  const [openFor, setOpenFor] = useState<string | null>(null)

  return (
    <div data-testid="status-bar"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 10px', background: 'var(--panel, #1e1e1e)',
        borderTop: '1px solid var(--border, #333)', fontSize: 12, color: 'var(--fg-dim, #aaa)', minHeight: 22 }}>
      {cloud.length === 0 && <span style={{ opacity: 'var(--dimmer)' }}>cloud status…</span>}
      {cloud.map(c => (
        <div key={c.id} style={{ position: 'relative' }}>
          <button data-testid={`cloud-${c.id}`} type="button" title={`${c.label}: ${c.state}`}
            onClick={() => setOpenFor(openFor === c.id ? null : c.id)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit',
              color: COLOR[c.state], padding: 0, whiteSpace: 'nowrap' }}>
            {GLYPH[c.state]} {c.label}{accountLabel(c)}
          </button>
          {openFor === c.id && (
            <div data-testid={`cloud-menu-${c.id}`} onClick={e => e.stopPropagation()}
              style={{ ...SURFACE, position: 'absolute', bottom: 24, left: 0, zIndex: Z.menu, padding: 8, minWidth: 240, display: 'flex',
                flexDirection: 'column', gap: 4, fontFamily: 'var(--mono)' }}>
              {c.detail && Object.entries(c.detail).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--fg-dim, #aaa)', minWidth: 92 }}>{k}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
                </div>
              ))}
              {(!c.detail || Object.keys(c.detail).length === 0) && <div style={{ color: 'var(--fg-dim, #aaa)' }}>{c.state}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button data-testid={`cloud-refresh-${c.id}`} type="button"
                  onClick={() => refreshCloud()}>Refresh</button>
                {c.state !== 'not-installed' && c.login && (
                  <button data-testid={`cloud-login-${c.id}`} type="button"
                    onClick={() => { const l = c.login!; launchCommand(l); setOpenFor(null) }}>Log in</button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
