# Customizable UI Theming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Customize and persist the whole app's look (window/panel/text/accent/alert/terminal colors, fonts, sizes) via design tokens → CSS variables, with named presets.

**Architecture:** A pure `Theme` + `DEFAULT_THEME`/`mergeTheme`/`themeCssVars` (`src/shared/theme.ts`); persistence in `quick.json` (`theme` + `themePresets`); store actions; a `ThemeProvider` that applies CSS variables + the Monaco theme; xterm themed per-terminal from tokens; a UI token sweep converting hardcoded colors to `var(--token)`; a `ThemeEditor` panel.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-ui-theming-design.md`

---

## Task 1: Theme types + pure core

**Files:** Modify `src/shared/types.ts`; Create `src/shared/theme.ts`; Test `tests/shared/theme.test.ts`.

- [ ] **Step 1: Failing test** — `tests/shared/theme.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, mergeTheme, themeCssVars } from '../../src/shared/theme'

describe('mergeTheme', () => {
  it('returns defaults for undefined', () => {
    expect(mergeTheme(undefined)).toEqual(DEFAULT_THEME)
  })
  it('overrides only provided tokens', () => {
    const t = mergeTheme({ windowBg: '#123456', fontSize: 16 })
    expect(t.windowBg).toBe('#123456')
    expect(t.fontSize).toBe(16)
    expect(t.panelBg).toBe(DEFAULT_THEME.panelBg)
  })
})

describe('themeCssVars', () => {
  it('maps tokens to CSS variables with px on sizes', () => {
    const v = themeCssVars(DEFAULT_THEME)
    expect(v['--bg']).toBe(DEFAULT_THEME.windowBg)
    expect(v['--panel']).toBe(DEFAULT_THEME.panelBg)
    expect(v['--font-size']).toBe(`${DEFAULT_THEME.fontSize}px`)
    expect(v['--term-font-size']).toBe(`${DEFAULT_THEME.termFontSize}px`)
    expect(v['--accent']).toBe(DEFAULT_THEME.accent)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Type** — in `src/shared/types.ts` add:
```ts
export interface Theme {
  windowBg: string
  panelBg: string
  elevatedBg: string
  border: string
  text: string
  textDim: string
  accent: string
  statusBusy: string
  statusNeedsInput: string
  fontFamily: string
  fontSize: number
  termBg: string
  termFg: string
  termFontFamily: string
  termFontSize: number
}
```

- [ ] **Step 4: Implement** — `src/shared/theme.ts`:
```ts
import type { Theme } from './types'

export const DEFAULT_THEME: Theme = {
  windowBg: '#1e1e1e',
  panelBg: '#1e1e1e',
  elevatedBg: '#252526',
  border: '#444444',
  text: '#eeeeee',
  textDim: '#aaaaaa',
  accent: '#1e88e5',
  statusBusy: '#1e88e5',
  statusNeedsInput: '#ff8f00',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 13,
  termBg: '#000000',
  termFg: '#ffffff',
  termFontFamily: "'Consolas', 'Cascadia Mono', monospace",
  termFontSize: 13
}

/** Fill any missing tokens from defaults (forward-compatible with older persisted themes). */
export function mergeTheme(partial: Partial<Theme> | undefined): Theme {
  return { ...DEFAULT_THEME, ...(partial ?? {}) }
}

/** UI design tokens as CSS custom properties (sizes get a px suffix). */
export function themeCssVars(t: Theme): Record<string, string> {
  return {
    '--bg': t.windowBg,
    '--panel': t.panelBg,
    '--elevated': t.elevatedBg,
    '--border': t.border,
    '--fg': t.text,
    '--fg-dim': t.textDim,
    '--accent': t.accent,
    '--status-busy': t.statusBusy,
    '--status-needs': t.statusNeedsInput,
    '--font': t.fontFamily,
    '--font-size': `${t.fontSize}px`,
    '--term-bg': t.termBg,
    '--term-fg': t.termFg,
    '--term-font': t.termFontFamily,
    '--term-font-size': `${t.termFontSize}px`
  }
}
```

- [ ] **Step 5: Run, verify pass; typecheck. Commit:**
```bash
git add src/shared/types.ts src/shared/theme.ts tests/shared/theme.test.ts
git commit -m "feat(theme): Theme type + DEFAULT_THEME/mergeTheme/themeCssVars"
```

---

## Task 2: Persistence (quick.json)

**Files:** Modify `src/shared/types.ts`, `src/main/persistence/quick-store.ts`.

- [ ] **Step 1:** In `src/shared/types.ts`, add to the `QuickStore` interface:
```ts
  theme?: Partial<Theme>
  themePresets: { id: string; name: string; theme: Theme }[]
```
and add `themePresets: []` to `EMPTY_QUICK` (leave `theme` undefined there).

- [ ] **Step 2:** In `src/main/persistence/quick-store.ts` `normalizeQuick`, add to the returned object:
```ts
    theme: (value as { theme?: unknown })?.theme && typeof (value as { theme?: unknown }).theme === 'object'
      ? (value as { theme?: object }).theme as Partial<import('@shared/types').Theme> : undefined,
    themePresets: Array.isArray(v.themePresets) ? v.themePresets : [],
```
(If existing test fixtures construct a full `QuickStore`, they may need `themePresets: []` added — update `tests/main/quick-store.test.ts` / `tests/shared/quick.test.ts` if the type now requires it.)

- [ ] **Step 3: Typecheck. Commit:**
```bash
git add src/shared/types.ts src/main/persistence/quick-store.ts tests/main/quick-store.test.ts tests/shared/quick.test.ts
git commit -m "feat(theme): persist theme + themePresets in quick.json"
```

---

## Task 3: Store actions

**Files:** Modify `src/renderer/store.ts`.

- [ ] **Step 1: Imports** — add `import { DEFAULT_THEME, mergeTheme } from '@shared/theme'` and `Theme` to the `@shared/types` import.

- [ ] **Step 2: State interface**
```ts
  setTheme: (patch: Partial<Theme>) => void
  resetTheme: () => void
  saveThemePreset: (name: string) => void
  applyThemePreset: (id: string) => void
  deleteThemePreset: (id: string) => void
```

- [ ] **Step 3: Implement** (uses `uuid`, `scheduleQuickSave` already in file):
```ts
    setTheme: (patch) => {
      set(s => ({ quick: { ...s.quick, theme: { ...mergeTheme(s.quick.theme), ...patch } } }))
      scheduleQuickSave()
    },
    resetTheme: () => {
      set(s => ({ quick: { ...s.quick, theme: { ...DEFAULT_THEME } } }))
      scheduleQuickSave()
    },
    saveThemePreset: (name) => {
      const n = name.trim(); if (!n) return
      set(s => ({ quick: { ...s.quick, themePresets: [...s.quick.themePresets, { id: uuid(), name: n, theme: mergeTheme(s.quick.theme) }] } }))
      scheduleQuickSave()
    },
    applyThemePreset: (id) => {
      const p = get().quick.themePresets.find(t => t.id === id)
      if (!p) return
      set(s => ({ quick: { ...s.quick, theme: { ...p.theme } } }))
      scheduleQuickSave()
    },
    deleteThemePreset: (id) => {
      set(s => ({ quick: { ...s.quick, themePresets: s.quick.themePresets.filter(t => t.id !== id) } }))
      scheduleQuickSave()
    },
```

- [ ] **Step 4: Typecheck. Commit:**
```bash
git add src/renderer/store.ts
git commit -m "feat(theme): store setTheme/resetTheme/save+apply+deleteThemePreset"
```

---

## Task 4: ThemeProvider + global CSS conversion

**Files:** Create `src/renderer/components/ThemeProvider.tsx`; Modify `src/renderer/App.tsx`, `src/renderer/index.css`.

- [ ] **Step 1: Create `ThemeProvider.tsx`**
```tsx
import { useEffect } from 'react'
import { useStore } from '../store'
import { mergeTheme, themeCssVars } from '@shared/theme'
import { monaco } from '../editor/monaco-setup'

export function ThemeProvider() {
  const quickTheme = useStore(s => s.quick.theme)
  useEffect(() => {
    const theme = mergeTheme(quickTheme)
    const root = document.documentElement
    for (const [k, v] of Object.entries(themeCssVars(theme))) root.style.setProperty(k, v)
    try {
      monaco.editor.defineTheme('termhalla', {
        base: 'vs-dark', inherit: true, rules: [],
        colors: { 'editor.background': theme.windowBg, 'editor.foreground': theme.text }
      })
      monaco.editor.setTheme('termhalla')
    } catch { /* invalid color or editor not ready */ }
  }, [quickTheme])
  return null
}
```

- [ ] **Step 2: Mount in `App.tsx`** — import `{ ThemeProvider }` and render `<ThemeProvider />` as the FIRST child inside the top-level wrapper `<div>` (so vars apply before children paint).

- [ ] **Step 3: Convert `src/renderer/index.css`** to use the variables (and add base body styling). Replace the file contents with:
```css
html, body, #root { margin: 0; height: 100%; }
body { background: var(--bg, #1e1e1e); color: var(--fg, #eee); font-family: var(--font, 'Segoe UI', sans-serif); font-size: var(--font-size, 13px); }
.mosaic, .mosaic-root { height: 100%; }
.mosaic-blueprint-theme { height: 100%; }
.term-tile { box-sizing: border-box; }

.mosaic-blueprint-theme .mosaic-window.term-status .mosaic-window-toolbar button {
  background: rgba(255, 255, 255, 0.92) !important;
  color: #182026 !important;
  border-radius: 3px;
}
.mosaic-blueprint-theme .mosaic-window.term-busy .mosaic-window-title,
.mosaic-blueprint-theme .mosaic-window.term-needs-input .mosaic-window-title {
  color: #fff !important; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.mosaic-window.term-busy .mosaic-window-toolbar {
  animation: term-bar-busy 1.4s ease-in-out infinite;
  background-color: var(--status-busy, #1e88e5);
}
@keyframes term-bar-busy { 0%, 100% { opacity: 1 } 50% { opacity: 0.6 } }
.mosaic-window.term-needs-input .mosaic-window-toolbar {
  animation: term-bar-needs 0.8s steps(1) infinite;
  background-color: var(--status-needs, #ff8f00);
}
@keyframes term-bar-needs { 0%, 50% { filter: none } 51%, 100% { filter: brightness(0.7) } }
```
(The busy/needs animations now pulse via opacity/brightness on the themed base color, so they follow `--status-busy`/`--status-needs`.)

- [ ] **Step 4: Typecheck + build. Commit:**
```bash
git add src/renderer/components/ThemeProvider.tsx src/renderer/App.tsx src/renderer/index.css
git commit -m "feat(theme): ThemeProvider applies CSS vars + Monaco theme; themed status CSS"
```

---

## Task 5: Terminal (xterm) theming

**Files:** Modify `src/renderer/components/TerminalPane.tsx`.

- [ ] **Step 1:** Read `TerminalPane.tsx`. It creates `new Terminal({ fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: true })` in a `useEffect` whose deps must NOT include the theme (else the PTY re-spawns). Make these changes:
  - Import: `import { mergeTheme } from '@shared/theme'` and `import { useStore } from '../store'`.
  - Add refs above the effect: `const termRef = useRef<Terminal | null>(null)` and `const fitRef = useRef<FitAddon | null>(null)`.
  - In the create effect, read the theme once at mount and use it:
```ts
    const t0 = mergeTheme(useStore.getState().quick.theme)
    const term = new Terminal({
      fontFamily: t0.termFontFamily, fontSize: t0.termFontSize, cursorBlink: true,
      theme: { background: t0.termBg, foreground: t0.termFg }
    })
```
    and set `termRef.current = term` (and `fitRef.current = fit`) after creating them; clear them to `null` in the cleanup.
  - Add a SEPARATE effect that live-updates the terminal when the theme changes (no PTY re-spawn):
```ts
  const quickTheme = useStore(s => s.quick.theme)
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const t = mergeTheme(quickTheme)
    term.options.theme = { background: t.termBg, foreground: t.termFg }
    term.options.fontFamily = t.termFontFamily
    term.options.fontSize = t.termFontSize
    fitRef.current?.fit()
  }, [quickTheme])
```

- [ ] **Step 2: Typecheck + build. Commit:**
```bash
git add src/renderer/components/TerminalPane.tsx
git commit -m "feat(theme): xterm terminal colors/font from theme (live, no respawn)"
```

---

## Task 6: UI token sweep

**Files:** Modify the renderer components with hardcoded colors.

- [ ] **Step 1:** Replace hardcoded colors with `var(--token, <original>)` (keep the original as the fallback) across these files. Apply this map consistently:

| Original | Replace with |
|---|---|
| `#1e1e1e` (toolbars, tab bar, status bar bg) | `var(--panel, #1e1e1e)` |
| `#252526` (dialogs/menus bg) | `var(--elevated, #252526)` |
| `#444` / `#444444` (borders) | `var(--border, #444)` |
| `#eee` / `#ddd` / `#fff` text | `var(--fg, #eee)` |
| `#333` (active tab / hover bg) | `var(--accent, #1e88e5)` *(only where it indicates active/selection; otherwise leave)* |
| dim text (`opacity:0.6/0.7` is fine to keep; explicit dim greys) | `var(--fg-dim, #aaa)` |

Files to sweep (read each, convert the inline `style` color/background/border values that match the map; leave overlay scrims like `#0008` and the white-backed status buttons as-is):
`src/renderer/components/WorkspaceTabs.tsx`, `WorkspaceView.tsx`, `StatusBar.tsx`,
`BroadcastDialog.tsx`, `ScheduleDialog.tsx`, `TemplatesMenu.tsx`, `CommandPalette.tsx`,
`SshConnectionForm.tsx`, `TerminalSettings.tsx`, `EditorPane.tsx`, `ExplorerPane.tsx`.

Guidance: the active-tab `fontWeight`/background and the menu/dialog `background:'#252526'` + `border:'1px solid #444'` + `color:'#eee'` are the highest-value conversions. Where a color clearly isn't a theme surface (e.g. the `editor-reloadbar` amber `#5a4a00`, the proc-row opacity greys), leave it. Don't change behavior — only swap color literals for `var(--token, literal)`.

- [ ] **Step 2: Typecheck + build** → clean (no visual regression: every `var()` keeps its original as fallback). Commit:
```bash
git add src/renderer/components/
git commit -m "feat(theme): sweep renderer chrome to CSS variables"
```

---

## Task 7: ThemeEditor panel + button

**Files:** Create `src/renderer/components/ThemeEditor.tsx`; Modify `src/renderer/components/WorkspaceTabs.tsx`.

- [ ] **Step 1: Create `ThemeEditor.tsx`**
```tsx
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
```

- [ ] **Step 2: Wire into `WorkspaceTabs.tsx`** — import `{ ThemeEditor }`, add `const [themeOpen, setThemeOpen] = useState(false)`, add a button near `save-workspace`:
```tsx
      <button data-testid="theme-button" title="Theme" onClick={() => setThemeOpen(true)}>🎨</button>
```
and render `{themeOpen && <ThemeEditor onClose={() => setThemeOpen(false)} />}` before the component's closing `</div>`.

- [ ] **Step 3: Typecheck + build. Commit:**
```bash
git add src/renderer/components/ThemeEditor.tsx src/renderer/components/WorkspaceTabs.tsx
git commit -m "feat(theme): ThemeEditor panel + 🎨 button (live edit, presets, reset)"
```

---

## Task 8: e2e + verify + docs

**Files:** Create `tests/e2e/theme.spec.ts`; docs.

- [ ] **Step 1: e2e** — `tests/e2e/theme.spec.ts`:
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}
const cssVar = (win: import('@playwright/test').Page, name: string) =>
  win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

test('customizes the theme, persists it, and supports presets', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-theme-'))
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  await win.getByTestId('theme-button').click()
  await expect(win.getByTestId('theme-editor')).toBeVisible()
  // Change the window background to a distinctive color.
  await win.getByTestId('theme-windowBg').fill('#7733aa')
  await expect.poll(() => cssVar(win, '--bg')).toBe('#7733aa')
  // Save a preset, reset to default, then re-apply the preset.
  await win.getByTestId('theme-preset-name').fill('Purple')
  await win.getByTestId('theme-save-preset').click()
  await win.getByTestId('theme-reset').click()
  await expect.poll(() => cssVar(win, '--bg')).not.toBe('#7733aa')
  await win.locator('[data-testid^="theme-preset-"]', { hasText: 'Purple' }).click()
  await expect.poll(() => cssVar(win, '--bg')).toBe('#7733aa')

  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(1000)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  // Relaunch: the customized theme persists.
  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => cssVar(win, '--bg'), { timeout: 10_000 }).toBe('#7733aa')
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```
(`<input type="color">.fill('#7733aa')` sets the value and fires input; `theme-windowBg` is a color input. If `fill` doesn't trigger React onChange for a color input, use `win.getByTestId('theme-windowBg').evaluate((el, v) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }, '#7733aa')`.)

- [ ] **Step 2: Build + run** — `npm run build` then `npx playwright test tests/e2e/theme.spec.ts` → 1 passed. Fix the color-input interaction if needed (see note) but keep the persist + preset assertions.
- [ ] **Step 3: Full gate** — `npm run typecheck` (exit 0), `npm test`, `npm run e2e` → all green.
- [ ] **Step 4: Docs** — new `docs/features/theming.md`; `CHANGELOG.md` `[Unreleased] → Added`; commit.
```bash
git add tests/e2e/theme.spec.ts docs/features/theming.md CHANGELOG.md
git commit -m "test+docs: UI theming e2e + docs"
```

---

## Self-review notes
- Spec coverage: tokens+pure (T1), persistence (T2), store (T3), provider+CSS+Monaco (T4), terminal (T5), sweep (T6), editor UI+presets (T7), e2e+docs (T8).
- Type consistency: `Theme`, `DEFAULT_THEME`, `mergeTheme`, `themeCssVars`, the `setTheme`/preset actions, and the `--token` names are consistent across theme.ts / store / ThemeProvider / ThemeEditor / index.css.
- Forward-compat: `mergeTheme` fills missing tokens; every swept `var(--token, original)` keeps the current look as fallback, so an unset theme = today's appearance. Non-goals respected (no ANSI palette, no per-workspace, no import/export, no OS auto-switch).
