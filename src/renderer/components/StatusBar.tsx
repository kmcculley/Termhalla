import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { CloudState, CloudStatus } from '@shared/types'
import { Z, SURFACE } from './Modal'
import { resolveBindings, formatChord, COMMANDS, TIP_COMMANDS, nextTipIndex } from '@shared/keybindings'
import { groupCloudStatuses } from '@shared/group-cloud'

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
  const overrides = useStore(s => s.quick.keybindings)
  // Decision queue (feature 0006): the badge reads the SAME memoized queueCount selector the
  // drawer's list derives from (REQ-007) — never a second count. Live while the drawer is closed.
  const queueOpen = useStore(s => s.queueOpen)
  const setQueueOpen = useStore(s => s.setQueueOpen)
  const queueCount = useStore(s => s.queueCount())
  const [tipIdx, setTipIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTipIdx(i => nextTipIndex(i, TIP_COMMANDS.length)), 7000)
    return () => clearInterval(t)
  }, [])
  const resolved = resolveBindings(overrides)
  // The tooltip chord derives from the user-customizable registry (CONV-005) — never a hard-coded
  // chord literal; a rebind updates this text, an explicit 'none' unbind drops the suffix.
  const queueChord = resolved['toggle-orky-queue']
  const queueTitle = `Toggle Orky decision queue${queueChord ? ` (${formatChord(queueChord)})` : ''}`
  const tipId = TIP_COMMANDS[tipIdx % TIP_COMMANDS.length]
  const tipCmd = COMMANDS.find(c => c.id === tipId)
  const tipChord = resolved[tipId]
  const tipText = tipCmd && tipChord ? `Press ${formatChord(tipChord)} to ${tipCmd.tip ?? tipCmd.label.toLowerCase()}` : null

  return (
    <div data-testid="status-bar"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 10px', background: 'var(--panel, #1e1e1e)',
        borderTop: '1px solid var(--border, #333)', fontSize: 12, color: 'var(--fg-dim, #aaa)', minHeight: 22 }}>
      {cloud.length === 0 && <span style={{ opacity: 'var(--dimmer)' }}>cloud status…</span>}
      {groupCloudStatuses(cloud).map(g => (
        <div key={g.family} style={{ position: 'relative' }}>
          <button data-testid={`cloud-${g.family}`} type="button" title={`${g.label}: ${g.summary}`}
            onClick={() => setOpenFor(openFor === g.family ? null : g.family)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit',
              // Partial login (some profiles in, some out) shows amber, not the all-green of summary.
              color: g.summary === 'logged-in' && g.loggedIn < g.total ? COLOR['logged-out'] : COLOR[g.summary],
              padding: 0, whiteSpace: 'nowrap' }}>
            {GLYPH[g.summary]} {g.label}{g.total > 1 ? ` ${g.loggedIn}/${g.total}` : ''}
          </button>
          {openFor === g.family && (
            <div data-testid={`cloud-menu-${g.family}`} onClick={e => e.stopPropagation()}
              style={{ ...SURFACE, position: 'absolute', bottom: 24, left: 0, zIndex: Z.menu, padding: 8, minWidth: 260,
                display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--mono)' }}>
              {g.members.map(c => (
                <div key={c.id} data-testid={`cloud-profile-${c.profile ?? c.family}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid var(--border, #444)', paddingTop: 4 }}>
                  <div style={{ color: COLOR[c.state], whiteSpace: 'nowrap' }}>
                    {GLYPH[c.state]} {c.profile ?? c.label}{accountLabel(c)}
                  </div>
                  {c.detail && Object.entries(c.detail).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap', color: 'var(--fg-dim, #aaa)' }}>
                      <span style={{ minWidth: 80 }}>{k}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
                    </div>
                  ))}
                  {c.state !== 'not-installed' && c.login && (c.state === 'logged-out' || c.state === 'error') && (
                    <button data-testid={`cloud-login-${c.id}`} type="button"
                      onClick={() => { const l = c.login!; launchCommand(l); setOpenFor(null) }}>Log in</button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button data-testid={`cloud-refresh-${g.family}`} type="button" onClick={() => refreshCloud()}>Refresh</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {/* The rotating tip sits LEFT of the buttons: its width changes every rotation, and as the
          rightmost element it would shove the search/notes/queue buttons sideways each time.
          Here the spacer absorbs the width change and the buttons stay pinned to the right edge. */}
      {tipText && (
        <span data-testid="statusbar-tip"
          style={{ whiteSpace: 'nowrap', opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {tipText}
        </span>
      )}
      <button data-testid="search-toggle" type="button" title="Search output history (Ctrl+Shift+F)"
        onClick={() => useStore.getState().setSearchOpen(true)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--fg-dim, #aaa)', padding: 0 }}>🔍</button>
      <button data-testid="notes-toggle" type="button" title="Toggle notes (project notepad)"
        onClick={() => useStore.getState().setNotesOpen(!useStore.getState().notesOpen)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--fg-dim, #aaa)', padding: 0 }}>📝</button>
      <button data-testid="orky-queue-toggle" type="button" title={queueTitle}
        // The accessible NAME carries the live count (FINDING-009): aria-label overrides element
        // content in accessible-name computation, so the visible badge alone would leave the
        // needs-you signal unannounced to assistive technology.
        aria-label={`Toggle Orky decision queue${queueCount > 0 ? `, ${queueCount} waiting` : ''}`}
        aria-expanded={queueOpen}
        onClick={() => setQueueOpen(!queueOpen)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit',
          color: 'var(--fg-dim, #aaa)', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        📋{queueCount > 0 && (
          <span data-testid="orky-queue-badge"
            style={{ background: 'var(--status-needs-input, #e0a030)', color: 'var(--panel, #1e1e1e)',
              borderRadius: 8, padding: '0 5px', fontSize: 11, lineHeight: '14px' }}>
            {queueCount}
          </span>
        )}
      </button>
    </div>
  )
}
