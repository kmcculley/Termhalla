# UI Polish Phase 4 — Unified Settings Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Settings window (sidebar: General / Appearance / Environment / Terminal) that consolidates the theme, env, and terminal-prefs surfaces, reachable from a single ⚙ button, Ctrl+, , and a palette command, with per-pane buttons routing into it with pane context.

**Architecture:** A pure `settings` store slice holds `{ section, paneId } | null`. `SettingsPanel` (rendered once at app root) reads it and shows the section. The existing `ThemeEditor`/`EnvManager` bodies are extracted verbatim into `ThemeSettings`/`EnvSettings` section components (same testids); the per-pane `TerminalSettings` name/alerts become `TerminalAlertsSettings`; its global record bits move to a new `GeneralSettings`. Two stages: A = panel shell + General + entry points; B = embed editors + reroute panes + delete old surfaces.

**Tech Stack:** React + zustand slices; vitest (unit), Playwright-for-Electron (e2e).

---

## File Structure

- `src/renderer/store/settings-slice.ts` — **new** — `settings` state + open/close.
- `src/renderer/store/types.ts` — `SettingsSection`, `SettingsTarget`, actions on `State`.
- `src/renderer/store.ts` — compose slice.
- `src/renderer/components/SettingsPanel.tsx` — **new** — Modal + sidebar + section switch.
- `src/renderer/components/GeneralSettings.tsx` — **new** — shell/record/recordings.
- `src/renderer/components/ThemeSettings.tsx` — **new** — extracted ThemeEditor body.
- `src/renderer/components/EnvSettings.tsx` — **new** — extracted EnvManager body.
- `src/renderer/components/TerminalAlertsSettings.tsx` — **new** — per-pane name/alerts.
- `src/shared/keymap.ts` — `open-settings` shortcut.
- `src/shared/quick.ts` — `settings` PaletteAction + command item.
- `src/renderer/App.tsx` — render `<SettingsPanel/>`, dispatch Ctrl+,.
- `src/renderer/components/CommandPalette.tsx` — dispatch `settings` action.
- `src/renderer/components/WorkspaceTabs.tsx` — ⚙ button; remove 🎨/🔑 (Stage B).
- `src/renderer/components/PaneToolbar.tsx` — repoint 🎨/🔑/⚙ to `openSettings` (Stage B).
- `src/renderer/components/PaneTile.tsx` — drop settings/theme/env menu cases (Stage B).
- Deleted (Stage B): `ThemeEditor.tsx`, `EnvManager.tsx`, `TerminalSettings.tsx`.
- Tests: `tests/settings-slice.test.ts`, extend `tests/keymap.test.ts`, `tests/quick-commands.test.ts`, `tests/e2e/settings.spec.ts` (new), `tests/e2e/ui-polish.spec.ts` (migrate env flow).

---

## STAGE A — Panel shell + General + entry points

### Task 1: `settings` store slice

**Files:**
- Create: `src/renderer/store/settings-slice.ts`
- Modify: `src/renderer/store/types.ts`, `src/renderer/store.ts`
- Test: `tests/settings-slice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings-slice.test.ts
import { describe, it, expect } from 'vitest'
import { createSettingsSlice } from '../src/renderer/store/settings-slice'

function harness() {
  let state: any = { settings: null }
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  return { slice: createSettingsSlice({ set, get } as any), get }
}

describe('settings slice', () => {
  it('openSettings sets the target', () => {
    const { slice, get } = harness()
    slice.openSettings({ section: 'appearance', paneId: 'p1' })
    expect(get().settings).toEqual({ section: 'appearance', paneId: 'p1' })
  })
  it('closeSettings clears it', () => {
    const { slice, get } = harness()
    slice.openSettings({ section: 'general' })
    slice.closeSettings()
    expect(get().settings).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- settings-slice`
Expected: FAIL — module not found.

- [ ] **Step 3: Types in `store/types.ts`**

Add near the `Toast` types:

```ts
export type SettingsSection = 'general' | 'appearance' | 'environment' | 'terminal'
export interface SettingsTarget { section: SettingsSection; paneId?: string }
```

Add to `State`:

```ts
  settings: SettingsTarget | null
  openSettings: (t: SettingsTarget) => void
  closeSettings: () => void
```

- [ ] **Step 4: Create the slice**

```ts
// src/renderer/store/settings-slice.ts
import type { State, SliceDeps, SettingsTarget } from './types'

type SettingsSlice = Pick<State, 'settings' | 'openSettings' | 'closeSettings'>

/** Ephemeral open-state for the unified Settings panel: which section + (optionally)
 *  which pane's context. Never persisted. */
export function createSettingsSlice({ set }: SliceDeps): SettingsSlice {
  return {
    settings: null,
    openSettings: (t: SettingsTarget) => set({ settings: t }),
    closeSettings: () => set({ settings: null })
  }
}
```

- [ ] **Step 5: Compose in `store.ts`**

Add `import { createSettingsSlice } from './store/settings-slice'`, and add
`...createSettingsSlice(deps),` to the domain-slices block.

- [ ] **Step 6: Run + typecheck**

Run: `npm test -- settings-slice && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/store/settings-slice.ts src/renderer/store/types.ts src/renderer/store.ts tests/settings-slice.test.ts
git commit -m "feat(renderer): settings open-state store slice"
```

---

### Task 2: Ctrl+, keymap + App dispatch

**Files:**
- Modify: `src/shared/keymap.ts`, `tests/keymap.test.ts`, `src/renderer/App.tsx`

- [ ] **Step 1: Add the failing keymap test**

Append to `tests/keymap.test.ts` (inside the describe):

```ts
  it('Ctrl+comma opens settings', () => {
    expect(matchShortcut(ev({ key: ',', ctrlKey: true }))).toEqual({ type: 'open-settings' })
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- keymap`
Expected: FAIL — returns null for `,`.

- [ ] **Step 3: Extend keymap**

In `src/shared/keymap.ts`, add `{ type: 'open-settings' }` to the `Shortcut` union, and
before the digit rule add:

```ts
  if (k === ',') return { type: 'open-settings' }
```

- [ ] **Step 4: Dispatch in App**

In `src/renderer/App.tsx`'s keymap `switch`, add a case:

```tsx
        case 'open-settings': s.openSettings({ section: 'general' }); break
```

- [ ] **Step 5: Run + typecheck**

Run: `npm test -- keymap && npm run typecheck`
Expected: PASS; typecheck clean (App's switch is now exhaustive again).

- [ ] **Step 6: Commit**

```bash
git add src/shared/keymap.ts tests/keymap.test.ts src/renderer/App.tsx
git commit -m "feat: Ctrl+, opens settings"
```

---

### Task 3: Palette "Settings" command

**Files:**
- Modify: `src/shared/quick.ts`, `tests/quick-commands.test.ts`, `src/renderer/components/CommandPalette.tsx`

- [ ] **Step 1: Extend the failing test**

In `tests/quick-commands.test.ts`, add to the first test's `arrayContaining` list the
string `'settings'`, and add:

```ts
  it('surfaces the settings command', () => {
    const hit = filterPaletteItems(buildCommandItems(), 'settings')
    expect(hit.some(c => c.kind === 'action' && c.action === 'settings')).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- quick-commands`
Expected: FAIL — no `settings` action.

- [ ] **Step 3: Add the action**

In `src/shared/quick.ts`, add `'settings'` to the `PaletteAction` union, and add to the
`buildCommandItems()` return array:

```ts
    cmd('settings', 'Settings', 'settings preferences options theme environment'),
```

- [ ] **Step 4: Dispatch in CommandPalette**

In `CommandPalette.tsx`, add `const openSettings = useStore(s => s.openSettings)` with
the other selectors, and in `activate()` add (after the other command arms, before the
final `close()`):

```tsx
    else if (item.action === 'settings') openSettings({ section: 'general' })
```

- [ ] **Step 5: Run + typecheck**

Run: `npm test -- quick-commands && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/quick.ts tests/quick-commands.test.ts src/renderer/components/CommandPalette.tsx
git commit -m "feat(renderer): Settings command in the palette"
```

---

### Task 4: SettingsPanel shell + GeneralSettings + ⚙ button

**Files:**
- Create: `src/renderer/components/GeneralSettings.tsx`, `src/renderer/components/SettingsPanel.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/components/WorkspaceTabs.tsx`

- [ ] **Step 1: GeneralSettings**

```tsx
// src/renderer/components/GeneralSettings.tsx
import { useStore } from '../store'
import { api } from '../api'

/** App-wide terminal/recording preferences (was scattered across the per-pane
 *  TerminalSettings popover and the tab-bar shell picker). */
export function GeneralSettings() {
  const shells = useStore(s => s.shells)
  const shellId = useStore(s => s.newTerminalShellId)
  const setShell = useStore(s => s.setNewTerminalShell)
  const recordByDefault = useStore(s => s.quick.recordByDefault)
  const setRecordByDefault = useStore(s => s.setRecordByDefault)
  return (
    <div data-testid="settings-general" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Default shell for new terminals</span>
        <select data-testid="general-shell" value={shellId ?? ''} onChange={e => setShell(e.target.value)}>
          {shells.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="rec-default" type="checkbox" checked={!!recordByDefault}
          onChange={e => setRecordByDefault(e.target.checked)} />
        Record new terminals by default
      </label>
      <div>
        <button data-testid="rec-folder" onClick={() => api.recReveal()}>Open recordings folder</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: SettingsPanel shell (Stage-A placeholders for B sections)**

```tsx
// src/renderer/components/SettingsPanel.tsx
import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Modal'
import type { SettingsSection } from '../store/types'
import { GeneralSettings } from './GeneralSettings'

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'environment', label: 'Environment' },
  { id: 'terminal', label: 'Terminal' }
]

export function SettingsPanel() {
  const settings = useStore(s => s.settings)
  const close = useStore(s => s.closeSettings)
  const [section, setSection] = useState<SettingsSection>('general')
  // Re-seed the section each time the panel is (re)opened with a target.
  const [seededFor, setSeededFor] = useState<object | null>(null)
  if (settings && settings !== seededFor) { setSection(settings.section); setSeededFor(settings) }
  if (!settings) return null

  return (
    <Modal onClose={close} backdropTestId="settings-backdrop" cardTestId="settings-panel"
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': 'Settings' }}
      card={{ width: 680, height: '70vh', padding: 0, gap: 0, flexDirection: 'row' }}>
      <div style={{ width: 160, borderRight: '1px solid var(--border, #444)', padding: 8,
        display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECTIONS.map(s => (
          <button key={s.id} data-testid={`settings-nav-${s.id}`}
            onClick={() => setSection(s.id)}
            style={{ textAlign: 'left', background: section === s.id ? 'var(--sel-bg)' : 'transparent' }}>
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, padding: 14, overflow: 'auto' }}>
        {section === 'general' && <GeneralSettings />}
        {section !== 'general' && <div data-testid="settings-placeholder" style={{ color: 'var(--fg-dim, #aaa)' }}>Moved here in the next step…</div>}
      </div>
    </Modal>
  )
}
```

(Note: `Modal`'s `card` style is spread over `CARD_BASE`, so `flexDirection: 'row'`
overrides the column default to lay out sidebar + content side by side.)

- [ ] **Step 3: Render in App**

In `App.tsx` add `import { SettingsPanel } from './components/SettingsPanel'` and render
`<SettingsPanel />` next to the other global overlays (after `<Toasts />`).

- [ ] **Step 4: ⚙ button in the tab bar**

In `WorkspaceTabs.tsx`, add an `openSettings` selector and a button next to the existing
🎨/🔑 (leave those for now — removed in Stage B):

```tsx
      <button data-testid="settings-button" title="Settings (Ctrl+,)" onClick={() => openSettings({ section: 'general' })}>⚙</button>
```

Add to the `useShallow` selector object: `openSettings: s.openSettings` (and destructure it).

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/GeneralSettings.tsx src/renderer/components/SettingsPanel.tsx src/renderer/App.tsx src/renderer/components/WorkspaceTabs.tsx
git commit -m "feat(renderer): Settings panel shell + General section + entry points"
```

---

## STAGE B — Embed editors, reroute panes, remove old surfaces

### Task 5: Extract `ThemeSettings` from `ThemeEditor`

**Files:**
- Create: `src/renderer/components/ThemeSettings.tsx`
- Modify: `src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 1: Create `ThemeSettings`**

Copy `ThemeEditor.tsx` to `ThemeSettings.tsx` and transform:
- Rename the component to `ThemeSettings`; change its prop type to
  `{ paneId?: string }` and use `paneId` everywhere the old code used `initialPaneId`
  (the `useState(initialPaneId ? ...)` seed).
- Remove the `import { Modal } from './Modal'`.
- Replace the outer `<Modal …>…</Modal>` wrapper with a fragment `<>…</>`: delete the
  `<Modal …>` opening tag and the closing `</Modal>`.
- Delete the trailing Close button block:
  `<div style={{ display: 'flex', justifyContent: 'flex-end' }}><button onClick={onClose}>Close</button></div>`
  and remove `onClose` from props.
- Keep every `data-testid` (`theme-scope`, `theme-<key>`, `theme-fontFamily`,
  `theme-save-preset`, `theme-preset-*`, `theme-reset`) and all logic verbatim.

- [ ] **Step 2: Wire into the panel**

In `SettingsPanel.tsx` add `import { ThemeSettings } from './ThemeSettings'` and replace
the placeholder for `appearance`:

```tsx
        {section === 'appearance' && <ThemeSettings paneId={settings.paneId} />}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean (the old `ThemeEditor` still exists/compiles; it's removed in Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ThemeSettings.tsx src/renderer/components/SettingsPanel.tsx
git commit -m "feat(renderer): Appearance settings section (extracted theme editor body)"
```

---

### Task 6: Extract `EnvSettings` from `EnvManager`

**Files:**
- Create: `src/renderer/components/EnvSettings.tsx`
- Modify: `src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 1: Create `EnvSettings`**

Copy `EnvManager.tsx` to `EnvSettings.tsx` and transform:
- Rename the component to `EnvSettings`; keep props `{ wsId?: string; paneId?: string }`
  but remove `onClose`.
- Remove `import { Modal } from './Modal'`.
- Replace the outer `<Modal …>…</Modal>` with a fragment `<>…</>`.
- Delete the two `<button onClick={onClose}>Close</button>` instances (the one in the
  unlocked footer and the standalone-locked one); keep the `Lock` button.
- Keep every `data-testid` and the passphrase `autoFocus` verbatim.

- [ ] **Step 2: Wire into the panel**

In `SettingsPanel.tsx` add `import { EnvSettings } from './EnvSettings'`, pull the active
workspace id (`const activeId = useStore(s => s.activeId)`), and replace the
`environment` placeholder:

```tsx
        {section === 'environment' && <EnvSettings wsId={settings.paneId ? activeId ?? undefined : undefined} paneId={settings.paneId} />}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/EnvSettings.tsx src/renderer/components/SettingsPanel.tsx
git commit -m "feat(renderer): Environment settings section (extracted env manager body)"
```

---

### Task 7: `TerminalAlertsSettings` (per-pane name + alerts)

**Files:**
- Create: `src/renderer/components/TerminalAlertsSettings.tsx`
- Modify: `src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/TerminalAlertsSettings.tsx
import type { TerminalConfig } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore } from '../store'

/** Per-pane terminal name + alert toggles (was the in-tile TerminalSettings popover).
 *  Needs a terminal pane in context; otherwise shows a hint. */
export function TerminalAlertsSettings({ wsId, paneId }: { wsId?: string; paneId?: string }) {
  const cfg = useStore(s => (wsId && paneId) ? s.workspaces[wsId]?.panes[paneId]?.config : undefined)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  if (!wsId || !paneId || !cfg || cfg.kind !== 'terminal') {
    return <div data-testid="settings-terminal" style={{ color: 'var(--fg-dim, #aaa)' }}>Open from a terminal’s ⚙ to edit its name and alerts.</div>
  }
  const term = cfg as TerminalConfig
  const a = resolveAlerts(term.alerts)
  const change = (patch: Partial<TerminalConfig>) => updatePaneConfig(wsId, paneId, patch)
  const toggle = (key: keyof typeof a) => change({ alerts: { ...term.alerts, [key]: !a[key] } })
  return (
    <div data-testid="settings-terminal" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ display: 'block' }}>Name
        <input data-testid="setting-name" style={{ width: '100%' }} value={term.name ?? ''} placeholder="Terminal"
          onChange={e => change({ name: e.target.value })} />
      </label>
      {([['border', 'Status border'], ['tabBadge', 'Tab badge'],
         ['osNotification', 'OS notification'], ['needsInput', 'Needs-input detection']] as const).map(([key, label]) => (
        <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" data-testid={`setting-${key}`} checked={a[key]} onChange={() => toggle(key)} />
          {label}
        </label>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire into the panel**

In `SettingsPanel.tsx` add the import and replace the `terminal` placeholder:

```tsx
        {section === 'terminal' && <TerminalAlertsSettings wsId={settings.paneId ? activeId ?? undefined : undefined} paneId={settings.paneId} />}
```

- [ ] **Step 3: Typecheck + build + commit**

Run: `npm run typecheck && npm run build`
Expected: clean.

```bash
git add src/renderer/components/TerminalAlertsSettings.tsx src/renderer/components/SettingsPanel.tsx
git commit -m "feat(renderer): Terminal alerts settings section"
```

---

### Task 8: Reroute pane buttons + remove old surfaces

**Files:**
- Modify: `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneTile.tsx`, `src/renderer/components/WorkspaceTabs.tsx`
- Delete: `src/renderer/components/ThemeEditor.tsx`, `src/renderer/components/EnvManager.tsx`, `src/renderer/components/TerminalSettings.tsx`

- [ ] **Step 1: PaneToolbar → openSettings**

In `PaneToolbar.tsx`, add `const openSettings = useStore(s => s.openSettings)` and
repoint the three buttons (drop their `toggle(...)` calls):

```tsx
          <button type="button" data-testid={`env-chip-${paneId}`} title="Environment variables"
            style={{ color: envActive ? 'var(--accent, #4ea1ff)' : undefined }}
            onClick={() => openSettings({ section: 'environment', paneId })}>🔑</button>
```
```tsx
      <button data-testid={`gear-${paneId}`} title="Terminal settings" onClick={() => openSettings({ section: 'terminal', paneId })}>⚙</button>
      <button data-testid={`theme-chip-${paneId}`} title="Theme this pane" onClick={() => openSettings({ section: 'appearance', paneId })}>🎨</button>
```

The `toggle` prop is now only used for `proc`/`cwd`/`schedule`. Keep `toggle` in the
props (still used). `PaneMenu` type narrows in Step 2.

- [ ] **Step 2: PaneTile — drop the removed menu cases + imports**

In `PaneTile.tsx`:
- Change `export type PaneMenu = 'proc' | 'cwd' | 'settings' | 'schedule' | 'theme' | 'env'`
  to `export type PaneMenu = 'proc' | 'cwd' | 'schedule'`.
- Remove the three menu render blocks: `{menu === 'settings' && …}`,
  `{menu === 'theme' && …}`, `{menu === 'env' && …}`.
- Remove the now-unused imports: `TerminalSettings`, `ThemeEditor`, `EnvManager`.
  (`updatePaneConfig` is still used by nothing here now — remove its selector too if it
  becomes unused; the settings move means PaneTile no longer calls it.)

- [ ] **Step 3: WorkspaceTabs — remove 🎨/🔑 + their modals/state**

In `WorkspaceTabs.tsx`:
- Remove the `themeOpen`/`envOpen` `useState` and the `theme-button`/`env-button`
  buttons, and the trailing `{themeOpen && <ThemeEditor …/>}` / `{envOpen && <EnvManager …/>}`
  renders. Remove the `ThemeEditor`/`EnvManager` imports. Keep `TemplatesMenu`.
- The `settings-button` (⚙) from Task 4 stays.

- [ ] **Step 4: Delete the three old components**

```bash
git rm src/renderer/components/ThemeEditor.tsx src/renderer/components/EnvManager.tsx src/renderer/components/TerminalSettings.tsx
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean. (If typecheck flags a leftover import of a deleted file, remove it.)

- [ ] **Step 6: Commit**

```bash
git add -A src/renderer/components/
git commit -m "refactor(renderer): route pane settings into the panel; remove standalone theme/env/terminal-settings"
```

---

### Task 9: e2e + verification

**Files:**
- Create: `tests/e2e/settings.spec.ts`
- Modify: `tests/e2e/ui-polish.spec.ts` (migrate the env-autofocus open path)

- [ ] **Step 1: Migrate the env-autofocus test**

In `tests/e2e/ui-polish.spec.ts`, the "env manager autofocuses the passphrase input"
test currently clicks `env-button`. Replace that open path with the panel:

```ts
  await win.getByTestId('settings-button').click()
  await win.getByTestId('settings-nav-environment').click()
  await expect(win.getByTestId('env-passphrase')).toBeFocused({ timeout: 10_000 })
```

- [ ] **Step 2: Write `settings.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
const launch = (userData: string) =>
  electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })

test('gear opens the panel and the sidebar switches sections', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-set1-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  await expect(win.getByTestId('settings-general')).toBeVisible()
  await win.getByTestId('settings-nav-appearance').click()
  await expect(win.getByTestId('theme-scope')).toBeVisible({ timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('record-by-default toggle persists across reopen', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-set2-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('settings-button').click()
  await win.getByTestId('rec-default').check()
  await win.getByTestId('settings-backdrop').click({ position: { x: 5, y: 5 } }) // close via backdrop
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('rec-default')).toBeChecked()
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('a pane theme button opens Appearance scoped to that pane', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-set3-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-set3-proj-'))
  const f = join(proj, 'a.ts'); writeFileSync(f, '1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [f], activePath: f } }], 'p1')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  await win.getByTestId('theme-chip-p1').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  await expect(win.getByTestId('theme-scope')).toBeVisible()
  // the scope select defaulted to this pane (value starts with "pane:")
  const v = await win.getByTestId('theme-scope').inputValue()
  expect(v.startsWith('pane:')).toBe(true)
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 3: Build + run the new specs**

Run: `npm run build && npm run e2e -- settings.spec.ts ui-polish.spec.ts`
Expected: all pass (re-run on terminal/startup flake as in Phases 1–3).

- [ ] **Step 4: Full verification (read exit codes directly)**

Run: `npm run typecheck`
Then: `npm test`
Then: `npm run build && npm run e2e -- settings.spec.ts ui-polish.spec.ts keyboard.spec.ts`
Expected: typecheck exit 0; all unit pass; specs green (flaky terminal specs recover on
retry — evaluate as in Phases 1–3).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/settings.spec.ts tests/e2e/ui-polish.spec.ts
git commit -m "test(e2e): settings panel open/switch/persist + migrate env-autofocus path"
```

---

### Task 10: Docs

**Files:**
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-06-16-ui-polish-phase4-design.md`

- [ ] **Step 1: Changelog**

Under `## [Unreleased]` → `### Changed` (it's a consolidation/UX change):

```markdown
- **Unified Settings panel (UI polish phase 4).** Theme, environment variables, and
  terminal preferences now live in one Settings window (sidebar: General / Appearance /
  Environment / Terminal) instead of three separate surfaces. Open it from the tab-bar
  **⚙**, **Ctrl+,**, or the command palette; a pane's 🎨/🔑/⚙ open the same panel
  focused on the right section with that pane preselected. The standalone theme/env
  modals and the in-tile terminal-settings popover are gone; the global
  "record-by-default" + recordings-folder controls (previously buried in a per-pane
  popover) now live under General with the default-shell preference.
```

- [ ] **Step 2: Mark spec implemented**

Change the spec's `**Status:** Design — pending review` to `**Status:** Implemented`.

- [ ] **Step 3: Update the relevant feature doc**

In `docs/features/` find the theming/workspaces doc that references the `ThemeEditor`/
`EnvManager` modals and add a short note that these are now sections of the unified
Settings panel (`SettingsPanel`), reached via `openSettings({ section, paneId })`. Keep
it to 2–3 sentences.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/
git commit -m "docs: changelog + spec status + feature note for UI polish phase 4"
```

---

## Self-Review

**Spec coverage:** settings slice ✓(T1), Ctrl+, ✓(T2), palette command ✓(T3), panel
shell + General + ⚙ + render ✓(T4), ThemeSettings ✓(T5), EnvSettings ✓(T6),
TerminalAlertsSettings ✓(T7), reroute panes + remove old surfaces ✓(T8), e2e + env
migration ✓(T9), docs ✓(T10). General-hosts-record/shell ✓(T4). Pane context routing
✓(T8 buttons → openSettings with paneId). All spec items covered.

**Placeholder scan:** T5/T6 say "copy and transform … verbatim" rather than reprinting
~100 lines of unchanged JSX — that's a precise move instruction (rename, drop Modal
wrapper, drop Close button, keep testids), not a TODO. T4 ships intentional
"Moved here…" placeholders for the B sections (documented, replaced in T5–T7). No vague
"handle errors" gaps.

**Type consistency:** `SettingsSection`/`SettingsTarget` defined T1, used T2 (App
dispatch target), T3 (palette), T4–T7 (panel + sections), T8 (pane buttons). `Shortcut`
gains `open-settings` T2, dispatched T2. `PaletteAction` gains `settings` T3, dispatched
T3. `openSettings(t)` signature consistent across App/palette/panes. `paneId?` prop
threaded consistently into ThemeSettings/EnvSettings/TerminalAlertsSettings. `PaneMenu`
narrowed in T8 (consumers in PaneToolbar still pass only proc/cwd/schedule). Consistent.
