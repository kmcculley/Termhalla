import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import type { SearchHit, SearchStats } from '@shared/types'
import { Modal, Z } from './Modal'

function baseName(p: string): string { const a = p.split(/[\\/]/).filter(Boolean); return a[a.length - 1] ?? p }
function paneExists(workspaces: Record<string, { panes: Record<string, unknown> }>, paneId: string): boolean {
  return Object.values(workspaces).some(ws => paneId in ws.panes)
}

export function SearchHistory() {
  const open = useStore(s => s.searchOpen)
  const setOpen = useStore(s => s.setSearchOpen)
  const reveal = useStore(s => s.revealPaneFromSearch)
  const relaunch = useStore(s => s.relaunchFromSearch)
  const workspaces = useStore(s => s.workspaces)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [stats, setStats] = useState<SearchStats>({ segments: 0, oldest: null })

  useEffect(() => { if (open) void api.searchStats().then(setStats) }, [open])
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { void api.searchQuery(q).then(setHits) }, 200)
    return () => clearTimeout(t)
  }, [q, open])

  if (!open) return null
  return (
    <Modal onClose={() => setOpen(false)} align="top" z={Z.palette}
      backdropTestId="search-backdrop" cardTestId="search-history" card={{ width: 640, maxHeight: '70vh', gap: 0 }}>
      <input data-testid="search-input" autoFocus value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search terminal output…"
        style={{ padding: 10, border: 'none', borderBottom: '1px solid var(--border, #444)', background: 'transparent', color: 'var(--fg, #eee)', fontSize: 14 }} />
      <div style={{ overflowY: 'auto' }}>
        {hits.length === 0 && q.trim() !== '' && <div style={{ padding: 10, color: 'var(--fg-dim, #aaa)' }}>No matches.</div>}
        {hits.map((h, i) => (
          <div key={h.id} data-testid={`search-result-${i}`}
            style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #333)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 11, color: 'var(--fg-dim, #aaa)', display: 'flex', gap: 8 }}>
              <span>{h.cwd ? baseName(h.cwd) : '—'}</span>
              <span style={{ flex: 1 }} />
              {paneExists(workspaces, h.paneId)
                ? <button data-testid={`search-reveal-${i}`} onClick={() => reveal(h.paneId)}>Reveal</button>
                : <button data-testid={`search-relaunch-${i}`} onClick={() => relaunch(h.cwd)}>Relaunch</button>}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{h.snippet}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border, #444)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--fg-dim, #aaa)' }}>
        <span data-testid="search-stats">{stats.segments} segments{stats.oldest ? ` · oldest ${new Date(stats.oldest).toLocaleDateString()}` : ''}</span>
        <span style={{ flex: 1 }} />
        <button data-testid="search-clear" onClick={() => { void api.searchClear().then(setStats); setHits([]) }}>Clear history</button>
      </div>
    </Modal>
  )
}
