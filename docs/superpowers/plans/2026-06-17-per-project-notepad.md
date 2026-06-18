# Per-Project Notepad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collapsible right-side notes drawer scoped to a project (git root, else cwd), tracking the focused pane (sticky to the last project), persisted in an app-global `notes.json`.

**Architecture:** A pure project-key resolver + a `NotesStore` (modeled on `DraftStore`) behind new `notes:*` IPC + a renderer `notes` slice + a `NotesPanel` drawer mounted in `App`. Notes are keyed by `gitStatus[focusedPaneId]?.root ?? paneCwd(focusedPaneId)`. Debounced autosave mirrors the existing `quickSave`.

**Tech Stack:** Electron, TypeScript, React, zustand, vitest, Playwright-for-Electron.

## Global Constraints

- **Path alias:** `@shared/...`.
- **TDD:** failing test first for pure logic (`project-key`, `notes-store`, `notes-slice`); UI/persistence verified by e2e; plumbing by `npm run typecheck`.
- **`noUnusedLocals`/`noUnusedParameters` = true.**
- **No `../api` import in unit-tested modules:** `project-key.ts` inlines the cwd fallback (does NOT import `internals.ts`, which imports `api`). `notes-slice.test.ts` uses the slice-harness pattern (mock `../api` if needed, like `tests/renderer/clear-pane-runtime.test.ts`).
- **Persistence:** `notes.json` in Electron `userData`; `NotesStore` mirrors `DraftStore` (best-effort writes, `flush()` on `win.on('close')`).
- **Do NOT change how workspace hosts mount/hide** in `App.tsx` (all mounted, inactive `visibility: hidden`) — only wrap them in a flex row with the drawer.
- **Keybinding:** `toggle-notes` default Ctrl+Shift+N — verified free (existing chords: Ctrl+K, Ctrl+Shift+T/M/Enter/Tab/W, Ctrl+comma, Ctrl+Tab).
- **e2e is `workers: 1`; `npm run build` before `npm run e2e`.**

---

## Task 1: `resolveProjectKey` pure helper

**Files:**
- Create: `src/shared/project-key.ts`
- Test: `tests/shared/project-key.test.ts`

**Interfaces:**
- Consumes: `GitStatus`, `Workspace` (`@shared/types`).
- Produces: `resolveProjectKey(s, paneId): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/project-key.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveProjectKey } from '../../src/shared/project-key'
import type { GitStatus, Workspace } from '../../src/shared/types'

const git = (root: string): GitStatus => ({ root, branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: false })

function state(over: Partial<{ gitStatus: Record<string, GitStatus>; cwds: Record<string, string>; workspaces: Record<string, Workspace> }> = {}) {
  return { gitStatus: {}, cwds: {}, workspaces: {}, ...over }
}

describe('resolveProjectKey', () => {
  it('prefers the git root', () => {
    const s = state({ gitStatus: { p1: git('/repo') }, cwds: { p1: '/repo/sub' } })
    expect(resolveProjectKey(s, 'p1')).toBe('/repo')
  })
  it('falls back to the live cwd when no git status', () => {
    const s = state({ cwds: { p1: '/some/dir' } })
    expect(resolveProjectKey(s, 'p1')).toBe('/some/dir')
  })
  it('falls back to the persisted terminal cwd when no live cwd', () => {
    const ws: Workspace = { id: 'w', name: 'W', layout: 'p1', panes: { p1: { paneId: 'p1', config: { kind: 'terminal', shellId: 'sh', cwd: '/persisted' } } } } as unknown as Workspace
    expect(resolveProjectKey(state({ workspaces: { w: ws } }), 'p1')).toBe('/persisted')
  })
  it('returns empty string for no pane / no project', () => {
    expect(resolveProjectKey(state(), null)).toBe('')
    expect(resolveProjectKey(state(), 'ghost')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/project-key.test.ts`
Expected: FAIL — cannot find module `project-key`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/project-key.ts`:
```ts
import type { GitStatus, Workspace } from './types'

/** The project a pane belongs to: git repo root if known, else the pane's live cwd, else its
 *  persisted terminal cwd, else '' (no project). Pure (inlines the cwd fallback rather than
 *  importing the renderer `paneCwd`, which transitively imports `../api`). */
export function resolveProjectKey(
  s: { gitStatus: Record<string, GitStatus>; cwds: Record<string, string>; workspaces: Record<string, Workspace> },
  paneId: string | null
): string {
  if (!paneId) return ''
  const root = s.gitStatus[paneId]?.root
  if (root) return root
  if (s.cwds[paneId]) return s.cwds[paneId]
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane?.config.kind === 'terminal') return pane.config.cwd
  }
  return ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/project-key.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/project-key.ts tests/shared/project-key.test.ts
git commit -m "feat(notes): resolveProjectKey pure helper (git root -> cwd)"
```

---

## Task 2: `NotesStore` + IPC wiring

**Files:**
- Create: `src/main/persistence/notes-store.ts`
- Create: `src/main/ipc/register-notes.ts`
- Modify: `src/shared/ipc-contract.ts` (channels + `TermhallaApi`)
- Modify: `src/preload/index.ts` (expose)
- Modify: `src/main/ipc/register.ts` (compose)
- Test: `tests/main/notes-store.test.ts`

**Interfaces:**
- Produces: `NotesStore` (`load`/`set`/`flush`); `registerNotes(win, userDataDir)`; `CH.notesLoad`/`CH.notesSet`; `TermhallaApi.notesLoad`/`notesSet`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/notes-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesStore } from '../../src/main/persistence/notes-store'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'notes-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('NotesStore', () => {
  it('round-trips a note through set + reload', async () => {
    const a = new NotesStore(dir)
    await a.load()
    a.set('/proj', 'hello notes')
    const b = new NotesStore(dir)
    expect(await b.load()).toEqual({ '/proj': 'hello notes' })
  })

  it('prunes a key when the text is empty/whitespace', async () => {
    const a = new NotesStore(dir)
    await a.load()
    a.set('/proj', 'x')
    a.set('/proj', '   ')
    const b = new NotesStore(dir)
    expect(await b.load()).toEqual({})
  })

  it('returns {} for a corrupt file', async () => {
    writeFileSync(join(dir, 'notes.json'), 'not json', 'utf8')
    expect(await new NotesStore(dir).load()).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/notes-store.test.ts`
Expected: FAIL — cannot find module `notes-store`.

- [ ] **Step 3: Write `NotesStore`**

Create `src/main/persistence/notes-store.ts`:
```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type NotesMap = Record<string, string>

/** Keep only string-valued entries. */
function sanitize(value: unknown): NotesMap {
  const out: NotesMap = {}
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  return out
}

/** Persists per-project notepad text to notes.json in userData, keyed by project key (git root or
 *  cwd). Writes are best-effort and never throw into the editing path; mirrors DraftStore. */
export class NotesStore {
  private map: NotesMap = {}

  constructor(private readonly baseDir: string) {}

  private file() { return join(this.baseDir, 'notes.json') }

  async load(): Promise<NotesMap> {
    try { this.map = sanitize(JSON.parse(await readFile(this.file(), 'utf8'))) }
    catch { this.map = {} }
    return this.map
  }

  /** Set (or, when text is empty/whitespace-only, delete) a project's note. */
  set(key: string, text: string): void {
    if (text.trim() === '') { if (!(key in this.map)) return; delete this.map[key] }
    else this.map[key] = text
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/notes-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the IPC contract entries**

In `src/shared/ipc-contract.ts`:

Add to `CH` (near `draftsLoad`):
```ts
  notesLoad: 'notes:load',
  notesSet: 'notes:set',
```

Add to `TermhallaApi` (near the drafts methods):
```ts
  notesLoad(): Promise<Record<string, string>>
  notesSet(key: string, text: string): void
```

- [ ] **Step 6: Expose in preload**

In `src/preload/index.ts`, add (near the drafts entries):
```ts
  notesLoad: () => ipcRenderer.invoke(CH.notesLoad),
  notesSet: (key, text) => ipcRenderer.send(CH.notesSet, key, text),
```

- [ ] **Step 7: Create the registrar**

Create `src/main/ipc/register-notes.ts`:
```ts
import { ipcMain, type BrowserWindow } from 'electron'
import { CH } from '@shared/ipc-contract'
import { NotesStore } from '../persistence/notes-store'

/** Per-project notepad persistence. Mirrors registerDrafts: load on start, set on demand,
 *  synchronous flush on window close (covers app close, where renderer cleanups don't run). */
export function registerNotes(win: BrowserWindow, userDataDir: string): void {
  const notes = new NotesStore(userDataDir)
  void notes.load()
  ipcMain.handle(CH.notesLoad, () => notes.load())
  ipcMain.on(CH.notesSet, (_e, key: string, text: string) => notes.set(key, text))
  win.on('close', () => notes.flush())
}
```

- [ ] **Step 8: Compose in register.ts**

In `src/main/ipc/register.ts`:

Add the import (near `registerDrafts`):
```ts
import { registerNotes } from './register-notes'
```

Call it next to `registerDrafts(win, dir)`:
```ts
  registerNotes(win, dir)
```

- [ ] **Step 9: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/main/persistence/notes-store.ts src/main/ipc/register-notes.ts src/main/ipc/register.ts src/shared/ipc-contract.ts src/preload/index.ts tests/main/notes-store.test.ts
git commit -m "feat(notes): NotesStore + notes:load/set IPC"
```

---

## Task 3: renderer `notes` slice + store wiring

**Files:**
- Create: `src/renderer/store/notes-slice.ts`
- Modify: `src/renderer/store/types.ts` (state + actions + `SliceDeps`)
- Modify: `src/renderer/store.ts` (debounce, deps, init load, flushNotes, compose, initial state)
- Modify: `src/renderer/App.tsx` (flush notes on beforeunload)
- Test: `src/renderer/store/notes-slice.test.ts`

**Interfaces:**
- Consumes: `api.notesSet` (Task 2); `resolveProjectKey` is used by the UI (Task 4), not here.
- Produces: state `notes`/`notesOpen`/`notesProjectKey`; actions `setNotesOpen`/`setNotesProject`/`setNote`; `flushNotes`; `scheduleNotesSave` in `SliceDeps`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/store/notes-slice.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createNotesSlice } from './notes-slice'

function harness() {
  let state: any = { notes: {}, notesOpen: false, notesProjectKey: null }
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  const scheduleNotesSave = vi.fn()
  const slice = createNotesSlice({ set, get, scheduleNotesSave } as any)
  return { slice, get, scheduleNotesSave }
}

describe('notes slice', () => {
  it('setNote updates the map and schedules a save', () => {
    const { slice, get, scheduleNotesSave } = harness()
    slice.setNote('/proj', 'hello')
    expect(get().notes['/proj']).toBe('hello')
    expect(scheduleNotesSave).toHaveBeenCalled()
  })
  it('setNotesProject sets the current key', () => {
    const { slice, get } = harness()
    slice.setNotesProject('/proj')
    expect(get().notesProjectKey).toBe('/proj')
  })
  it('setNotesOpen toggles the drawer', () => {
    const { slice, get } = harness()
    slice.setNotesOpen(true)
    expect(get().notesOpen).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/store/notes-slice.test.ts`
Expected: FAIL — cannot find module `notes-slice`.

- [ ] **Step 3: Create the slice**

Create `src/renderer/store/notes-slice.ts` (does NOT import `../api` — the debounced `api.notesSet`
lives in `store.ts`'s `notesSave`; keeping `api` out of this slice lets its unit test run without
mocking `window.termhalla`):
```ts
import type { State, SliceDeps } from './types'

type NotesSlice = Pick<State, 'setNotesOpen' | 'setNotesProject' | 'setNote'>

/** Per-project notepad: the open/closed drawer state, the currently shown project key (set by the
 *  panel's tracking effect, sticky on empty), and the note map. setNote updates the map for instant
 *  UI and debounces the disk write via scheduleNotesSave (which calls api.notesSet in store.ts). */
export function createNotesSlice({ set, scheduleNotesSave }: SliceDeps): NotesSlice {
  return {
    setNotesOpen: (open) => set({ notesOpen: open }),
    setNotesProject: (key) => set({ notesProjectKey: key }),
    setNote: (key, text) => {
      set(s => ({ notes: { ...s.notes, [key]: text } }))
      scheduleNotesSave()
    }
  }
}
```

- [ ] **Step 4: Add state + deps types**

In `src/renderer/store/types.ts`:

Add to `State` (near `drafts`):
```ts
  notes: Record<string, string>
  notesOpen: boolean
  notesProjectKey: string | null
  setNotesOpen: (open: boolean) => void
  setNotesProject: (key: string) => void
  setNote: (key: string, text: string) => void
  flushNotes: () => void
```

Add to `SliceDeps`:
```ts
  scheduleNotesSave: () => void
```

- [ ] **Step 5: Wire store.ts**

In `src/renderer/store.ts`:

Add the import (near `createScheduleSlice`):
```ts
import { createNotesSlice } from './store/notes-slice'
```

Add the debounce + schedule next to `quickSave` (after line ~43):
```ts
  const notesSave = makeDebounce(() => {
    const s = get(); const k = s.notesProjectKey
    if (k != null) void api.notesSet(k, s.notes[k] ?? '')
  }, AUTOSAVE_DEBOUNCE_MS)
  const scheduleNotesSave = notesSave.schedule
```

Add `scheduleNotesSave` to the `deps` object:
```ts
  const deps: SliceDeps = { set, get, scheduleAutosave, scheduleQuickSave, scheduleNotesSave, commitPane }
```

Add `notes` to the `init` Promise.all (the one that loads quick/home/drafts):
```ts
      const [quick, home, drafts, notes] = await Promise.all([api.loadQuick(), api.homeDir(), api.draftsLoad(), api.notesLoad()])
      set({ quick, home, drafts, notes })
```

Add `flushNotes` next to `flushQuick: quickSave.flush,`:
```ts
    flushNotes: notesSave.flush,
```

Add to the initial-state object (near `drafts: {}` / `cloud: []`):
```ts
    notes: {},
    notesOpen: false,
    notesProjectKey: null,
```

Compose the slice (after `...createScheduleSlice(deps),`):
```ts
    ...createNotesSlice(deps),
```

- [ ] **Step 6: Flush notes on app close**

In `src/renderer/App.tsx`, update the `beforeunload` flush (line ~31):
```ts
    const flush = () => { const s = useStore.getState(); void s.saveAll(); s.flushQuick(); s.flushNotes() }
```

- [ ] **Step 7: Run the slice test + typecheck**

Run: `npx vitest run src/renderer/store/notes-slice.test.ts` → PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/store/notes-slice.ts src/renderer/store/notes-slice.test.ts src/renderer/store/types.ts src/renderer/store.ts src/renderer/App.tsx
git commit -m "feat(notes): renderer notes slice + store wiring (load/save/flush)"
```

---

## Task 4: `NotesPanel` drawer + toggle (App, keybinding, StatusBar)

**Files:**
- Create: `src/renderer/components/NotesPanel.tsx`
- Modify: `src/renderer/App.tsx` (flex row + render drawer + keydown case + selector)
- Modify: `src/shared/keybindings.ts` (`toggle-notes`)
- Modify: `src/renderer/components/StatusBar.tsx` (📝 button)

**Interfaces:**
- Consumes: `resolveProjectKey` (Task 1); `notes`/`notesOpen`/`notesProjectKey`/`setNote`/`setNotesProject`/`setNotesOpen` (Task 3); `focusedPaneId`/`gitStatus`/`cwds`/`workspaces` from the store.

- [ ] **Step 1: Create the panel**

Create `src/renderer/components/NotesPanel.tsx`:
```tsx
import { useEffect } from 'react'
import { useStore } from '../store'
import { resolveProjectKey } from '@shared/project-key'

/** Basename of a path key, for the header. */
function projName(key: string): string {
  const parts = key.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? key
}

/** Right-side notes drawer: shows the note for the focused pane's project (sticky to the last
 *  non-empty project). Plain auto-saved textarea. Only rendered when notesOpen. */
export function NotesPanel() {
  const focusedPaneId = useStore(s => s.focusedPaneId)
  const gitStatus = useStore(s => s.gitStatus)
  const cwds = useStore(s => s.cwds)
  const workspaces = useStore(s => s.workspaces)
  const notesProjectKey = useStore(s => s.notesProjectKey)
  const notes = useStore(s => s.notes)
  const setNote = useStore(s => s.setNote)
  const setNotesProject = useStore(s => s.setNotesProject)
  const setNotesOpen = useStore(s => s.setNotesOpen)

  // Track the focused pane's project; ignore empties so the panel keeps showing the last project.
  useEffect(() => {
    const key = resolveProjectKey({ gitStatus, cwds, workspaces }, focusedPaneId)
    if (key) setNotesProject(key)
  }, [focusedPaneId, gitStatus, cwds, workspaces, setNotesProject])

  const text = notesProjectKey ? (notes[notesProjectKey] ?? '') : ''

  return (
    <div data-testid="notes-panel"
      style={{ width: 320, flex: '0 0 320px', display: 'flex', flexDirection: 'column',
        background: 'var(--panel, #1e1e1e)', borderLeft: '1px solid var(--border, #333)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid var(--border, #333)' }}>
        <span data-testid="notes-project" style={{ flex: 1, fontSize: 12, color: 'var(--fg-dim, #aaa)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {notesProjectKey ? projName(notesProjectKey) : 'Notes'}
        </span>
        <button data-testid="notes-close" title="Close notes" onClick={() => setNotesOpen(false)}>✕</button>
      </div>
      {notesProjectKey ? (
        <textarea data-testid="notes-textarea" value={text}
          onChange={e => setNote(notesProjectKey, e.target.value)}
          placeholder="Notes for this project…"
          style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', padding: 8,
            background: 'transparent', color: 'var(--fg, #eee)', fontFamily: 'var(--mono)', fontSize: 13 }} />
      ) : (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>
          Focus a terminal in a project to take notes.
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the keybinding command**

In `src/shared/keybindings.ts`:

Add `'toggle-notes'` to the `CommandId` union (in the General group):
```ts
  | 'open-settings' | 'toggle-maximize-pane' | 'toggle-notes'
```
(Append `| 'toggle-notes'` to the existing union — keep all current members.)

Add to the `COMMANDS` array (near `open-settings`):
```ts
  { id: 'toggle-notes', label: 'Toggle notes panel', category: 'General', defaultChord: c(true, true, 'n'), tip: 'open the project notes panel' },
```

- [ ] **Step 3: Wire App.tsx (selector, layout, keydown)**

In `src/renderer/App.tsx`:

Add the import:
```ts
import { NotesPanel } from './components/NotesPanel'
```

Add `notesOpen` to the shallow selector:
```ts
  const { activeId, workspaces, order, notesOpen } = useStore(
    useShallow(s => ({ activeId: s.activeId, workspaces: s.workspaces, order: s.order, notesOpen: s.notesOpen }))
  )
```

Wrap the workspace content div + drawer in a flex row. Replace the existing
`<div style={{ flex: 1, position: 'relative' }} className="mosaic-blueprint-theme">…</div>`
block with:
```tsx
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative' }} className="mosaic-blueprint-theme">
          {order.length === 0 && <div data-testid="app-title">Termhalla</div>}
          {order.map(id => {
            const ws = workspaces[id]
            if (!ws) return null
            const isActive = id === activeId
            return (
              <div key={id} data-testid="workspace-host" data-ws={id} data-active={isActive ? 'true' : 'false'}
                aria-hidden={!isActive}
                style={{ ...themeCssVarsPartial(ws.theme ?? {}), position: 'absolute', inset: 0, visibility: isActive ? 'visible' : 'hidden',
                  pointerEvents: isActive ? 'auto' : 'none', zIndex: isActive ? 1 : 0 }}>
                <WorkspaceView ws={ws} />
              </div>
            )
          })}
        </div>
        {notesOpen && <NotesPanel />}
      </div>
```
(The inner workspace `<div>` keeps `position: relative` and the exact host-mounting logic — only the outer flex-row wrapper and the `{notesOpen && <NotesPanel />}` are new. Keep the explanatory comment that precedes the `order.map`.)

Add the keydown case (in the `switch (sc.type)`):
```ts
        case 'toggle-notes': s.setNotesOpen(!s.notesOpen); break
```

- [ ] **Step 4: Add the StatusBar toggle button**

In `src/renderer/components/StatusBar.tsx`, add a button after the `<div style={{ flex: 1 }} />` spacer (before the `tipText` span):
```tsx
      <button data-testid="notes-toggle" type="button" title="Toggle notes (project notepad)"
        onClick={() => useStore.getState().setNotesOpen(!useStore.getState().notesOpen)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--fg-dim, #aaa)', padding: 0 }}>📝</button>
```

- [ ] **Step 5: Typecheck + build + commit**

Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds.

```bash
git add src/renderer/components/NotesPanel.tsx src/renderer/App.tsx src/shared/keybindings.ts src/renderer/components/StatusBar.tsx
git commit -m "feat(notes): NotesPanel drawer + toggle (keybinding + statusbar)"
```

---

## Task 5: End-to-end test

**Files:**
- Create: `tests/e2e/notepad.spec.ts`

- [ ] **Step 1: Build**

Run: `npm run build` → success.

- [ ] **Step 2: Write the e2e**

Create `tests/e2e/notepad.spec.ts`:
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync, execFileSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('per-project notepad: take a note, persist across relaunch, scope by project', async () => {
  test.setTimeout(75_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-notes-'))
  const projA = mkdtempSync(join(tmpdir(), 'termh-notesA-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: projA })
  const projB = mkdtempSync(join(tmpdir(), 'termh-notesB-'))

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`Set-Location '${projA}'`)
  await win.keyboard.press('Enter')
  // wait until the git/cwd resolves for this pane (chip shows the branch)
  await expect(win.locator('[data-testid^="tile-"][data-git-branch="main"]')).toHaveCount(1, { timeout: 20_000 })

  // Open notes, type a note for project A.
  await win.getByTestId('notes-toggle').click()
  await expect(win.getByTestId('notes-panel')).toBeVisible()
  await win.getByTestId('notes-textarea').fill('PROJECT-A-NOTE')
  await win.waitForTimeout(1200)  // debounce flush

  // Relaunch -> note persists.
  const pid1 = app.process().pid; if (pid1) killTree(pid1)
  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator('[data-testid^="tile-"][data-git-branch="main"]')).toHaveCount(1, { timeout: 20_000 })
  await win.getByTestId('notes-toggle').click()
  await expect(win.getByTestId('notes-textarea')).toHaveValue('PROJECT-A-NOTE', { timeout: 15_000 })

  // Split a second terminal, cd into project B, focus it -> notes are empty (different project).
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await win.locator('.xterm-screen').nth(1).click()
  await win.keyboard.type(`Set-Location '${projB}'`)
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('notes-textarea')).toHaveValue('', { timeout: 20_000 })

  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})
```

- [ ] **Step 3: Run the e2e**

Run: `npm run e2e -- notepad`
Expected: PASS (1 test). If `shell-picker`/`add-first-terminal`/`split-` testids differ, mirror `tests/e2e/cwd.spec.ts`. The project-B step relies on cwd resolution (no git needed — `resolveProjectKey` falls back to cwd); if focus timing flakes, the `.xterm-screen` click on the second terminal drives `setFocusedPane`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/notepad.spec.ts
git commit -m "test(notes): e2e for per-project notepad (persist + scope)"
```

---

## Task 6: Docs

**Files:**
- Create: `docs/features/notepad.md`
- Modify: `CHANGELOG.md`, `CLAUDE.md` (Where things live), `docs/architecture.md` (persisted stores list if present)

- [ ] **Step 1: Feature doc**

Create `docs/features/notepad.md`: data flow (focused pane → resolveProjectKey → notesProjectKey → NotesPanel → setNote → notes:set → NotesStore), project-key resolution + the keep-last-project stickiness, persistence (`notes.json`, DraftStore-like, flush on close, empty prunes key), the drawer UI + toggle (Ctrl+Shift+N / 📝), multi-window behavior (content shared, open-state per-window), and non-goals (plain text only, one note per project, no search index yet, not in workspace JSON/templates). Match an existing `docs/features/*.md` in style.

- [ ] **Step 2: Changelog + CLAUDE.md + architecture.md**

Add a CHANGELOG entry. Add a CLAUDE.md "Where things live" row:
```
| Per-project notepad | `src/main/persistence/notes-store.ts`, `src/renderer/components/NotesPanel.tsx` | [notepad](docs/features/notepad.md) |
```
If `docs/architecture.md` lists the userData persistence files (`workspaces/`, `app-state.json`, `quick.json`, `editor-drafts.json`), add `notes.json`.

- [ ] **Step 3: Commit**

```bash
git add docs/features/notepad.md CHANGELOG.md CLAUDE.md docs/architecture.md
git commit -m "docs(notes): document per-project notepad"
```

---

## Self-Review

**Spec coverage:**
- Project key = git root ?? cwd → Task 1 (`resolveProjectKey`). ✓
- Dedicated app-global store (`notes.json`, DraftStore-like, flush on close, empty prunes) → Task 2. ✓
- IPC `notes:load`/`notes:set` → Task 2. ✓
- Renderer state + debounced autosave (mirrors quickSave) + init load + beforeunload flush → Task 3. ✓
- Right-side drawer, sticky-last-project tracking, empty state, textarea → Task 4. ✓
- Toggle (Ctrl+Shift+N + 📝) → Task 4. ✓
- Tests: unit (project-key, notes-store, notes-slice) + e2e (persist + scope) → Tasks 1,2,3,5. ✓
- Docs → Task 6. ✓
- Non-goals (plain text, one note/project, no search index, not in workspace JSON/templates) → respected (nothing added for them). ✓

**Placeholder scan:** none — all code is complete.

**Type consistency:** `notes`/`notesOpen`/`notesProjectKey` and actions `setNotesOpen`/`setNotesProject`/`setNote`/`flushNotes` match across `State`, the slice, `store.ts`, and the components. `scheduleNotesSave` matches between `SliceDeps`, `store.ts` `deps`, and the slice. `CH.notesLoad`/`notesSet` + `notesLoad()`/`notesSet()` match across contract, preload, registrar, and `store.ts`. `resolveProjectKey` signature matches between Task 1 and its use in `NotesPanel`. Test ids (`notes-panel`/`notes-toggle`/`notes-textarea`/`notes-close`/`notes-project`) match between Task 4 and Task 5.

**Decision locked:** `notes-slice.ts` must NOT import `../api` (drop the `_notesApi` guard line) — the debounced `api.notesSet` lives in `store.ts`'s `notesSave`. This keeps the slice unit test free of the `window.termhalla` load-time throw without needing a `vi.mock`.
