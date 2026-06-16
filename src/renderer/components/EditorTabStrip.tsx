import { UNTITLED } from '@shared/editor-draft'
import { base, isDirty, type Tab } from '../editor/tabs'

const tabStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex', gap: 4, alignItems: 'center', padding: '2px 8px', cursor: 'pointer',
  background: selected ? 'var(--accent, #1e88e5)' : 'transparent', color: 'var(--fg, #ddd)', whiteSpace: 'nowrap'
})

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

/** One open-file tab. */
function FileTab({ path, tab, active, onSelect, onClose }: {
  path: string; tab: Tab | undefined; active: boolean; onSelect: () => void; onClose: () => void
}) {
  return (
    <div data-testid={`tab-${base(path)}`} onClick={onSelect} style={tabStyle(active)}>
      <span style={{ textDecoration: tab?.missing ? 'line-through' : 'none' }}>
        {base(path)}{isDirty(tab) ? ' •' : ''}{tab?.missing ? ' (deleted)' : ''}
      </span>
      <button data-testid={`tab-close-${base(path)}`} onClick={e => { e.stopPropagation(); onClose() }}>×</button>
    </div>
  )
}

export function EditorTabStrip({ order, active, untitledContent, getTab, onSelect, onClose, onSaveUntitledAs, onClearUntitled, onOpenFile }: {
  order: string[]
  active: string | undefined
  untitledContent: string
  getTab: (path: string) => Tab | undefined
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onSaveUntitledAs: () => void
  onClearUntitled: () => void
  onOpenFile: () => void
}) {
  return (
    <div data-testid="editor-tabs" style={{ display: 'flex', background: 'var(--panel, #1e1e1e)', overflowX: 'auto' }}>
      <UntitledTab content={untitledContent} active={active === UNTITLED} hasFiles={order.length > 0}
        onSelect={() => onSelect(UNTITLED)} onSaveAs={onSaveUntitledAs} onClear={onClearUntitled} />
      {order.length === 0 && (
        <button data-testid="editor-open-file" onClick={onOpenFile}>Open File…</button>
      )}
      {order.map(p => (
        <FileTab key={p} path={p} tab={getTab(p)} active={p === active}
          onSelect={() => onSelect(p)} onClose={() => onClose(p)} />
      ))}
    </div>
  )
}
