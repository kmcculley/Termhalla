# SSH + Favorites/Recents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch terminals straight into SSH of a saved remote, and add an app-global favorites/recents layer (saved SSH connections + recent connections + favorite/recent dirs) reached through a Ctrl+K command palette.

**Architecture:** A new app-global `QuickStore` is persisted to `quick.json` in `userData` (same main-process + IPC pattern as the workspace store). An SSH terminal is an ordinary terminal pane carrying a self-contained `launch` override on its `TerminalConfig`; `PtyManager` runs that command instead of a discovered shell and skips shell-integration injection. A renderer `CommandPalette` (Ctrl+K) launches connections and dirs; a `SshConnectionForm` modal creates/edits connections. Pure logic (SSH argv, MRU recents, palette build/filter, spawn resolution) is unit-tested with vitest; the wired UI + spawn routing is verified by a hermetic Playwright e2e.

**Tech Stack:** Electron + TypeScript (strict), electron-vite, React, zustand, react-mosaic, xterm.js, node-pty, vitest, @playwright/test (Electron). Path alias `@shared/*` → `src/shared/*`.

**Spec:** `docs/superpowers/specs/2026-06-14-termhalla-ssh-favorites-design.md`

---

## File Structure

**New files:**
- `src/shared/quick.ts` — pure helpers: `buildSshArgs`, `pushRecent`, `nextRecentDirs`, `PaletteItem`, `buildPaletteItems`, `filterPaletteItems`.
- `src/main/pty/spawn-spec.ts` — pure `resolveSpawnSpec(shell, scriptDir, launch?)` deciding file/args/env (shell-injection vs. launch override).
- `src/main/persistence/quick-store.ts` — `QuickStore` read/write against `quick.json`.
- `src/renderer/components/CommandPalette.tsx` — Ctrl+K overlay.
- `src/renderer/components/SshConnectionForm.tsx` — connection modal.
- `tests/shared/quick.test.ts`, `tests/main/spawn-spec.test.ts`, `tests/main/quick-store.test.ts`, `tests/e2e/ssh-quick.spec.ts`.

**Modified files:**
- `src/shared/types.ts` — `SshConnection`, `QuickStore`, `EMPTY_QUICK`, `TerminalLaunch`; `TerminalConfig.launch?`/`connectionId?`.
- `src/shared/ipc-contract.ts` — `quick:load`/`quick:save`/`app:homeDir` channels, API methods, `PtySpawnArgs.launch?`.
- `src/main/pty/pty-manager.ts` — use `resolveSpawnSpec`; add `launch` param to `spawn`; guard spawn failures.
- `src/main/ipc/register.ts` — route launch in `ptySpawn`; quick + homeDir handlers.
- `src/preload/index.ts` — expose new API methods.
- `src/renderer/components/TerminalPane.tsx` — pass `config.launch` through `ptySpawn`.
- `src/renderer/store.ts` — quick state, load/save, connection CRUD, launch actions, recents hook on `setCwd`.
- `src/renderer/App.tsx` — load quick in init path, Ctrl+K, render palette + form.

---

## Task 1: Shared types + SSH/recents pure helpers

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/quick.ts`
- Test: `tests/shared/quick.test.ts`

- [ ] **Step 1: Add the new types to `src/shared/types.ts`**

Insert after the `AlertConfig` interface (before `TerminalConfig`):

```ts
export interface TerminalLaunch {
  command: string
  args: string[]
  title: string
}

/** A saved SSH connection. No secrets stored — only host/user/port and an identity-file path. */
export interface SshConnection {
  id: string
  name: string
  host: string
  user: string
  port?: number          // default 22
  identityFile?: string  // path to a private key; optional
}

/** App-global favorites/recents (persisted to quick.json, not per-workspace). */
export interface QuickStore {
  connections: SshConnection[]
  recentConnections: string[]   // connection ids, most-recently-used
  favoriteDirs: string[]        // user-pinned (★)
  recentDirs: string[]          // MRU, deduped, capped, home excluded
}

export const EMPTY_QUICK: QuickStore = {
  connections: [], recentConnections: [], favoriteDirs: [], recentDirs: []
}
```

Then extend `TerminalConfig` (add the two optional fields):

```ts
export interface TerminalConfig {
  kind: 'terminal'
  shellId: string
  cwd: string
  name?: string
  alerts?: AlertConfig
  launch?: TerminalLaunch   // when set, run this instead of a discovered shell (SSH)
  connectionId?: string     // links back to the saved SshConnection, for display
}
```

Leave `SCHEMA_VERSION = 3` unchanged — the new fields are optional and backward-compatible.

- [ ] **Step 2: Write the failing test `tests/shared/quick.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildSshArgs, pushRecent, nextRecentDirs } from '@shared/quick'
import type { SshConnection } from '@shared/types'

const base: SshConnection = { id: 'c1', name: 'box', host: 'example.com', user: 'kev' }

describe('buildSshArgs', () => {
  it('omits port when default (22) and identity when unset', () => {
    expect(buildSshArgs(base)).toEqual(['kev@example.com'])
    expect(buildSshArgs({ ...base, port: 22 })).toEqual(['kev@example.com'])
  })
  it('adds -p for a non-default port', () => {
    expect(buildSshArgs({ ...base, port: 2222 })).toEqual(['-p', '2222', 'kev@example.com'])
  })
  it('adds -i for an identity file', () => {
    expect(buildSshArgs({ ...base, identityFile: 'C:\\keys\\id' }))
      .toEqual(['-i', 'C:\\keys\\id', 'kev@example.com'])
  })
  it('orders port before identity before target', () => {
    expect(buildSshArgs({ ...base, port: 2200, identityFile: 'k' }))
      .toEqual(['-p', '2200', '-i', 'k', 'kev@example.com'])
  })
})

describe('pushRecent', () => {
  it('prepends, de-dupes to front, and caps', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 5)).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
})

describe('nextRecentDirs', () => {
  const home = 'C:\\Users\\kev'
  it('prepends a visited dir and de-dupes case-insensitively', () => {
    expect(nextRecentDirs(['C:\\a'], 'C:\\B', home)).toEqual(['C:\\B', 'C:\\a'])
    expect(nextRecentDirs(['C:\\a', 'C:\\b'], 'c:\\A', home)).toEqual(['c:\\A', 'C:\\b'])
  })
  it('skips the home directory (trailing-slash/case insensitive)', () => {
    expect(nextRecentDirs(['C:\\a'], 'C:\\Users\\kev\\', home)).toEqual(['C:\\a'])
  })
  it('ignores an empty dir and respects the cap', () => {
    expect(nextRecentDirs(['x'], '', home)).toEqual(['x'])
    expect(nextRecentDirs(['a', 'b'], 'c', home, 2)).toEqual(['c', 'a'])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- quick`
Expected: FAIL — `Cannot find module '@shared/quick'`.

- [ ] **Step 4: Create `src/shared/quick.ts` with the helpers**

```ts
import type { SshConnection } from './types'

/** Build the argv after the `ssh` program: `[-p PORT] [-i IDENTITY] user@host`. */
export function buildSshArgs(c: SshConnection): string[] {
  const args: string[] = []
  if (c.port && c.port !== 22) args.push('-p', String(c.port))
  if (c.identityFile && c.identityFile.length > 0) args.push('-i', c.identityFile)
  args.push(`${c.user}@${c.host}`)
  return args
}

/** MRU: move/insert `value` at the front, de-dupe (strict equality), cap length. */
export function pushRecent<T>(list: T[], value: T, cap: number): T[] {
  return [value, ...list.filter(v => v !== value)].slice(0, cap)
}

export const RECENT_DIR_CAP = 20

const normDir = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()

/** MRU for directories: skip empty + the home dir, de-dupe case/trailing-slash-insensitively. */
export function nextRecentDirs(
  recent: string[], dir: string, home: string, cap: number = RECENT_DIR_CAP
): string[] {
  if (!dir) return recent
  if (home && normDir(dir) === normDir(home)) return recent
  const filtered = recent.filter(d => normDir(d) !== normDir(dir))
  return [dir, ...filtered].slice(0, cap)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- quick`
Expected: PASS (all `buildSshArgs` / `pushRecent` / `nextRecentDirs` cases green).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/quick.ts tests/shared/quick.test.ts
git commit -m "feat(ssh): add SSH/recents types and pure helpers"
```

---

## Task 2: Command-palette item building + filtering (pure)

**Files:**
- Modify: `src/shared/quick.ts`
- Test: `tests/shared/quick.test.ts` (append)

- [ ] **Step 1: Append the failing tests to `tests/shared/quick.test.ts`**

```ts
import { buildPaletteItems, filterPaletteItems } from '@shared/quick'
import type { QuickStore } from '@shared/types'

const quick: QuickStore = {
  connections: [
    { id: 'c1', name: 'alpha', host: 'a.example', user: 'kev' },
    { id: 'c2', name: 'beta', host: 'b.example', user: 'kev', port: 2222 }
  ],
  recentConnections: ['c2'],
  favoriteDirs: ['C:\\proj'],
  recentDirs: ['C:\\proj', 'C:\\work']
}

describe('buildPaletteItems', () => {
  it('orders recent connections first, then the rest', () => {
    const items = buildPaletteItems(quick, 'C:\\cwd')
    const conns = items.filter(i => i.kind === 'connection')
    expect(conns.map(i => (i as { id: string }).id)).toEqual(['c2', 'c1'])
  })
  it('lists favorite dirs, then recent dirs that are not already favorites', () => {
    const dirs = buildPaletteItems(quick, 'C:\\cwd').filter(i => i.kind === 'dir') as
      { path: string; favorite: boolean }[]
    expect(dirs).toEqual([
      { kind: 'dir', path: 'C:\\proj', favorite: true, search: 'c:\\proj' },
      { kind: 'dir', path: 'C:\\work', favorite: false, search: 'c:\\work' }
    ])
  })
  it('always offers New SSH connection, and Pin only when a cwd is known', () => {
    const withCwd = buildPaletteItems(quick, 'C:\\cwd').filter(i => i.kind === 'action')
    expect(withCwd.map(i => (i as { action: string }).action)).toEqual(['new-connection', 'pin-cwd'])
    const noCwd = buildPaletteItems(quick, '').filter(i => i.kind === 'action')
    expect(noCwd.map(i => (i as { action: string }).action)).toEqual(['new-connection'])
  })
})

describe('filterPaletteItems', () => {
  const items = buildPaletteItems(quick, 'C:\\cwd')
  it('returns everything for an empty query', () => {
    expect(filterPaletteItems(items, '   ')).toEqual(items)
  })
  it('substring-matches name/host/path case-insensitively', () => {
    expect(filterPaletteItems(items, 'beta').map(i => i.kind)).toEqual(['connection'])
    expect(filterPaletteItems(items, 'work').map(i => i.kind)).toEqual(['dir'])
    expect(filterPaletteItems(items, 'b.example').map(i => i.kind)).toEqual(['connection'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- quick`
Expected: FAIL — `buildPaletteItems`/`filterPaletteItems` are not exported.

- [ ] **Step 3: Append the implementation to `src/shared/quick.ts`**

Add `QuickStore` to the existing type import (`import type { SshConnection, QuickStore } from './types'`), then append:

```ts
export type PaletteItem =
  | { kind: 'connection'; id: string; label: string; detail: string; search: string }
  | { kind: 'dir'; path: string; favorite: boolean; search: string }
  | { kind: 'action'; action: 'new-connection' | 'pin-cwd'; label: string; search: string }

/** Build the merged, ordered palette list: connections (recent-first), favorite dirs,
 *  recent dirs (minus favorites), then the New-connection and (cwd-gated) Pin actions. */
export function buildPaletteItems(q: QuickStore, currentCwd: string): PaletteItem[] {
  const items: PaletteItem[] = []

  const order: string[] = q.recentConnections.filter(id => q.connections.some(c => c.id === id))
  for (const c of q.connections) if (!order.includes(c.id)) order.push(c.id)
  for (const id of order) {
    const c = q.connections.find(x => x.id === id)
    if (!c) continue
    const detail = `${c.user}@${c.host}${c.port && c.port !== 22 ? ':' + c.port : ''}`
    items.push({ kind: 'connection', id: c.id, label: c.name, detail,
      search: `${c.name} ${detail}`.toLowerCase() })
  }

  for (const d of q.favoriteDirs) {
    items.push({ kind: 'dir', path: d, favorite: true, search: d.toLowerCase() })
  }
  for (const d of q.recentDirs) {
    if (q.favoriteDirs.includes(d)) continue
    items.push({ kind: 'dir', path: d, favorite: false, search: d.toLowerCase() })
  }

  items.push({ kind: 'action', action: 'new-connection', label: 'New SSH connection…',
    search: 'new ssh connection' })
  if (currentCwd) {
    items.push({ kind: 'action', action: 'pin-cwd', label: `Pin current directory (${currentCwd})`,
      search: `pin current directory ${currentCwd.toLowerCase()}` })
  }
  return items
}

/** Case-insensitive substring filter; an empty/whitespace query returns the list unchanged. */
export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(i => i.search.includes(q))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- quick`
Expected: PASS (all Task 1 + Task 2 cases green).

- [ ] **Step 5: Commit**

```bash
git add src/shared/quick.ts tests/shared/quick.test.ts
git commit -m "feat(ssh): add command-palette item build/filter helpers"
```

---

## Task 3: Spawn resolution + launch override in PtyManager

**Files:**
- Create: `src/main/pty/spawn-spec.ts`
- Test: `tests/main/spawn-spec.test.ts`
- Modify: `src/main/pty/pty-manager.ts`
- Modify: `src/shared/ipc-contract.ts:32` (`PtySpawnArgs`)
- Modify: `src/main/ipc/register.ts:46-49` (`ptySpawn` handler)
- Modify: `src/renderer/components/TerminalPane.tsx:19-22,38`

- [ ] **Step 1: Write the failing test `tests/main/spawn-spec.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { resolveSpawnSpec } from '../../src/main/pty/spawn-spec'
import type { ShellInfo } from '@shared/types'

const pwsh: ShellInfo = { id: 'pwsh', label: 'PowerShell 7', path: 'C:\\pwsh.exe', args: [] }
const cmd: ShellInfo = { id: 'cmd', label: 'cmd', path: 'C:\\cmd.exe', args: [] }

describe('resolveSpawnSpec', () => {
  it('uses the launch override verbatim and injects nothing', () => {
    const spec = resolveSpawnSpec(cmd, 'C:\\scripts',
      { command: 'ssh', args: ['kev@host'], title: 'box' })
    expect(spec).toEqual({ file: 'ssh', args: ['kev@host'] })
  })
  it('injects shell integration for an integrated shell', () => {
    const spec = resolveSpawnSpec(pwsh, 'C:\\scripts')
    expect(spec.file).toBe('C:\\pwsh.exe')
    expect(spec.args).toContain('-NoExit')
    expect(spec.env).toEqual({})
  })
  it('falls back to the shell args for a non-integrated shell', () => {
    const spec = resolveSpawnSpec(cmd, 'C:\\scripts')
    expect(spec).toEqual({ file: 'C:\\cmd.exe', args: [], env: undefined })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- spawn-spec`
Expected: FAIL — `Cannot find module '../../src/main/pty/spawn-spec'`.

- [ ] **Step 3: Create `src/main/pty/spawn-spec.ts`**

```ts
import type { ShellInfo } from '@shared/types'
import { shellInjection } from '../status/shell-integration'

export interface SpawnSpec {
  file: string
  args: string[]
  env?: Record<string, string>
}

/** Decide what to actually spawn: a launch override (e.g. ssh) runs verbatim with no
 *  shell-integration injection; otherwise the shell's integrated args/env (or its own args). */
export function resolveSpawnSpec(
  shell: ShellInfo, scriptDir: string,
  launch?: { command: string; args: string[] }
): SpawnSpec {
  if (launch) return { file: launch.command, args: launch.args }
  const inj = shellInjection(shell, scriptDir)
  return { file: shell.path, args: inj ? inj.args : shell.args, env: inj?.env }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- spawn-spec`
Expected: PASS.

- [ ] **Step 5: Rewrite `src/main/pty/pty-manager.ts` to use `resolveSpawnSpec`, accept a launch override, and guard spawn failures**

Replace the whole file with:

```ts
import * as pty from 'node-pty'
import type { ShellInfo, TerminalLaunch } from '@shared/types'
import { StatusEngine } from '../status/status-engine'
import { resolveSpawnSpec } from './spawn-spec'
import { sanitizeShellEnv } from './env'

export interface PtySession { id: string; proc: pty.IPty }

export class PtyManager {
  private sessions = new Map<string, PtySession>()

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, code: number) => void,
    private readonly engine: StatusEngine,
    private readonly scriptDir: string
  ) {}

  spawn(id: string, shell: ShellInfo, cwd: string, cols = 80, rows = 24, launch?: TerminalLaunch): void {
    if (this.sessions.has(id)) return
    const dir = cwd && cwd.length ? cwd : (process.env.USERPROFILE ?? process.env.HOME ?? process.cwd())
    const spec = resolveSpawnSpec(shell, this.scriptDir, launch)
    this.engine.register(id)

    let proc: pty.IPty
    try {
      proc = pty.spawn(spec.file, spec.args, {
        name: 'xterm-256color', cols, rows, cwd: dir,
        env: sanitizeShellEnv({ ...process.env, ...(spec.env ?? {}) })
      })
    } catch (e) {
      // A bad launch command (e.g. ssh not on PATH) must not crash main. Surface it
      // to the pane like a process that exited, and unwind the engine registration.
      this.onData(id, `\r\n[failed to launch ${spec.file}: ${(e as Error).message}]\r\n`)
      this.engine.markExit(id, 1); this.engine.unregister(id)
      this.onExit(id, 1)
      return
    }

    proc.onData(d => { this.engine.feed(id, d); this.onData(id, d) })
    proc.onExit(({ exitCode }) => {
      this.engine.markExit(id, exitCode); this.engine.unregister(id)
      this.onExit(id, exitCode); this.sessions.delete(id)
    })
    this.sessions.set(id, { id, proc })
  }

  write(id: string, data: string): void { this.sessions.get(id)?.proc.write(data) }
  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.proc.resize(Math.max(cols, 1), Math.max(rows, 1))
  }
  kill(id: string): void {
    this.sessions.get(id)?.proc.kill(); this.engine.unregister(id); this.sessions.delete(id)
  }
  killAll(): void { for (const id of [...this.sessions.keys()]) this.kill(id) }
}
```

- [ ] **Step 6: Add `launch?` to `PtySpawnArgs` in `src/shared/ipc-contract.ts`**

Change the import on line 1 to include `TerminalLaunch`:

```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch } from './types'
```

Change `PtySpawnArgs` (line 32):

```ts
export interface PtySpawnArgs { id: string; shellId: string; cwd: string; cols: number; rows: number; launch?: TerminalLaunch }
```

- [ ] **Step 7: Route the launch override in the `ptySpawn` handler `src/main/ipc/register.ts:46-49`**

```ts
  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows, a.launch)
  })
```

- [ ] **Step 8: Pass `config.launch` through in `src/renderer/components/TerminalPane.tsx`**

Update the `ptySpawn` call (lines 19-22):

```ts
    api.ptySpawn({
      id: paneId, shellId: config.shellId, cwd: config.cwd,
      cols: term.cols, rows: term.rows, launch: config.launch
    })
```

And add `config.launch` to the effect dependency array (line 38) so a config gaining a launch re-spawns correctly. Because `launch` is an object, depend on a stable primitive:

```ts
  }, [paneId, config.shellId, config.cwd, config.launch?.command, JSON.stringify(config.launch?.args)])
```

- [ ] **Step 9: Build to typecheck the wiring**

Run: `npm run build`
Expected: SUCCESS — no TypeScript errors. (`npm run build` runs `electron-vite build`, which typechecks all three bundles.)

- [ ] **Step 10: Run the full unit suite (no regressions)**

Run: `npm test`
Expected: PASS — existing suites plus the new `quick` and `spawn-spec` tests.

- [ ] **Step 11: Commit**

```bash
git add src/main/pty/spawn-spec.ts tests/main/spawn-spec.test.ts src/main/pty/pty-manager.ts src/shared/ipc-contract.ts src/main/ipc/register.ts src/renderer/components/TerminalPane.tsx
git commit -m "feat(ssh): launch override + spawn resolution in PtyManager"
```

---

## Task 4: QuickStore persistence + IPC (load/save + homeDir)

**Files:**
- Create: `src/main/persistence/quick-store.ts`
- Test: `tests/main/quick-store.test.ts`
- Modify: `src/shared/ipc-contract.ts` (channels, API methods)
- Modify: `src/main/ipc/register.ts` (handlers)
- Modify: `src/preload/index.ts` (expose methods)

- [ ] **Step 1: Write the failing test `tests/main/quick-store.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuickStore } from '../../src/main/persistence/quick-store'
import { EMPTY_QUICK } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-quick-')) })

describe('QuickStore', () => {
  it('returns an empty store when quick.json is missing', async () => {
    const store = new QuickStore(dir)
    expect(await store.load()).toEqual(EMPTY_QUICK)
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a saved store', async () => {
    const store = new QuickStore(dir)
    const data = {
      connections: [{ id: 'c1', name: 'box', host: 'h', user: 'u', port: 2222 }],
      recentConnections: ['c1'],
      favoriteDirs: ['C:\\proj'],
      recentDirs: ['C:\\proj', 'C:\\work']
    }
    await store.save(data)
    expect(await store.load()).toEqual(data)
    rmSync(dir, { recursive: true, force: true })
  })

  it('falls back to empty on a corrupt file', async () => {
    const store = new QuickStore(dir)
    await store.save({ ...EMPTY_QUICK })
    rmSync(join(dir, 'quick.json'))
    expect(await store.load()).toEqual(EMPTY_QUICK)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- quick-store`
Expected: FAIL — `Cannot find module '../../src/main/persistence/quick-store'`.

- [ ] **Step 3: Create `src/main/persistence/quick-store.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EMPTY_QUICK, type QuickStore as QuickData } from '@shared/types'

export class QuickStore {
  constructor(private readonly baseDir: string) {}

  private file() { return join(this.baseDir, 'quick.json') }

  async load(): Promise<QuickData> {
    try {
      const parsed = JSON.parse(await readFile(this.file(), 'utf8')) as Partial<QuickData>
      return {
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        recentConnections: Array.isArray(parsed.recentConnections) ? parsed.recentConnections : [],
        favoriteDirs: Array.isArray(parsed.favoriteDirs) ? parsed.favoriteDirs : [],
        recentDirs: Array.isArray(parsed.recentDirs) ? parsed.recentDirs : []
      }
    } catch {
      return { ...EMPTY_QUICK }
    }
  }

  async save(data: QuickData): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(this.file(), JSON.stringify(data, null, 2), 'utf8')
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- quick-store`
Expected: PASS.

- [ ] **Step 5: Add channels + API methods to `src/shared/ipc-contract.ts`**

Add `QuickStore` to the type import on line 1:

```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore } from './types'
```

Add three channels to the `CH` object (after `revealPath` on line 28 — add a comma after `revealPath: 'shell:reveal'`):

```ts
  revealPath: 'shell:reveal',
  quickLoad: 'quick:load',
  quickSave: 'quick:save',
  homeDir: 'app:homeDir'
} as const
```

Add the methods to the `TermhallaApi` interface (after `revealPath` on line 61):

```ts
  loadQuick(): Promise<QuickStore>
  saveQuick(data: QuickStore): Promise<void>
  homeDir(): Promise<string>
```

- [ ] **Step 6: Add handlers in `src/main/ipc/register.ts`**

First instantiate a `QuickStore` next to the `WorkspaceStore` (after line 15 `const store = new WorkspaceStore(userDataDir())`). Add the import at the top alongside the existing persistence imports:

```ts
import { QuickStore } from '../persistence/quick-store'
```

```ts
  const quick = new QuickStore(userDataDir())
```

Then register handlers (add near the other `ipcMain.handle` calls, e.g. after the `revealPath` handler on line 79):

```ts
  ipcMain.handle(CH.quickLoad, () => quick.load())
  ipcMain.handle(CH.quickSave, (_e, data: import('@shared/types').QuickStore) => quick.save(data))
  ipcMain.handle(CH.homeDir, () => process.env.USERPROFILE ?? process.env.HOME ?? '')
```

- [ ] **Step 7: Expose the methods in `src/preload/index.ts`**

Add to the `api` object (after `revealPath` on line 44):

```ts
  loadQuick: () => ipcRenderer.invoke(CH.quickLoad),
  saveQuick: (data) => ipcRenderer.invoke(CH.quickSave, data),
  homeDir: () => ipcRenderer.invoke(CH.homeDir),
```

- [ ] **Step 8: Build to typecheck and run units**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — bundles typecheck, `quick-store` tests green, no regressions.

- [ ] **Step 9: Commit**

```bash
git add src/main/persistence/quick-store.ts tests/main/quick-store.test.ts src/shared/ipc-contract.ts src/main/ipc/register.ts src/preload/index.ts
git commit -m "feat(ssh): QuickStore persistence + quick/homeDir IPC"
```

---

## Task 5: Renderer store — quick state, CRUD, launch actions, recents hook

**Files:**
- Modify: `src/renderer/store.ts`

This task wires the pure helpers and IPC into zustand. The store has no unit tests by convention (verified by e2e in Task 8); each step ends with a typecheck build.

- [ ] **Step 1: Extend imports and the `State` interface in `src/renderer/store.ts`**

Add to the `@shared/types` import (line 3) the new types, and import the quick helpers + uuid is already present:

```ts
import type { Workspace, ShellInfo, MosaicNode, MosaicDirection, TerminalConfig, TerminalStatus, PaneConfig, EditorConfig, ExplorerConfig, QuickStore, SshConnection } from '@shared/types'
import { EMPTY_QUICK } from '@shared/types'
import { buildSshArgs, nextRecentDirs, pushRecent } from '@shared/quick'
```

Add these members to the `State` interface (after `openExplorerHere` on line 34):

```ts
  quick: QuickStore
  home: string
  paletteOpen: boolean
  connectionFormFor: SshConnection | 'new' | null
  loadQuick: () => Promise<void>
  setPaletteOpen: (open: boolean) => void
  setConnectionForm: (target: SshConnection | 'new' | null) => void
  saveConnection: (conn: SshConnection) => void
  deleteConnection: (id: string) => void
  pinDir: (dir: string) => void
  unpinDir: (dir: string) => void
  launchConnection: (connId: string) => void
  launchDir: (dir: string) => void
```

- [ ] **Step 2: Add a debounced quick-save helper and initial state**

Inside the `create<State>((set, get) => { ... })` body, alongside `scheduleAutosave` (after line 76), add:

```ts
  let quickTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleQuickSave = () => {
    if (quickTimer) clearTimeout(quickTimer)
    quickTimer = setTimeout(() => { void api.saveQuick(get().quick) }, 500)
  }
```

Add initial values to the returned object (next to `cwds: {}` on line 86):

```ts
    quick: EMPTY_QUICK,
    home: '',
    paletteOpen: false,
    connectionFormFor: null,
```

- [ ] **Step 3: Load quick + home during `init`**

In the `init` action, after `const shells = await api.listShells()` (line 89), add:

```ts
      const [quick, home] = await Promise.all([api.loadQuick(), api.homeDir()])
      set({ quick, home })
```

(Place this before the `set({ shells, ... })` call so it does not get clobbered; both `set` calls merge.)

- [ ] **Step 4: Hook `setCwd` to push into `recentDirs`**

Replace the `setCwd` action (lines 161-165) with:

```ts
    setCwd: (id, cwd) => {
      if (get().cwds[id] === cwd) return
      set(s => ({ cwds: { ...s.cwds, [id]: cwd } }))
      const q = get().quick
      const recentDirs = nextRecentDirs(q.recentDirs, cwd, get().home)
      if (recentDirs !== q.recentDirs) {
        set({ quick: { ...q, recentDirs } })
        scheduleQuickSave()
      }
      scheduleAutosave()   // persist into config.cwd (debounced) so restore uses it
    },
```

- [ ] **Step 5: Add the quick actions**

Add these actions to the returned object (after `openExplorerHere`, before `openFileInEditor` on line 207). `loadQuick` is provided for completeness/refresh; `init` already loads:

```ts
    loadQuick: async () => {
      const [quick, home] = await Promise.all([api.loadQuick(), api.homeDir()])
      set({ quick, home })
    },

    setPaletteOpen: (open) => set({ paletteOpen: open }),
    setConnectionForm: (target) => set({ connectionFormFor: target }),

    saveConnection: (conn) => {
      const q = get().quick
      const exists = q.connections.some(c => c.id === conn.id)
      const connections = exists
        ? q.connections.map(c => (c.id === conn.id ? conn : c))
        : [...q.connections, conn]
      set({ quick: { ...q, connections } })
      scheduleQuickSave()
    },

    deleteConnection: (id) => {
      const q = get().quick
      set({ quick: { ...q,
        connections: q.connections.filter(c => c.id !== id),
        recentConnections: q.recentConnections.filter(rid => rid !== id) } })
      scheduleQuickSave()
    },

    pinDir: (dir) => {
      const q = get().quick
      if (!dir || q.favoriteDirs.includes(dir)) return
      set({ quick: { ...q, favoriteDirs: [...q.favoriteDirs, dir] } })
      scheduleQuickSave()
    },

    unpinDir: (dir) => {
      const q = get().quick
      set({ quick: { ...q, favoriteDirs: q.favoriteDirs.filter(d => d !== dir) } })
      scheduleQuickSave()
    },

    launchConnection: (connId) => {
      const wsId = get().activeId
      if (!wsId) return
      const conn = get().quick.connections.find(c => c.id === connId)
      if (!conn) return
      const ws = get().workspaces[wsId]
      const target = ws.layout ? Object.keys(ws.panes)[0] : null
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cfg: TerminalConfig = {
        kind: 'terminal', shellId, cwd: '', name: conn.name, connectionId: conn.id,
        launch: { command: 'ssh', args: buildSshArgs(conn), title: conn.name }
      }
      const r = ws.layout === null || target === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, target, 'row', cfg, uuid)
      const q = get().quick
      set(s => ({
        workspaces: { ...s.workspaces, [wsId]: r.workspace },
        quick: { ...q, recentConnections: pushRecent(q.recentConnections, conn.id, 20) }
      }))
      scheduleAutosave()
      scheduleQuickSave()
    },

    launchDir: (dir) => {
      const wsId = get().activeId
      if (!wsId || !dir) return
      const ws = get().workspaces[wsId]
      const target = ws.layout ? Object.keys(ws.panes)[0] : null
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cfg: TerminalConfig = { kind: 'terminal', shellId, cwd: dir }
      const r = ws.layout === null || target === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, target, 'row', cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
      scheduleAutosave()
    },
```

- [ ] **Step 6: Build to typecheck**

Run: `npm run build`
Expected: SUCCESS — no TypeScript errors.

- [ ] **Step 7: Run the unit suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/store.ts
git commit -m "feat(ssh): quick store state, connection CRUD, launch actions, recents"
```

---

## Task 6: CommandPalette overlay + Ctrl+K

**Files:**
- Create: `src/renderer/components/CommandPalette.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create `src/renderer/components/CommandPalette.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useStore, paneCwd } from '../store'
import { buildPaletteItems, filterPaletteItems, type PaletteItem } from '@shared/quick'

export function CommandPalette() {
  const open = useStore(s => s.paletteOpen)
  const setOpen = useStore(s => s.setPaletteOpen)
  const quick = useStore(s => s.quick)
  const activeId = useStore(s => s.activeId)
  const workspaces = useStore(s => s.workspaces)
  const cwds = useStore(s => s.cwds)
  const launchConnection = useStore(s => s.launchConnection)
  const launchDir = useStore(s => s.launchDir)
  const pinDir = useStore(s => s.pinDir)
  const unpinDir = useStore(s => s.unpinDir)
  const deleteConnection = useStore(s => s.deleteConnection)
  const setConnectionForm = useStore(s => s.setConnectionForm)

  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)

  // The "current" cwd for Pin = the first terminal pane's tracked cwd in the active workspace.
  const currentCwd = useMemo(() => {
    if (!activeId) return ''
    const ws = workspaces[activeId]
    if (!ws) return ''
    const termId = Object.keys(ws.panes).find(id => ws.panes[id].config.kind === 'terminal')
    return termId ? paneCwd({ cwds, workspaces }, termId) : ''
  }, [activeId, workspaces, cwds])

  const items = useMemo(
    () => filterPaletteItems(buildPaletteItems(quick, currentCwd), query),
    [quick, currentCwd, query]
  )

  useEffect(() => { if (open) { setQuery(''); setSel(0) } }, [open])
  useEffect(() => { setSel(0) }, [query])

  if (!open) return null

  const close = () => setOpen(false)

  const activate = (item: PaletteItem) => {
    if (item.kind === 'connection') { launchConnection(item.id); close() }
    else if (item.kind === 'dir') { launchDir(item.path); close() }
    else if (item.action === 'new-connection') { setConnectionForm('new') /* form replaces palette */; setOpen(false) }
    else if (item.action === 'pin-cwd') { pinDir(currentCwd); /* keep open to show the new ★ */ }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) activate(items[sel]) }
  }

  return (
    <div data-testid="command-palette-backdrop" onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div data-testid="command-palette" onClick={e => e.stopPropagation()}
        style={{ width: 560, maxHeight: '60vh', background: '#252526', color: '#eee',
          border: '1px solid #444', borderRadius: 6, display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        <input data-testid="palette-input" autoFocus value={query}
          onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Connect to… or jump to a directory"
          style={{ background: '#1e1e1e', color: '#eee', border: 'none', borderBottom: '1px solid #444',
            padding: '10px 12px', fontSize: 14, outline: 'none' }} />
        <div style={{ overflowY: 'auto' }}>
          {items.length === 0 && <div style={{ padding: 12, opacity: 0.6 }}>No matches</div>}
          {items.map((item, i) => {
            const key = item.kind === 'connection' ? `c-${item.id}`
              : item.kind === 'dir' ? `d-${item.path}` : `a-${item.action}`
            const label = item.kind === 'connection' ? `🔌 ${item.label}`
              : item.kind === 'dir' ? `${item.favorite ? '★' : '⏱'} ${item.path}`
              : item.label
            const detail = item.kind === 'connection' ? item.detail : ''
            return (
              <div key={key} data-testid={`palette-item-${i}`}
                onMouseEnter={() => setSel(i)} onClick={() => activate(item)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                  cursor: 'pointer', background: i === sel ? '#094771' : 'transparent' }}>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                {detail && <span style={{ opacity: 0.6, fontSize: 12 }}>{detail}</span>}
                {item.kind === 'connection' && (
                  <>
                    <button data-testid={`palette-edit-${item.id}`} title="Edit"
                      onClick={e => { e.stopPropagation()
                        const c = quick.connections.find(x => x.id === item.id)
                        if (c) { setConnectionForm(c); setOpen(false) } }}>✎</button>
                    <button data-testid={`palette-delete-${item.id}`} title="Delete"
                      onClick={e => { e.stopPropagation(); deleteConnection(item.id) }}>🗑</button>
                  </>
                )}
                {item.kind === 'dir' && item.favorite && (
                  <button data-testid="palette-unpin" title="Unpin"
                    onClick={e => { e.stopPropagation(); unpinDir(item.path) }}>✕</button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render the palette and wire Ctrl+K in `src/renderer/App.tsx`**

Add the import:

```tsx
import { CommandPalette } from './components/CommandPalette'
```

Add a Ctrl+K (and Esc-to-close) effect inside `App` (after the existing effects, before `const active = ...`):

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        const s = useStore.getState()
        s.setPaletteOpen(!s.paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

Render `<CommandPalette />` inside the top-level container (after the closing `</div>` of the mosaic area, still inside the outer flex `div`):

```tsx
      <div style={{ flex: 1, position: 'relative' }} className="mosaic-blueprint-theme">
        {active ? <WorkspaceView ws={active} /> : <div data-testid="app-title">Termhalla</div>}
      </div>
      <CommandPalette />
    </div>
```

- [ ] **Step 3: Build to typecheck**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/CommandPalette.tsx src/renderer/App.tsx
git commit -m "feat(ssh): Ctrl+K command palette overlay"
```

---

## Task 7: SshConnectionForm modal

**Files:**
- Create: `src/renderer/components/SshConnectionForm.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create `src/renderer/components/SshConnectionForm.tsx`**

```tsx
import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useStore } from '../store'
import { api } from '../api'
import type { SshConnection } from '@shared/types'

export function SshConnectionForm() {
  const target = useStore(s => s.connectionFormFor)
  const setForm = useStore(s => s.setConnectionForm)
  const saveConnection = useStore(s => s.saveConnection)
  const launchConnection = useStore(s => s.launchConnection)

  const editing = target && target !== 'new' ? target : null
  const [name, setName] = useState(editing?.name ?? '')
  const [host, setHost] = useState(editing?.host ?? '')
  const [user, setUser] = useState(editing?.user ?? '')
  const [port, setPort] = useState(editing?.port ? String(editing.port) : '')
  const [identityFile, setIdentityFile] = useState(editing?.identityFile ?? '')

  if (!target) return null

  const valid = host.trim().length > 0 && user.trim().length > 0
  const close = () => setForm(null)

  const build = (): SshConnection => ({
    id: editing?.id ?? uuid(),
    name: name.trim() || `${user.trim()}@${host.trim()}`,
    host: host.trim(),
    user: user.trim(),
    ...(port.trim() ? { port: Number(port) } : {}),
    ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {})
  })

  const onSave = (connect: boolean) => {
    if (!valid) return
    const conn = build()
    saveConnection(conn)
    close()
    if (connect) launchConnection(conn.id)
  }

  const browse = async () => {
    const p = await api.openFile()
    if (p) setIdentityFile(p)
  }

  const field = (label: string, node: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
      <span style={{ opacity: 0.8 }}>{label}</span>{node}
    </label>
  )
  const inputStyle = { background: '#1e1e1e', color: '#eee', border: '1px solid #444',
    borderRadius: 4, padding: '6px 8px', fontSize: 13 } as const

  return (
    <div data-testid="connection-form-backdrop" onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div data-testid="connection-form" onClick={e => e.stopPropagation()}
        style={{ width: 420, background: '#252526', color: '#eee', border: '1px solid #444',
          borderRadius: 6, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{editing ? 'Edit SSH connection' : 'New SSH connection'}</h3>
        {field('Name', <input data-testid="conn-name" value={name}
          onChange={e => setName(e.target.value)} style={inputStyle} />)}
        {field('Host *', <input data-testid="conn-host" value={host}
          onChange={e => setHost(e.target.value)} style={inputStyle} />)}
        {field('User *', <input data-testid="conn-user" value={user}
          onChange={e => setUser(e.target.value)} style={inputStyle} />)}
        {field('Port (default 22)', <input data-testid="conn-port" value={port} inputMode="numeric"
          onChange={e => setPort(e.target.value.replace(/[^0-9]/g, ''))} style={inputStyle} />)}
        {field('Identity file', (
          <div style={{ display: 'flex', gap: 4 }}>
            <input data-testid="conn-identity" value={identityFile}
              onChange={e => setIdentityFile(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <button data-testid="conn-browse" onClick={browse}>Browse…</button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
          <button data-testid="conn-cancel" onClick={close}>Cancel</button>
          <button data-testid="conn-save" disabled={!valid} onClick={() => onSave(false)}>Save</button>
          <button data-testid="conn-save-connect" disabled={!valid} onClick={() => onSave(true)}>Save &amp; Connect</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render the form in `src/renderer/App.tsx`**

Add the import:

```tsx
import { SshConnectionForm } from './components/SshConnectionForm'
```

Render it next to the palette:

```tsx
      <CommandPalette />
      <SshConnectionForm />
    </div>
```

- [ ] **Step 3: Build to typecheck**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SshConnectionForm.tsx src/renderer/App.tsx
git commit -m "feat(ssh): SSH connection form modal"
```

---

## Task 8: End-to-end test + full verification

**Files:**
- Create: `tests/e2e/ssh-quick.spec.ts`

This e2e is hermetic (temp `--user-data-dir`) and follows the conventions in `tests/e2e/cwd.spec.ts` (launch flags, `killTree` teardown). It does NOT depend on a real SSH server: launching a connection asserts that a terminal pane is created carrying the connection name; the `ssh` process behavior is irrelevant (and a missing `ssh` is handled gracefully by the Task 3 spawn guard).

- [ ] **Step 1: Write `tests/e2e/ssh-quick.spec.ts`**

```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}
function csspath(p: string): string { return p.replace(/\\/g, '\\\\') }

test('command palette: create a connection, launch it, and jump to a recent dir', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ssh-'))
  const seededDir = mkdtempSync(join(tmpdir(), 'termh-sshdir-'))
  mkdirSync(join(seededDir, 'leaf'))

  // Seed quick.json with one recent directory so the palette has a dir entry to launch.
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'quick.json'), JSON.stringify({
    connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [seededDir]
  }), 'utf8')

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const app: ElectronApplication = await launch()
  const win = await app.firstWindow()
  await expect(win.getByTestId('workspace-tabs')).toBeVisible({ timeout: 15_000 })

  // Open the palette and create a connection via the form.
  await win.keyboard.press('Control+K')
  await expect(win.getByTestId('command-palette')).toBeVisible()
  await win.getByTestId('palette-input').fill('new ssh')
  await win.getByTestId('palette-item-0').click()             // "New SSH connection…"
  await expect(win.getByTestId('connection-form')).toBeVisible()
  await win.getByTestId('conn-name').fill('my-box')
  await win.getByTestId('conn-host').fill('example.com')
  await win.getByTestId('conn-user').fill('kev')
  await win.getByTestId('conn-save').click()
  await expect(win.getByTestId('connection-form')).toBeHidden()

  // Re-open the palette: the new connection appears and launches an SSH terminal pane.
  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('my-box')
  await expect(win.getByTestId('palette-item-0')).toContainText('my-box')
  await win.getByTestId('palette-item-0').click()
  // A terminal pane titled with the connection name now exists.
  await expect(win.locator('.mosaic-window-title', { hasText: 'my-box' })).toBeVisible({ timeout: 15_000 })

  // Open the palette again and launch the seeded recent directory -> a local terminal cwd'd there.
  await win.keyboard.press('Control+K')
  await win.getByTestId('palette-input').fill('termh-sshdir')
  await win.getByTestId('palette-item-0').click()
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(seededDir)}"]`))
    .toHaveCount(1, { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 2: Build the app so e2e runs against fresh `out/`**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 3: Run the new e2e**

Run: `npm run e2e -- ssh-quick`
Expected: PASS — palette opens, connection is created and launched (pane titled `my-box`), and the seeded recent directory opens a terminal whose tile `data-cwd` equals the seeded dir.

If the connection-launch assertion is flaky because the mosaic title markup differs, fall back to asserting a new `[data-testid^="tile-"]` count increased after the launch click (do not weaken the recent-dir assertion, which is the spec's primary e2e check).

- [ ] **Step 4: Run the entire unit suite and full e2e (regression gate)**

Run: `npm test && npm run e2e`
Expected: PASS — all vitest suites and all Playwright specs (smoke, persistence, editor, explorer, status, cwd, ssh-quick) green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ssh-quick.spec.ts
git commit -m "test(ssh): e2e for palette, connection launch, and recent-dir jump"
```

---

## Self-Review

**1. Spec coverage:**
- §3 data model → Task 1 (`SshConnection`, `QuickStore`, `EMPTY_QUICK`); persistence → Task 4 (`quick.json`).
- §4 SSH mechanism → Task 1 (`TerminalLaunch`, `connectionId`), Task 3 (`resolveSpawnSpec` skips injection, launch threading, restore via serialized `launch`), Task 5 (`buildSshArgs` in `launchConnection`). "No secrets" → only host/user/port/identity-path stored (Task 1 type, Task 7 form fields). ✓
- §5 command palette → Task 6 (substring filter, recent-first connections, dirs, pinned actions, per-row edit/delete/unpin). ✓
- §6 connection form → Task 7 (name/host/user/port/identity + Browse via `dialog:openFile`, Save / Save & Connect, host+user required). ✓
- §7 recents auto-tracking → Task 5 (`setCwd` → `nextRecentDirs`, home-excluded, cap 20; `pushRecent` for connections; debounced `quick.json`). ✓
- §8 testing → unit (Task 1, 2, 3, 4), main integration (Task 4), e2e (Task 8). ✓
- §9 non-goals respected: no secret storage, no `~/.ssh/config` import, no remote cwd/status, substring-only filter. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. The one conditional ("if flaky, fall back…") in Task 8 Step 3 is an explicit, bounded contingency with a concrete alternative, not a placeholder.

**3. Type consistency:** `TerminalLaunch {command,args,title}` is defined once (Task 1) and consumed identically in `PtySpawnArgs.launch` (Task 3), `resolveSpawnSpec` launch param (Task 3), and `launchConnection` (Task 5). `QuickStore` shape is identical across `EMPTY_QUICK` (Task 1), `QuickStore` class (Task 4), store state (Task 5), and seeded e2e JSON (Task 8). `buildSshArgs`/`pushRecent`/`nextRecentDirs`/`buildPaletteItems`/`filterPaletteItems`/`PaletteItem` signatures match between definition (Tasks 1-2) and use (Tasks 5-6). Channel keys `quickLoad`/`quickSave`/`homeDir` and API methods `loadQuick`/`saveQuick`/`homeDir` are consistent across contract (Task 4), preload (Task 4), and store (Task 5).
