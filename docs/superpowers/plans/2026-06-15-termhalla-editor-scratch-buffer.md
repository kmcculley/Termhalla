# Editor Scratch (Untitled) Buffer Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every editor pane one persistent **Untitled** scratch buffer (survives restart, reusing the hot-exit drafts store) that **Ctrl+S** can save to a new file.

**Architecture:** The untitled buffer is a `Tab` in `EditorPane` keyed by a reserved sentinel `UNTITLED` with `saved = ''`, so the existing `persistDraft`/dirty/flush/cleanup machinery persists it under `paneId::UNTITLED` in `editor-drafts.json` — no new store, no `EditorConfig`/schema change. Save-As adds one IPC (`dialog:saveFile`).

**Tech Stack:** Electron + TypeScript, React, Monaco, zustand; vitest + Playwright-for-Electron.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-editor-scratch-buffer-design.md`

---

## Task 1: UNTITLED sentinel (shared, pure)

**Files:**
- Modify: `src/shared/editor-draft.ts`
- Test: `tests/shared/editor-draft.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/shared/editor-draft.test.ts` (new `describe` block; keep existing imports, but update the import line to include the new exports):

Change the import line at the top from:
```ts
import { draftKey, resolveDraftOnOpen } from '../../src/shared/editor-draft'
```
to:
```ts
import { draftKey, resolveDraftOnOpen, UNTITLED, isUntitled } from '../../src/shared/editor-draft'
```

Then append:
```ts
describe('UNTITLED sentinel', () => {
  it('is a non-empty string that cannot be a real path', () => {
    expect(typeof UNTITLED).toBe('string')
    expect(UNTITLED.length).toBeGreaterThan(0)
    expect(UNTITLED).toContain('\u0000') // leading NUL — invalid in filesystem paths
  })
  it('isUntitled matches only the sentinel', () => {
    expect(isUntitled(UNTITLED)).toBe(true)
    expect(isUntitled('C:\\dev\\a.ts')).toBe(false)
    expect(isUntitled('untitled')).toBe(false)
    expect(isUntitled('')).toBe(false)
  })
  it('draftKey works with the sentinel', () => {
    expect(draftKey('p1', UNTITLED)).toBe(`p1::${UNTITLED}`)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/shared/editor-draft.test.ts`
Expected: FAIL — `UNTITLED`/`isUntitled` are not exported.

- [ ] **Step 3: Implement**

In `src/shared/editor-draft.ts`, after the `draftKey` function, add:
```ts
/** Reserved sentinel "path" for a pane's untitled scratch buffer. The leading NUL can never
 *  appear in a real filesystem path, so this never collides with a file tab's key. */
export const UNTITLED = '\u0000untitled'

export function isUntitled(path: string): boolean {
  return path === UNTITLED
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/shared/editor-draft.test.ts`
Expected: PASS (existing 7 + 3 new).

- [ ] **Step 5: Commit**
```bash
git add src/shared/editor-draft.ts tests/shared/editor-draft.test.ts
git commit -m "feat(editor): UNTITLED sentinel + isUntitled"
```

---

## Task 2: Save-file dialog IPC

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/register.ts`

- [ ] **Step 1: Extend the contract**

In `src/shared/ipc-contract.ts`:
- In `CH`, after `dialogOpenFile: 'dialog:openFile',` add:
```ts
  dialogSaveFile: 'dialog:saveFile',
```
- In `TermhallaApi`, after `openFile(): Promise<string | null>` add:
```ts
  saveFileDialog(): Promise<string | null>
```

- [ ] **Step 2: Implement the preload method**

In `src/preload/index.ts`, after the `openFile` entry, add:
```ts
  saveFileDialog: () => ipcRenderer.invoke(CH.dialogSaveFile),
```

- [ ] **Step 3: Wire the main handler**

In `src/main/ipc/register.ts`, after the `ipcMain.handle(CH.dialogOpenFile, …)` block (ends at the `})` before `revealPath`), add:
```ts
  ipcMain.handle(CH.dialogSaveFile, async () => {
    // Test hook: hermetic e2e can't drive a native dialog (mirrors TERMHALLA_CLAUDE_HOME).
    if (process.env.TERMHALLA_SAVE_PATH) return process.env.TERMHALLA_SAVE_PATH
    const r = await dialog.showSaveDialog(win, {})
    return r.canceled || !r.filePath ? null : r.filePath
  })
```
(`dialog` is already imported in `register.ts`.)

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck` → no errors.
Run: `npm run build` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/register.ts
git commit -m "feat(editor): dialog:saveFile IPC (+ TERMHALLA_SAVE_PATH test hook)"
```

---

## Task 3: EditorPane — the Untitled scratch tab

**Files:**
- Modify: `src/renderer/components/EditorPane.tsx`

No new unit test (Monaco/IPC integration); Task 5 covers it end-to-end.

- [ ] **Step 1: Import the sentinel helpers**

Change the import on line 4 from:
```ts
import { draftKey, resolveDraftOnOpen } from '@shared/editor-draft'
```
to:
```ts
import { draftKey, resolveDraftOnOpen, UNTITLED, isUntitled } from '@shared/editor-draft'
```

- [ ] **Step 2: Persist `activePath` as undefined when the untitled tab is active**

In `setActiveModel`, change:
```ts
    persistRef.current(orderRef.current, path)
```
to:
```ts
    persistRef.current(orderRef.current, isUntitled(path) ? undefined : path)
```

- [ ] **Step 3: Add a `clearUntitled` helper**

Immediately after `scheduleDraftPersist` (after its closing `}, [persistDraft])`), add:
```ts
  // Clear the untitled scratch buffer (the × on its tab) and drop its persisted draft.
  const clearUntitled = useCallback(() => {
    const t = tabs.current.get(UNTITLED)
    if (!t) return
    applyContent(t.model, '')
    api.draftDelete(draftKey(paneId, UNTITLED))
    const dt = draftTimers.current.get(UNTITLED); if (dt) { clearTimeout(dt); draftTimers.current.delete(UNTITLED) }
    if (active === UNTITLED) { const f = orderRef.current[0]; if (f) setActiveModel(f) }
    rerender()
  }, [active, paneId, setActiveModel, rerender])
```

- [ ] **Step 4: Create the untitled model on mount**

In the editor-create `useEffect` (keyed `[paneId]`), after the `ed.addCommand(...)` line and before the `return () => {` cleanup, add:
```ts
    // One persistent untitled scratch buffer per pane (saved='' so the existing dirty/persist
    // logic treats any non-empty content as a draft). Seeded from the loaded drafts map.
    const untitledModel = monaco.editor.createModel(
      useStore.getState().drafts[draftKey(paneId, UNTITLED)]?.content ?? '', 'plaintext'
    )
    const untitledDisp = untitledModel.onDidChangeContent(() => { rerender(); scheduleDraftPersist(UNTITLED) })
    tabs.current.set(UNTITLED, { path: UNTITLED, model: untitledModel, saved: '', disp: untitledDisp, tooLarge: false, missing: false })
    if (config.files.length === 0) setActiveModel(UNTITLED)
```
(The existing cleanup loop iterates `tabs.current`, so it already disposes the untitled model and deletes its draft on pane removal; `fsUnwatch` on the never-watched untitled key is a harmless no-op.)

- [ ] **Step 5: Render the Untitled tab**

In the tab strip `<div data-testid="editor-tabs" …>`, immediately after the opening tag and before the `{order.length === 0 && (` block, add:
```tsx
        {(() => {
          const ut = tabs.current.get(UNTITLED)
          const content = ut?.model.getValue() ?? ''
          if (order.length !== 0 && content === '') return null
          return (
            <div data-testid="tab-untitled" onClick={() => setActiveModel(UNTITLED)}
              style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 8px', cursor: 'pointer',
                background: active === UNTITLED ? '#333' : 'transparent', color: '#ddd', whiteSpace: 'nowrap' }}>
              <span>Untitled{content !== '' ? ' •' : ''}</span>
              {order.length > 0 && (
                <button data-testid="tab-close-untitled" onClick={e => { e.stopPropagation(); clearUntitled() }}>×</button>
              )}
            </div>
          )
        })()}
```

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck` → no errors.
Run: `npm run build` → clean.

- [ ] **Step 7: Commit**
```bash
git add src/renderer/components/EditorPane.tsx
git commit -m "feat(editor): persistent untitled scratch tab per editor pane"
```

---

## Task 4: EditorPane — Save As (untitled → file)

**Files:**
- Modify: `src/renderer/components/EditorPane.tsx`

- [ ] **Step 1: Add `saveUntitledAs`**

Immediately before the `const saveActive = useCallback(` declaration, add:
```ts
  // Save the untitled scratch buffer to a new file: write it, drop its draft, clear it,
  // and open the saved file as a normal (clean) tab.
  const saveUntitledAs = useCallback(async () => {
    const t = tabs.current.get(UNTITLED)
    if (!t) return
    const content = t.model.getValue()
    const path = await api.saveFileDialog()
    if (!path) return
    await api.fsWrite(path, content)
    api.draftDelete(draftKey(paneId, UNTITLED))
    const dt = draftTimers.current.get(UNTITLED); if (dt) { clearTimeout(dt); draftTimers.current.delete(UNTITLED) }
    applyContent(t.model, '')
    await openTab(path)
    rerender()
  }, [paneId, openTab, rerender])
```

- [ ] **Step 2: Branch `saveActive` for the untitled tab**

In `saveActive`, change the opening:
```ts
  const saveActive = useCallback(async () => {
    if (!active) return
    const t = tabs.current.get(active)
```
to:
```ts
  const saveActive = useCallback(async () => {
    if (!active) return
    if (isUntitled(active)) { await saveUntitledAs(); return }
    const t = tabs.current.get(active)
```
and add `saveUntitledAs` to `saveActive`'s dependency array (`[active, rerender, paneId]` → `[active, rerender, paneId, saveUntitledAs]`).

- [ ] **Step 3: Add a "Save As…" button on the active untitled tab**

In the Untitled tab JSX added in Task 3, change the inner content so a Save As button shows when the untitled tab is active. Replace:
```tsx
              <span>Untitled{content !== '' ? ' •' : ''}</span>
              {order.length > 0 && (
                <button data-testid="tab-close-untitled" onClick={e => { e.stopPropagation(); clearUntitled() }}>×</button>
              )}
```
with:
```tsx
              <span>Untitled{content !== '' ? ' •' : ''}</span>
              {active === UNTITLED && content !== '' && (
                <button data-testid="untitled-saveas" title="Save As…"
                  onClick={e => { e.stopPropagation(); void saveUntitledAs() }}>Save As…</button>
              )}
              {order.length > 0 && (
                <button data-testid="tab-close-untitled" onClick={e => { e.stopPropagation(); clearUntitled() }}>×</button>
              )}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck` → no errors (the Save As button references `saveUntitledAs`, which must be declared above the return — it is, as a component-level `useCallback`).
Run: `npm run build` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/renderer/components/EditorPane.tsx
git commit -m "feat(editor): Save As for the untitled scratch buffer"
```

---

## Task 5: End-to-end

**Files:**
- Create: `tests/e2e/editor-scratch.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/editor-scratch.spec.ts`:
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string, env?: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, ...(env ?? {}) }
  })
}

test('restores an untitled scratch buffer after relaunch', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-scratch-'))
  // Editor pane with NO file open — the scratch case.
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [], activePath: undefined } }], 'p1')

  // Session 1: type into the untitled buffer, do NOT save.
  let app = await launch(userData)
  let win = await app.firstWindow()
  await expect(win.getByTestId('tab-untitled')).toBeVisible({ timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.type('scratch-note-9911\n')
  await expect(win.locator('.view-lines')).toContainText('scratch-note-9911', { timeout: 10_000 })
  await win.waitForTimeout(900) // debounce flush
  let pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)

  // Session 2: relaunch (same userData, NOT re-seeded) -> scratch restored, tab dirty.
  app = await launch(userData)
  win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('scratch-note-9911', { timeout: 20_000 })
  await expect(win.getByTestId('tab-untitled')).toContainText('•', { timeout: 10_000 })
  pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('Save As turns an untitled buffer into a real file', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-scratch2-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-scratchproj-'))
  const target = join(proj, 'saved-note.txt')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [], activePath: undefined } }], 'p1')

  const app = await launch(userData, { TERMHALLA_SAVE_PATH: target })
  const win = await app.firstWindow()
  await expect(win.getByTestId('tab-untitled')).toBeVisible({ timeout: 20_000 })
  await win.locator('.view-lines').first().click()
  await win.keyboard.type('save-me-4242')
  await expect(win.getByTestId('untitled-saveas')).toBeVisible({ timeout: 10_000 })
  await win.keyboard.press('Control+S')

  // The file is written, and a real file tab appears.
  await expect.poll(() => { try { return readFileSync(target, 'utf8') } catch { return '' } },
    { timeout: 10_000 }).toContain('save-me-4242')
  await expect(win.getByTestId('tab-saved-note.txt')).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 2: Build, then run**

Run: `npm run build`
Run: `npx playwright test tests/e2e/editor-scratch.spec.ts`
Expected: 2 passed. If `seedWorkspace`'s pane config rejects `activePath: undefined`, omit the field instead (`config: { kind: 'editor', files: [] }`).

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/editor-scratch.spec.ts
git commit -m "test(editor): e2e for untitled scratch restore + Save As"
```

---

## Task 6: Full verification + docs

- [ ] **Step 1: Unit + e2e**

Run: `npm test` → all green (202 + 3 new = 205).
Run: `npm run e2e` → all green incl. `editor-scratch.spec.ts`.

- [ ] **Step 2: Docs**

- Add a "Scratch / Untitled buffer" subsection to `docs/features/editor-explorer.md` (untitled tab, persists via the drafts store, Save As, `dialog:saveFile`).
- Add an `[Unreleased] → Added` entry to `CHANGELOG.md`: "Editor panes now have a persistent Untitled scratch buffer (survives restart; Ctrl+S → Save As)."
- Add a decision-log entry to `docs/decisions.md` if anything non-obvious arose (e.g. the sentinel-with-`saved:''` reuse of the drafts machinery).

```bash
git add docs/features/editor-explorer.md CHANGELOG.md docs/decisions.md
git commit -m "docs: document the untitled scratch buffer"
```

---

## Self-review notes

- **Spec coverage:** sentinel + `isUntitled` (Task 1); `dialog:saveFile` + test hook (Task 2); untitled model create/persist/restore/visibility/clear + activePath-undefined (Task 3); Save As flow (Task 4); scratch-restore + Save-As e2e (Task 5). All spec sections map to a task.
- **Reuse correctness:** the untitled tab is a `Tab` with `saved: ''`, so `persistDraft` (delete-when-empty / set-otherwise), the `beforeunload` flush, and the pane-close cleanup all operate on it unchanged via `tabs.current`. No change to file-tab hot-exit behavior.
- **Type consistency:** `UNTITLED`/`isUntitled` from `@shared/editor-draft` used identically in EditorPane and tests; `saveUntitledAs` is declared above both `saveActive` and the return so it's in scope for the dependency array and the button.
- **Non-goals respected:** one scratch per pane, plaintext, no cursor/scroll persistence.
