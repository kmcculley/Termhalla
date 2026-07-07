import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import type { PaneKind } from '../store/pane-ops'
import { tabBadge } from './tab-badge'
import { useTabDrag } from './use-tab-drag'
import { TemplatesMenu } from './TemplatesMenu'
import { MenuSurface } from './MenuSurface'
import { Z } from './Modal'

export function WorkspaceTabs() {
  // Scope the subscription so the always-mounted tab bar doesn't re-render on every per-pane
  // runtime change (cwds/procs/usage/cloud/recording all churn during terminal activity).
  const {
    order, workspaces, activeId, setActive, newWorkspace,
    saveAll, shells, newTerminalShellId, setNewTerminalShell, addPaneOfKind,
    renameWorkspace, closeWorkspace, moveWorkspace, setBroadcastOpen, broadcastOpen
  } = useStore(useShallow(s => ({
    order: s.order, workspaces: s.workspaces, activeId: s.activeId, setActive: s.setActive,
    newWorkspace: s.newWorkspace, saveAll: s.saveAll, shells: s.shells,
    newTerminalShellId: s.newTerminalShellId, setNewTerminalShell: s.setNewTerminalShell,
    addPaneOfKind: s.addPaneOfKind,
    renameWorkspace: s.renameWorkspace, closeWorkspace: s.closeWorkspace,
    moveWorkspace: s.moveWorkspace, setBroadcastOpen: s.setBroadcastOpen, broadcastOpen: s.broadcastOpen
  })))
  // Derive the per-workspace badge string inside the selector: statuses/aiSessions change on
  // every line of output, but shallow-comparing the derived strings means we only re-render
  // when a badge's *text* actually changes.
  const badges = useStore(useShallow(s => {
    const out: Record<string, string> = {}
    for (const id of s.order) { const ws = s.workspaces[id]; if (ws) out[id] = tabBadge(ws, s.statuses, s.aiSessions, s.orky) }
    return out
  }))

  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  // The templates menu is transient chrome: a modal opening over it (e.g. Settings via Ctrl+,)
  // must dismiss it — otherwise its invisible full-viewport click-catcher survives the modal
  // round-trip and silently swallows the next click on the tab strip (frozen TEST-018).
  const settingsOpen = useStore(s => s.settings !== null)
  useEffect(() => { if (settingsOpen) setTemplatesOpen(false) }, [settingsOpen])
  const { ghost, beginTabDrag } = useTabDrag(setActive, moveWorkspace)

  const startRename = (id: string) => { setRenameText(workspaces[id]?.name ?? ''); setRenamingId(id); setMenuFor(null) }
  const commitRename = (id: string) => { renameWorkspace(id, renameText); setRenamingId(null) }

  // --- Tab-strip horizontal scroll ------------------------------------------------------------
  // The tabs live in a fixed-scrollbar-free viewport; when they overflow the available width we
  // reveal ◀/▶ scroll buttons (the native scrollbar stays hidden so an overflowing strip never
  // grows the strip's height — the constant-height invariant guarded by tab-strip.spec.ts).
  const scrollRef = useRef<HTMLDivElement>(null)
  const [nav, setNav] = useState({ overflow: false, atStart: true, atEnd: true })
  const syncNav = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const overflow = el.scrollWidth - el.clientWidth > 1
    const atStart = el.scrollLeft <= 1
    const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1
    setNav(prev => (prev.overflow === overflow && prev.atStart === atStart && prev.atEnd === atEnd)
      ? prev : { overflow, atStart, atEnd })
  }, [])
  // Re-measure when the tab count changes or the viewport is resized (window resize, arrows
  // appearing/disappearing). setNav is guarded so this settles rather than oscillates.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    syncNav()
    const ro = new ResizeObserver(syncNav)
    ro.observe(el)
    return () => ro.disconnect()
  }, [syncNav, order.length])
  // Keep the active tab in view (a fixed-width overflowing strip can otherwise hide it after a
  // switch, reorder, or new-workspace). getBoundingClientRect avoids offsetParent assumptions.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const btn = activeId ? tabRefs.current.get(activeId) : null
    if (!el || !btn) return
    const er = el.getBoundingClientRect(), br = btn.getBoundingClientRect()
    if (br.left < er.left) el.scrollLeft -= (er.left - br.left) + 8
    else if (br.right > er.right) el.scrollLeft += (br.right - er.right) + 8
    syncNav()
  }, [activeId, order, syncNav])
  const scrollStrip = (dir: -1 | 1) => {
    const el = scrollRef.current
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.75), behavior: 'smooth' })
  }

  // Roving-tabindex arrow nav within the tablist (ArrowLeft/Right wrap; Home/End jump).
  const onTabKey = (id: string) => (e: React.KeyboardEvent) => {
    const i = order.indexOf(id)
    let next: string | undefined
    if (e.key === 'ArrowRight') next = order[(i + 1) % order.length]
    else if (e.key === 'ArrowLeft') next = order[(i - 1 + order.length) % order.length]
    else if (e.key === 'Home') next = order[0]
    else if (e.key === 'End') next = order[order.length - 1]
    else return
    e.preventDefault()
    if (next) { setActive(next); tabRefs.current.get(next)?.focus() }
  }

  return (
    <div data-testid="workspace-tabs" role="tablist" aria-label="Workspaces"
      // The strip must keep a CONSTANT height: when crowded, tabs scroll horizontally (arrows) rather
      // than wrapping to a second line. A wrap-driven height change resizes the terminal area → full
      // ConPTY repaint → the status tracker sees "output" → the badge flips → the strip un-wraps — a
      // self-sustaining oscillation. Guarded by tests/e2e/tab-strip.spec.ts.
      style={{ display: 'flex', flexWrap: 'nowrap', gap: 4, padding: 4, background: 'var(--panel, #1e1e1e)', alignItems: 'center', fontSize: 'var(--font-size, 13px)' }}>
      {nav.overflow && (
        <button data-testid="tabs-scroll-left" className="ws-scroll-btn" aria-label="Scroll tabs left"
          disabled={nav.atStart} onClick={() => scrollStrip(-1)}>◀</button>
      )}
      {/* Presentational scroll viewport: keeps the tab buttons (still tablist descendants) on one
          scrollable line. Its native scrollbar is hidden in CSS so overflow can't add height. */}
      <div className="ws-tab-scroll" role="presentation" ref={scrollRef} onScroll={syncNav}>
        {order.map(id => (
          renamingId === id ? (
            <input key={id} data-testid={`ws-rename-${id}`} className="ws-rename" autoFocus value={renameText}
              onFocus={e => e.currentTarget.select()}
              onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(id); else if (e.key === 'Escape') setRenamingId(null) }}
              onBlur={() => commitRename(id)}
              style={{ width: 'var(--ws-tab-w)', flexShrink: 0 }} />
          ) : (
            <button key={id} data-testid={`tab-${id}`} data-tab-id={id} className="ws-tab"
              data-active={id === activeId}
              role="tab" aria-selected={id === activeId} tabIndex={id === activeId ? 0 : -1}
              title={workspaces[id].name}
              ref={el => { if (el) tabRefs.current.set(id, el); else tabRefs.current.delete(id) }}
              onKeyDown={onTabKey(id)}
              onPointerDown={beginTabDrag(id)}
              onDoubleClick={() => startRename(id)}
              onContextMenu={e => { e.preventDefault(); setMenuFor({ id, x: e.clientX, y: e.clientY }) }}>
              {badges[id]?.trim() ? <span className="ws-tab-badge">{badges[id].trim()}</span> : null}
              {/* Name scrolls horizontally when it can't fit; translate a vertical wheel into a
                  horizontal scroll so a plain mouse can reveal the rest. */}
              <span className="ws-tab-name"
                onWheel={e => { const el = e.currentTarget; if (el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY || e.deltaX }}>
                {workspaces[id].name}
              </span>
            </button>
          )
        ))}
      </div>
      {nav.overflow && (
        <button data-testid="tabs-scroll-right" className="ws-scroll-btn" aria-label="Scroll tabs right"
          disabled={nav.atEnd} onClick={() => scrollStrip(1)}>▶</button>
      )}
      <button data-testid="new-workspace" style={{ flexShrink: 0 }}
        onClick={() => { const id = newWorkspace(`Workspace ${order.length + 1}`); startRename(id) }}>+</button>
      <button data-testid="templates-button" title="Workspace templates" style={{ flexShrink: 0 }}
        onClick={() => setTemplatesOpen(o => !o)}>▾</button>
      <span style={{ flex: 1 }} />
      <select data-testid="shell-picker" value={newTerminalShellId ?? ''} style={{ flexShrink: 0 }}
        onChange={e => setNewTerminalShell(e.target.value)}>
        {shells.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select data-testid="add-pane" value="" style={{ flexShrink: 0 }} onChange={e => {
        const kind = e.target.value as PaneKind; e.currentTarget.value = ''
        if (activeId) void addPaneOfKind(activeId, kind)
      }}>
        <option value="" disabled>＋ pane…</option>
        <option value="terminal">Terminal</option>
        <option value="editor">Editor</option>
        <option value="explorer">Explorer</option>
        <option value="orky">Orky</option>
      </select>
      <button data-testid="broadcast-button" title="Broadcast to all terminals (Ctrl+Shift+Enter)" style={{ flexShrink: 0 }}
        onClick={() => setBroadcastOpen(!broadcastOpen)}>⇉</button>
      <button data-testid="save-workspace" style={{ flexShrink: 0 }} onClick={() => saveAll()}>Save</button>

      {menuFor && (
        // No portal: the tab strip is window chrome, not a mosaic tile.
        <MenuSurface testid="ws-menu" onClose={() => setMenuFor(null)}
          style={{ left: menuFor.x, top: menuFor.y, padding: 4, gap: 2, fontSize: 'var(--font-size, 13px)' }}>
          <button data-testid="ws-menu-rename" onClick={() => startRename(menuFor.id)}>Rename</button>
          <button data-testid="ws-menu-save" onClick={() => { void saveAll(); setMenuFor(null) }}>Save</button>
          <button data-testid="ws-menu-close" onClick={() => {
            const ws = workspaces[menuFor.id]
            const ok = !ws || Object.keys(ws.panes).length === 0 ||
              window.confirm(`Close workspace "${ws.name}"? Its terminals will be closed.`)
            if (ok) closeWorkspace(menuFor.id)
            setMenuFor(null)
          }}>Close</button>
        </MenuSurface>
      )}
      {ghost && (
        <div data-testid="tab-ghost"
          style={{ position: 'fixed', left: ghost.x + 8, top: ghost.y + 8, zIndex: Z.menu + 2, pointerEvents: 'none',
            padding: '2px 8px', background: 'var(--elevated, #333)', border: '1px solid var(--border, #555)', borderRadius: 4, opacity: 0.9 }}>
          {workspaces[ghost.id]?.name}
        </div>
      )}
      {templatesOpen && <TemplatesMenu onPicked={startRename} onClose={() => setTemplatesOpen(false)} />}
    </div>
  )
}
