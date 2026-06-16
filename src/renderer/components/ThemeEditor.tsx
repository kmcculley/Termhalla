import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, type ThemeScope } from '../store'
import { mergeTheme, resolveTheme, themeCssVarsPartial } from '@shared/theme'
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

// CSS var for a single token (reuses the shared mapping).
function varFor(key: keyof Theme, value: string | number): [string, string] {
  return Object.entries(themeCssVarsPartial({ [key]: value } as Partial<Theme>))[0] as [string, string]
}

export function ThemeEditor({ onClose, initialPaneId }: { onClose: () => void; initialPaneId?: string }) {
  const activeId = useStore(s => s.activeId)
  const ws = useStore(s => (s.activeId ? s.workspaces[s.activeId] : null))
  const quickTheme = useStore(s => s.quick.theme)
  const setThemeScoped = useStore(s => s.setThemeScoped)
  const resetThemeScope = useStore(s => s.resetThemeScope)
  const saveThemePreset = useStore(s => s.saveThemePreset)
  const applyThemePreset = useStore(s => s.applyThemePreset)
  const deleteThemePreset = useStore(s => s.deleteThemePreset)
  const presets = useStore(s => s.quick.themePresets)

  // Opened from a pane's button → start scoped to that pane; otherwise app-wide.
  const [sel, setSel] = useState(initialPaneId ? `pane:${initialPaneId}` : 'app') // 'app' | 'workspace' | `pane:<paneId>`
  const [presetName, setPresetName] = useState('')

  const paneId = sel.startsWith('pane:') ? sel.slice(5) : null
  const pane = paneId && ws ? ws.panes[paneId] : null

  // Resolved theme shown for the selected scope.
  const t: Theme = sel === 'app' ? mergeTheme(quickTheme)
    : sel === 'workspace' ? resolveTheme(quickTheme, ws?.theme, undefined)
      : resolveTheme(quickTheme, ws?.theme, pane?.config.theme)

  const scopeOf = (): ThemeScope =>
    sel === 'app' ? { kind: 'app' }
      : sel === 'workspace' ? { kind: 'workspace', wsId: activeId! }
        : { kind: 'pane', wsId: activeId!, paneId: paneId! }

  // Element to live-preview on (CSS-var cascade target).
  const scopeTarget = (): HTMLElement | null =>
    sel === 'app' ? document.documentElement
      : sel === 'workspace' ? document.querySelector(`[data-testid="workspace-host"][data-ws="${activeId}"]`)
        : document.querySelector(`[data-testid="tile-${paneId}"]`)

  const live = (key: keyof Theme, value: string) => { const [k, v] = varFor(key, value); scopeTarget()?.style.setProperty(k, v) }
  const commit = (key: keyof Theme, value: string | number) => setThemeScoped(scopeOf(), { [key]: value } as Partial<Theme>)

  const row = { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' } as const

  return createPortal(
    <div data-testid="theme-editor" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 60 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--elevated, #252526)', color: 'var(--fg, #eee)', border: '1px solid var(--border, #444)',
          borderRadius: 6, padding: 14, width: 440, maxHeight: '86vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--font-size, 13px)' }}>
        <div style={{ fontWeight: 600 }}>Theme</div>
        <label style={row}><span>Scope</span>
          <select data-testid="theme-scope" value={sel} onChange={e => setSel(e.target.value)} style={{ flex: 1, marginLeft: 8 }}>
            <option value="app">App (default)</option>
            <option value="workspace" disabled={!ws}>This workspace</option>
            {ws && Object.keys(ws.panes).map(pid => (
              <option key={pid} value={`pane:${pid}`}>{ws.panes[pid].config.kind} ({pid.slice(0, 4)})</option>
            ))}
          </select>
        </label>

        {COLORS.map(c => (
          <label key={c.key} style={row}>
            <span>{c.label}</span>
            <input data-testid={`theme-${c.key}`} type="color" value={String(t[c.key])}
              onInput={e => live(c.key, (e.target as HTMLInputElement).value)}
              onChange={e => commit(c.key, e.target.value)} />
          </label>
        ))}
        <label style={row}><span>UI font</span>
          <input data-testid="theme-fontFamily" value={t.fontFamily} style={{ width: 200 }}
            onChange={e => commit('fontFamily', e.target.value)} /></label>
        <label style={row}><span>UI text size</span>
          <input data-testid="theme-fontSize" type="number" min={8} max={32} value={t.fontSize} style={{ width: 64 }}
            onChange={e => commit('fontSize', +e.target.value)} /></label>
        <label style={row}><span>Terminal font</span>
          <input data-testid="theme-termFontFamily" value={t.termFontFamily} style={{ width: 200 }}
            onChange={e => commit('termFontFamily', e.target.value)} /></label>
        <label style={row}><span>Terminal text size</span>
          <input data-testid="theme-termFontSize" type="number" min={8} max={32} value={t.termFontSize} style={{ width: 64 }}
            onChange={e => commit('termFontSize', +e.target.value)} /></label>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button data-testid="theme-reset" onClick={() => resetThemeScope(scopeOf())}>Reset this scope</button>
        </div>

        <div style={{ borderTop: '1px solid var(--border, #444)', paddingTop: 8, display: 'flex', gap: 6 }}>
          <input data-testid="theme-preset-name" placeholder="App preset name" value={presetName}
            onChange={e => setPresetName(e.target.value)} style={{ flex: 1 }} />
          <button data-testid="theme-save-preset" disabled={!presetName.trim()}
            onClick={() => { saveThemePreset(presetName); setPresetName('') }}>Save app preset</button>
        </div>
        {presets.map(p => (
          <div key={p.id} style={row}>
            <button data-testid={`theme-preset-${p.id}`} style={{ flex: 1, textAlign: 'left' }}
              onClick={() => applyThemePreset(p.id)}>{p.name}</button>
            <button data-testid={`theme-preset-del-${p.id}`} onClick={() => deleteThemePreset(p.id)}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
