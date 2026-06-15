import { useState } from 'react'
import { useStore } from '../store'

export function TemplatesMenu({ onPicked, onClose }: { onPicked: (id: string) => void; onClose: () => void }) {
  const templates = useStore(s => s.quick.templates)
  const saveTemplate = useStore(s => s.saveTemplate)
  const deleteTemplate = useStore(s => s.deleteTemplate)
  const newFromTemplate = useStore(s => s.newWorkspaceFromTemplate)
  const [name, setName] = useState('')
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div data-testid="templates-menu"
        style={{ position: 'fixed', top: 30, left: 4, zIndex: 41, background: 'var(--elevated, #252526)', color: 'var(--fg, #eee)',
          border: '1px solid var(--border, #444)', borderRadius: 4, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, fontSize: 'var(--font-size, 13px)' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input data-testid="tpl-name" placeholder="Template name" value={name}
            onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
          <button data-testid="tpl-save" disabled={!name.trim()}
            onClick={() => { saveTemplate(name); setName('') }}>Save current</button>
        </div>
        {templates.length === 0 && <div style={{ opacity: 0.6 }}>No templates yet.</div>}
        {templates.map(t => (
          <div key={t.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button data-testid={`tpl-${t.id}`} style={{ flex: 1, textAlign: 'left' }}
              onClick={() => { const id = newFromTemplate(t.id, t.name); onClose(); onPicked(id) }}>{t.name}</button>
            <button data-testid={`tpl-del-${t.id}`} title="Delete template"
              onClick={() => deleteTemplate(t.id)}>×</button>
          </div>
        ))}
      </div>
    </>
  )
}
