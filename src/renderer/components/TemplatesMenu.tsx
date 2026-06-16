import { useState } from 'react'
import { useStore } from '../store'
import { Z, SURFACE } from './Modal'

export function TemplatesMenu({ onPicked, onClose }: { onPicked: (id: string) => void; onClose: () => void }) {
  const templates = useStore(s => s.quick.templates)
  const saveTemplate = useStore(s => s.saveTemplate)
  const deleteTemplate = useStore(s => s.deleteTemplate)
  const newFromTemplate = useStore(s => s.newWorkspaceFromTemplate)
  const [name, setName] = useState('')
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: Z.menu }} />
      <div data-testid="templates-menu"
        style={{ ...SURFACE, position: 'fixed', top: 30, left: 4, zIndex: Z.menu + 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, fontSize: 'var(--font-size, 13px)' }}>
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
