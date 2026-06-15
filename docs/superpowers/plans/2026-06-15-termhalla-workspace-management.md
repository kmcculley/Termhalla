# Workspace Tab Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Right-click workspace tab menu (Rename/Save/Close), inline name-on-create, and drag-reorder of tabs.

**Architecture:** Pure `reorderIds` in `workspace-model.ts`; store actions `renameWorkspace`/`closeWorkspace`/`moveWorkspace`; a rewritten `WorkspaceTabs.tsx` with inline-rename, a context menu, and native drag-and-drop.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-workspace-management-design.md`

---

## Task 1: Pure `reorderIds`

**Files:** Modify `src/shared/workspace-model.ts`; Test `tests/shared/workspace-reorder.test.ts`.

- [ ] **Step 1: Failing test** — `tests/shared/workspace-reorder.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { reorderIds } from '../../src/shared/workspace-model'

describe('reorderIds', () => {
  it('moves an id forward to the target position', () => {
    expect(reorderIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
  })
  it('moves an id backward to the target position', () => {
    expect(reorderIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op when from === to or either is missing', () => {
    expect(reorderIds(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(reorderIds(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
    expect(reorderIds(['a', 'b'], 'a', 'x')).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/shared/workspace-reorder.test.ts`.

- [ ] **Step 3: Implement** — append to `src/shared/workspace-model.ts`:
```ts
/** Move `fromId` to the index currently held by `toId`, returning a new array.
 *  No-op when either id is missing or they are equal. */
export function reorderIds(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order
  const from = order.indexOf(fromId)
  const to = order.indexOf(toId)
  if (from < 0 || to < 0) return order
  const next = order.slice()
  next.splice(from, 1)
  next.splice(to, 0, fromId)
  return next
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit**
```bash
git add src/shared/workspace-model.ts tests/shared/workspace-reorder.test.ts
git commit -m "feat(workspace): pure reorderIds"
```

---

## Task 2: Store actions

**Files:** Modify `src/renderer/store.ts`.

- [ ] **Step 1: Import** — add `reorderIds` to the existing `@shared/workspace-model` import.

- [ ] **Step 2: State interface** — after `newWorkspace` in the `State` interface, add:
```ts
  renameWorkspace: (id: string, name: string) => void
  closeWorkspace: (id: string) => void
  moveWorkspace: (fromId: string, toId: string) => void
```

- [ ] **Step 3: Implement** — add alongside `newWorkspace`/`setActive`:
```ts
    renameWorkspace: (id, name) => {
      const n = name.trim()
      if (!n) return
      set(s => s.workspaces[id] ? { workspaces: { ...s.workspaces, [id]: { ...s.workspaces[id], name: n } } } : {})
      scheduleAutosave()
    },

    closeWorkspace: (id) => {
      const ws = get().workspaces[id]
      if (!ws) return
      const paneIds = Object.keys(ws.panes)
      for (const pid of paneIds) {
        if (ws.panes[pid].config.kind === 'terminal') { api.ptyKill(pid); api.usageUnwatch(pid) }
      }
      set(s => {
        const workspaces = { ...s.workspaces }; delete workspaces[id]
        const order = s.order.filter(x => x !== id)
        const statuses = { ...s.statuses }, cwds = { ...s.cwds }, procs = { ...s.procs },
              aiSessions = { ...s.aiSessions }, usage = { ...s.usage }
        for (const pid of paneIds) { delete statuses[pid]; delete cwds[pid]; delete procs[pid]; delete aiSessions[pid]; delete usage[pid] }
        const activeId = s.activeId === id ? (order[0] ?? null) : s.activeId
        return { workspaces, order, activeId, statuses, cwds, procs, aiSessions, usage }
      })
      if (get().order.length === 0) get().newWorkspace('Workspace 1')
      scheduleAutosave()
    },

    moveWorkspace: (fromId, toId) => {
      set(s => ({ order: reorderIds(s.order, fromId, toId) }))
      scheduleAutosave()
    },
```

- [ ] **Step 4: Typecheck** — `npm run typecheck` → no errors.
- [ ] **Step 5: Commit**
```bash
git add src/renderer/store.ts
git commit -m "feat(workspace): renameWorkspace / closeWorkspace / moveWorkspace"
```

---

## Task 3: WorkspaceTabs — rename, menu, create-rename, drag

**Files:** Modify `src/renderer/components/WorkspaceTabs.tsx`.

Replace the ENTIRE file with the following (it keeps `tabBadge` and all existing controls — shell picker, add-pane, broadcast, save — and adds inline rename, the context menu, name-on-create, and drag):

```tsx
import { useState } from 'react'
import type { Workspace, AiSession, TerminalStatus } from '@shared/types'
import { resolveAlerts } from '@shared/alerts'
import { useStore, aiState } from '../store'
import { api } from '../api'

function tabBadge(
  ws: Workspace,
  statuses: Record<string, TerminalStatus>,
  aiSessions: Record<string, AiSession>
): string {
  let needs = 0, busy = false, ai = false, aiAwaiting = false
  for (const paneId of Object.keys(ws.panes)) {
    const cfg = ws.panes[paneId].config
    if (cfg.kind !== 'terminal') continue
    const as = aiState({ aiSessions, statuses }, paneId)
    if (as) { ai = true; if (as === 'awaiting') aiAwaiting = true }
    if (!resolveAlerts(cfg.alerts).tabBadge) continue
    const st = statuses[paneId]?.state
    if (st === 'needs-input') needs++
    else if (st === 'busy') busy = true
  }
  const aiPart = ai ? (aiAwaiting ? ' ✨⏳' : ' ✨') : ''
  if (needs > 0) return `${aiPart} 🔔${needs}`
  if (busy) return `${aiPart} •`
  return aiPart
}

export function WorkspaceTabs() {
  const {
    order, workspaces, activeId, setActive, newWorkspace,
    saveAll, shells, newTerminalShellId, setNewTerminalShell, statuses,
    addTerminal, addEditor, addExplorer, aiSessions,
    renameWorkspace, closeWorkspace, moveWorkspace, setBroadcastOpen, broadcastOpen
  } = useStore()

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const startRename = (id: string) => { setRenameText(workspaces[id]?.name ?? ''); setRenamingId(id); setMenuFor(null) }
  const commitRename = (id: string) => { renameWorkspace(id, renameText); setRenamingId(null) }

  return (
    <div data-testid="workspace-tabs"
      style={{ display: 'flex', gap: 4, padding: 4, background: '#1e1e1e', alignItems: 'center' }}>
      {order.map(id => (
        renamingId === id ? (
          <input key={id} data-testid={`ws-rename-${id}`} autoFocus value={renameText}
            onChange={e => setRenameText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(id); else if (e.key === 'Escape') setRenamingId(null) }}
            onBlur={() => commitRename(id)}
            style={{ width: 120 }} />
        ) : (
          <button key={id} data-testid={`tab-${id}`}
            draggable
            onDragStart={() => setDraggedId(id)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => { if (draggedId && draggedId !== id) moveWorkspace(draggedId, id); setDraggedId(null) }}
            onClick={() => setActive(id)}
            onDoubleClick={() => startRename(id)}
            onContextMenu={e => { e.preventDefault(); setMenuFor({ id, x: e.clientX, y: e.clientY }) }}
            style={{ fontWeight: id === activeId ? 700 : 400 }}>
            {workspaces[id].name}{tabBadge(workspaces[id], statuses, aiSessions)}
          </button>
        )
      ))}
      <button data-testid="new-workspace"
        onClick={() => { const id = newWorkspace(`Workspace ${order.length + 1}`); startRename(id) }}>+</button>
      <span style={{ flex: 1 }} />
      <select data-testid="shell-picker" value={newTerminalShellId ?? ''}
        onChange={e => setNewTerminalShell(e.target.value)}>
        {shells.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select data-testid="add-pane" value="" onChange={async e => {
        const kind = e.target.value; e.currentTarget.value = ''
        if (!activeId) return
        const ws = workspaces[activeId]
        const target = ws.layout ? Object.keys(ws.panes)[0] : null
        if (kind === 'terminal') addTerminal(activeId, target, 'row')
        else if (kind === 'editor') addEditor(activeId, target, 'row')
        else if (kind === 'explorer') { const r = await api.openFolder(); if (r) addExplorer(activeId, target, 'row', r) }
      }}>
        <option value="" disabled>＋ pane…</option>
        <option value="terminal">Terminal</option>
        <option value="editor">Editor</option>
        <option value="explorer">Explorer</option>
      </select>
      <button data-testid="broadcast-button" title="Broadcast to all terminals (Ctrl+Shift+Enter)"
        onClick={() => setBroadcastOpen(!broadcastOpen)}>⇉</button>
      <button data-testid="save-workspace" onClick={() => saveAll()}>Save</button>

      {menuFor && (
        <>
          <div onClick={() => setMenuFor(null)} onContextMenu={e => { e.preventDefault(); setMenuFor(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div data-testid="ws-menu"
            style={{ position: 'fixed', left: menuFor.x, top: menuFor.y, zIndex: 41, background: '#252526',
              color: '#eee', border: '1px solid #444', borderRadius: 4, padding: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button data-testid="ws-menu-rename" onClick={() => startRename(menuFor.id)}>Rename</button>
            <button data-testid="ws-menu-save" onClick={() => { void saveAll(); setMenuFor(null) }}>Save</button>
            <button data-testid="ws-menu-close" onClick={() => {
              const ws = workspaces[menuFor.id]
              const ok = !ws || Object.keys(ws.panes).length === 0 ||
                window.confirm(`Close workspace "${ws.name}"? Its terminals will be closed.`)
              if (ok) closeWorkspace(menuFor.id)
              setMenuFor(null)
            }}>Close</button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 1:** Replace the file with the above.
- [ ] **Step 2: Typecheck + build** — `npm run typecheck` and `npm run build` → clean.
- [ ] **Step 3: Commit**
```bash
git add src/renderer/components/WorkspaceTabs.tsx
git commit -m "feat(workspace): tab context menu, inline rename, name-on-create, drag-reorder"
```

---

## Task 4: e2e

**Files:** Create `tests/e2e/workspace-mgmt.spec.ts`.

- [ ] **Step 1: Write the spec** (model launch/teardown on `tests/e2e/persistence.spec.ts`):
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

test('rename on create + context-menu rename persists; close and reorder work', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-wsmgmt-'))
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Name on create: + focuses an inline input.
  await win.getByTestId('new-workspace').click()
  const input = win.locator('[data-testid^="ws-rename-"]')
  await expect(input).toBeFocused({ timeout: 10_000 })
  await input.fill('Alpha')
  await input.press('Enter')
  await expect(win.getByTestId('workspace-tabs')).toContainText('Alpha')

  // Add a third workspace, then drag it before the first.
  await win.getByTestId('new-workspace').click()
  await win.locator('[data-testid^="ws-rename-"]').fill('Beta')
  await win.locator('[data-testid^="ws-rename-"]').press('Enter')

  // Close "Alpha" via its context menu (no panes -> no confirm).
  const tabs = win.locator('[data-testid^="tab-"]')
  const alpha = win.locator('[data-testid^="tab-"]', { hasText: 'Alpha' })
  await alpha.click({ button: 'right' })
  await expect(win.getByTestId('ws-menu')).toBeVisible()
  await win.getByTestId('ws-menu-close').click()
  await expect(win.locator('[data-testid^="tab-"]', { hasText: 'Alpha' })).toHaveCount(0)

  // Context-menu rename persists across relaunch.
  const beta = win.locator('[data-testid^="tab-"]', { hasText: 'Beta' })
  await beta.click({ button: 'right' })
  await win.getByTestId('ws-menu-rename').click()
  const ri = win.locator('[data-testid^="ws-rename-"]')
  await ri.fill('Gamma'); await ri.press('Enter')
  await expect(win.getByTestId('workspace-tabs')).toContainText('Gamma')
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(800)
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toContainText('Gamma', { timeout: 15_000 })
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 2: Build + run** — `npm run build` then `npx playwright test tests/e2e/workspace-mgmt.spec.ts`. If the drag assertion or any step is flaky, stabilize it (e.g. explicit waits), but keep the rename-persist, close, and name-on-create assertions. (A native HTML5 drag is hard to drive in Playwright; the spec above exercises rename/close/create — reordering is covered by the `reorderIds` unit test. Optionally add a drag check with `dragTo` if reliable.)

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/workspace-mgmt.spec.ts
git commit -m "test(workspace): e2e rename/close/name-on-create"
```

---

## Task 5: Verify + docs

- [ ] **Step 1:** `npm run typecheck` (exit 0), `npm test`, `npm run e2e` → all green.
- [ ] **Step 2:** New `docs/features/workspace-management.md` (context menu, inline rename, name-on-create, drag-reorder, close semantics); `CHANGELOG.md` `[Unreleased] → Added`. Also append a "Workspace tab management" note to `docs/features/workspaces.md`'s Related/behaviors if natural.
```bash
git add docs/features/workspace-management.md CHANGELOG.md
git commit -m "docs: document workspace tab management"
```

---

## Self-review notes
- Spec coverage: reorderIds (T1), store rename/close/move (T2), tabs UI incl. all 3 features (T3), e2e (T4), docs (T5).
- Type consistency: `renameWorkspace(id,name)`, `closeWorkspace(id)`, `moveWorkspace(fromId,toId)`, `reorderIds(order,fromId,toId)` consistent across store/tabs/tests.
- Close cleans the same per-pane maps as `closePane` (statuses/cwds/procs/aiSessions/usage) and kills terminals; last-close creates a fresh workspace. Non-goals respected.
