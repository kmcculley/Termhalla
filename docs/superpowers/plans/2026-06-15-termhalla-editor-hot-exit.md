# Editor Hot-Exit (Unsaved Draft Persistence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each dirty editor buffer's unsaved content so it is restored exactly on app restart, with the existing "Changed on disk" bar handling files that also changed on disk.

**Architecture:** A new main-process `DraftStore` persists a `paneId::path → {content, baseline}` map to `editor-drafts.json` in `userData`, behind three IPC channels (`drafts:load`/`drafts:set`/`drafts:delete`). The renderer loads the map once in `store.init`; `EditorPane` applies a draft on open via the pure `resolveDraftOnOpen`, persists drafts debounced on edit, and deletes them on save / tab-close / pane-close. `EditorConfig` is unchanged.

**Tech Stack:** Electron + TypeScript, React, zustand, Monaco; vitest (pure/main) and Playwright-for-Electron (e2e).

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-editor-hot-exit-design.md`

---

## Task 1: Shared draft types + pure open-time resolution

**Files:**
- Modify: `src/shared/types.ts` (add `EditorDraft`)
- Create: `src/shared/editor-draft.ts`
- Test: `tests/shared/editor-draft.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/shared/editor-draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { draftKey, resolveDraftOnOpen } from '../../src/shared/editor-draft'

describe('draftKey', () => {
  it('combines paneId and path with the :: separator (matches the fs-watch id scheme)', () => {
    expect(draftKey('p1', 'C:\\dev\\a.ts')).toBe('p1::C:\\dev\\a.ts')
  })
})

describe('resolveDraftOnOpen', () => {
  it('passes disk content through when there is no draft', () => {
    expect(resolveDraftOnOpen('on disk', undefined)).toEqual({ content: 'on disk', dirty: false, externalChanged: false })
  })
  it('treats a missing file with no draft as empty content', () => {
    expect(resolveDraftOnOpen(null, undefined)).toEqual({ content: '', dirty: false, externalChanged: false })
  })
  it('restores the draft as dirty when disk is unchanged vs the baseline', () => {
    const r = resolveDraftOnOpen('base', { content: 'edited', baseline: 'base' })
    expect(r).toEqual({ content: 'edited', dirty: true, externalChanged: false })
  })
  it('flags externalChanged when disk differs from the draft baseline', () => {
    const r = resolveDraftOnOpen('disk moved', { content: 'edited', baseline: 'base' })
    expect(r).toEqual({ content: 'edited', dirty: true, externalChanged: true })
  })
  it('flags externalChanged for a now-deleted file with a draft', () => {
    const r = resolveDraftOnOpen(null, { content: 'edited', baseline: 'base' })
    expect(r).toEqual({ content: 'edited', dirty: true, externalChanged: true })
  })
  it('reports not-dirty when the draft equals disk (stale draft)', () => {
    const r = resolveDraftOnOpen('same', { content: 'same', baseline: 'base' })
    expect(r).toEqual({ content: 'same', dirty: false, externalChanged: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shared/editor-draft.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/editor-draft'`.

- [ ] **Step 3: Add the `EditorDraft` type**

In `src/shared/types.ts`, add immediately after the `ExplorerConfig` interface (before `PaneConfig`):

```ts
/** A persisted unsaved editor buffer (hot-exit). Keyed by `paneId::path` in the draft store. */
export interface EditorDraft {
  content: string    // the unsaved buffer text to restore
  baseline: string   // the disk text the buffer diverged from (for on-reopen conflict detection)
}
```

- [ ] **Step 4: Implement the pure module**

Create `src/shared/editor-draft.ts`:

```ts
import type { EditorDraft } from './types'

/** Stable per-tab key: paneIds persist in the workspace layout, so this survives restart.
 *  Identical to the editor's existing fs-watch id scheme. */
export function draftKey(paneId: string, path: string): string {
  return `${paneId}::${path}`
}

export interface DraftResolution {
  content: string          // what to load into the model
  dirty: boolean           // mark the tab dirty?
  externalChanged: boolean // show the "Changed on disk" reload bar?
}

/** Decide a tab's initial content when (re)opening a file, given the current disk content
 *  (null when the file is missing) and any persisted unsaved draft. */
export function resolveDraftOnOpen(diskContent: string | null, draft: EditorDraft | undefined): DraftResolution {
  if (!draft) return { content: diskContent ?? '', dirty: false, externalChanged: false }
  return {
    content: draft.content,
    dirty: draft.content !== diskContent,
    externalChanged: diskContent !== draft.baseline
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/shared/editor-draft.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/editor-draft.ts tests/shared/editor-draft.test.ts
git commit -m "feat(editor): EditorDraft type + pure resolveDraftOnOpen"
```

---

## Task 2: Main-process DraftStore

**Files:**
- Create: `src/main/persistence/draft-store.ts`
- Test: `tests/main/draft-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/draft-store.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DraftStore } from '../../src/main/persistence/draft-store'

const dirs: string[] = []
function tempDir(): string { const d = mkdtempSync(join(tmpdir(), 'ds-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('DraftStore', () => {
  it('returns {} when no file exists', async () => {
    const s = new DraftStore(tempDir())
    expect(await s.load()).toEqual({})
  })

  it('round-trips set then load (from a fresh store)', async () => {
    const dir = tempDir()
    const s = new DraftStore(dir)
    await s.load()
    s.set('p1::a.ts', { content: 'edited', baseline: 'base' })
    await wait(50)
    expect(await new DraftStore(dir).load()).toEqual({ 'p1::a.ts': { content: 'edited', baseline: 'base' } })
  })

  it('delete removes an entry', async () => {
    const dir = tempDir()
    const s = new DraftStore(dir)
    await s.load()
    s.set('p1::a.ts', { content: 'x', baseline: 'y' })
    await wait(50)
    s.delete('p1::a.ts')
    await wait(50)
    expect(await new DraftStore(dir).load()).toEqual({})
  })

  it('sanitizes malformed entries on load', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'editor-drafts.json'), JSON.stringify({
      good: { content: 'c', baseline: 'b' },
      bad1: { content: 'c' },              // missing baseline
      bad2: { content: 5, baseline: 'b' }, // wrong type
      bad3: 'nope'
    }), 'utf8')
    expect(await new DraftStore(dir).load()).toEqual({ good: { content: 'c', baseline: 'b' } })
  })

  it('flush writes the current map synchronously', () => {
    const dir = tempDir()
    const s = new DraftStore(dir)
    s.set('p1::a.ts', { content: 'c', baseline: 'b' })
    s.flush()
    expect(existsSync(join(dir, 'editor-drafts.json'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/draft-store.test.ts`
Expected: FAIL — cannot find module `draft-store`.

- [ ] **Step 3: Implement `DraftStore`**

Create `src/main/persistence/draft-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EditorDraft } from '@shared/types'

type DraftMap = Record<string, EditorDraft>

/** Drop any entry that is not a well-formed { content: string, baseline: string }. */
function sanitize(value: unknown): DraftMap {
  const out: DraftMap = {}
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const e = v as Partial<EditorDraft>
      if (e && typeof e.content === 'string' && typeof e.baseline === 'string') {
        out[k] = { content: e.content, baseline: e.baseline }
      }
    }
  }
  return out
}

/** Persists unsaved editor buffers (hot-exit) to editor-drafts.json in userData.
 *  Writes are best-effort and never throw into the editing path. */
export class DraftStore {
  private map: DraftMap = {}

  constructor(private readonly baseDir: string) {}

  private file() { return join(this.baseDir, 'editor-drafts.json') }

  async load(): Promise<DraftMap> {
    try { this.map = sanitize(JSON.parse(await readFile(this.file(), 'utf8'))) }
    catch { this.map = {} }
    return this.map
  }

  set(key: string, draft: EditorDraft): void {
    this.map[key] = { content: draft.content, baseline: draft.baseline }
    void this.persist()
  }

  delete(key: string): void {
    if (!(key in this.map)) return
    delete this.map[key]
    void this.persist()
  }

  /** Synchronous write for shutdown (win 'close'); best-effort. */
  flush(): void {
    try { mkdirSync(this.baseDir, { recursive: true }); writeFileSync(this.file(), JSON.stringify(this.map), 'utf8') }
    catch { /* best-effort on teardown */ }
  }

  private async persist(): Promise<void> {
    try { await mkdir(this.baseDir, { recursive: true }); await writeFile(this.file(), JSON.stringify(this.map), 'utf8') }
    catch { /* best-effort */ }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/draft-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/persistence/draft-store.ts tests/main/draft-store.test.ts
git commit -m "feat(editor): main-process DraftStore for hot-exit"
```

---

## Task 3: IPC contract, preload, and main handlers

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/register.ts`

- [ ] **Step 1: Extend the IPC contract**

In `src/shared/ipc-contract.ts`:

1. Add `EditorDraft` to the type import on line 1 (append `, EditorDraft` to the existing import list from `./types`).
2. Add to the `CH` object (after the `usageMetrics` entry):

```ts
  draftsLoad: 'drafts:load',
  draftsSet: 'drafts:set',
  draftsDelete: 'drafts:delete'
```

(Add a comma after the previous last entry so the object stays valid.)

3. Add to the `TermhallaApi` interface (after `homeDir()`):

```ts
  draftsLoad(): Promise<Record<string, EditorDraft>>
  draftSet(key: string, draft: EditorDraft): void
  draftDelete(key: string): void
```

- [ ] **Step 2: Implement the preload methods**

In `src/preload/index.ts`, add to the `api` object (after the `homeDir` entry):

```ts
  draftsLoad: () => ipcRenderer.invoke(CH.draftsLoad),
  draftSet: (key, draft) => ipcRenderer.send(CH.draftsSet, key, draft),
  draftDelete: (key) => ipcRenderer.send(CH.draftsDelete, key),
```

- [ ] **Step 3: Wire the main handlers**

In `src/main/ipc/register.ts`:

1. Add the import (after the `UsageTracker` import):

```ts
import { DraftStore } from '../persistence/draft-store'
```

2. After the `usage` wiring block (the `win.on('closed', () => usage.dispose())` line), add:

```ts
  const drafts = new DraftStore(userDataDir())
  void drafts.load()
  ipcMain.handle(CH.draftsLoad, () => drafts.load())
  ipcMain.on(CH.draftsSet, (_e, key: string, draft: import('@shared/types').EditorDraft) => drafts.set(key, draft))
  ipcMain.on(CH.draftsDelete, (_e, key: string) => drafts.delete(key))
  win.on('close', () => drafts.flush())
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: builds `out/` cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/register.ts
git commit -m "feat(editor): drafts IPC (load/set/delete) + DraftStore wiring"
```

---

## Task 4: Load drafts into the renderer store

**Files:**
- Modify: `src/renderer/store.ts`

- [ ] **Step 1: Import the type**

In `src/renderer/store.ts`, add `EditorDraft` to the existing `@shared/types` import list (line 3).

- [ ] **Step 2: Add the state field to the `State` interface**

After the `usage`/`setUsage` lines in the `State` interface, add:

```ts
  drafts: Record<string, EditorDraft>
```

- [ ] **Step 3: Add the default**

In the store's initial state object (next to `usage: {}`), add:

```ts
    drafts: {},
```

- [ ] **Step 4: Load drafts in `init`**

In `init`, change the quick/home load line:

```ts
      const [quick, home] = await Promise.all([api.loadQuick(), api.homeDir()])
      set({ quick, home })
```

to:

```ts
      const [quick, home, drafts] = await Promise.all([api.loadQuick(), api.homeDir(), api.draftsLoad()])
      set({ quick, home, drafts })
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store.ts
git commit -m "feat(editor): load persisted drafts into the renderer store on init"
```

---

## Task 5: EditorPane — apply, persist, and clear drafts

**Files:**
- Modify: `src/renderer/components/EditorPane.tsx`

This task has no unit test (it is Monaco/IPC integration); Task 6 covers it end-to-end.

- [ ] **Step 1: Add imports**

In `src/renderer/components/EditorPane.tsx`, add after the existing `@shared/language` import:

```ts
import { draftKey, resolveDraftOnOpen } from '@shared/editor-draft'
```

(`useStore` is already imported.)

- [ ] **Step 2: Add the per-tab draft-persist helpers**

Inside the `EditorPane` component, after the `loading` ref declaration (`const loading = useRef<Set<string>>(new Set())`), add:

```ts
  const draftTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Persist or clear the draft for one tab based on its current dirty state.
  const persistDraft = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (!t || t.tooLarge) return
    const key = draftKey(paneId, path)
    const value = t.model.getValue()
    if (value === t.saved) api.draftDelete(key)
    else api.draftSet(key, { content: value, baseline: t.saved })
  }, [paneId])

  // Debounced persist on edit (mirrors the workspace autosave cadence).
  const scheduleDraftPersist = useCallback((path: string) => {
    const timers = draftTimers.current
    const existing = timers.get(path)
    if (existing) clearTimeout(existing)
    timers.set(path, setTimeout(() => { timers.delete(path); persistDraft(path) }, 500))
  }, [persistDraft])
```

- [ ] **Step 3: Apply a draft on open and persist on edit**

In `openTab`, replace the block from `let saved = ''` through the `tabs.current.set(...)` line. Current code:

```ts
      let saved = '', tooLarge = false, missing = false
      try { const r = await api.fsRead(path); saved = r.content; tooLarge = r.tooLarge }
      catch { missing = true }
      const model = monaco.editor.createModel(tooLarge || missing ? '' : saved, languageForPath(path))
      const disp = model.onDidChangeContent(() => rerender())
      tabs.current.set(path, { path, model, saved, disp, tooLarge, missing })
      api.fsWatch(`${paneId}::${path}`, path)
```

Replace with:

```ts
      let saved = '', tooLarge = false, missing = false
      try { const r = await api.fsRead(path); saved = r.content; tooLarge = r.tooLarge }
      catch { missing = true }
      const key = draftKey(paneId, path)
      const draft = useStore.getState().drafts[key]
      const resolved = tooLarge
        ? { content: '', dirty: false, externalChanged: false }
        : resolveDraftOnOpen(missing ? null : saved, draft)
      const model = monaco.editor.createModel(resolved.content, languageForPath(path))
      const disp = model.onDidChangeContent(() => { rerender(); scheduleDraftPersist(path) })
      tabs.current.set(path, { path, model, saved, disp, tooLarge, missing, externalChanged: resolved.externalChanged || undefined })
      if (draft && !resolved.dirty) api.draftDelete(key)  // stale draft equals disk
      api.fsWatch(key, path)
```

Then add `scheduleDraftPersist` to `openTab`'s dependency array (currently `[rerender, setActiveModel]` → `[rerender, setActiveModel, scheduleDraftPersist]`).

- [ ] **Step 4: Clear the draft on save**

In `saveActive`, after `t.saved = value`, add:

```ts
    api.draftDelete(draftKey(paneId, active))
```

Add `paneId` to `saveActive`'s dependency array (currently `[active, rerender]` → `[active, rerender, paneId]`).

- [ ] **Step 5: Clear the draft on tab close**

In `closeTab`, after `t.disp.dispose(); t.model.dispose(); tabs.current.delete(path)`, add:

```ts
    api.draftDelete(draftKey(paneId, path))
    const dt = draftTimers.current.get(path); if (dt) { clearTimeout(dt); draftTimers.current.delete(path) }
```

Add `paneId` to `closeTab`'s dependency array.

- [ ] **Step 6: Flush drafts on app close; delete this pane's drafts on pane close**

Add this new effect right after the editor-create effect (the one keyed on `[paneId]` that ends with the cleanup clearing `tabs.current`):

```ts
  // Best-effort flush of pending drafts when the whole app is closing.
  useEffect(() => {
    const flush = () => {
      for (const t of draftTimers.current.values()) clearTimeout(t)
      draftTimers.current.clear()
      for (const path of tabs.current.keys()) persistDraft(path)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [persistDraft])
```

Then, in the editor-create effect's cleanup (the `return () => { ... }` that disposes the editor), add a `draftDelete` for each open tab so a removed pane does not leave orphan drafts. Change:

```ts
      for (const t of tabs.current.values()) { api.fsUnwatch(`${paneId}::${t.path}`); t.disp.dispose(); t.model.dispose() }
```

to:

```ts
      for (const t of draftTimers.current.values()) clearTimeout(t)
      draftTimers.current.clear()
      for (const t of tabs.current.values()) { api.fsUnwatch(`${paneId}::${t.path}`); api.draftDelete(draftKey(paneId, t.path)); t.disp.dispose(); t.model.dispose() }
```

> Note: this cleanup runs only when the pane is genuinely removed (closePane) or its workspace is torn down in-session. On app close the renderer is hard-destroyed without running React cleanups, so session drafts survive on disk — that is what makes restart-restore work. (Workspaces stay mounted across tab switches, so switching never triggers this.)

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: builds cleanly.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/EditorPane.tsx
git commit -m "feat(editor): apply/persist/clear unsaved drafts in EditorPane"
```

---

## Task 6: End-to-end — draft survives relaunch (+ disk-conflict)

**Files:**
- Create: `tests/e2e/editor-hot-exit.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/editor-hot-exit.spec.ts` (models `editor.spec.ts` for opening a seeded file and `persistence.spec.ts` for relaunch):

```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(app: ElectronApplication): void {
  const pid = app.process().pid
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

test('restores an unsaved editor draft after relaunch', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-hotexit-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-hotproj-'))
  const file = join(proj, 'hello.ts')
  writeFileSync(file, 'const a = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')

  // Session 1: open the seeded file, type unsaved text, DON'T save.
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('const a = 1', { timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('// UNSAVED-DRAFT\n')
  await expect(win.locator('.view-lines')).toContainText('UNSAVED-DRAFT', { timeout: 10_000 })
  await win.waitForTimeout(900) // let the debounced draftSet flush to disk
  await app.close().catch(() => {}); killTree(app)

  // Session 2: relaunch -> the unsaved draft is restored and the tab is dirty.
  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('UNSAVED-DRAFT', { timeout: 20_000 })
  await expect(win.getByTestId('tab-hello.ts')).toContainText('•', { timeout: 10_000 })
  await app.close().catch(() => {}); killTree(app)
})

test('shows the changed-on-disk bar when a drafted file changed while closed', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-hotexit2-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-hotproj2-'))
  const file = join(proj, 'note.txt')
  writeFileSync(file, 'original\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')

  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('original', { timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('DRAFTED ')
  await win.waitForTimeout(900)
  await app.close().catch(() => {}); killTree(app)

  // Change the file on disk while the app is closed.
  writeFileSync(file, 'changed on disk\n', 'utf8')

  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('DRAFTED', { timeout: 20_000 })
  await expect(win.getByTestId('editor-reloadbar')).toBeVisible({ timeout: 10_000 })
  await app.close().catch(() => {}); killTree(app)
})
```

- [ ] **Step 2: Build, then run the e2e**

Run: `npm run build`
Run: `npx playwright test tests/e2e/editor-hot-exit.spec.ts`
Expected: 2 passed. (If the draft is not restored, confirm the debounce flush window — the 900ms wait — and that `app.close()` triggers the beforeunload/`close` flushes.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/editor-hot-exit.spec.ts
git commit -m "test(editor): e2e for unsaved draft restore + disk-conflict bar"
```

---

## Task 7: Full verification

- [ ] **Step 1: Unit suite**

Run: `npm test`
Expected: all green (existing 190 + 7 editor-draft + 5 draft-store = 202).

- [ ] **Step 2: Full e2e**

Run: `npm run e2e`
Expected: all specs green, including the new `editor-hot-exit.spec.ts`.

- [ ] **Step 3: Update living docs**

- Add a "Hot-exit (unsaved drafts)" section to `docs/features/editor-explorer.md` (drafts store, `paneId::path` key, restore + reload-bar conflict, lifecycle).
- Add an `[Unreleased] → Added` entry to `CHANGELOG.md`: "Unsaved editor buffers now persist across restart (hot-exit)."
- If any decision proved non-obvious during implementation, add an entry to `docs/decisions.md`.

```bash
git add docs/features/editor-explorer.md CHANGELOG.md docs/decisions.md
git commit -m "docs: document editor hot-exit"
```

---

## Self-review notes

- **Spec coverage:** separate store + `editor-drafts.json` (Task 2); `paneId::path` key, `{content, baseline}` (Tasks 1–2); IPC `drafts:load/set/delete` (Task 3); load-on-init (Task 4); apply-on-open via `resolveDraftOnOpen`, debounced persist, delete on save/tab-close/pane-close, beforeunload + `close` flush (Tasks 2,5); reload-bar conflict reuse (Task 5 + e2e Task 6). All spec sections map to a task.
- **Type consistency:** `EditorDraft {content, baseline}` and `draftKey`/`resolveDraftOnOpen` signatures are identical across Tasks 1–6. `draftKey(paneId, path)` equals the existing `` `${paneId}::${path}` `` fs-watch id, so the `fsWatch` call is switched to `key` without behavior change.
- **Non-goals respected:** no cursor/scroll persistence, no untitled buffers, no orphan-draft pruning, whole-map writes.
