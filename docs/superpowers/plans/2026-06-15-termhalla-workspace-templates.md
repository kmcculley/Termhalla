# Workspace Layout Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Save a workspace's layout as a named template (in quick.json) and create new workspaces from templates.

**Architecture:** `WorkspaceTemplate` type + `templates` on `QuickStore`; pure `remapPaneIds`/`templateFromWorkspace`/`workspaceFromTemplate`; store `saveTemplate`/`deleteTemplate`/`newWorkspaceFromTemplate`; a `TemplatesMenu` opened from a `▾` button in `WorkspaceTabs`. Reuses `quick:load`/`quick:save` — no new IPC.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-workspace-templates-design.md`

---

## Task 1: Types + pure helpers

**Files:** Modify `src/shared/types.ts`, `src/main/persistence/quick-store.ts`, `src/shared/workspace-model.ts`; Test `tests/shared/workspace-template.test.ts`.

- [ ] **Step 1: Failing test** — `tests/shared/workspace-template.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { remapPaneIds, templateFromWorkspace, workspaceFromTemplate } from '../../src/shared/workspace-model'
import type { Workspace } from '../../src/shared/types'

const ws = {
  id: 'w1', name: 'Src',
  layout: { direction: 'row', first: 'a', second: 'b' },
  panes: {
    a: { paneId: 'a', config: { kind: 'terminal', shellId: 's', cwd: 'C:\\x' } },
    b: { paneId: 'b', config: { kind: 'editor', files: ['C:\\f.ts'] } }
  }
} as unknown as Workspace

let n = 0
const uuid = () => `new-${n++}`

describe('remapPaneIds', () => {
  it('assigns fresh ids in the layout tree and panes map', () => {
    n = 0
    const r = remapPaneIds(ws.layout, ws.panes, uuid)
    const leaves = [(r.layout as { first: string }).first, (r.layout as { second: string }).second]
    expect(leaves.sort()).toEqual(['new-0', 'new-1'])
    expect(Object.keys(r.panes).sort()).toEqual(['new-0', 'new-1'])
    for (const id of Object.keys(r.panes)) expect(r.panes[id].paneId).toBe(id)
  })
  it('passes through a blank workspace', () => {
    const r = remapPaneIds(null, {}, uuid)
    expect(r).toEqual({ layout: null, panes: {} })
  })
})

describe('templateFromWorkspace / workspaceFromTemplate', () => {
  it('captures then re-instantiates with fresh ids and given name', () => {
    n = 0
    const tpl = templateFromWorkspace(ws, 't1', 'My Template')
    expect(tpl).toMatchObject({ id: 't1', name: 'My Template' })
    const out = workspaceFromTemplate(tpl, 'w2', 'Copy', uuid)
    expect(out.id).toBe('w2')
    expect(out.name).toBe('Copy')
    expect(Object.keys(out.panes)).toHaveLength(2)
    // fresh ids (not the template's a/b)
    expect(Object.keys(out.panes)).not.toContain('a')
  })
  it('templateFromWorkspace deep-copies (later workspace edits do not mutate the template)', () => {
    const tpl = templateFromWorkspace(ws, 't1', 'T')
    ;(ws.panes.a.config as { cwd: string }).cwd = 'MUTATED'
    expect((tpl.panes.a.config as { cwd: string }).cwd).toBe('C:\\x')
    ;(ws.panes.a.config as { cwd: string }).cwd = 'C:\\x' // restore
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Add the type** — in `src/shared/types.ts`, after the `Workspace` interface, add:
```ts
export interface WorkspaceTemplate {
  id: string
  name: string
  layout: MosaicNode | null
  panes: Record<string, PaneNode>
}
```
Add `templates: WorkspaceTemplate[]` to the `QuickStore` interface, and `templates: []` to `EMPTY_QUICK`.

- [ ] **Step 4: normalizeQuick** — in `src/main/persistence/quick-store.ts`, add to the returned object in `normalizeQuick`:
```ts
    templates: Array.isArray(v.templates) ? v.templates : [],
```

- [ ] **Step 5: Pure helpers** — append to `src/shared/workspace-model.ts` (it already imports the workspace/pane/mosaic types it uses; add `WorkspaceTemplate` to its `@shared/types`/`./types` imports if needed):
```ts
function cloneConfig<T>(v: T): T { return JSON.parse(JSON.stringify(v)) }

/** Re-key every pane with a fresh id, rewriting the layout-tree leaves and the panes map. */
export function remapPaneIds(
  layout: MosaicNode | null,
  panes: Record<string, PaneNode>,
  uuid: () => string
): { layout: MosaicNode | null; panes: Record<string, PaneNode> } {
  const idMap = new Map<string, string>()
  for (const oldId of Object.keys(panes)) idMap.set(oldId, uuid())
  const remapNode = (node: MosaicNode): MosaicNode =>
    typeof node === 'string'
      ? (idMap.get(node) ?? node)
      : { ...node, first: remapNode(node.first), second: remapNode(node.second) }
  const newPanes: Record<string, PaneNode> = {}
  for (const [oldId, pane] of Object.entries(panes)) {
    const newId = idMap.get(oldId)!
    newPanes[newId] = { paneId: newId, config: cloneConfig(pane.config) }
  }
  return { layout: layout === null ? null : remapNode(layout), panes: newPanes }
}

/** Capture a workspace's layout as a (deep-copied) template blueprint. */
export function templateFromWorkspace(ws: Workspace, id: string, name: string): WorkspaceTemplate {
  return { id, name, layout: ws.layout === null ? null : cloneConfig(ws.layout), panes: cloneConfig(ws.panes) }
}

/** Instantiate a fresh workspace from a template (new pane ids). */
export function workspaceFromTemplate(tpl: WorkspaceTemplate, wsId: string, name: string, uuid: () => string): Workspace {
  const { layout, panes } = remapPaneIds(tpl.layout, tpl.panes, uuid)
  return { id: wsId, name, layout, panes }
}
```
(Ensure the file imports `MosaicNode`, `PaneNode`, `Workspace`, `WorkspaceTemplate` from its types module — check the existing imports and extend them.)

- [ ] **Step 6: Run, verify pass; typecheck.**
- [ ] **Step 7: Commit**
```bash
git add src/shared/types.ts src/main/persistence/quick-store.ts src/shared/workspace-model.ts tests/shared/workspace-template.test.ts
git commit -m "feat(templates): WorkspaceTemplate type + remap/from-template helpers"
```

---

## Task 2: Store actions

**Files:** Modify `src/renderer/store.ts`.

- [ ] **Step 1: Imports** — add `templateFromWorkspace, workspaceFromTemplate` to the `@shared/workspace-model` import; add `WorkspaceTemplate` to the `@shared/types` import.

- [ ] **Step 2: State interface** — add:
```ts
  saveTemplate: (name: string) => void
  deleteTemplate: (id: string) => void
  newWorkspaceFromTemplate: (templateId: string, name: string) => string
```

- [ ] **Step 3: Implement** — add alongside `newWorkspace` (uses `uuid`, `scheduleAutosave`, `scheduleQuickSave` — all already in the file):
```ts
    saveTemplate: (name) => {
      const n = name.trim(); if (!n) return
      const s = get(); const ws = s.activeId ? s.workspaces[s.activeId] : null
      if (!ws) return
      const tpl = templateFromWorkspace(ws, uuid(), n)
      set(st => ({ quick: { ...st.quick, templates: [...st.quick.templates, tpl] } }))
      scheduleQuickSave()
    },

    deleteTemplate: (id) => {
      set(st => ({ quick: { ...st.quick, templates: st.quick.templates.filter(t => t.id !== id) } }))
      scheduleQuickSave()
    },

    newWorkspaceFromTemplate: (templateId, name) => {
      const tpl = get().quick.templates.find(t => t.id === templateId)
      if (!tpl) return get().newWorkspace(name)
      const ws = workspaceFromTemplate(tpl, uuid(), name, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [ws.id]: ws }, order: [...s.order, ws.id], activeId: ws.id }))
      scheduleAutosave()
      return ws.id
    },
```

- [ ] **Step 4: Typecheck.**
- [ ] **Step 5: Commit**
```bash
git add src/renderer/store.ts
git commit -m "feat(templates): store saveTemplate/deleteTemplate/newWorkspaceFromTemplate"
```

---

## Task 3: TemplatesMenu + WorkspaceTabs button

**Files:** Create `src/renderer/components/TemplatesMenu.tsx`; Modify `src/renderer/components/WorkspaceTabs.tsx`.

- [ ] **Step 1: Create `TemplatesMenu.tsx`**
```tsx
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
        style={{ position: 'fixed', top: 30, left: 4, zIndex: 41, background: '#252526', color: '#eee',
          border: '1px solid #444', borderRadius: 4, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
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
```

- [ ] **Step 2: Wire into `WorkspaceTabs.tsx`** — read it; then:
  - Add the import: `import { TemplatesMenu } from './TemplatesMenu'`.
  - Add local state near the others: `const [templatesOpen, setTemplatesOpen] = useState(false)`.
  - Add a button immediately AFTER the `new-workspace` (`+`) button:
```tsx
      <button data-testid="templates-button" title="Workspace templates"
        onClick={() => setTemplatesOpen(o => !o)}>▾</button>
```
  - Render the menu (e.g. just before the closing `</div>` of the component, after the `menuFor` block):
```tsx
      {templatesOpen && <TemplatesMenu onPicked={startRename} onClose={() => setTemplatesOpen(false)} />}
```
  (`startRename` already exists in `WorkspaceTabs` from sub-project B.)

- [ ] **Step 3: Typecheck + build** → clean.
- [ ] **Step 4: Commit**
```bash
git add src/renderer/components/TemplatesMenu.tsx src/renderer/components/WorkspaceTabs.tsx
git commit -m "feat(templates): TemplatesMenu + tab-bar button"
```

---

## Task 4: e2e

**Files:** Create `tests/e2e/workspace-templates.spec.ts`.

- [ ] **Step 1: Write the spec** (note: all workspaces stay mounted, so scope terminal counts to the ACTIVE host `[data-testid="workspace-host"][data-active="true"]`):
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('saves a 2-terminal workspace as a template and creates a new workspace from it', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tpl-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  // Build a 2-terminal workspace.
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })

  // Save as a template.
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-name').fill('TwoTerms')
  await win.getByTestId('tpl-save').click()

  // Create a new workspace from the template.
  await win.getByTestId('templates-button').click()
  await win.locator('[data-testid^="tpl-"]', { hasText: 'TwoTerms' }).click()

  // The active (new) workspace has two terminal tiles.
  const activeHost = win.locator('[data-testid="workspace-host"][data-active="true"]')
  await expect(activeHost.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 2: Build + run** — `npm run build` then `npx playwright test tests/e2e/workspace-templates.spec.ts`. The `tpl-` prefix also matches `tpl-name`/`tpl-save`/`tpl-del-*`; the `hasText: 'TwoTerms'` filter targets the template button. If the locator is ambiguous, narrow it (e.g. exclude `tpl-name`/`tpl-save` or use the `tpl-<id>` row). Keep the core assertion (new active workspace has 2 terminals).
- [ ] **Step 3: Commit**
```bash
git add tests/e2e/workspace-templates.spec.ts
git commit -m "test(templates): e2e save + instantiate a workspace template"
```

---

## Task 5: Verify + docs

- [ ] **Step 1:** `npm run typecheck` (exit 0), `npm test`, `npm run e2e` → all green.
- [ ] **Step 2:** New `docs/features/workspace-templates.md`; `CHANGELOG.md` `[Unreleased] → Added`.
```bash
git add docs/features/workspace-templates.md CHANGELOG.md
git commit -m "docs: document workspace templates"
```

---

## Self-review notes
- Spec coverage: type+quick+pure (T1), store (T2), menu+button (T3), e2e (T4), docs (T5).
- Type consistency: `WorkspaceTemplate`, `remapPaneIds`, `templateFromWorkspace`, `workspaceFromTemplate` consistent across model/store/tests; `templates` added to both the `QuickStore` interface and `EMPTY_QUICK` and `normalizeQuick`.
- Reuses `quick:load`/`quick:save` (no new IPC); new-from-template reuses sub-project B's inline rename via `onPicked`.
