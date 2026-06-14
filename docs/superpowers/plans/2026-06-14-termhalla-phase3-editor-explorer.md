# Termhalla Phase 3 — Editor & Explorer Panes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tabbed Monaco editor pane and a live-watching read-only file-explorer pane to the existing tiled workspace, with all filesystem work behind typed main-process IPC.

**Architecture:** `PaneConfig` becomes a `kind`-discriminated union (`terminal | editor | explorer`); `WorkspaceView.renderTile` switches on it. A new `src/main/fs/` layer (read/write/readDir/stat + a chokidar `WatchManager` + native dialogs) is exposed over IPC. The editor uses `monaco-editor` with one model per open file; the explorer renders a lazy tree driven by a pure reducer over `fs:change` events.

**Tech Stack:** (adds to Phases 1–2) `monaco-editor`, `chokidar`.

**Pre-req:** Phases 1 & 2 merged to master. Create the branch before Task 1:
`git checkout -b feat/phase3-editor-explorer`

All commits append the trailer:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
and use `git -c user.name='Termhalla Dev' -c user.email='kevin.mcculley@gmail.com' commit ...` if git lacks identity. Use the PowerShell tool for npm/npx (Windows).

---

## File Structure

```
src/shared/
  types.ts            # MODIFY: EditorConfig/ExplorerConfig/PaneConfig union; fs types; SCHEMA_VERSION=3
  language.ts         # NEW: languageForPath (pure)
  ipc-contract.ts     # MODIFY: fs:* + dialog:* channels; fs:change event; TermhallaApi methods
src/main/fs/
  files.ts            # NEW: readTextFile/writeTextFile/readDirectory/statPath/sortEntries/isBinary
  watch-manager.ts    # NEW: chokidar WatchManager
src/main/ipc/register.ts  # MODIFY: fs + dialog handlers, WatchManager, close cleanup
src/preload/index.ts      # MODIFY: fs.* + dialog.* + onFsChange
src/renderer/
  editor/monaco-setup.ts        # NEW: MonacoEnvironment workers + monaco re-export
  components/EditorPane.tsx      # NEW
  components/ExplorerPane.tsx    # NEW
  components/explorer-tree.ts    # NEW: pure tree reducer
  store.ts            # MODIFY: addEditor/addExplorer/openFileInEditor/lastEditorPaneId/registerEditorPane
  components/WorkspaceView.tsx   # MODIFY: switch on kind; empty-state 3 buttons
  components/WorkspaceTabs.tsx   # MODIFY: "＋ pane" menu
  index.html          # MODIFY: CSP for monaco workers
tests/shared/language.test.ts            # NEW
tests/shared/pane-union.test.ts          # NEW
tests/main/fs-files.test.ts              # NEW
tests/main/watch-manager.test.ts         # NEW
tests/renderer/explorer-tree.test.ts     # NEW
tests/e2e/seed.ts                         # NEW (helper)
tests/e2e/editor.spec.ts                  # NEW
tests/e2e/explorer.spec.ts                # NEW
```

> **vitest note:** `explorer-tree.test.ts` and the renderer-side pure tests live under `tests/renderer/` and `tests/shared/`. `vitest.config.ts` already includes `tests/**/*.test.ts`, so they are picked up. The explorer reducer is pure (no DOM), so `environment: 'node'` is fine.

---

## Task 1: Pane-union types, fs types, schema v3

**Files:** Modify `src/shared/types.ts`; Create `tests/shared/pane-union.test.ts`

- [ ] **Step 1: Edit `src/shared/types.ts`**

Add the editor/explorer configs and turn `PaneConfig` into a union (replace the existing `export type PaneConfig = TerminalConfig`):
```ts
export interface EditorConfig {
  kind: 'editor'
  files: string[]
  activePath?: string
}

export interface ExplorerConfig {
  kind: 'explorer'
  root: string
}

export type PaneConfig = TerminalConfig | EditorConfig | ExplorerConfig
```
Add filesystem contract types (used by main fs layer + renderer):
```ts
export interface DirEntry { name: string; path: string; isDir: boolean }
export interface ReadResult { content: string; tooLarge: boolean }
export interface StatResult { size: number; mtimeMs: number; isDir: boolean }
export type FsEvent = 'add' | 'unlink' | 'change' | 'addDir' | 'unlinkDir'
export interface FsChange { event: FsEvent; path: string }
```
Bump the schema:
```ts
export const SCHEMA_VERSION = 3
```

- [ ] **Step 2: Write `tests/shared/pane-union.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import { createWorkspace, addFirstPane, serializeWorkspace, deserializeWorkspace } from '@shared/workspace-model'
import type { EditorConfig, ExplorerConfig } from '@shared/types'

describe('pane union persistence', () => {
  it('round-trips an editor pane config', () => {
    const cfg: EditorConfig = { kind: 'editor', files: ['C:\\a.ts', 'C:\\b.ts'], activePath: 'C:\\b.ts' }
    const ws = addFirstPane(createWorkspace('W', () => 'w'), cfg, () => 'p').workspace
    expect(deserializeWorkspace(serializeWorkspace(ws))).toEqual(ws)
  })
  it('round-trips an explorer pane config', () => {
    const cfg: ExplorerConfig = { kind: 'explorer', root: 'C:\\proj' }
    const ws = addFirstPane(createWorkspace('W', () => 'w'), cfg, () => 'p').workspace
    expect(deserializeWorkspace(serializeWorkspace(ws))).toEqual(ws)
  })
  it('still loads a v2 terminal-only workspace file', () => {
    const v2 = JSON.stringify({
      schemaVersion: 2,
      workspace: { id: 'x', name: 'n', layout: 'p1',
        panes: { p1: { paneId: 'p1', config: { kind: 'terminal', shellId: 'cmd', cwd: '' } } } }
    })
    expect(deserializeWorkspace(v2).panes.p1.config.kind).toBe('terminal')
  })
})
```

- [ ] **Step 3: Run it (RED), then it passes once types compile**
Run: `npx vitest run tests/shared/pane-union.test.ts`
Expected: PASS (the model serializer is config-agnostic; this test only confirms the union types serialize and v2 still loads). If it fails to compile, fix the type edits.

- [ ] **Step 4: Fix the Phase 2 schemaVersion assertion**
`tests/shared/workspace-model.test.ts` asserts `schemaVersion).toBe(2)`. Update that one assertion to `.toBe(3)`. The migrate-guard test uses 999 (still > 3, still throws) — leave it.

- [ ] **Step 5: Verify + commit**
Run: `npm run typecheck` → clean. `npm test` → full suite green (the Phase 1/2 TerminalPane render path is unaffected — see Task 12 for the renderTile switch).
```
git add -A && git commit -m "feat: editor/explorer pane union + fs contract types, schema v3"
```

---

## Task 2: languageForPath (pure, TDD)

**Files:** Create `src/shared/language.ts`, `tests/shared/language.test.ts`

- [ ] **Step 1: Write the failing test `tests/shared/language.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import { languageForPath } from '@shared/language'

describe('languageForPath', () => {
  it('maps common extensions to Monaco language ids', () => {
    expect(languageForPath('C:\\x\\main.ts')).toBe('typescript')
    expect(languageForPath('a.tsx')).toBe('typescript')
    expect(languageForPath('a.js')).toBe('javascript')
    expect(languageForPath('a.py')).toBe('python')
    expect(languageForPath('a.json')).toBe('json')
    expect(languageForPath('a.md')).toBe('markdown')
    expect(languageForPath('a.css')).toBe('css')
    expect(languageForPath('a.ps1')).toBe('powershell')
  })
  it('is case-insensitive', () => {
    expect(languageForPath('README.MD')).toBe('markdown')
  })
  it('falls back to plaintext for unknown or missing extensions', () => {
    expect(languageForPath('a.unknownext')).toBe('plaintext')
    expect(languageForPath('Makefile')).toBe('plaintext')
    expect(languageForPath('/path/to/noext')).toBe('plaintext')
  })
})
```

- [ ] **Step 2: Run (FAIL)**
Run: `npx vitest run tests/shared/language.test.ts` → FAIL.

- [ ] **Step 3: Create `src/shared/language.ts`**
```ts
const MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', psm1: 'powershell',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', toml: 'ini', ini: 'ini',
  bat: 'bat', cmd: 'bat', dockerfile: 'dockerfile', lua: 'lua'
}

/** Monaco language id for a file path, by extension. 'plaintext' if unknown. */
export function languageForPath(path: string): string {
  const m = /\.([^.\\/]+)$/.exec(path)
  const ext = m ? m[1].toLowerCase() : ''
  return MAP[ext] ?? 'plaintext'
}
```

- [ ] **Step 4: Run (PASS) + commit**
Run: `npx vitest run tests/shared/language.test.ts` → pass. `npm run typecheck` → clean.
```
git add -A && git commit -m "feat: file-extension to Monaco language mapping"
```

---

## Task 3: Main fs file operations (TDD with temp dirs)

**Files:** Create `src/main/fs/files.ts`, `tests/main/fs-files.test.ts`

- [ ] **Step 1: Write the failing test `tests/main/fs-files.test.ts`**
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readTextFile, writeTextFile, readDirectory, statPath, sortEntries, isBinary
} from '../../src/main/fs/files'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-fs-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('files', () => {
  it('writes and reads back text', async () => {
    const f = join(dir, 'a.txt')
    await writeTextFile(f, 'hello')
    expect((await readTextFile(f)).content).toBe('hello')
  })
  it('flags files over the size cap as tooLarge without reading content', async () => {
    const f = join(dir, 'big.txt'); writeFileSync(f, 'abcdefghij') // 10 bytes
    const r = await readTextFile(f, 5) // cap 5
    expect(r).toEqual({ content: '', tooLarge: true })
  })
  it('rejects binary files', async () => {
    const f = join(dir, 'bin'); writeFileSync(f, Buffer.from([0x41, 0x00, 0x42]))
    await expect(readTextFile(f)).rejects.toThrow()
  })
  it('lists a directory dirs-first, alphabetical', async () => {
    writeFileSync(join(dir, 'b.txt'), '')
    writeFileSync(join(dir, 'a.txt'), '')
    mkdirSync(join(dir, 'zsub'))
    const entries = await readDirectory(dir)
    expect(entries.map(e => e.name)).toEqual(['zsub', 'a.txt', 'b.txt'])
    expect(entries[0].isDir).toBe(true)
  })
  it('stats a path', async () => {
    const f = join(dir, 'a.txt'); await writeTextFile(f, 'xy')
    const s = await statPath(f)
    expect(s.size).toBe(2); expect(s.isDir).toBe(false)
  })
  it('sortEntries puts dirs first then alphabetical (pure)', () => {
    const out = sortEntries([
      { name: 'b', path: 'b', isDir: false },
      { name: 'a', path: 'a', isDir: false },
      { name: 'dir', path: 'dir', isDir: true }
    ])
    expect(out.map(e => e.name)).toEqual(['dir', 'a', 'b'])
  })
  it('isBinary detects NUL bytes', () => {
    expect(isBinary(Buffer.from('text'))).toBe(false)
    expect(isBinary(Buffer.from([0x41, 0x00]))).toBe(true)
  })
})
```

- [ ] **Step 2: Run (FAIL)**
Run: `npx vitest run tests/main/fs-files.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/fs/files.ts`**
```ts
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DirEntry, ReadResult, StatResult } from '@shared/types'

const MAX_BYTES = 50 * 1024 * 1024

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export function sortEntries(list: DirEntry[]): DirEntry[] {
  return [...list].sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name))
}

export async function readTextFile(path: string, maxBytes = MAX_BYTES): Promise<ReadResult> {
  const s = await stat(path)
  if (s.size > maxBytes) return { content: '', tooLarge: true }
  const buf = await readFile(path)
  if (isBinary(buf)) throw new Error('Cannot open binary file')
  return { content: buf.toString('utf8'), tooLarge: false }
}

export async function writeTextFile(path: string, content: string): Promise<number> {
  await writeFile(path, content, 'utf8')
  return (await stat(path)).mtimeMs
}

export async function readDirectory(path: string): Promise<DirEntry[]> {
  const ents = await readdir(path, { withFileTypes: true })
  return sortEntries(ents.map(e => ({ name: e.name, path: join(path, e.name), isDir: e.isDirectory() })))
}

export async function statPath(path: string): Promise<StatResult> {
  const s = await stat(path)
  return { size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }
}
```

- [ ] **Step 4: Run (PASS) + commit**
Run: `npx vitest run tests/main/fs-files.test.ts` → 7 pass. `npm run typecheck` → clean.
```
git add -A && git commit -m "feat: main-process file read/write/list/stat with size+binary guards"
```

---

## Task 4: WatchManager (chokidar, TDD with temp dir)

**Files:** Create `src/main/fs/watch-manager.ts`, `tests/main/watch-manager.test.ts`. Add `chokidar` dependency.

- [ ] **Step 1: Add chokidar**
Run: `npm install chokidar@^4.0.0`
Expected: installs (pure JS, no native build).

- [ ] **Step 2: Write the failing test `tests/main/watch-manager.test.ts`**
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WatchManager } from '../../src/main/fs/watch-manager'
import type { FsChange } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-w-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (pred()) { clearInterval(iv); resolve() }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout')) }
    }, 25)
  })
}

describe('WatchManager', () => {
  it('emits an add event when a file appears in a watched dir', async () => {
    const events: FsChange[] = []
    const wm = new WatchManager((_id, c) => events.push(c))
    wm.watch('w1', dir)
    await new Promise(r => setTimeout(r, 300)) // let chokidar finish initial scan
    writeFileSync(join(dir, 'new.txt'), 'hi')
    await waitFor(() => events.some(e => e.event === 'add' && e.path.endsWith('new.txt')))
    wm.closeAll()
    expect(events.some(e => e.event === 'add')).toBe(true)
  })

  it('stops emitting after unwatch', async () => {
    const events: FsChange[] = []
    const wm = new WatchManager((_id, c) => events.push(c))
    wm.watch('w1', dir)
    await new Promise(r => setTimeout(r, 300))
    wm.unwatch('w1')
    writeFileSync(join(dir, 'x.txt'), 'hi')
    await new Promise(r => setTimeout(r, 400))
    expect(events.length).toBe(0)
    wm.closeAll()
  })
})
```

- [ ] **Step 3: Run (FAIL)**
Run: `npx vitest run tests/main/watch-manager.test.ts` → FAIL (module not found).

- [ ] **Step 4: Create `src/main/fs/watch-manager.ts`**
```ts
import chokidar, { type FSWatcher } from 'chokidar'
import type { FsChange, FsEvent } from '@shared/types'

const EVENTS: FsEvent[] = ['add', 'unlink', 'change', 'addDir', 'unlinkDir']

/** Manages per-id chokidar watchers (non-recursive). Forwards change events. */
export class WatchManager {
  private watchers = new Map<string, FSWatcher>()

  constructor(private readonly onChange: (id: string, change: FsChange) => void) {}

  watch(id: string, path: string): void {
    if (this.watchers.has(id)) this.unwatch(id)
    const w = chokidar.watch(path, {
      ignoreInitial: true, depth: 0,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 }
    })
    for (const ev of EVENTS) w.on(ev, (p: string) => this.onChange(id, { event: ev, path: p }))
    this.watchers.set(id, w)
  }

  unwatch(id: string): void {
    const w = this.watchers.get(id)
    if (w) { void w.close(); this.watchers.delete(id) }
  }

  closeAll(): void { for (const id of [...this.watchers.keys()]) this.unwatch(id) }
}
```

- [ ] **Step 5: Run (PASS) + commit**
Run: `npx vitest run tests/main/watch-manager.test.ts` → 2 pass (these are timing tests; if flaky on a slow machine, the timeouts are generous — re-run once). `npm run typecheck` → clean.
```
git add -A && git commit -m "feat: chokidar WatchManager for live fs change events"
```

---

## Task 5: Explorer tree reducer (pure, TDD)

**Files:** Create `src/renderer/components/explorer-tree.ts`, `tests/renderer/explorer-tree.test.ts`

The explorer keeps, per expanded directory, a sorted list of child entries. This module applies an `FsChange` to such a list. Pure.

- [ ] **Step 1: Write the failing test `tests/renderer/explorer-tree.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import { applyDirChange } from '../../src/renderer/components/explorer-tree'
import type { DirEntry } from '@shared/types'

const E = (name: string, isDir = false): DirEntry => ({ name, path: `/d/${name}`, isDir })

describe('applyDirChange', () => {
  const base: DirEntry[] = [E('sub', true), E('a.txt'), E('c.txt')]

  it('inserts an added file in dirs-first sorted position', () => {
    const out = applyDirChange(base, { event: 'add', path: '/d/b.txt' })
    expect(out.map(e => e.name)).toEqual(['sub', 'a.txt', 'b.txt', 'c.txt'])
    expect(out.find(e => e.name === 'b.txt')!.isDir).toBe(false)
  })
  it('inserts an added directory before files', () => {
    const out = applyDirChange(base, { event: 'addDir', path: '/d/aaa' })
    expect(out.map(e => e.name)).toEqual(['aaa', 'sub', 'a.txt', 'c.txt'])
    expect(out.find(e => e.name === 'aaa')!.isDir).toBe(true)
  })
  it('removes an unlinked file', () => {
    const out = applyDirChange(base, { event: 'unlink', path: '/d/a.txt' })
    expect(out.map(e => e.name)).toEqual(['sub', 'c.txt'])
  })
  it('removes an unlinked directory', () => {
    const out = applyDirChange(base, { event: 'unlinkDir', path: '/d/sub' })
    expect(out.map(e => e.name)).toEqual(['a.txt', 'c.txt'])
  })
  it('ignores a plain change event (content only)', () => {
    expect(applyDirChange(base, { event: 'change', path: '/d/a.txt' })).toEqual(base)
  })
  it('is idempotent for a duplicate add', () => {
    const once = applyDirChange(base, { event: 'add', path: '/d/b.txt' })
    expect(applyDirChange(once, { event: 'add', path: '/d/b.txt' })).toEqual(once)
  })
})
```

- [ ] **Step 2: Run (FAIL)**
Run: `npx vitest run tests/renderer/explorer-tree.test.ts` → FAIL.

- [ ] **Step 3: Create `src/renderer/components/explorer-tree.ts`**
```ts
import type { DirEntry, FsChange } from '@shared/types'

function baseName(p: string): string {
  const m = /[\\/]([^\\/]+)[\\/]?$/.exec(p)
  return m ? m[1] : p
}

function sort(list: DirEntry[]): DirEntry[] {
  return [...list].sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name))
}

/** Apply a single fs change to one directory's child list (pure). */
export function applyDirChange(entries: DirEntry[], change: FsChange): DirEntry[] {
  const name = baseName(change.path)
  switch (change.event) {
    case 'add':
    case 'addDir': {
      if (entries.some(e => e.path === change.path)) return entries
      return sort([...entries, { name, path: change.path, isDir: change.event === 'addDir' }])
    }
    case 'unlink':
    case 'unlinkDir':
      return entries.filter(e => e.path !== change.path)
    default:
      return entries
  }
}
```

- [ ] **Step 4: Run (PASS) + commit**
Run: `npx vitest run tests/renderer/explorer-tree.test.ts` → 6 pass. `npm run typecheck` → clean.
```
git add -A && git commit -m "feat: pure explorer directory-change reducer"
```

---

## Task 6: IPC contract + preload (fs + dialog)

**Files:** Modify `src/shared/ipc-contract.ts`, `src/preload/index.ts`

- [ ] **Step 1: Edit `src/shared/ipc-contract.ts`**
Extend the type import:
```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange } from './types'
```
Add channels to `CH` (before `} as const`; ensure trailing comma on the prior line):
```ts
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsReadDir: 'fs:readDir',
  fsStat: 'fs:stat',
  fsWatch: 'fs:watch',
  fsUnwatch: 'fs:unwatch',
  fsChange: 'fs:change',          // main -> renderer event
  dialogOpenFolder: 'dialog:openFolder',
  dialogOpenFile: 'dialog:openFile'
```
Add to `TermhallaApi`:
```ts
  fsRead(path: string): Promise<ReadResult>
  fsWrite(path: string, content: string): Promise<number>
  fsReadDir(path: string): Promise<DirEntry[]>
  fsStat(path: string): Promise<StatResult>
  fsWatch(id: string, path: string): void
  fsUnwatch(id: string): void
  onFsChange(cb: (id: string, change: FsChange) => void): () => void
  openFolder(): Promise<string | null>
  openFile(): Promise<string | null>
```

- [ ] **Step 2: Edit `src/preload/index.ts`** — add to the `api` object:
```ts
  fsRead: (path) => ipcRenderer.invoke(CH.fsRead, path),
  fsWrite: (path, content) => ipcRenderer.invoke(CH.fsWrite, path, content),
  fsReadDir: (path) => ipcRenderer.invoke(CH.fsReadDir, path),
  fsStat: (path) => ipcRenderer.invoke(CH.fsStat, path),
  fsWatch: (id, path) => ipcRenderer.send(CH.fsWatch, id, path),
  fsUnwatch: (id) => ipcRenderer.send(CH.fsUnwatch, id),
  onFsChange: (cb) => {
    const h = (_e: unknown, id: string, change: import('@shared/types').FsChange) => cb(id, change)
    ipcRenderer.on(CH.fsChange, h as never)
    return () => ipcRenderer.removeListener(CH.fsChange, h as never)
  },
  openFolder: () => ipcRenderer.invoke(CH.dialogOpenFolder),
  openFile: () => ipcRenderer.invoke(CH.dialogOpenFile),
```

- [ ] **Step 3: Typecheck (gate) + commit**
Run: `npm run typecheck` → clean (the `api` object is typed `TermhallaApi`, so a missing method fails here). `npm run build` → succeeds; `grep -o "preload/index\.[a-z]*" out/main/index.js` → `preload/index.mjs`.
```
git add -A && git commit -m "feat: fs + dialog IPC contract and preload bridge"
```

---

## Task 7: Register fs + dialog handlers in main

**Files:** Modify `src/main/ipc/register.ts`

- [ ] **Step 1: Add imports** at the top of `register.ts`:
```ts
import { dialog } from 'electron'
import { readTextFile, writeTextFile, readDirectory, statPath } from '../fs/files'
import { WatchManager } from '../fs/watch-manager'
```
(Merge `dialog` into the existing `electron` import that already has `ipcMain, Notification, type BrowserWindow`.)

- [ ] **Step 2: Inside `registerHandlers(win)`, after the existing handlers and before `return pty`, add:**
```ts
  const watcher = new WatchManager((id, change) => win.webContents.send(CH.fsChange, id, change))
  win.on('closed', () => watcher.closeAll())

  ipcMain.handle(CH.fsRead, (_e, path: string) => readTextFile(path))
  ipcMain.handle(CH.fsWrite, (_e, path: string, content: string) => writeTextFile(path, content))
  ipcMain.handle(CH.fsReadDir, (_e, path: string) => readDirectory(path))
  ipcMain.handle(CH.fsStat, (_e, path: string) => statPath(path))
  ipcMain.on(CH.fsWatch, (_e, id: string, path: string) => watcher.watch(id, path))
  ipcMain.on(CH.fsUnwatch, (_e, id: string) => watcher.unwatch(id))

  ipcMain.handle(CH.dialogOpenFolder, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(CH.dialogOpenFile, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
```
The `CH` import already exists in this file; ensure `CH.fsChange` etc. resolve (they do after Task 6).

- [ ] **Step 3: Typecheck + build + suite + commit**
Run: `npm run typecheck` → clean. `npm run build` → succeeds. `npm test` → all green (no test imports register.ts).
```
git add -A && git commit -m "feat: wire fs read/write/list/stat, watch, and native dialogs in main"
```

---

## Task 8: Store — editor/explorer pane creation + open-from-explorer

**Files:** Modify `src/renderer/store.ts`

- [ ] **Step 1: Edit `src/renderer/store.ts`**
Add to the imports from `@shared/types`: `EditorConfig`, `ExplorerConfig` (merge into the existing type import).

Add to the `State` interface:
```ts
  lastEditorPaneId: string | null
  registerEditorPane: (paneId: string) => void
  addEditor: (wsId: string, targetPaneId: string | null, dir: import('@shared/types').MosaicDirection) => string
  addExplorer: (wsId: string, targetPaneId: string | null, dir: import('@shared/types').MosaicDirection, root: string) => string
  openFileInEditor: (wsId: string, path: string) => void
```
Add `lastEditorPaneId: null,` to the initial state.

Add these actions (after `addTerminal`). They reuse the same `addFirstPane`/`splitPane` model helpers already imported:
```ts
    registerEditorPane: (paneId) => set({ lastEditorPaneId: paneId }),

    addEditor: (wsId, targetPaneId, dir) => {
      const ws = get().workspaces[wsId]
      const cfg: EditorConfig = { kind: 'editor', files: [] }
      const r = ws.layout === null || targetPaneId === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, targetPaneId, dir, cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace }, lastEditorPaneId: r.paneId }))
      void get().saveAll()
      return r.paneId
    },

    addExplorer: (wsId, targetPaneId, dir, root) => {
      const ws = get().workspaces[wsId]
      const cfg: ExplorerConfig = { kind: 'explorer', root }
      const r = ws.layout === null || targetPaneId === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, targetPaneId, dir, cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
      void get().saveAll()
      return r.paneId
    },

    openFileInEditor: (wsId, path) => {
      const ws = get().workspaces[wsId]
      const last = get().lastEditorPaneId
      const editorId = (last && ws.panes[last]?.config.kind === 'editor')
        ? last
        : Object.keys(ws.panes).find(id => ws.panes[id].config.kind === 'editor') ?? null
      if (editorId) {
        const cfg = ws.panes[editorId].config as EditorConfig
        const files = cfg.files.includes(path) ? cfg.files : [...cfg.files, path]
        get().updatePaneConfig(wsId, editorId, { files, activePath: path } as Partial<EditorConfig>)
        set({ lastEditorPaneId: editorId })
      } else {
        const target = Object.keys(ws.panes)[0] ?? null
        const cfg: EditorConfig = { kind: 'editor', files: [path], activePath: path }
        const r = target === null
          ? addFirstPane(ws, cfg, uuid)
          : splitPane(ws, target, 'row', cfg, uuid)
        set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace }, lastEditorPaneId: r.paneId }))
        void get().saveAll()
      }
    },
```
NOTE: `updatePaneConfig`'s patch type is `Partial<TerminalConfig>` from Phase 2. Widen it: change the `State` signature of `updatePaneConfig` to `(wsId: string, paneId: string, patch: Partial<PaneConfig>) => void` and import `PaneConfig`. Since `PaneConfig` is a union, `Partial<PaneConfig>` is awkward; instead type the patch as `Record<string, unknown>` is too loose. Use `patch: Partial<EditorConfig & ExplorerConfig & TerminalConfig>` — simplest correct widening that accepts `{files, activePath}`, `{name, alerts}`, `{root}`. Update the `updatePaneConfig` implementation's spread (`{ ...pane.config, ...patch }`) — it already works structurally; only the type annotation changes. Apply that type change.

- [ ] **Step 2: Typecheck + commit**
Run: `npm run typecheck` → clean. `npm test` → green.
```
git add -A && git commit -m "feat: store actions for editor/explorer panes and open-from-explorer"
```

---

## Task 9: Monaco setup + EditorPane (tabs, dirty, save)

**Files:** Add `monaco-editor`; Create `src/renderer/editor/monaco-setup.ts`, `src/renderer/components/EditorPane.tsx`; Modify `src/renderer/index.html` (CSP)

- [ ] **Step 1: Add monaco**
Run: `npm install monaco-editor@^0.52.0`

- [ ] **Step 2: Relax the renderer CSP for Monaco workers**
In `src/renderer/index.html`, replace the CSP `content` with:
```
default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data:; font-src 'self' data:;
```
(`worker-src blob:` and `'unsafe-eval'` are required by Monaco's bundled workers; this is the minimal relaxation. If the Task 9 e2e shows Monaco works without `'unsafe-eval'`, tighten it back — report if so.)

- [ ] **Step 3: Create `src/renderer/editor/monaco-setup.ts`**
```ts
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(self as any).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

export { monaco }
```

- [ ] **Step 4: Create `src/renderer/components/EditorPane.tsx`** (tabs, per-file models, dirty, Ctrl+S; external-change watch is added in Task 10)
```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { monaco } from '../editor/monaco-setup'
import { languageForPath } from '@shared/language'
import { api } from '../api'
import { useStore } from '../store'
import type { EditorConfig } from '@shared/types'

interface Tab {
  path: string
  model: monaco.editor.ITextModel
  saved: string
  disp: monaco.IDisposable
  tooLarge: boolean
  missing: boolean
}

function base(p: string): string { return p.split(/[\\/]/).pop() ?? p }

export function EditorPane({ paneId, wsId, config }: { paneId: string; wsId: string; config: EditorConfig }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const edRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const tabs = useRef<Map<string, Tab>>(new Map())
  const [order, setOrder] = useState<string[]>(config.files)
  const [active, setActive] = useState<string | undefined>(config.activePath ?? config.files[0])
  const [, force] = useState(0)
  const rerender = useCallback(() => force(x => x + 1), [])
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const registerEditorPane = useStore(s => s.registerEditorPane)

  const persist = useCallback((nextOrder: string[], nextActive: string | undefined) => {
    if (nextOrder.join(' ') === config.files.join(' ') && nextActive === config.activePath) return
    updatePaneConfig(wsId, paneId, { files: nextOrder, activePath: nextActive } as Partial<EditorConfig>)
  }, [wsId, paneId, config.files, config.activePath, updatePaneConfig])

  const setActiveModel = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (t && edRef.current) edRef.current.setModel(t.model)
    setActive(path)
  }, [])

  const openTab = useCallback(async (path: string) => {
    if (tabs.current.has(path)) { setActiveModel(path); return }
    let saved = '', tooLarge = false, missing = false
    try { const r = await api.fsRead(path); saved = r.content; tooLarge = r.tooLarge }
    catch { missing = true }
    const model = monaco.editor.createModel(tooLarge || missing ? '' : saved, languageForPath(path))
    const disp = model.onDidChangeContent(() => rerender())
    tabs.current.set(path, { path, model, saved, disp, tooLarge, missing })
    setOrder(o => (o.includes(path) ? o : [...o, path]))
    setActiveModel(path)
    rerender()
  }, [rerender, setActiveModel])

  const saveActive = useCallback(async () => {
    if (!active) return
    const t = tabs.current.get(active)
    if (!t || t.tooLarge) return
    const value = t.model.getValue()
    await api.fsWrite(active, value)
    t.saved = value
    rerender()
  }, [active, rerender])

  const closeTab = useCallback((path: string) => {
    const t = tabs.current.get(path)
    if (!t) return
    if (!t.tooLarge && !t.missing && t.model.getValue() !== t.saved) {
      const ok = window.confirm(`${base(path)} has unsaved changes. Close anyway?`)
      if (!ok) return
    }
    t.disp.dispose(); t.model.dispose(); tabs.current.delete(path)
    api.fsUnwatch(`${paneId}::${path}`)
    setOrder(o => {
      const next = o.filter(p => p !== path)
      const nextActive = active === path ? next[next.length - 1] : active
      if (nextActive) setActiveModel(nextActive); else { setActive(undefined); edRef.current?.setModel(null) }
      persist(next, nextActive)
      return next
    })
    rerender()
  }, [active, paneId, persist, setActiveModel, rerender])

  // create the editor once
  useEffect(() => {
    const ed = monaco.editor.create(hostRef.current!, {
      automaticLayout: true, theme: 'vs-dark', minimap: { enabled: false }, fontSize: 13
    })
    edRef.current = ed
    registerEditorPane(paneId)
    const focusDisp = ed.onDidFocusEditorText(() => registerEditorPane(paneId))
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveActive() })
    return () => {
      focusDisp.dispose(); ed.dispose()
      for (const t of tabs.current.values()) { t.disp.dispose(); t.model.dispose(); api.fsUnwatch(`${paneId}::${t.path}`) }
      tabs.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  // open any files present in config (initial + when explorer adds one)
  useEffect(() => {
    for (const f of config.files) if (!tabs.current.has(f)) void openTab(f)
    if (config.activePath && tabs.current.has(config.activePath)) setActiveModel(config.activePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.files, config.activePath])

  const activeTab = active ? tabs.current.get(active) : undefined
  const isDirty = (t: Tab | undefined) => !!t && !t.tooLarge && !t.missing && t.model.getValue() !== t.saved

  return (
    <div data-testid={`editor-${paneId}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div data-testid="editor-tabs" style={{ display: 'flex', background: '#1e1e1e', overflowX: 'auto' }}>
        {order.length === 0 && (
          <button data-testid="editor-open-file" onClick={async () => { const p = await api.openFile(); if (p) void openTab(p) }}>
            Open File…
          </button>
        )}
        {order.map(p => {
          const t = tabs.current.get(p)
          return (
            <div key={p} data-testid={`tab-${base(p)}`} onClick={() => setActiveModel(p)}
              style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 8px', cursor: 'pointer',
                background: p === active ? '#333' : 'transparent', color: '#ddd', whiteSpace: 'nowrap' }}>
              <span>{base(p)}{isDirty(t) ? ' •' : ''}</span>
              <button data-testid={`tab-close-${base(p)}`} onClick={e => { e.stopPropagation(); closeTab(p) }}>×</button>
            </div>
          )
        })}
      </div>
      {activeTab?.tooLarge && <div data-testid="editor-toolarge" style={{ color: '#bbb', padding: 8 }}>File too large to open.</div>}
      <div ref={hostRef} style={{ flex: 1, display: activeTab?.tooLarge ? 'none' : 'block' }} />
    </div>
  )
}
```

- [ ] **Step 5: Wire EditorPane into the renderTile switch (temporary, for the e2e)**
This task needs the editor reachable. Apply the Task 12 `renderTile` switch now (it's idempotent with Task 12). In `src/renderer/components/WorkspaceView.tsx`, replace the single `{pane ? <TerminalPane .../> : ...}` child with a kind switch:
```tsx
              {pane?.config.kind === 'terminal' && <TerminalPane paneId={paneId} config={pane.config} />}
              {pane?.config.kind === 'editor' && <EditorPane paneId={paneId} wsId={ws.id} config={pane.config} />}
              {!pane && <div>missing pane</div>}
```
and add `import { EditorPane } from './EditorPane'` at the top. (ExplorerPane is added in Task 11; its branch comes in Task 12.)

- [ ] **Step 6: Create the e2e seed helper `tests/e2e/seed.ts`**
```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function seedWorkspace(
  userData: string,
  panes: Array<{ paneId: string; config: unknown }>,
  layout: unknown
): void {
  const wsDir = join(userData, 'workspaces')
  mkdirSync(wsDir, { recursive: true })
  const panesObj: Record<string, unknown> = {}
  for (const p of panes) panesObj[p.paneId] = { paneId: p.paneId, config: p.config }
  const ws = { id: 'ws-seed', name: 'Seed', layout, panes: panesObj }
  writeFileSync(join(wsDir, 'ws-seed.json'), JSON.stringify({ schemaVersion: 3, workspace: ws }), 'utf8')
  writeFileSync(join(userData, 'app-state.json'),
    JSON.stringify({ schemaVersion: 3, openWorkspaceIds: ['ws-seed'], activeWorkspaceId: 'ws-seed' }), 'utf8')
}
```

- [ ] **Step 7: Create `tests/e2e/editor.spec.ts`** (Monaco renders, edit + save)
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('opens a seeded file in Monaco, edits, and saves to disk', async () => {
  test.setTimeout(40_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ed-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-proj-'))
  const file = join(proj, 'hello.ts')
  writeFileSync(file, 'const a = 1\n', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  // Monaco renders the seeded content
  await expect(win.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 })
  await expect(win.locator('.view-lines')).toContainText('const a = 1', { timeout: 15_000 })
  // edit + save
  await win.locator('.monaco-editor textarea').first().click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('// edited\n')
  await win.keyboard.press('Control+S')
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 10_000 }).toContain('// edited')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 8: Build + run the editor e2e**
Run: `npm run build && npx playwright test tests/e2e/editor.spec.ts`
Expected: PASS — Monaco mounts, shows content, save writes disk. **If Monaco fails to render (blank, worker/CSP errors in console):** read the Electron console (Playwright `win.on('console')`), check the CSP and the `?worker` imports. Monaco-in-Vite issues are almost always worker config or CSP. Do NOT skip — Monaco rendering is the core of this task. Report exact errors if blocked.

- [ ] **Step 9: Full gates + commit**
Run: `npm run typecheck && npm test && npm run build` → all green.
```
git add -A && git commit -m "feat: Monaco editor pane with tabs, dirty tracking, and save"
```

---

## Task 10: EditorPane external-change reload

**Files:** Modify `src/renderer/components/EditorPane.tsx`

- [ ] **Step 1: Add per-file watching + reload logic**
Add this effect to `EditorPane` (after the config-files effect). It watches each open file and reacts to disk changes:
```tsx
  // watch open files for external changes
  useEffect(() => {
    const off = api.onFsChange((id, change) => {
      const prefix = `${paneId}::`
      if (!id.startsWith(prefix)) return
      const path = id.slice(prefix.length)
      const t = tabs.current.get(path)
      if (!t) return
      if (change.event === 'unlink') { t.missing = true; rerender(); return }
      if (change.event !== 'change') return
      const dirty = !t.tooLarge && !t.missing && t.model.getValue() !== t.saved
      if (dirty) { t.externalChanged = true; rerender(); return }  // show reload bar
      void api.fsRead(path).then(r => {
        if (r.tooLarge) return
        t.saved = r.content; t.model.setValue(r.content); t.missing = false; t.externalChanged = false; rerender()
      }).catch(() => {})
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])
```
Extend the `Tab` interface with `externalChanged?: boolean`.
In `openTab`, after creating the tab, start a watch: `api.fsWatch(\`${paneId}::${path}\`, path)`.
Add a reload bar above the editor host, shown when the active tab has `externalChanged`:
```tsx
      {activeTab?.externalChanged && (
        <div data-testid="editor-reloadbar" style={{ background: '#5a4a00', color: '#fff', padding: '2px 8px', display: 'flex', gap: 8 }}>
          <span>Changed on disk.</span>
          <button data-testid="editor-reload" onClick={async () => {
            const t = activeTab; const r = await api.fsRead(t.path).catch(() => null)
            if (r && !r.tooLarge) { t.saved = r.content; t.model.setValue(r.content); t.externalChanged = false; rerender() }
          }}>Reload</button>
          <button data-testid="editor-keepmine" onClick={() => { activeTab.externalChanged = false; rerender() }}>Keep mine</button>
        </div>
      )}
```

- [ ] **Step 2: Add the external-reload e2e to `tests/e2e/editor.spec.ts`**
```ts
test('reloads a clean open file when it changes on disk', async () => {
  test.setTimeout(40_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ed2-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-proj2-'))
  const file = join(proj, 'note.txt')
  writeFileSync(file, 'original', 'utf8')
  seedWorkspace(userData, [{ paneId: 'p1', config: { kind: 'editor', files: [file], activePath: file } }], 'p1')
  const app = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()
  await expect(win.locator('.view-lines')).toContainText('original', { timeout: 20_000 })
  // change the file externally (tab is clean)
  writeFileSync(file, 'changed externally', 'utf8')
  await expect(win.locator('.view-lines')).toContainText('changed externally', { timeout: 10_000 })
  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 3: Build + run + commit**
Run: `npm run build && npx playwright test tests/e2e/editor.spec.ts` → both editor tests pass.
Run: `npm run typecheck` → clean.
```
git add -A && git commit -m "feat: editor reloads clean files / offers reload bar on external change"
```

---

## Task 11: ExplorerPane

**Files:** Create `src/renderer/components/ExplorerPane.tsx`

- [ ] **Step 1: Create `src/renderer/components/ExplorerPane.tsx`**
```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { applyDirChange } from './explorer-tree'
import type { DirEntry, ExplorerConfig } from '@shared/types'

function base(p: string): string { return p.split(/[\\/]/).pop() ?? p }

export function ExplorerPane({ paneId, wsId, config }: { paneId: string; wsId: string; config: ExplorerConfig }) {
  const openFileInEditor = useStore(s => s.openFileInEditor)
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})  // dir path -> entries
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expandedRef = useRef(expanded); expandedRef.current = expanded

  const loadDir = useCallback(async (dir: string) => {
    const entries = await api.fsReadDir(dir).catch(() => [] as DirEntry[])
    setChildren(c => ({ ...c, [dir]: entries }))
    api.fsWatch(`${paneId}::${dir}`, dir)
  }, [paneId])

  const collapse = useCallback((dir: string) => {
    api.fsUnwatch(`${paneId}::${dir}`)
    setExpanded(s => { const n = new Set(s); n.delete(dir); return n })
    setChildren(c => { const n = { ...c }; delete n[dir]; return n })
  }, [paneId])

  const toggle = useCallback((dir: string) => {
    if (expandedRef.current.has(dir)) { collapse(dir); return }
    setExpanded(s => new Set(s).add(dir))
    void loadDir(dir)
  }, [collapse, loadDir])

  // root
  useEffect(() => {
    setExpanded(new Set([config.root]))
    void loadDir(config.root)
    return () => { for (const d of Object.keys(expandedRef.current ? Object.fromEntries(expandedRef.current.size ? [] : []) : {})) void d }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.root])

  // live updates
  useEffect(() => {
    const off = api.onFsChange((id, change) => {
      const prefix = `${paneId}::`
      if (!id.startsWith(prefix)) return
      const dir = id.slice(prefix.length)
      setChildren(c => (c[dir] ? { ...c, [dir]: applyDirChange(c[dir], change) } : c))
    })
    return off
  }, [paneId])

  // cleanup all watches on unmount
  useEffect(() => () => { for (const d of Object.keys(children)) api.fsUnwatch(`${paneId}::${d}`) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const renderDir = (dir: string, depth: number) => {
    const entries = children[dir] ?? []
    return entries.map(e => (
      <div key={e.path}>
        <div data-testid={`entry-${base(e.path)}`}
          onClick={() => e.isDir ? toggle(e.path) : openFileInEditor(wsId, e.path)}
          style={{ paddingLeft: depth * 14 + 6, cursor: 'pointer', color: '#ddd', userSelect: 'none' }}>
          {e.isDir ? (expanded.has(e.path) ? '▾ ' : '▸ ') : '  '}{e.name}
        </div>
        {e.isDir && expanded.has(e.path) && renderDir(e.path, depth + 1)}
      </div>
    ))
  }

  return (
    <div data-testid={`explorer-${paneId}`} style={{ height: '100%', overflow: 'auto', background: '#252526', fontFamily: 'Consolas, monospace', fontSize: 13 }}>
      <div style={{ padding: '4px 6px', color: '#999' }}>{base(config.root)}</div>
      {renderDir(config.root, 0)}
    </div>
  )
}
```
NOTE: keep the root cleanup simple — the unmount effect unwatches every dir currently in `children`. Replace the awkward root-effect return with a no-op (remove the `return () => {...}` line in the root effect; the dedicated cleanup effect handles unwatching). Final root effect:
```tsx
  useEffect(() => {
    setExpanded(new Set([config.root]))
    void loadDir(config.root)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.root])
```

- [ ] **Step 2: Typecheck + build + commit**
Run: `npm run typecheck` → clean. `npm run build` → succeeds.
```
git add -A && git commit -m "feat: live file-explorer pane with lazy expand and open-on-click"
```

---

## Task 12: Wire explorer into renderTile + pane-creation UI

**Files:** Modify `src/renderer/components/WorkspaceView.tsx`, `src/renderer/components/WorkspaceTabs.tsx`

- [ ] **Step 1: Add the explorer branch to `renderTile` in `WorkspaceView.tsx`**
Add the import `import { ExplorerPane } from './ExplorerPane'` and add to the kind switch (alongside the terminal/editor branches from Task 9 Step 5):
```tsx
              {pane?.config.kind === 'explorer' && <ExplorerPane paneId={paneId} wsId={ws.id} config={pane.config} />}
```

- [ ] **Step 2: Replace the empty-workspace block in `WorkspaceView.tsx`** with three creation buttons:
```tsx
  if (ws.layout === null) {
    return (
      <div data-testid="empty-workspace" style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button data-testid="add-first-terminal" onClick={() => addTerminal(ws.id, null, 'row')}>+ Terminal</button>
          <button data-testid="add-first-editor" onClick={() => addEditor(ws.id, null, 'row')}>+ Editor</button>
          <button data-testid="add-first-explorer" onClick={async () => { const r = await openFolder(); if (r) addExplorer(ws.id, null, 'row', r) }}>+ Explorer</button>
        </div>
      </div>
    )
  }
```
Add the needed store selectors + `openFolder` near the other `useStore` calls at the top of `WorkspaceView`:
```tsx
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
```
and `import { api } from '../api'`, using `api.openFolder` (rename the call above to `api.openFolder()`).
> Keep `add-first-terminal` testid so existing Phase 1 e2e still passes.

- [ ] **Step 3: Add a "＋ pane" menu to `WorkspaceTabs.tsx`**
Add, just before the Save button, a small menu that adds a pane to the active workspace by splitting its first pane (or as the first pane). Add to the destructured store values: `activeId, workspaces, addTerminal, addEditor, addExplorer` (some already present). Insert:
```tsx
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
```
Add `import { api } from '../api'` and pull `addTerminal, addEditor, addExplorer, workspaces, activeId` from `useStore()` (workspaces/activeId already destructured; add the three add* actions).

- [ ] **Step 4: Typecheck + build + the full existing e2e + commit**
Run: `npm run typecheck` → clean. `npm run build` → succeeds. `npm run e2e` → Phase 1+2 e2e (8) + editor (2) still pass.
```
git add -A && git commit -m "feat: render editor/explorer panes; pane-creation buttons and menu"
```

---

## Task 13: Explorer end-to-end (open, live-watch)

**Files:** Create `tests/e2e/explorer.spec.ts`

- [ ] **Step 1: Create `tests/e2e/explorer.spec.ts`**
```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedWorkspace } from './seed'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('explorer lists files, opens one in the editor, and reflects external creates', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ex-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-exproj-'))
  writeFileSync(join(proj, 'readme.md'), '# hello world', 'utf8')
  // a workspace with an explorer (left) and an editor (right), tiled
  seedWorkspace(userData,
    [{ paneId: 'pe', config: { kind: 'explorer', root: proj } },
     { paneId: 'ed', config: { kind: 'editor', files: [] } }],
    { direction: 'row', first: 'pe', second: 'ed' })

  const app = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
  const win = await app.firstWindow()

  // tree shows the seeded file
  await expect(win.getByTestId('entry-readme.md')).toBeVisible({ timeout: 20_000 })
  // clicking it opens it in the editor with content
  await win.getByTestId('entry-readme.md').click()
  await expect(win.locator('.view-lines')).toContainText('hello world', { timeout: 15_000 })
  // an externally-created file appears live
  writeFileSync(join(proj, 'new-file.txt'), 'x', 'utf8')
  await expect(win.getByTestId('entry-new-file.txt')).toBeVisible({ timeout: 10_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 2: Build + run + commit**
Run: `npm run build && npx playwright test tests/e2e/explorer.spec.ts` → PASS.
If the editor doesn't receive the file (open-from-explorer), check `openFileInEditor` targets the seeded `ed` editor pane (it has `kind:'editor'`), and that `EditorPane`'s config-files effect opens the newly-added path. Report real failures.
```
git add -A && git commit -m "test: e2e explorer open-in-editor and live file creation"
```

---

## Task 14: Phase 3 verification pass

- [ ] **Step 1: Full gates**
Run: `npm run typecheck && npm test && npm run build && npm run e2e`
Expected: typecheck clean; all unit tests pass (Phase 1/2 66 + language ~3 + pane-union 3 + fs-files 7 + watch 2 + explorer-tree 6 = ~87 — report exact); build succeeds; all e2e pass (Phase 1/2 8 + editor 2 + explorer 1 = 11).

- [ ] **Step 2: Manual acceptance**
In `npm run dev`, confirm by hand:
- Empty workspace → "+ Editor" makes a Monaco pane; "Open File…" opens a file; edit shows a dirty dot; Ctrl+S clears it and writes disk.
- "+ Explorer" prompts for a folder, shows a live tree; expanding folders loads children; creating/deleting files on disk updates the tree.
- Clicking a file in the explorer opens it as a tab in an editor pane (creating one if none exists).
- Editing a file, then changing it on disk: clean tab silently reloads; dirty tab shows the reload bar.
- Save a workspace with editor + explorer panes, restart → panes restore (files reopened fresh, explorer re-rooted).
- The "＋ pane" menu adds each pane type to the active workspace.

- [ ] **Step 3: Commit any adjustments**
```
git add -A && git commit -m "chore: phase 3 verification adjustments"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** pane union + renderTile switch ✓ (Tasks 1, 9, 12); schema v3 + v2 loads ✓ (Task 1); main fs read/write/list/stat with size+binary guards ✓ (Task 3); chokidar live watching ✓ (Task 4); native dialogs ✓ (Tasks 6–7); Monaco editor with per-file tabs/models, dirty, Ctrl+S ✓ (Task 9); large/binary handling ✓ (Task 3 `tooLarge` + Task 9 notice); external-change reload (clean silent / dirty bar / deleted) ✓ (Task 10); explorer lazy tree + live reducer + open-on-click ✓ (Tasks 5, 11); open-from-explorer rule (last editor pane, else create) ✓ (Task 8); pane-creation UI ✓ (Task 12); restore semantics (fresh reopen) ✓ (config-driven, no process/edit resurrection); tests ✓ (Tasks 2–5 unit, 3–4 integration, 9/10/13 e2e).
- **Type consistency:** `PaneConfig` union members (`kind` discriminants), `DirEntry/ReadResult/StatResult/FsChange/FsEvent`, `EditorConfig{files,activePath}`, `ExplorerConfig{root}`, the `CH.fs*`/`CH.dialog*` channels, and `TermhallaApi` fs methods are used identically across tasks. `updatePaneConfig` is widened to accept editor/explorer patches (Task 8). Watch ids use the `${paneId}::${path}` convention consistently in EditorPane (Tasks 9–10) and ExplorerPane (Task 11).
- **Native-dialog testing gap (flagged, mitigated):** `dialog:openFolder/openFile` can't be driven by Playwright (OS dialogs). Editor/explorer e2e therefore seed a workspace JSON (`tests/e2e/seed.ts`) so panes exist without dialogs; the dialog wrappers are covered by manual acceptance (Task 14 Step 2).
- **Monaco risk (flagged):** the one runtime risk is Monaco worker/CSP bundling; Task 9's e2e is the gate and includes explicit debugging guidance (console capture, worker imports, CSP) before any other editor work proceeds.
```