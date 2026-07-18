import { useState } from 'react'
import { UNTITLED } from '@shared/editor-draft'
import { api } from '../api'
import { useStore } from '../store'
import { base, isDirty, type Tab } from '../editor/tabs'
import { MenuSurface } from './MenuSurface'

const tabStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex', gap: 4, alignItems: 'center', padding: '2px 8px', cursor: 'pointer',
  background: selected ? 'var(--accent, #1e88e5)' : 'transparent', color: 'var(--fg, #ddd)', whiteSpace: 'nowrap'
})

// CLAUDE.md gotcha: nothing here may change the strip children's BOX (border/padding/font shifts
// the strip height and wedges Monaco's layout). The label cap is width-only; menus portal out.
const LABEL_MAX_PX = 160

/** The untitled scratch-buffer tab. Hidden once real files are open and the buffer is empty. */
function UntitledTab({ content, active, hasFiles, onSelect, onSaveAs, onClear }: {
  content: string; active: boolean; hasFiles: boolean
  onSelect: () => void; onSaveAs: () => void; onClear: () => void
}) {
  if (hasFiles && content === '') return null
  return (
    <div data-testid="tab-untitled" onClick={onSelect} style={tabStyle(active)}>
      <span>Untitled{content !== '' ? ' •' : ''}</span>
      {active && content !== '' && (
        <button data-testid="untitled-saveas" title="Save As…"
          onClick={e => { e.stopPropagation(); onSaveAs() }}>Save As…</button>
      )}
      {hasFiles && (
        <button data-testid="tab-close-untitled" onClick={e => { e.stopPropagation(); onClear() }}>×</button>
      )}
    </div>
  )
}

/** One open-file tab. Middle-click closes (QoL 2026-07-17); long names ellipsize with the full
 *  path on hover; right-click opens the tab menu. */
function FileTab({ path, tab, active, onSelect, onClose, onMenu }: {
  path: string; tab: Tab | undefined; active: boolean
  onSelect: () => void; onClose: () => void; onMenu: (x: number, y: number) => void
}) {
  // Only a real not-found renders "(deleted)". An unknown read failure (permissions, I/O) gets
  // a distinct "(can't read)" affordance — paint-only (color/title), never strikethrough, since
  // the file may well still exist (finding 27, 2026-07 quality audit).
  const state = tab?.missing ? ' (deleted)' : tab?.binary ? ' (binary)' : tab?.readError ? " (can't read)" : ''
  return (
    <div data-testid={`tab-${base(path)}`} onClick={onSelect}
      title={tab?.readError ? `${path} — ${tab.readError}` : path}
      onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose() } }}
      onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY) }}
      style={tabStyle(active)}>
      <span style={{ textDecoration: tab?.missing ? 'line-through' : 'none',
        color: tab?.readError ? 'var(--warn-fg, #e0a030)' : undefined,
        maxWidth: LABEL_MAX_PX, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {base(path)}{isDirty(tab) ? ' •' : ''}{state}
      </span>
      <button data-testid={`tab-close-${base(path)}`} onClick={e => { e.stopPropagation(); onClose() }}>×</button>
    </div>
  )
}

export function EditorTabStrip({ order, active, untitledContent, getTab, onSelect, onClose, onSaveUntitledAs, onClearUntitled, onOpenFile, onSaveTabAs }: {
  order: string[]
  active: string | undefined
  untitledContent: string
  getTab: (path: string) => Tab | undefined
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onSaveUntitledAs: () => void
  onClearUntitled: () => void
  onOpenFile: () => void
  onSaveTabAs: (path: string) => void
}) {
  const pushToast = useStore(s => s.pushToast)
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const closeMany = (paths: string[]) => { for (const p of paths) onClose(p) }
  return (
    <div data-testid="editor-tabs" style={{ display: 'flex', background: 'var(--panel, #1e1e1e)', overflowX: 'auto' }}>
      <UntitledTab content={untitledContent} active={active === UNTITLED} hasFiles={order.length > 0}
        onSelect={() => onSelect(UNTITLED)} onSaveAs={onSaveUntitledAs} onClear={onClearUntitled} />
      {order.length === 0 && (
        <button data-testid="editor-open-file" onClick={onOpenFile}>Open File…</button>
      )}
      {order.map(p => (
        <FileTab key={p} path={p} tab={getTab(p)} active={p === active}
          onSelect={() => onSelect(p)} onClose={() => onClose(p)}
          onMenu={(x, y) => setMenu({ path: p, x, y })} />
      ))}
      {menu && (
        // portal: the tab strip lives inside a react-mosaic tile (the containing-block gotcha).
        <MenuSurface testid="editor-tab-menu" portal onClose={() => setMenu(null)}
          style={{ left: menu.x, top: menu.y, padding: 4, gap: 2, fontSize: 'var(--font-size, 13px)' }}>
          <button data-testid="tab-menu-close" onClick={() => { setMenu(null); onClose(menu.path) }}>Close</button>
          <button data-testid="tab-menu-close-others" disabled={order.length < 2}
            onClick={() => { setMenu(null); closeMany(order.filter(p => p !== menu.path)) }}>Close others</button>
          <button data-testid="tab-menu-close-right" disabled={order.indexOf(menu.path) === order.length - 1}
            onClick={() => { setMenu(null); closeMany(order.slice(order.indexOf(menu.path) + 1)) }}>Close to the right</button>
          <button data-testid="tab-menu-close-all" onClick={() => { setMenu(null); closeMany([...order]) }}>Close all</button>
          <button data-testid="tab-menu-saveas" onClick={() => { setMenu(null); onSaveTabAs(menu.path) }}>Save As…</button>
          <button data-testid="tab-menu-copy-path" onClick={() => { api.clipboardWrite(menu.path); pushToast('Path copied'); setMenu(null) }}>Copy path</button>
          <button data-testid="tab-menu-reveal" onClick={() => { void api.fsRevealItem(menu.path); setMenu(null) }}>Reveal in File Explorer</button>
        </MenuSurface>
      )}
    </div>
  )
}
