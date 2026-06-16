# UI Polish Phase 2 — Feedback & micro-QoL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-renderer toast system, a file-explorer context menu (copy/reveal/rename/recoverable-delete), auto-focus the two passphrase inputs, and explorer/EnvManager empty/error states.

**Architecture:** A pure `toasts` zustand slice + a `Toasts` component (timers in the component, store stays pure), wired at call sites. The explorer context menu reuses the `ws-menu` pattern and three new fs IPC channels (`fs:rename`, `fs:trash` → Recycle Bin, `fs:revealItem`) plus a pure `relativeTo` helper. Two independently-shippable stages: renderer-only feedback first (Tasks 1–5), then explorer + fs IPC (Tasks 6–10).

**Tech Stack:** React + zustand slices + inline-style/CSS tokens; Electron `shell.trashItem`/`showItemInFolder`; vitest (unit), Playwright-for-Electron (e2e).

---

## File Structure

- `src/renderer/store/toasts-slice.ts` — **new** — `toasts` state + `pushToast`/`dismissToast`.
- `src/renderer/components/Toasts.tsx` — **new** — bottom-right stack, per-toast auto-dismiss.
- `src/renderer/store/types.ts` — `Toast`, `ToastKind`, slice actions on `State`.
- `src/renderer/store.ts` — initial `toasts: []` + compose slice.
- `src/renderer/App.tsx` — render `<Toasts/>`.
- Call sites: `TemplatesMenu`, `ThemeEditor`, `SshConnectionForm`, `ScheduleDialog`, `EnvManager`.
- `src/shared/paths.ts` — **+** `relativeTo`.
- `src/shared/ipc-contract.ts` — 3 channels + 3 `TermhallaApi` methods.
- `src/preload/index.ts` — 3 bridge methods.
- `src/main/fs/files.ts` — **+** `renamePath`.
- `src/main/ipc/register-fs.ts` — 3 handlers.
- `src/renderer/components/ExplorerPane.tsx` — context menu, inline rename, empty/error.
- Tests: `tests/toasts-slice.test.ts`, `tests/paths.test.ts` (extend), `tests/fs-rename.test.ts`, `tests/e2e/ui-polish.spec.ts` (extend).

---

## STAGE 1 — Renderer-only feedback (Tasks 1–5)

### Task 1: Toasts slice (pure)

**Files:**
- Create: `src/renderer/store/toasts-slice.ts`
- Modify: `src/renderer/store/types.ts`
- Test: `tests/toasts-slice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/toasts-slice.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createToastsSlice } from '../src/renderer/store/toasts-slice'

// Minimal harness: a stand-in store whose state the slice mutates via set/get.
function harness() {
  let state: any = { toasts: [] }
  const set = (fn: any) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  const get = () => state
  const slice = createToastsSlice({ set, get } as any)
  return { slice, get }
}

describe('toasts slice', () => {
  it('pushToast appends a toast and returns its id', () => {
    const { slice, get } = harness()
    const id = slice.pushToast('Saved', 'success')
    expect(typeof id).toBe('string')
    expect(get().toasts).toHaveLength(1)
    expect(get().toasts[0]).toMatchObject({ id, text: 'Saved', kind: 'success' })
  })

  it('defaults kind to success', () => {
    const { slice, get } = harness()
    slice.pushToast('Hi')
    expect(get().toasts[0].kind).toBe('success')
  })

  it('dismissToast removes by id', () => {
    const { slice, get } = harness()
    const id = slice.pushToast('Bye')
    slice.dismissToast(id)
    expect(get().toasts).toHaveLength(0)
  })

  it('caps the stack at the 4 most-recent', () => {
    const { slice, get } = harness()
    for (let i = 0; i < 6; i++) slice.pushToast(`t${i}`)
    expect(get().toasts).toHaveLength(4)
    expect(get().toasts.map((t: any) => t.text)).toEqual(['t2', 't3', 't4', 't5'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- toasts-slice`
Expected: FAIL — cannot find module `toasts-slice`.

- [ ] **Step 3: Add types to `store/types.ts`**

Add near the top (after the imports), exported:

```ts
export type ToastKind = 'success' | 'error' | 'info'
export interface Toast { id: string; kind: ToastKind; text: string }
```

Add to the `State` interface (alongside the other transient-UI fields):

```ts
  toasts: Toast[]
  pushToast: (text: string, kind?: ToastKind) => string
  dismissToast: (id: string) => void
```

- [ ] **Step 4: Create the slice**

```ts
// src/renderer/store/toasts-slice.ts
import { v4 as uuid } from 'uuid'
import type { State, SliceDeps, Toast, ToastKind } from './types'

type ToastsSlice = Pick<State, 'toasts' | 'pushToast' | 'dismissToast'>

/** Ephemeral bottom-right notifications. Pure: auto-dismiss timers live in the Toasts
 *  component, never here, so the store has no side effects to test around. Capped so a
 *  burst of saves can't grow the stack unbounded. */
const MAX_TOASTS = 4

export function createToastsSlice({ set }: SliceDeps): ToastsSlice {
  return {
    toasts: [],
    pushToast: (text, kind: ToastKind = 'success') => {
      const id = uuid()
      const toast: Toast = { id, kind, text }
      set(s => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }))
      return id
    },
    dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- toasts-slice && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store/toasts-slice.ts src/renderer/store/types.ts tests/toasts-slice.test.ts
git commit -m "feat(renderer): pure toasts store slice"
```

---

### Task 2: Compose the slice + initial state

**Files:**
- Modify: `src/renderer/store.ts`

- [ ] **Step 1: Import + compose**

In `src/renderer/store.ts`, add the import next to the other slice imports:

```ts
import { createToastsSlice } from './store/toasts-slice'
```

Add `toasts: [],` to the initial-state block (right after `connectionFormFor: null,`).

Add the slice to the `// ---- domain slices ----` spread block:

```ts
    ...createThemeSlice(deps),
    ...createRuntimeSlice(deps),
    ...createQuickSlice(deps),
    ...createScheduleSlice(deps),
    ...createToastsSlice(deps),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (the `State` additions from Task 1 are now satisfied).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/store.ts
git commit -m "feat(renderer): compose toasts slice into the store"
```

---

### Task 3: Toasts component

**Files:**
- Create: `src/renderer/components/Toasts.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/Toasts.tsx
import { useEffect } from 'react'
import { useStore } from '../store'
import { SURFACE } from './Modal'
import type { Toast } from '../store/types'

const ACCENT: Record<Toast['kind'], string> = {
  success: 'var(--accent, #1e88e5)',
  error: 'var(--status-needs, #ff8f00)',
  info: 'var(--border, #444)'
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore(s => s.dismissToast)
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id, dismiss])
  return (
    <div data-testid="toast" className="ui-pop-in" onClick={() => dismiss(toast.id)}
      style={{ ...SURFACE, pointerEvents: 'auto', cursor: 'pointer', padding: '6px 10px',
        borderLeft: `3px solid ${ACCENT[toast.kind]}`, maxWidth: 320,
        fontSize: 'var(--font-size, 13px)' }}>
      {toast.text}
    </div>
  )
}

/** Bottom-right transient notifications. The container ignores pointer events so it never
 *  blocks the app beneath; each card re-enables them to be click-dismissable. */
export function Toasts() {
  const toasts = useStore(s => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div data-testid="toasts" style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 2000,
      display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}
```

- [ ] **Step 2: Render it in `App.tsx`**

Add the import:

```ts
import { Toasts } from './components/Toasts'
```

Render it just before `<BroadcastDialog />`:

```tsx
      <Toasts />
      <BroadcastDialog />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Toasts.tsx src/renderer/App.tsx
git commit -m "feat(renderer): bottom-right toast stack with auto-dismiss"
```

---

### Task 4: Wire toasts into non-explorer call sites

**Files:**
- Modify: `src/renderer/components/TemplatesMenu.tsx`, `ThemeEditor.tsx`, `SshConnectionForm.tsx`, `ScheduleDialog.tsx`, `EnvManager.tsx`

For each, read `pushToast` from the store and call it after the action. Add
`const pushToast = useStore(s => s.pushToast)` where the component already calls `useStore`.

- [ ] **Step 1: TemplatesMenu**

In `TemplatesMenu.tsx`, after `saveTemplate(name)` (the `tpl-save` button onClick) add
`pushToast('Template saved')`; in the delete button (`tpl-del-*`) onClick add
`pushToast('Template deleted')`. Example for save:

```tsx
            onClick={() => { saveTemplate(name); pushToast('Template saved'); setName('') }}>Save current</button>
```

- [ ] **Step 2: ThemeEditor**

In `ThemeEditor.tsx`, find the save-preset and delete-preset handlers (they call
`saveThemePreset` / `deleteThemePreset`). After save add `pushToast('Preset saved')`;
after delete add `pushToast('Preset deleted')`. Do NOT toast on apply.

- [ ] **Step 3: SshConnectionForm**

In `SshConnectionForm.tsx`, in the Save / Save & Connect handlers after `saveConnection(...)`
add `pushToast('Connection saved')`.

- [ ] **Step 4: ScheduleDialog**

In `ScheduleDialog.tsx`, in `add()` after `addSchedule(...)` add `pushToast('Command scheduled')`;
in the cancel button (`schedule-cancel-*`) after `cancelSchedule(t.id)` add
`pushToast('Schedule canceled')`.

- [ ] **Step 5: EnvManager**

In `EnvManager.tsx`: in `add()` after `api.envSetGlobal(...)` add `pushToast('Variable added')`;
in `addTerminalVar()` after `api.envSetTerminal(...)` add `pushToast('Variable added')`;
in `create()` after `await api.envCreate(passphrase)` add `pushToast('Vault created')`.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/renderer/components/
git commit -m "feat(renderer): confirm discrete saves with toasts"
```

---

### Task 5: EnvManager autofocus + loading state

**Files:**
- Modify: `src/renderer/components/EnvManager.tsx`

- [ ] **Step 1: Autofocus both passphrase inputs**

Add `autoFocus` to the create-passphrase input (the one whose `onKeyDown` calls `create()`)
and the unlock-passphrase input (whose `onKeyDown` calls `unlock()`):

```tsx
            <input data-testid="env-passphrase" type="password" autoFocus value={passphrase}
```

(Apply to both — only one renders at a time, so no conflict.)

- [ ] **Step 2: Loading line**

In the `env.unlocked` block, right after the "Global variables" header, show a loading line
while `data` hasn't arrived:

```tsx
            {data === null && <div data-testid="env-loading" style={{ color: 'var(--fg-dim, #aaa)' }}>Loading…</div>}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/renderer/components/EnvManager.tsx
git commit -m "feat(renderer): autofocus env passphrase + loading state"
```

---

## STAGE 2 — Explorer context menu + fs IPC (Tasks 6–10)

### Task 6: `relativeTo` pure helper

**Files:**
- Modify: `src/shared/paths.ts`
- Test: `tests/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/paths.test.ts` (create the file with this content if it doesn't exist):

```ts
import { describe, it, expect } from 'vitest'
import { relativeTo } from '../src/shared/paths'

describe('relativeTo', () => {
  it('strips a backslash root', () => {
    expect(relativeTo('C:\\proj', 'C:\\proj\\src\\a.ts')).toBe('src\\a.ts')
  })
  it('strips a forward-slash root', () => {
    expect(relativeTo('/home/p', '/home/p/src/a.ts')).toBe('src/a.ts')
  })
  it('tolerates a trailing separator on root', () => {
    expect(relativeTo('C:\\proj\\', 'C:\\proj\\a.ts')).toBe('a.ts')
  })
  it('returns empty for the root itself', () => {
    expect(relativeTo('C:\\proj', 'C:\\proj')).toBe('')
  })
  it('returns the input unchanged when not under root', () => {
    expect(relativeTo('C:\\proj', 'D:\\other\\a.ts')).toBe('D:\\other\\a.ts')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- paths`
Expected: FAIL — `relativeTo` is not exported.

- [ ] **Step 3: Implement**

Append to `src/shared/paths.ts`:

```ts
/** Path of `p` relative to `root`, with either separator and an optional trailing
 *  separator on `root`. Exact match → ''. Not under root → `p` unchanged. */
export function relativeTo(root: string, p: string): string {
  const r = root.replace(/[\\/]+$/, '')
  if (p === r) return ''
  if (p.startsWith(r + '\\') || p.startsWith(r + '/')) return p.slice(r.length + 1)
  return p
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- paths && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/paths.ts tests/paths.test.ts
git commit -m "feat(shared): relativeTo path helper"
```

---

### Task 7: `renamePath` in main fs

**Files:**
- Modify: `src/main/fs/files.ts`
- Test: `tests/fs-rename.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/fs-rename.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renamePath } from '../src/main/fs/files'

describe('renamePath', () => {
  it('renames a file in place', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rn-'))
    const a = join(d, 'a.txt'); const b = join(d, 'b.txt')
    writeFileSync(a, 'hi', 'utf8')
    await renamePath(a, b)
    expect(existsSync(a)).toBe(false)
    expect(readFileSync(b, 'utf8')).toBe('hi')
  })

  it('rejects when the source is missing', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rn2-'))
    await expect(renamePath(join(d, 'nope.txt'), join(d, 'x.txt'))).rejects.toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- fs-rename`
Expected: FAIL — `renamePath` not exported.

- [ ] **Step 3: Implement**

Add to `src/main/fs/files.ts` — first extend the import on line 1:

```ts
import { readFile, writeFile, readdir, stat, rename } from 'node:fs/promises'
```

Then append:

```ts
/** Rename/move a file or directory. Rejects (caller surfaces an error toast) if the source
 *  is missing or the target exists — node's rename throws on a cross-device move too. */
export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- fs-rename && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/fs/files.ts tests/fs-rename.test.ts
git commit -m "feat(main): renamePath fs helper"
```

---

### Task 8: New fs IPC channels (contract → preload → main)

**Files:**
- Modify: `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc/register-fs.ts`

- [ ] **Step 1: Channel constants**

In `src/shared/ipc-contract.ts`, in the `CH` object after `fsStat: 'fs:stat',` add:

```ts
  fsRename: 'fs:rename',
  fsTrash: 'fs:trash',
  fsRevealItem: 'fs:revealItem',
```

- [ ] **Step 2: `TermhallaApi` methods**

In the same file, after `revealPath(path: string): Promise<void>` add:

```ts
  fsRename(oldPath: string, newPath: string): Promise<void>
  fsTrash(path: string): Promise<void>
  fsRevealItem(path: string): Promise<void>
```

- [ ] **Step 3: Preload bridge**

In `src/preload/index.ts`, after the `revealPath:` line add:

```ts
  fsRename: (oldPath, newPath) => ipcRenderer.invoke(CH.fsRename, oldPath, newPath),
  fsTrash: (path) => ipcRenderer.invoke(CH.fsTrash, path),
  fsRevealItem: (path) => ipcRenderer.invoke(CH.fsRevealItem, path),
```

- [ ] **Step 4: Main handlers**

In `src/main/ipc/register-fs.ts`, extend the imports:

```ts
import { readTextFile, writeTextFile, readDirectory, statPath, renamePath } from '../fs/files'
```

After the `CH.revealPath` handler (line ~36) add:

```ts
  ipcMain.handle(CH.fsRename, (_e, oldPath: string, newPath: string) => renamePath(oldPath, newPath))
  ipcMain.handle(CH.fsTrash, (_e, path: string) => shell.trashItem(path))
  ipcMain.handle(CH.fsRevealItem, (_e, path: string) => { shell.showItemInFolder(path) })
```

(`shell` is already imported in `register-fs.ts`.)

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean build (verifies preload + main + contract agree).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/register-fs.ts
git commit -m "feat(ipc): fs rename/trash/revealItem channels"
```

---

### Task 9: Explorer context menu + inline rename + empty/error

**Files:**
- Modify: `src/renderer/components/ExplorerPane.tsx`

This is the largest UI change. ExplorerPane currently renders rows via `renderDir(dir, depth)`.

- [ ] **Step 1: Imports + state**

Add imports:

```tsx
import { api } from '../api'   // already imported
import { relativeTo } from '@shared/paths'
import { Z, SURFACE } from './Modal'
```

Add `pushToast` from the store and local state inside the component:

```tsx
  const pushToast = useStore(s => s.pushToast)
  const [menu, setMenu] = useState<{ entry: DirEntry; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)  // path being renamed
  const [renameText, setRenameText] = useState('')
  const [errored, setErrored] = useState<Set<string>>(new Set())
```

- [ ] **Step 2: Track read errors in `loadDir`**

Change `loadDir`'s catch to record the errored dir:

```tsx
  const loadDir = useCallback(async (dir: string) => {
    try {
      const entries = await api.fsReadDir(dir)
      setChildren(c => ({ ...c, [dir]: entries }))
      setErrored(e => { if (!e.has(dir)) return e; const n = new Set(e); n.delete(dir); return n })
    } catch {
      setErrored(e => new Set(e).add(dir))
      setChildren(c => ({ ...c, [dir]: [] }))
    }
    if (!watchedRef.current.has(dir)) { api.fsWatch(`${paneId}::${dir}`, dir); watchedRef.current.add(dir) }
  }, [paneId])
```

- [ ] **Step 3: Rename commit + delete handlers**

Add inside the component:

```tsx
  const commitRename = async (entry: DirEntry) => {
    const name = renameText.trim()
    setRenaming(null)
    if (!name || name === entry.name) return
    const parent = entry.path.slice(0, entry.path.length - entry.name.length)
    try { await api.fsRename(entry.path, parent + name); pushToast('Renamed') }
    catch { pushToast('Rename failed', 'error') }
  }

  const del = async (entry: DirEntry) => {
    setMenu(null)
    if (!window.confirm(`Move "${entry.name}" to the Recycle Bin?`)) return
    try { await api.fsTrash(entry.path); pushToast('Moved to Recycle Bin') }
    catch { pushToast('Delete failed', 'error') }
  }
```

- [ ] **Step 4: Row rendering — context menu + inline rename**

Replace the `renderDir` row `<div data-testid={`entry-...`}>` element so it (a) opens the
menu on right-click and (b) becomes an input when renaming:

```tsx
  const renderDir = (dir: string, depth: number) => {
    const entries = children[dir] ?? []
    if (errored.has(dir)) return <div style={{ paddingLeft: depth * INDENT_PX + 6, color: 'var(--fg-dim, #aaa)' }}>Couldn't read folder</div>
    if (expanded.has(dir) && entries.length === 0) return <div style={{ paddingLeft: depth * INDENT_PX + 6, color: 'var(--fg-dim, #aaa)' }}>Folder is empty</div>
    return entries.map(e => (
      <div key={e.path}>
        {renaming === e.path ? (
          <input data-testid={`rename-${base(e.path)}`} autoFocus value={renameText}
            onFocus={ev => ev.currentTarget.select()}
            onChange={ev => setRenameText(ev.target.value)}
            onKeyDown={ev => { if (ev.key === 'Enter') void commitRename(e); else if (ev.key === 'Escape') setRenaming(null) }}
            onBlur={() => void commitRename(e)}
            style={{ marginLeft: depth * INDENT_PX + 6, width: 160 }} />
        ) : (
          <div data-testid={`entry-${base(e.path)}`}
            onClick={() => e.isDir ? toggle(e.path) : openFileInEditor(wsId, e.path)}
            onContextMenu={ev => { ev.preventDefault(); setMenu({ entry: e, x: ev.clientX, y: ev.clientY }) }}
            style={{ paddingLeft: depth * INDENT_PX + 6, cursor: 'pointer', color: 'var(--fg, #ddd)', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {e.isDir ? (expanded.has(e.path) ? '▾ ' : '▸ ') : '  '}{e.name}
          </div>
        )}
        {e.isDir && expanded.has(e.path) && renderDir(e.path, depth + 1)}
      </div>
    ))
  }
```

(Note: the empty/error rows render only for *expanded* dirs; the root is always expanded.)

- [ ] **Step 5: The menu element**

Just before the closing `</div>` of the explorer root return, add the menu (mirrors `ws-menu`):

```tsx
      {menu && (
        <>
          <div onClick={() => setMenu(null)} onContextMenu={ev => { ev.preventDefault(); setMenu(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: Z.menu }} />
          <div data-testid="explorer-menu"
            style={{ ...SURFACE, position: 'fixed', left: menu.x, top: menu.y, zIndex: Z.menu + 1, padding: 4,
              display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--font-size, 13px)' }}>
            {!menu.entry.isDir && <button data-testid="explorer-open" onClick={() => { openFileInEditor(wsId, menu.entry.path); setMenu(null) }}>Open</button>}
            <button data-testid="explorer-reveal" onClick={() => { void api.fsRevealItem(menu.entry.path); setMenu(null) }}>Reveal in File Explorer</button>
            <button data-testid="explorer-copy-path" onClick={() => { api.clipboardWrite(menu.entry.path); pushToast('Path copied'); setMenu(null) }}>Copy path</button>
            <button data-testid="explorer-copy-rel" onClick={() => { api.clipboardWrite(relativeTo(config.root, menu.entry.path)); pushToast('Path copied'); setMenu(null) }}>Copy relative path</button>
            <button data-testid="explorer-rename" onClick={() => { setRenameText(menu.entry.name); setRenaming(menu.entry.path); setMenu(null) }}>Rename</button>
            <button data-testid="explorer-delete" onClick={() => void del(menu.entry)}>Delete</button>
          </div>
        </>
      )}
```

- [ ] **Step 6: Verify `useState` is imported**

`ExplorerPane.tsx` already imports `useState` (line 1: `import { useEffect, useRef, useState, useCallback } from 'react'`). Confirm `DirEntry` is imported (it is, line 6).

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/ExplorerPane.tsx
git commit -m "feat(renderer): explorer context menu (reveal/copy/rename/trash) + empty/error states"
```

---

### Task 10: e2e + full verification

**Files:**
- Modify: `tests/e2e/ui-polish.spec.ts`

- [ ] **Step 1: Add the e2e tests**

Append to `tests/e2e/ui-polish.spec.ts` (it already imports `seedWorkspace`, `writeFileSync`,
`readFileSync`, `mkdtempSync`, `launch`, `killTree`; add `existsSync` to the `node:fs` import
and `mkdirSync` if needed):

```ts
test('toast appears when saving a workspace template', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol6-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('templates-button').click()
  await win.getByTestId('tpl-name').fill('My Tpl')
  await win.getByTestId('tpl-save').click()
  await expect(win.getByTestId('toast')).toContainText('Template saved', { timeout: 5_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('explorer context menu renames and trashes a file', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol7-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-pol7-proj-'))
  const f = join(proj, 'old.txt'); writeFileSync(f, 'x', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'explorer', root: proj } }], 'p1')
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('entry-old.txt')).toBeVisible({ timeout: 15_000 })

  // rename old.txt -> new.txt
  await win.getByTestId('entry-old.txt').click({ button: 'right' })
  await win.getByTestId('explorer-rename').click()
  const input = win.getByTestId('rename-old.txt')
  await input.fill('new.txt')
  await input.press('Enter')
  await expect(win.getByTestId('entry-new.txt')).toBeVisible({ timeout: 10_000 })
  expect(existsSync(join(proj, 'new.txt'))).toBe(true)
  expect(existsSync(f)).toBe(false)

  // delete new.txt (auto-accept the confirm)
  await win.evaluate(() => { (globalThis as unknown as { confirm: () => boolean }).confirm = () => true })
  await win.getByTestId('entry-new.txt').click({ button: 'right' })
  await win.getByTestId('explorer-delete').click()
  await expect(win.getByTestId('entry-new.txt')).toHaveCount(0, { timeout: 10_000 })
  expect(existsSync(join(proj, 'new.txt'))).toBe(false)

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('env manager autofocuses the passphrase input', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-pol8-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })
  await win.getByTestId('env-button').click()
  await expect(win.getByTestId('env-passphrase')).toBeFocused({ timeout: 10_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 2: Add `existsSync` to the node:fs import**

Top of `tests/e2e/ui-polish.spec.ts`, change the `node:fs` import to include `existsSync`:

```ts
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
```

- [ ] **Step 3: Build + run the new e2e**

Run: `npm run build && npm run e2e -- ui-polish.spec.ts`
Expected: all pass (the 3 new + 5 existing). If the rename/delete tree assertions flake on
watch latency, bump the per-assertion timeout; do not weaken the disk-state assertions.

- [ ] **Step 4: Full verification (do NOT pipe typecheck through tail)**

Run: `npm run typecheck`
Then: `npm test`
Then: `npm run build && npm run e2e -- ui-polish.spec.ts`
Expected: typecheck exit 0; all unit pass; ui-polish e2e green. (Terminal-spawning specs in
the full e2e suite may flake on CIM/WMI polling — re-run in isolation to confirm, as in
Phase 1; those are not Phase 2 regressions.)

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ui-polish.spec.ts
git commit -m "test(e2e): toasts + explorer context menu + env autofocus"
```

---

### Task 11: Docs

**Files:**
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-06-16-ui-polish-phase2-design.md`

- [ ] **Step 1: Changelog**

Under `## [Unreleased]` → `### Added`, add:

```markdown
- **In-app toasts + file-explorer context menu (UI polish phase 2).** Discrete actions that
  used to succeed silently (saving a workspace template or theme preset, saving an SSH
  favorite, scheduling a command, adding an env var) now confirm with a bottom-right toast.
  Right-clicking a file or folder in the explorer opens a menu: Open, Reveal in File Explorer,
  Copy path / Copy relative path, Rename (inline), and Delete (to the Recycle Bin — recoverable,
  behind a confirm). The explorer now shows "Folder is empty" / "Couldn't read folder" instead
  of a blank pane, and the env-vault passphrase field auto-focuses.
```

- [ ] **Step 2: Mark spec implemented**

In the spec, change `**Status:** Design — pending review` to `**Status:** Implemented`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-06-16-ui-polish-phase2-design.md
git commit -m "docs: changelog + spec status for UI polish phase 2"
```

---

## Self-Review

**Spec coverage:** toast slice ✓(T1), compose ✓(T2), Toasts component + App ✓(T3), call-site
wiring ✓(T4), env autofocus + loading ✓(T5), `relativeTo` ✓(T6), `renamePath` ✓(T7), 3 fs IPC
channels ✓(T8), explorer context menu + inline rename + delete-to-trash + empty/error ✓(T9),
e2e (toast, rename, trash, autofocus) ✓(T10), docs ✓(T11). `pointer-events:none` container
✓(T3), trash-not-unlink ✓(T8/T9), reveal via `showItemInFolder` ✓(T8), copy via existing
`clipboardWrite` ✓(T9). All spec items covered.

**Placeholder scan:** Task 4 Steps 2–5 reference handlers "they call `saveThemePreset`/…"
without pinning exact line numbers — the function names are exact and unique per file, so the
engineer can locate them; the toast call to insert is fully specified. Task 9 Step 4 shows the
full replacement row JSX. No "TBD"/"handle errors"-style gaps.

**Type consistency:** `Toast`/`ToastKind` defined in T1 (`store/types.ts`), imported in T3
(`Toasts.tsx`) and used in T1. `pushToast(text, kind?)` signature consistent across T1/T3/T4/T9.
`relativeTo(root, p)` defined T6, used T9. `renamePath(oldPath, newPath)` defined T7, handler
T8, `api.fsRename(oldPath, newPath)` T8, used T9. `fsTrash`/`fsRevealItem` consistent T8↔T9.
`menu`/`renaming`/`errored` state names consistent within T9. Consistent.
