# UI Polish Phase 3 — Keyboard & a11y + Command Palette — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the command palette into a typed-to-reveal command menu, add a curated collision-safe global-shortcut set via a pure keymap, give the workspace-tab strip arrow-key nav + tab roles, and close the broadcast/palette ARIA gaps.

**Architecture:** Two pure, unit-tested modules carry the logic: `@shared/keymap.ts` (`matchShortcut(event) → Shortcut | null`) and a `buildCommandItems()` builder in `@shared/quick.ts`. `App.tsx` dispatches keymap results to existing store actions; `CommandPalette.tsx` appends command items when the query is non-empty and dispatches them; `WorkspaceTabs.tsx` gains tablist roles + roving-tabindex arrow nav. No main/IPC/persistence changes.

**Tech Stack:** React + zustand; pure TS modules; vitest (unit), Playwright-for-Electron (e2e).

---

## File Structure

- `src/shared/keymap.ts` — **new** — pure `matchShortcut`.
- `src/shared/quick.ts` — **+** `PaletteAction` type, `buildCommandItems()`.
- `src/renderer/components/CommandPalette.tsx` — append commands when querying, new `activate` arms, listbox/option roles.
- `src/renderer/App.tsx` — keymap-driven global keydown dispatch.
- `src/renderer/components/WorkspaceTabs.tsx` — tablist roles, roving tabindex, arrow/Home/End nav.
- `src/renderer/components/BroadcastDialog.tsx` — dialog ARIA.
- Tests: `tests/keymap.test.ts`, `tests/quick-commands.test.ts`, `tests/e2e/keyboard.spec.ts` (new), `tests/e2e/ui-polish.spec.ts` (extend for broadcast role).

---

### Task 1: `matchShortcut` pure keymap

**Files:**
- Create: `src/shared/keymap.ts`
- Test: `tests/keymap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/keymap.test.ts
import { describe, it, expect } from 'vitest'
import { matchShortcut } from '../src/shared/keymap'

const ev = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) =>
  ({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, ...over })

describe('matchShortcut', () => {
  it('Ctrl+K toggles the palette', () => {
    expect(matchShortcut(ev({ key: 'k', ctrlKey: true }))).toEqual({ type: 'toggle-palette' })
  })
  it('Meta+K also toggles the palette (mac parity)', () => {
    expect(matchShortcut(ev({ key: 'K', metaKey: true }))).toEqual({ type: 'toggle-palette' })
  })
  it('Ctrl+Shift+Enter toggles broadcast', () => {
    expect(matchShortcut(ev({ key: 'Enter', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'toggle-broadcast' })
  })
  it('Ctrl+Shift+T is new-terminal', () => {
    expect(matchShortcut(ev({ key: 'T', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'new-terminal' })
  })
  it('Ctrl+Shift+W is close-workspace', () => {
    expect(matchShortcut(ev({ key: 'W', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'close-workspace' })
  })
  it('Ctrl+Tab is next, Ctrl+Shift+Tab is prev', () => {
    expect(matchShortcut(ev({ key: 'Tab', ctrlKey: true }))).toEqual({ type: 'next-workspace' })
    expect(matchShortcut(ev({ key: 'Tab', ctrlKey: true, shiftKey: true }))).toEqual({ type: 'prev-workspace' })
  })
  it('Ctrl+3 jumps to 0-based index 2', () => {
    expect(matchShortcut(ev({ key: '3', ctrlKey: true }))).toEqual({ type: 'jump-workspace', index: 2 })
  })
  it('plain Tab and unmodified keys do not match', () => {
    expect(matchShortcut(ev({ key: 'Tab' }))).toBeNull()
    expect(matchShortcut(ev({ key: 't', ctrlKey: true }))).toBeNull() // no shift
    expect(matchShortcut(ev({ key: 'k' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- keymap`
Expected: FAIL — cannot find module `keymap`.

- [ ] **Step 3: Implement**

```ts
// src/shared/keymap.ts
export type Shortcut =
  | { type: 'toggle-palette' }
  | { type: 'toggle-broadcast' }
  | { type: 'new-terminal' }
  | { type: 'close-workspace' }
  | { type: 'next-workspace' }
  | { type: 'prev-workspace' }
  | { type: 'jump-workspace'; index: number }

interface KeyEvent { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

/** Map a keyboard event to a Shortcut, or null. Ctrl OR Meta satisfies "ctrl" for mac
 *  parity. Chords are chosen to avoid common shell/readline bindings; callers should
 *  preventDefault ONLY when this returns non-null so unmatched keys reach the terminal. */
export function matchShortcut(e: KeyEvent): Shortcut | null {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return null
  const k = e.key.toLowerCase()
  if (k === 'k' && !e.shiftKey) return { type: 'toggle-palette' }
  if (k === 'enter' && e.shiftKey) return { type: 'toggle-broadcast' }
  if (k === 't' && e.shiftKey) return { type: 'new-terminal' }
  if (k === 'w' && e.shiftKey) return { type: 'close-workspace' }
  if (k === 'tab') return { type: e.shiftKey ? 'prev-workspace' : 'next-workspace' }
  if (!e.shiftKey && k.length === 1 && k >= '1' && k <= '9') return { type: 'jump-workspace', index: Number(k) - 1 }
  return null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- keymap && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/keymap.ts tests/keymap.test.ts
git commit -m "feat(shared): pure matchShortcut keymap"
```

---

### Task 2: `buildCommandItems` + `PaletteAction`

**Files:**
- Modify: `src/shared/quick.ts`
- Test: `tests/quick-commands.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/quick-commands.test.ts
import { describe, it, expect } from 'vitest'
import { buildCommandItems, filterPaletteItems } from '../src/shared/quick'

describe('buildCommandItems', () => {
  it('returns command actions with non-empty search strings', () => {
    const cmds = buildCommandItems()
    const actions = cmds.map(c => c.kind === 'action' ? c.action : null)
    expect(actions).toEqual(expect.arrayContaining(['new-terminal', 'new-editor', 'new-explorer', 'new-workspace', 'broadcast', 'save-all', 'refresh-cloud']))
    for (const c of cmds) expect((c as { search: string }).search.length).toBeGreaterThan(0)
  })
  it('is filterable by query', () => {
    const hit = filterPaletteItems(buildCommandItems(), 'terminal')
    expect(hit.some(c => c.kind === 'action' && c.action === 'new-terminal')).toBe(true)
    expect(hit.some(c => c.kind === 'action' && c.action === 'refresh-cloud')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- quick-commands`
Expected: FAIL — `buildCommandItems` not exported.

- [ ] **Step 3: Extend the `PaletteItem` action union**

In `src/shared/quick.ts`, replace the `action` member of `PaletteItem` and add a
`PaletteAction` type just above it:

```ts
export type PaletteAction =
  | 'new-connection' | 'pin-cwd'
  | 'new-terminal' | 'new-editor' | 'new-explorer'
  | 'new-workspace' | 'broadcast' | 'save-all' | 'refresh-cloud'

export type PaletteItem =
  | { kind: 'connection'; id: string; label: string; detail: string; search: string }
  | { kind: 'dir'; path: string; favorite: boolean; search: string }
  | { kind: 'action'; action: PaletteAction; label: string; search: string }
```

- [ ] **Step 4: Add the builder**

Append to `src/shared/quick.ts`:

```ts
/** The command-menu items, appended to the palette ONLY when the query is non-empty
 *  (so the default connect/jump view stays uncluttered). Pure + order-stable. */
export function buildCommandItems(): PaletteItem[] {
  const cmd = (action: PaletteAction, label: string, search: string): PaletteItem =>
    ({ kind: 'action', action, label, search })
  return [
    cmd('new-terminal', 'New terminal', 'new terminal pane shell'),
    cmd('new-editor', 'New editor', 'new editor pane file'),
    cmd('new-explorer', 'New explorer…', 'new explorer pane folder directory'),
    cmd('new-workspace', 'New workspace', 'new workspace tab'),
    cmd('broadcast', 'Broadcast to all terminals', 'broadcast send all terminals'),
    cmd('save-all', 'Save all workspaces', 'save all workspaces'),
    cmd('refresh-cloud', 'Refresh cloud status', 'refresh cloud status')
  ]
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- quick-commands && npm run typecheck`
Expected: PASS; typecheck clean (the `CommandPalette` switch is non-exhaustive but
falls through harmlessly — the new arms come in Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/shared/quick.ts tests/quick-commands.test.ts
git commit -m "feat(shared): palette command items (typed-to-reveal)"
```

---

### Task 3: Wire commands into CommandPalette + listbox roles

**Files:**
- Modify: `src/renderer/components/CommandPalette.tsx`

- [ ] **Step 1: Add the needed store actions + api import**

At the top of `CommandPalette.tsx` add `import { api } from '../api'`, and add these
store selectors alongside the existing ones:

```tsx
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
  const newWorkspace = useStore(s => s.newWorkspace)
  const setBroadcastOpen = useStore(s => s.setBroadcastOpen)
  const saveAll = useStore(s => s.saveAll)
  const refreshCloud = useStore(s => s.refreshCloud)
  const pushToast = useStore(s => s.pushToast)
  const order = useStore(s => s.order)
```

- [ ] **Step 2: Append commands when querying**

Replace the `items` memo:

```tsx
  const items = useMemo(() => {
    const base = buildPaletteItems(quick, currentCwd)
    const all = query.trim() ? [...base, ...buildCommandItems()] : base
    return filterPaletteItems(all, query)
  }, [quick, currentCwd, query])
```

And add `buildCommandItems` to the import from `@shared/quick`:

```tsx
import { buildPaletteItems, buildCommandItems, filterPaletteItems, type PaletteItem } from '@shared/quick'
```

- [ ] **Step 3: Extend `activate()` with the command arms**

Replace `activate` with:

```tsx
  const activate = (item: PaletteItem) => {
    if (item.kind === 'connection') { launchConnection(item.id); close(); return }
    if (item.kind === 'dir') { launchDir(item.path); close(); return }
    if (item.action === 'new-connection') { setConnectionForm('new'); setOpen(false); return }
    if (item.action === 'pin-cwd') { pinDir(currentCwd); return }
    // Commands below need an active workspace.
    if (!activeId) return
    const ws = workspaces[activeId]
    const target = ws?.layout ? Object.keys(ws.panes)[0] : null
    if (item.action === 'new-terminal') addTerminal(activeId, target, 'row')
    else if (item.action === 'new-editor') addEditor(activeId, target, 'row')
    else if (item.action === 'new-explorer') { void api.openFolder().then(r => { if (r) addExplorer(activeId, target, 'row', r) }) }
    else if (item.action === 'new-workspace') newWorkspace(`Workspace ${order.length + 1}`)
    else if (item.action === 'broadcast') setBroadcastOpen(true)
    else if (item.action === 'save-all') { void saveAll(); pushToast('Workspaces saved') }
    else if (item.action === 'refresh-cloud') refreshCloud()
    close()
  }
```

- [ ] **Step 4: Listbox / option roles**

On the scroll `<div style={{ overflowY: 'auto' }}>` add `role="listbox"`. On each
item row `<div key={key} …>` add `role="option"` and
`aria-selected={i === clampedSel}`:

```tsx
        <div style={{ overflowY: 'auto' }} role="listbox" aria-label="Results">
```
```tsx
              <div key={key} data-testid={`palette-item-${i}`} role="option" aria-selected={i === clampedSel}
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/CommandPalette.tsx
git commit -m "feat(renderer): command-menu actions + listbox roles in palette"
```

---

### Task 4: Keymap-driven global shortcuts in App

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Import the keymap**

Add `import { matchShortcut } from '@shared/keymap'` near the other imports.

- [ ] **Step 2: Replace the keydown effect**

Replace the existing `useEffect` that wires `onKey` (the Ctrl+K / Ctrl+Shift+Enter
handler) with:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = matchShortcut(e)
      if (!sc) return
      e.preventDefault()
      const s = useStore.getState()
      const activeId = s.activeId
      const order = s.order
      const idx = activeId ? order.indexOf(activeId) : -1
      switch (sc.type) {
        case 'toggle-palette': s.setPaletteOpen(!s.paletteOpen); break
        case 'toggle-broadcast': s.setBroadcastOpen(!s.broadcastOpen); break
        case 'new-terminal': {
          if (!activeId) break
          const ws = s.workspaces[activeId]
          const target = ws?.layout ? Object.keys(ws.panes)[0] : null
          s.addTerminal(activeId, target, 'row'); break
        }
        case 'close-workspace': {
          if (!activeId) break
          const ws = s.workspaces[activeId]
          const ok = !ws || Object.keys(ws.panes).length === 0 ||
            window.confirm(`Close workspace "${ws.name}"? Its terminals will be closed.`)
          if (ok) s.closeWorkspace(activeId); break
        }
        case 'next-workspace': if (order.length) s.setActive(order[(idx + 1 + order.length) % order.length]); break
        case 'prev-workspace': if (order.length) s.setActive(order[(idx - 1 + order.length) % order.length]); break
        case 'jump-workspace': if (order[sc.index]) s.setActive(order[sc.index]); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(renderer): keymap-driven global shortcuts (new terminal, close/cycle/jump workspace)"
```

---

### Task 5: Tab strip arrow nav + tablist ARIA

**Files:**
- Modify: `src/renderer/components/WorkspaceTabs.tsx`

- [ ] **Step 1: Add a refs map for tab buttons**

Add `useRef` to the React import, and inside the component:

```tsx
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
```

- [ ] **Step 2: Arrow/Home/End handler**

Add inside the component (above the `return`):

```tsx
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
```

- [ ] **Step 3: tablist role on the strip**

On the root `<div data-testid="workspace-tabs" …>` add `role="tablist"` and
`aria-label="Workspaces"`:

```tsx
    <div data-testid="workspace-tabs" role="tablist" aria-label="Workspaces"
```

- [ ] **Step 4: Per-tab roles + roving tabindex + handler + ref**

In the tab `<button>` (the non-renaming branch), add the role/selection/tabindex/
keydown/ref props:

```tsx
          <button key={id} data-testid={`tab-${id}`} data-tab-id={id}
            data-active={id === activeId}
            role="tab" aria-selected={id === activeId} tabIndex={id === activeId ? 0 : -1}
            ref={el => { if (el) tabRefs.current.set(id, el); else tabRefs.current.delete(id) }}
            onKeyDown={onTabKey(id)}
            onPointerDown={beginTabDrag(id)}
            onDoubleClick={() => startRename(id)}
            onContextMenu={e => { e.preventDefault(); setMenuFor({ id, x: e.clientX, y: e.clientY }) }}
            style={{ fontWeight: id === activeId ? 700 : 400 }}>
            {workspaces[id].name}{badges[id] ?? ''}
          </button>
```

(The rename `<input>` branch is unchanged — arrow nav is naturally inert there
because the button isn't rendered while renaming.)

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/WorkspaceTabs.tsx
git commit -m "feat(renderer): workspace-tab arrow nav + tablist/tab ARIA roles"
```

---

### Task 6: Broadcast dialog ARIA

**Files:**
- Modify: `src/renderer/components/BroadcastDialog.tsx`

- [ ] **Step 1: Pass dialog cardProps**

Change the `<Modal …>` opening tag (line 31) to add `cardProps`:

```tsx
    <Modal onClose={() => setOpen(false)} backdropTestId="broadcast-dialog" card={{ padding: 12, width: 460 }}
      cardProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': 'Broadcast to all terminals' }}>
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/renderer/components/BroadcastDialog.tsx
git commit -m "feat(renderer): broadcast dialog ARIA role/label"
```

---

### Task 7: e2e + full verification

**Files:**
- Create: `tests/e2e/keyboard.spec.ts`
- Modify: `tests/e2e/ui-polish.spec.ts` (broadcast role assertion)

- [ ] **Step 1: Broadcast role assertion in ui-polish**

In `tests/e2e/ui-polish.spec.ts`, inside the existing broadcast test (after the
`broadcast-button` is clicked and quick keys are asserted), add:

```ts
  await expect(win.getByTestId('command-palette')).toHaveCount(0) // sanity: not the palette
  const role = await win.getByTestId('broadcast-dialog').getByRole('dialog').getAttribute('aria-label')
  expect(role).toBe('Broadcast to all terminals')
```

If `getByRole` is awkward against the portal, assert via the card directly:
`expect(await win.locator('[aria-label="Broadcast to all terminals"]').count()).toBeGreaterThan(0)`.

- [ ] **Step 2: Write the keyboard e2e spec**

Model launch/seed on the existing specs (`editor.spec.ts` launch pattern,
`seedWorkspace`). Use editor panes where possible; for the new-terminal assertions
a terminal pane is required (accept the documented PTY flakiness).

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

test('command palette: typing a command and Enter adds a pane', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kbd1-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-kbd1-proj-'))
  const f = join(proj, 'a.ts'); writeFileSync(f, '1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [f], activePath: f } }], 'p1')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  await win.keyboard.press('Control+KeyK')
  await win.getByTestId('palette-input').fill('new editor')
  await expect(win.getByTestId('palette-item-0')).toContainText('New editor', { timeout: 5_000 })
  await win.getByTestId('palette-input').press('Enter')
  // a second editor pane exists now (two [data-testid^="editor-"] hosts)
  await expect(win.locator('[data-testid^="editor-"]')).toHaveCount(2, { timeout: 10_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('Ctrl+digit / Ctrl+Tab switch workspaces', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kbd2-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  // create a second workspace via the + button, then jump back to the first with Ctrl+1
  await win.getByTestId('new-workspace').click()
  await win.keyboard.press('Escape') // dismiss the auto-started rename
  const tabs = win.locator('[data-testid^="tab-"]')
  await expect(tabs).toHaveCount(2, { timeout: 10_000 })
  await win.keyboard.press('Control+Digit1')
  await expect(tabs.first()).toHaveAttribute('data-active', 'true', { timeout: 5_000 })
  await win.keyboard.press('Control+Tab')
  await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true', { timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('workspace tab ArrowRight moves the active tab', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kbd3-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('new-workspace').click()
  await win.keyboard.press('Escape')
  const tabs = win.locator('[data-testid^="tab-"]')
  await expect(tabs).toHaveCount(2, { timeout: 10_000 })
  await tabs.first().click()              // activate + focus the first tab
  await tabs.first().focus()
  await win.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true', { timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 3: Build + run the keyboard spec**

Run: `npm run build && npm run e2e -- keyboard.spec.ts`
Expected: 3 passing (re-run on PTY/startup flake as in Phases 1–2).

- [ ] **Step 4: Run the broadcast-role assertion**

Run: `npm run e2e -- ui-polish.spec.ts`
Expected: all pass (broadcast test now also checks the dialog role).

- [ ] **Step 5: Full verification (read exit codes directly)**

Run: `npm run typecheck`
Then: `npm test`
Then: `npm run build && npm run e2e -- keyboard.spec.ts ui-polish.spec.ts`
Expected: typecheck exit 0; all unit pass; both e2e specs green (flaky terminal
specs recover on retry — evaluate as in Phases 1–2, not regressions).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/keyboard.spec.ts tests/e2e/ui-polish.spec.ts
git commit -m "test(e2e): palette commands, global shortcuts, tab arrow nav, broadcast role"
```

---

### Task 8: Docs

**Files:**
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-06-16-ui-polish-phase3-design.md`

- [ ] **Step 1: Changelog entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- **Keyboard navigation + command menu (UI polish phase 3).** The command palette
  (Ctrl+K) now also runs commands — type to reveal **New terminal/editor/explorer**,
  **New workspace**, **Broadcast**, **Save all**, **Refresh cloud status** (the
  default connect/jump view is unchanged until you type). New global shortcuts:
  **Ctrl+Shift+T** new terminal, **Ctrl+Shift+W** close workspace,
  **Ctrl+Tab / Ctrl+Shift+Tab** cycle workspaces, **Ctrl+1…9** jump to a workspace.
  The workspace-tab strip is now arrow-key navigable (Left/Right, Home/End) with
  proper `tablist`/`tab` roles, and the broadcast dialog + palette results expose
  correct ARIA roles. Shortcuts use terminal-safe chords and only intercept keys
  they match, so the shell still receives everything else.
```

- [ ] **Step 2: Mark spec implemented**

Change the spec's `**Status:** Design — pending review` to `**Status:** Implemented`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-06-16-ui-polish-phase3-design.md
git commit -m "docs: changelog + spec status for UI polish phase 3"
```

---

## Self-Review

**Spec coverage:** keymap ✓(T1), command items + `PaletteAction` ✓(T2), palette
command wiring + listbox roles ✓(T3), App keymap dispatch ✓(T4), tab arrow nav +
tablist/tab ARIA ✓(T5), broadcast ARIA ✓(T6), e2e (palette command, Ctrl+digit/Tab,
tab arrow, broadcast role) ✓(T7), docs ✓(T8). Theme/Env deferral noted (no task — by
design). `preventDefault`-on-match-only ✓(T4). All covered.

**Placeholder scan:** T7 Step 1 offers a fallback selector for the broadcast-role
assertion — that's a concrete alternative, not a TODO. No "handle errors"/"TBD" gaps;
every code step shows full code.

**Type consistency:** `Shortcut` defined T1, consumed T4 (switch covers every
variant). `PaletteAction` defined T2, used in T2's union + T3's `activate` arms (arm
per non-existing-action). `buildCommandItems` defined T2, imported T3.
`matchShortcut` signature `{key,ctrlKey,metaKey,shiftKey}` matches the `KeyboardEvent`
passed in T4. Tab `onTabKey(id)`/`tabRefs` names consistent within T5. Consistent.
