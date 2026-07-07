import { useState } from 'react'
import { useStore } from '../store'
import { MenuSurface } from './MenuSurface'

export function TemplatesMenu({ onPicked, onClose }: { onPicked: (id: string) => void; onClose: () => void }) {
  const templates = useStore(s => s.quick.templates)
  const saveTemplate = useStore(s => s.saveTemplate)
  const deleteTemplate = useStore(s => s.deleteTemplate)
  const newFromTemplate = useStore(s => s.newWorkspaceFromTemplate)
  const newOrkyWorkspace = useStore(s => s.newOrkyWorkspace)
  const newRemoteWorkspace = useStore(s => s.newRemoteWorkspace)
  const pushToast = useStore(s => s.pushToast)
  const [name, setName] = useState('')
  return (
    // No portal: this menu opens from the tab strip (window chrome, not a mosaic tile).
    <MenuSurface testid="templates-menu" onClose={onClose}
      style={{ top: 30, left: 4, padding: 6, gap: 4, minWidth: 220, fontSize: 'var(--font-size, 13px)' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input data-testid="tpl-name" placeholder="Template name" value={name}
            onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
          <button data-testid="tpl-save" disabled={!name.trim()}
            onClick={() => { saveTemplate(name); pushToast('Template saved'); setName('') }}>Save current</button>
        </div>
        {/* Feature 0011 (REQ-003): the BUILT-IN cockpit row — window chrome, never a saved
            template. Rendered in EVERY templates state (it may co-render with the saved-templates
            empty copy below, which keeps referring to SAVED templates), never deletable, never
            persisted: activating it dispatches the cockpit gesture — the F11-labelled shared
            root picker, then a fresh workspace holding an Orky pane + a terminal at the picked
            project root — and quick.json's template list is untouched by the whole flow. */}
        <button data-testid="tpl-orky-cockpit" style={{ textAlign: 'left' }}
          onClick={() => { void newOrkyWorkspace(); onClose() }}>Orky project cockpit…</button>
        {/* Feature 0022 (REQ-015): the BUILT-IN remote-workspace row — window chrome, never a saved
            template; activating it opens the remote-agent picker (single-gesture create). */}
        <button data-testid="tpl-remote-workspace" style={{ textAlign: 'left' }}
          onClick={() => { void newRemoteWorkspace(); onClose() }}>Remote workspace…</button>
        {templates.length === 0 && <div style={{ color: 'var(--fg-dim, #aaa)' }}>No templates yet.</div>}
        {templates.map(t => (
          <div key={t.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button data-testid={`tpl-${t.id}`} style={{ flex: 1, textAlign: 'left' }}
              onClick={() => { const id = newFromTemplate(t.id, t.name); onClose(); onPicked(id) }}>{t.name}</button>
            <button data-testid={`tpl-del-${t.id}`} title="Delete template"
              onClick={() => { deleteTemplate(t.id); pushToast('Template deleted') }}>×</button>
          </div>
        ))}
    </MenuSurface>
  )
}
