import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { mergeTheme } from '@shared/theme'
import type { Theme } from '@shared/types'

const COLORS: { key: keyof Theme; label: string }[] = [
  { key: 'windowBg', label: 'Window background' },
  { key: 'panelBg', label: 'Toolbar / panel' },
  { key: 'elevatedBg', label: 'Menus & dialogs' },
  { key: 'border', label: 'Borders' },
  { key: 'text', label: 'Text' },
  { key: 'textDim', label: 'Dim text' },
  { key: 'accent', label: 'Accent / active' },
  { key: 'statusBusy', label: 'Alert: busy' },
  { key: 'statusNeedsInput', label: 'Alert: needs input' },
  { key: 'termBg', label: 'Terminal background' },
  { key: 'termFg', label: 'Terminal text' }
]

export function ThemeEditor({ onClose }: { onClose: () => void }) {
  const quickTheme = useStore(s => s.quick.theme)
  const setTheme = useStore(s => s.setTheme)
  const resetTheme = useStore(s => s.resetTheme)
  const saveThemePreset = useStore(s => s.saveThemePreset)
  const applyThemePreset = useStore(s => s.applyThemePreset)
  const deleteThemePreset = useStore(s => s.deleteThemePreset)
  const presets = useStore(s => s.quick.themePresets)
  const t = mergeTheme(quickTheme)
  const [presetName, setPresetName] = useState('')

  const row = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' } as const

  return createPortal(
    <div data-testid="theme-editor" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 60 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--elevated, #252526)', color: 'var(--fg, #eee)', border: '1px solid var(--border, #444)',
          borderRadius: 6, padding: 14, width: 420, maxHeight: '86vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Theme</div>
        {COLORS.map(c => (
          <label key={c.key} style={row}>
            <span>{c.label}</span>
            <input data-testid={`theme-${c.key}`} type="color" value={String(t[c.key])}
              onChange={e => setTheme({ [c.key]: e.target.value } as Partial<Theme>)} />
          </label>
        ))}
        <label style={row}><span>UI font</span>
          <input data-testid="theme-fontFamily" value={t.fontFamily} style={{ width: 200 }}
            onChange={e => setTheme({ fontFamily: e.target.value })} /></label>
        <label style={row}><span>UI text size</span>
          <input data-testid="theme-fontSize" type="number" min={8} max={32} value={t.fontSize} style={{ width: 64 }}
            onChange={e => setTheme({ fontSize: +e.target.value })} /></label>
        <label style={row}><span>Terminal font</span>
          <input data-testid="theme-termFontFamily" value={t.termFontFamily} style={{ width: 200 }}
            onChange={e => setTheme({ termFontFamily: e.target.value })} /></label>
        <label style={row}><span>Terminal text size</span>
          <input data-testid="theme-termFontSize" type="number" min={8} max={32} value={t.termFontSize} style={{ width: 64 }}
            onChange={e => setTheme({ termFontSize: +e.target.value })} /></label>

        <div style={{ borderTop: '1px solid var(--border, #444)', paddingTop: 8, display: 'flex', gap: 6 }}>
          <input data-testid="theme-preset-name" placeholder="Preset name" value={presetName}
            onChange={e => setPresetName(e.target.value)} style={{ flex: 1 }} />
          <button data-testid="theme-save-preset" disabled={!presetName.trim()}
            onClick={() => { saveThemePreset(presetName); setPresetName('') }}>Save preset</button>
        </div>
        {presets.map(p => (
          <div key={p.id} style={row}>
            <button data-testid={`theme-preset-${p.id}`} style={{ flex: 1, textAlign: 'left' }}
              onClick={() => applyThemePreset(p.id)}>{p.name}</button>
            <button data-testid={`theme-preset-del-${p.id}`} onClick={() => deleteThemePreset(p.id)}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button data-testid="theme-reset" onClick={() => resetTheme()}>Reset to default</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
