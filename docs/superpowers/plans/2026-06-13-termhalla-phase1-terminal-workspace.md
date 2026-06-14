# Termhalla Phase 1 — Terminal Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shippable Electron app where a user opens multiple terminals (real Windows shells) in a tiled, resizable layout, organizes them into named workspace tabs, and saves/restores those workspaces across restarts.

**Architecture:** Electron with a privileged **main** process (node-pty sessions, JSON persistence in `userData`, window-state) and a single **renderer** (React UI: workspace tab strip + `react-mosaic` tiling + xterm.js terminals). A typed `preload` bridge connects them. All workspace/layout logic that can be pure lives in `src/shared` and is unit-tested test-first; Electron wiring is verified with a Playwright-for-Electron smoke loop.

**Tech Stack:** Electron, TypeScript (strict), electron-vite, React, zustand, react-mosaic-component, xterm.js (`@xterm/xterm` + `@xterm/addon-fit`), node-pty, vitest, @playwright/test.

---

## File Structure

```
package.json, electron.vite.config.ts, tsconfig.json, tsconfig.node.json,
vitest.config.ts, playwright.config.ts, .gitignore
src/
  shared/
    types.ts              # all shared TS types (Workspace, PaneConfig, AppState, WindowState, ShellInfo)
    workspace-model.ts    # PURE workspace/layout ops + (de)serialize + migrate
    ipc-contract.ts       # IPC channel names + request/response payload types
  main/
    index.ts              # app entry: create window, wire handlers
    window-state.ts       # compute/clamp window bounds (pure) + load/save
    pty/shells.ts         # discover available Windows shells
    pty/pty-manager.ts    # spawn/track/write/resize/kill node-pty sessions
    persistence/paths.ts  # resolve userData file paths
    persistence/store.ts  # read/write workspace + app-state JSON files
    ipc/register.ts       # ipcMain handlers wiring managers to the contract
  preload/index.ts        # contextBridge: expose typed window.termhalla
  renderer/
    index.html
    main.tsx              # React root
    App.tsx               # shell: tab strip + active workspace view
    api.ts                # typed wrapper over window.termhalla
    store.ts              # zustand store (workspaces, active id, statuses)
    components/WorkspaceTabs.tsx
    components/WorkspaceView.tsx   # renders react-mosaic from the model
    components/TerminalPane.tsx    # xterm.js wired to a pty session
tests/
  shared/workspace-model.test.ts
  main/window-state.test.ts
  main/shells.test.ts
  main/store.test.ts
  e2e/smoke.spec.ts       # Playwright-for-Electron
```

---

## Task 1: Project scaffold & configs

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `.gitignore` (exists — extend), `src/renderer/index.html`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "termhalla",
  "version": "0.1.0",
  "description": "Unified terminals, editor, and explorer with saveable workspaces.",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "postinstall": "patch-package"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "node-pty": "1.1.0-beta34",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-mosaic-component": "^6.1.1",
    "uuid": "^11.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/uuid": "^10.0.0",
    "electron": "^33.0.0",
    "electron-vite": "^2.3.0",
    "patch-package": "^8.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` (renderer + shared)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/renderer", "src/shared", "src/preload"]
}
```

- [ ] **Step 3: Create `tsconfig.node.json` (main process + tests)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/main", "src/shared", "tests"]
}
```

- [ ] **Step 4: Create `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
```

Add `@vitejs/plugin-react` to devDependencies (`^4.3.0`).

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
})
```

- [ ] **Step 6: Create `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;" />
    <title>Termhalla</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Extend `.gitignore`**

Ensure it contains: `node_modules/`, `out/`, `dist/`, `.vite/`, `release/`, `*.log`, `test-results/`, `playwright-report/`.

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: completes; `postinstall` runs `patch-package` (no patches yet — prints "No patch files found", which is fine).

> **Native-build note (this machine):** node-pty compiles a native addon. If `npm install` fails with `MSB8040: Spectre-mitigated libraries are required`, this is handled in Task 7 via a `patch-package` patch. If it fails with `'GetCommitHash.bat' is not recognized`, the shell has `NoDefaultCurrentDirectoryInExePath=1` set — clear it first: `Remove-Item env:NoDefaultCurrentDirectoryInExePath` (PowerShell), then re-run. A normal user shell does not set this.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite + typescript project"
```

---

## Task 2: Minimal Electron window

**Files:**
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`

- [ ] **Step 1: Create `src/preload/index.ts` (placeholder bridge)**

```ts
import { contextBridge } from 'electron'

// Expanded in Task 8. Present now so the renderer can assume it exists.
contextBridge.exposeInMainWorld('termhalla', {})
```

- [ ] **Step 2: Create `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { resolve } from 'node:path'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: resolve(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(resolve(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 3: Create `src/renderer/App.tsx`**

```tsx
export default function App() {
  return <h1 data-testid="app-title">Termhalla</h1>
}
```

- [ ] **Step 4: Create `src/renderer/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
```

- [ ] **Step 5: Verify the window opens**

Run: `npm run dev`
Expected: an Electron window appears showing "Termhalla". Close it. (If using the remote/headless harness, instead run `npm run build` and confirm it completes with no errors.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: minimal electron window rendering the app shell"
```

---

## Task 3: Shared types

**Files:**
- Create: `src/shared/types.ts`

This task defines types only (no behavior, no test). They are consumed by every task that follows.

- [ ] **Step 1: Create `src/shared/types.ts`**

```ts
/** A discovered shell the user can launch. */
export interface ShellInfo {
  id: string          // stable id: 'pwsh' | 'powershell' | 'cmd' | 'gitbash' | ...
  label: string       // human label, e.g. 'PowerShell 7'
  path: string        // absolute path to executable
  args: string[]      // launch args
}

/** Per-terminal pane configuration (what gets serialized). */
export interface TerminalConfig {
  kind: 'terminal'
  shellId: string
  cwd: string
  name?: string
}

/** Phase 1 has only terminals; editor/explorer added in Phase 3. */
export type PaneConfig = TerminalConfig

export interface PaneNode {
  paneId: string
  config: PaneConfig
}

/** react-mosaic layout tree. Leaves are paneIds (strings). */
export type MosaicDirection = 'row' | 'column'
export interface MosaicParent {
  direction: MosaicDirection
  first: MosaicNode
  second: MosaicNode
  splitPercentage?: number
}
export type MosaicNode = string | MosaicParent

export interface Workspace {
  id: string
  name: string
  layout: MosaicNode | null         // null = no panes yet
  panes: Record<string, PaneNode>   // paneId -> pane
}

export interface AppState {
  schemaVersion: number
  openWorkspaceIds: string[]
  activeWorkspaceId: string | null
}

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export const SCHEMA_VERSION = 1
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: shared domain types"
```

---

## Task 4: Workspace model (pure logic, TDD)

**Files:**
- Create: `src/shared/workspace-model.ts`
- Test: `tests/shared/workspace-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  createWorkspace, addFirstPane, splitPane, removePane,
  serializeWorkspace, deserializeWorkspace
} from '@shared/workspace-model'
import type { TerminalConfig } from '@shared/types'

const term = (cwd = 'C:\\'): TerminalConfig => ({ kind: 'terminal', shellId: 'pwsh', cwd })

describe('workspace-model', () => {
  it('creates an empty named workspace', () => {
    const ws = createWorkspace('Work', () => 'ws-1')
    expect(ws).toMatchObject({ id: 'ws-1', name: 'Work', layout: null, panes: {} })
  })

  it('adds the first pane as the root leaf', () => {
    let ws = createWorkspace('W', () => 'ws-1')
    const r = addFirstPane(ws, term(), () => 'p1')
    expect(r.paneId).toBe('p1')
    expect(r.workspace.layout).toBe('p1')
    expect(r.workspace.panes['p1'].config.cwd).toBe('C:\\')
  })

  it('splits a pane, replacing the leaf with a parent of both panes', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    const r = splitPane(ws, 'p1', 'row', term('D:\\'), () => 'p2')
    expect(r.workspace.layout).toEqual({ direction: 'row', first: 'p1', second: 'p2' })
    expect(Object.keys(r.workspace.panes).sort()).toEqual(['p1', 'p2'])
  })

  it('removes a pane and collapses its parent', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    ws = splitPane(ws, 'p1', 'row', term(), () => 'p2').workspace
    const after = removePane(ws, 'p1')
    expect(after.layout).toBe('p2')
    expect(after.panes['p1']).toBeUndefined()
  })

  it('removing the last pane yields an empty layout', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    const after = removePane(ws, 'p1')
    expect(after.layout).toBeNull()
    expect(after.panes).toEqual({})
  })

  it('serialize → deserialize round-trips and stamps schema version', () => {
    let ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term(), () => 'p1').workspace
    ws = splitPane(ws, 'p1', 'column', term('E:\\'), () => 'p2').workspace
    const json = serializeWorkspace(ws)
    expect(JSON.parse(json).schemaVersion).toBe(1)
    expect(deserializeWorkspace(json)).toEqual(ws)
  })

  it('rejects malformed workspace json', () => {
    expect(() => deserializeWorkspace('{"nope":true}')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/workspace-model.test.ts`
Expected: FAIL — cannot find module `@shared/workspace-model`.

- [ ] **Step 3: Write the implementation**

```ts
import type {
  Workspace, PaneConfig, MosaicNode, MosaicParent, MosaicDirection
} from '@shared/types'
import { SCHEMA_VERSION } from '@shared/types'

type IdGen = () => string

export function createWorkspace(name: string, id: IdGen): Workspace {
  return { id: id(), name, layout: null, panes: {} }
}

export function addFirstPane(ws: Workspace, config: PaneConfig, id: IdGen) {
  const paneId = id()
  const workspace: Workspace = {
    ...ws,
    layout: paneId,
    panes: { ...ws.panes, [paneId]: { paneId, config } }
  }
  return { workspace, paneId }
}

function replaceLeaf(node: MosaicNode, target: string, replacement: MosaicNode): MosaicNode {
  if (node === target) return replacement
  if (typeof node === 'string') return node
  return { ...node, first: replaceLeaf(node.first, target, replacement),
                     second: replaceLeaf(node.second, target, replacement) }
}

export function splitPane(
  ws: Workspace, targetPaneId: string, direction: MosaicDirection,
  config: PaneConfig, id: IdGen
) {
  if (ws.layout === null) return addFirstPane(ws, config, id)
  const paneId = id()
  const parent: MosaicParent = { direction, first: targetPaneId, second: paneId }
  const layout = replaceLeaf(ws.layout, targetPaneId, parent)
  const workspace: Workspace = {
    ...ws, layout,
    panes: { ...ws.panes, [paneId]: { paneId, config } }
  }
  return { workspace, paneId }
}

function removeLeaf(node: MosaicNode, target: string): MosaicNode | null {
  if (node === target) return null
  if (typeof node === 'string') return node
  const first = removeLeaf(node.first, target)
  const second = removeLeaf(node.second, target)
  if (first === null) return second
  if (second === null) return first
  return { ...node, first, second }
}

export function removePane(ws: Workspace, paneId: string): Workspace {
  const layout = ws.layout === null ? null : removeLeaf(ws.layout, paneId)
  const panes = { ...ws.panes }
  delete panes[paneId]
  return { ...ws, layout, panes }
}

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, workspace: ws }, null, 2)
}

export function deserializeWorkspace(json: string): Workspace {
  const data = JSON.parse(json)
  if (typeof data?.schemaVersion !== 'number' || !data.workspace) {
    throw new Error('Invalid workspace file: missing schemaVersion/workspace')
  }
  const ws = migrate(data.workspace, data.schemaVersion)
  if (typeof ws.id !== 'string' || typeof ws.panes !== 'object') {
    throw new Error('Invalid workspace file: bad shape')
  }
  return ws
}

// Future versions add cases here; v1 is identity.
function migrate(ws: Workspace, _version: number): Workspace {
  return ws
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/workspace-model.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pure workspace/layout model with serialize + tests"
```

---

## Task 5: Window-state logic (TDD) + persistence

**Files:**
- Create: `src/main/persistence/paths.ts`, `src/main/window-state.ts`
- Test: `tests/main/window-state.test.ts`

- [ ] **Step 1: Write the failing test (pure clamping logic)**

```ts
import { describe, it, expect } from 'vitest'
import { clampWindowState, DEFAULT_WINDOW_STATE } from '@shared/../main/window-state'
import type { WindowState } from '@shared/types'

const display = { x: 0, y: 0, width: 1920, height: 1080 }

describe('clampWindowState', () => {
  it('returns defaults when state is undefined', () => {
    expect(clampWindowState(undefined, [display])).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('keeps a fully on-screen window unchanged', () => {
    const s: WindowState = { x: 100, y: 100, width: 800, height: 600, maximized: false }
    expect(clampWindowState(s, [display])).toEqual(s)
  })

  it('recenters a window that is off all displays', () => {
    const s: WindowState = { x: 9000, y: 9000, width: 800, height: 600, maximized: false }
    const r = clampWindowState(s, [display])
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.width).toBe(800)
  })

  it('preserves the maximized flag', () => {
    const s: WindowState = { x: 0, y: 0, width: 800, height: 600, maximized: true }
    expect(clampWindowState(s, [display]).maximized).toBe(true)
  })
})
```

> Import note: the test imports from `src/main/window-state.ts`. Adjust the path to `../../src/main/window-state` if your vitest alias differs; keep the alias in `vitest.config.ts` pointing `@shared` at `src/shared`. Simplest: change the import to a relative path `../../src/main/window-state`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/window-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/main/persistence/paths.ts`**

```ts
import { app } from 'electron'
import { join } from 'node:path'

export const userDataDir = () => app.getPath('userData')
export const workspacesDir = () => join(userDataDir(), 'workspaces')
export const appStatePath = () => join(userDataDir(), 'app-state.json')
export const windowStatePath = () => join(userDataDir(), 'window-state.json')
```

- [ ] **Step 4: Create `src/main/window-state.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises'
import type { WindowState } from '@shared/types'
import { windowStatePath } from './persistence/paths'

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1200, height: 800, maximized: false
}

export interface DisplayBounds { x: number; y: number; width: number; height: number }

/** Pure: ensure the window sits on a known display; otherwise recenter on the first. */
export function clampWindowState(
  state: WindowState | undefined, displays: DisplayBounds[]
): WindowState {
  if (!state) return { ...DEFAULT_WINDOW_STATE }
  const onScreen = displays.some(d =>
    state.x !== undefined && state.y !== undefined &&
    state.x >= d.x && state.y >= d.y &&
    state.x + state.width <= d.x + d.width &&
    state.y + state.height <= d.y + d.height)
  if (onScreen || state.x === undefined) return state
  const d = displays[0]
  return {
    ...state,
    x: Math.round(d.x + (d.width - state.width) / 2),
    y: Math.round(d.y + (d.height - state.height) / 2)
  }
}

export async function loadWindowState(): Promise<WindowState | undefined> {
  try { return JSON.parse(await readFile(windowStatePath(), 'utf8')) as WindowState }
  catch { return undefined }
}

export async function saveWindowState(state: WindowState): Promise<void> {
  await writeFile(windowStatePath(), JSON.stringify(state), 'utf8')
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/main/window-state.test.ts`
Expected: PASS (4 tests). If the import path errored, switch it to the relative form noted in Step 1.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: window-state clamping logic + persistence"
```

---

## Task 6: Shell discovery (TDD)

**Files:**
- Create: `src/main/pty/shells.ts`
- Test: `tests/main/shells.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { detectShells, DEFAULT_SHELL_CANDIDATES } from '../../src/main/pty/shells'

describe('detectShells', () => {
  it('returns only candidates whose executable exists', () => {
    const candidates = [
      { id: 'a', label: 'A', path: 'C:\\real.exe', args: [] },
      { id: 'b', label: 'B', path: 'C:\\missing.exe', args: [] }
    ]
    const exists = (p: string) => p === 'C:\\real.exe'
    const shells = detectShells(candidates, exists)
    expect(shells.map(s => s.id)).toEqual(['a'])
  })

  it('always includes a guaranteed fallback even if nothing else exists', () => {
    const shells = detectShells(DEFAULT_SHELL_CANDIDATES, () => false)
    expect(shells.length).toBeGreaterThanOrEqual(1)
    expect(shells.some(s => s.id === 'cmd')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/shells.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/main/pty/shells.ts`**

```ts
import { existsSync } from 'node:fs'
import type { ShellInfo } from '@shared/types'

const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
const localAppData = process.env.LOCALAPPDATA ?? ''

export const DEFAULT_SHELL_CANDIDATES: ShellInfo[] = [
  { id: 'pwsh', label: 'PowerShell 7',
    path: `${programFiles}\\PowerShell\\7\\pwsh.exe`, args: [] },
  { id: 'powershell', label: 'Windows PowerShell',
    path: `${sysRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: [] },
  { id: 'gitbash', label: 'Git Bash',
    path: `${programFiles}\\Git\\bin\\bash.exe`, args: ['--login', '-i'] },
  { id: 'wsl', label: 'WSL',
    path: `${sysRoot}\\System32\\wsl.exe`, args: [] },
  { id: 'cmd', label: 'Command Prompt',
    path: `${sysRoot}\\System32\\cmd.exe`, args: [] }
]

/** Pure given an `exists` probe — returns candidates that resolve, plus a guaranteed cmd fallback. */
export function detectShells(
  candidates: ShellInfo[] = DEFAULT_SHELL_CANDIDATES,
  exists: (p: string) => boolean = existsSync
): ShellInfo[] {
  const found = candidates.filter(c => exists(c.path))
  if (found.length > 0) return found
  const cmd = candidates.find(c => c.id === 'cmd')
  return cmd ? [cmd] : [{ id: 'cmd', label: 'Command Prompt',
    path: `${sysRoot}\\System32\\cmd.exe`, args: [] }]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/shells.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: windows shell discovery"
```

---

## Task 7: Persistence store (TDD) + node-pty native-build patch

**Files:**
- Create: `src/main/persistence/store.ts`
- Test: `tests/main/store.test.ts`
- Maybe create: `patches/node-pty+1.1.0-beta34.patch`

- [ ] **Step 1: Write the failing test (store uses an injectable base dir)**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore } from '../../src/main/persistence/store'
import { createWorkspace, addFirstPane } from '@shared/workspace-model'
import type { TerminalConfig } from '@shared/types'

const term: TerminalConfig = { kind: 'terminal', shellId: 'cmd', cwd: 'C:\\' }
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-')) })

describe('WorkspaceStore', () => {
  it('saves and re-reads a workspace', async () => {
    const store = new WorkspaceStore(dir)
    const ws = addFirstPane(createWorkspace('W', () => 'ws-1'), term, () => 'p1').workspace
    await store.saveWorkspace(ws)
    const loaded = await store.loadWorkspace('ws-1')
    expect(loaded).toEqual(ws)
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists saved workspace ids', async () => {
    const store = new WorkspaceStore(dir)
    await store.saveWorkspace(createWorkspace('A', () => 'ws-a'))
    await store.saveWorkspace(createWorkspace('B', () => 'ws-b'))
    expect((await store.listWorkspaceIds()).sort()).toEqual(['ws-a', 'ws-b'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips app-state', async () => {
    const store = new WorkspaceStore(dir)
    const state = { schemaVersion: 1, openWorkspaceIds: ['ws-1'], activeWorkspaceId: 'ws-1' }
    await store.saveAppState(state)
    expect(await store.loadAppState()).toEqual(state)
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null for a missing workspace', async () => {
    const store = new WorkspaceStore(dir)
    expect(await store.loadWorkspace('nope')).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/main/persistence/store.ts`**

```ts
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workspace, AppState } from '@shared/types'
import { serializeWorkspace, deserializeWorkspace } from '@shared/workspace-model'

export class WorkspaceStore {
  constructor(private readonly baseDir: string) {}

  private wsDir() { return join(this.baseDir, 'workspaces') }
  private wsFile(id: string) { return join(this.wsDir(), `${id}.json`) }
  private appStateFile() { return join(this.baseDir, 'app-state.json') }

  async saveWorkspace(ws: Workspace): Promise<void> {
    await mkdir(this.wsDir(), { recursive: true })
    await writeFile(this.wsFile(ws.id), serializeWorkspace(ws), 'utf8')
  }

  async loadWorkspace(id: string): Promise<Workspace | null> {
    try { return deserializeWorkspace(await readFile(this.wsFile(id), 'utf8')) }
    catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  async listWorkspaceIds(): Promise<string[]> {
    try {
      const files = await readdir(this.wsDir())
      return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    } catch { return [] }
  }

  async saveAppState(state: AppState): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(this.appStateFile(), JSON.stringify(state, null, 2), 'utf8')
  }

  async loadAppState(): Promise<AppState | null> {
    try { return JSON.parse(await readFile(this.appStateFile(), 'utf8')) as AppState }
    catch { return null }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm node-pty built; patch if needed**

Run: `node -e "require('node-pty'); console.log('pty ok')"`
Expected: prints `pty ok`.
If it errors with a missing native build, rebuild for Electron:
Run: `npx electron-rebuild -f -w node-pty` (add `electron-rebuild` as a devDependency `^3.6.0`).
If rebuild fails with `MSB8040: Spectre-mitigated libraries are required`, create `patches/node-pty+1.1.0-beta34.patch` that flips `SpectreMitigation` from `'Spectre'` to `'false'` in node-pty's `.gyp`/`.vcxproj` config, then re-run `npx patch-package node-pty` to generate the patch and `npm run build` / rebuild. (The `postinstall` `patch-package` step then applies it automatically on future installs.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: workspace + app-state persistence store"
```

---

## Task 8: PTY manager

**Files:**
- Create: `src/main/pty/pty-manager.ts`

PTY behavior depends on real OS processes, so it's verified via the Playwright smoke loop (Task 13), not unit tests. Keep this module a thin, well-typed wrapper.

- [ ] **Step 1: Create `src/main/pty/pty-manager.ts`**

```ts
import * as pty from 'node-pty'
import type { ShellInfo } from '@shared/types'

export interface PtySession { id: string; proc: pty.IPty }

export class PtyManager {
  private sessions = new Map<string, PtySession>()

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, code: number) => void
  ) {}

  spawn(id: string, shell: ShellInfo, cwd: string, cols = 80, rows = 24): void {
    if (this.sessions.has(id)) return
    const proc = pty.spawn(shell.path, shell.args, {
      name: 'xterm-256color', cols, rows,
      cwd, env: process.env as Record<string, string>
    })
    proc.onData(d => this.onData(id, d))
    proc.onExit(({ exitCode }) => { this.onExit(id, exitCode); this.sessions.delete(id) })
    this.sessions.set(id, { id, proc })
  }

  write(id: string, data: string): void { this.sessions.get(id)?.proc.write(data) }
  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.proc.resize(Math.max(cols, 1), Math.max(rows, 1))
  }
  kill(id: string): void { this.sessions.get(id)?.proc.kill(); this.sessions.delete(id) }
  killAll(): void { for (const id of [...this.sessions.keys()]) this.kill(id) }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: node-pty session manager"
```

---

## Task 9: IPC contract, handlers & preload bridge

**Files:**
- Create: `src/shared/ipc-contract.ts`
- Create: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Create `src/shared/ipc-contract.ts`**

```ts
import type { ShellInfo, Workspace, AppState } from './types'

export const CH = {
  listShells: 'shells:list',
  listWorkspaceIds: 'ws:listIds',
  loadWorkspace: 'ws:load',
  saveWorkspace: 'ws:save',
  loadAppState: 'app:loadState',
  saveAppState: 'app:saveState',
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',     // main -> renderer event
  ptyExit: 'pty:exit'      // main -> renderer event
} as const

export interface PtySpawnArgs { id: string; shellId: string; cwd: string; cols: number; rows: number }
export interface PtyWriteArgs { id: string; data: string }
export interface PtyResizeArgs { id: string; cols: number; rows: number }

export interface TermhallaApi {
  listShells(): Promise<ShellInfo[]>
  listWorkspaceIds(): Promise<string[]>
  loadWorkspace(id: string): Promise<Workspace | null>
  saveWorkspace(ws: Workspace): Promise<void>
  loadAppState(): Promise<AppState | null>
  saveAppState(state: AppState): Promise<void>
  ptySpawn(args: PtySpawnArgs): Promise<void>
  ptyWrite(args: PtyWriteArgs): void
  ptyResize(args: PtyResizeArgs): void
  ptyKill(id: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, code: number) => void): () => void
}
```

- [ ] **Step 2: Create `src/main/ipc/register.ts`**

```ts
import { ipcMain, type BrowserWindow } from 'electron'
import { CH, type PtySpawnArgs, type PtyWriteArgs, type PtyResizeArgs } from '@shared/ipc-contract'
import type { Workspace, AppState } from '@shared/types'
import { detectShells } from '../pty/shells'
import { PtyManager } from '../pty/pty-manager'
import { WorkspaceStore } from '../persistence/store'
import { userDataDir } from '../persistence/paths'

export function registerHandlers(win: BrowserWindow): PtyManager {
  const store = new WorkspaceStore(userDataDir())
  const shells = detectShells()
  const pty = new PtyManager(
    (id, data) => win.webContents.send(CH.ptyData, id, data),
    (id, code) => win.webContents.send(CH.ptyExit, id, code)
  )

  ipcMain.handle(CH.listShells, () => shells)
  ipcMain.handle(CH.listWorkspaceIds, () => store.listWorkspaceIds())
  ipcMain.handle(CH.loadWorkspace, (_e, id: string) => store.loadWorkspace(id))
  ipcMain.handle(CH.saveWorkspace, (_e, ws: Workspace) => store.saveWorkspace(ws))
  ipcMain.handle(CH.loadAppState, () => store.loadAppState())
  ipcMain.handle(CH.saveAppState, (_e, s: AppState) => store.saveAppState(s))

  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows)
  })
  ipcMain.on(CH.ptyWrite, (_e, a: PtyWriteArgs) => pty.write(a.id, a.data))
  ipcMain.on(CH.ptyResize, (_e, a: PtyResizeArgs) => pty.resize(a.id, a.cols, a.rows))
  ipcMain.on(CH.ptyKill, (_e, id: string) => pty.kill(id))

  return pty
}
```

- [ ] **Step 3: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CH, type TermhallaApi } from '@shared/ipc-contract'

const api: TermhallaApi = {
  listShells: () => ipcRenderer.invoke(CH.listShells),
  listWorkspaceIds: () => ipcRenderer.invoke(CH.listWorkspaceIds),
  loadWorkspace: (id) => ipcRenderer.invoke(CH.loadWorkspace, id),
  saveWorkspace: (ws) => ipcRenderer.invoke(CH.saveWorkspace, ws),
  loadAppState: () => ipcRenderer.invoke(CH.loadAppState),
  saveAppState: (s) => ipcRenderer.invoke(CH.saveAppState, s),
  ptySpawn: (a) => ipcRenderer.invoke(CH.ptySpawn, a),
  ptyWrite: (a) => ipcRenderer.send(CH.ptyWrite, a),
  ptyResize: (a) => ipcRenderer.send(CH.ptyResize, a),
  ptyKill: (id) => ipcRenderer.send(CH.ptyKill, id),
  onPtyData: (cb) => {
    const h = (_e: unknown, id: string, data: string) => cb(id, data)
    ipcRenderer.on(CH.ptyData, h as never)
    return () => ipcRenderer.removeListener(CH.ptyData, h as never)
  },
  onPtyExit: (cb) => {
    const h = (_e: unknown, id: string, code: number) => cb(id, code)
    ipcRenderer.on(CH.ptyExit, h as never)
    return () => ipcRenderer.removeListener(CH.ptyExit, h as never)
  }
}

contextBridge.exposeInMainWorld('termhalla', api)
```

- [ ] **Step 4: Wire handlers + window-state into `src/main/index.ts`**

Replace the file with:

```ts
import { app, BrowserWindow, screen } from 'electron'
import { resolve } from 'node:path'
import { registerHandlers } from './ipc/register'
import {
  loadWindowState, saveWindowState, clampWindowState
} from './window-state'

async function createWindow(): Promise<void> {
  const saved = await loadWindowState()
  const displays = screen.getAllDisplays().map(d => d.workArea)
  const s = clampWindowState(saved, displays)

  const win = new BrowserWindow({
    width: s.width, height: s.height, x: s.x, y: s.y, show: false,
    webPreferences: {
      preload: resolve(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })
  if (s.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  const pty = registerHandlers(win)

  const persist = () => {
    const b = win.getBounds()
    saveWindowState({ ...b, maximized: win.isMaximized() }).catch(() => {})
  }
  win.on('resize', persist)
  win.on('move', persist)
  win.on('close', () => { persist(); pty.killAll() })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(resolve(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: typed IPC contract, main handlers, preload bridge, window-state wiring"
```

---

## Task 10: Renderer API wrapper + zustand store

**Files:**
- Create: `src/renderer/api.ts`, `src/renderer/store.ts`

- [ ] **Step 1: Create `src/renderer/api.ts`**

```ts
import type { TermhallaApi } from '@shared/ipc-contract'

declare global {
  interface Window { termhalla: TermhallaApi }
}
export const api: TermhallaApi = window.termhalla
```

- [ ] **Step 2: Create `src/renderer/store.ts`**

```ts
import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Workspace, ShellInfo, MosaicNode, MosaicDirection, TerminalConfig } from '@shared/types'
import {
  createWorkspace, addFirstPane, splitPane, removePane
} from '@shared/workspace-model'
import { api } from './api'

interface State {
  shells: ShellInfo[]
  workspaces: Record<string, Workspace>
  order: string[]
  activeId: string | null
  init: () => Promise<void>
  newWorkspace: (name: string) => string
  setActive: (id: string) => void
  setLayout: (wsId: string, layout: MosaicNode | null) => void
  addTerminal: (wsId: string, targetPaneId: string | null, dir: MosaicDirection) => string
  closePane: (wsId: string, paneId: string) => void
  save: (wsId: string) => Promise<void>
}

const defaultTerminal = (shellId: string): TerminalConfig =>
  ({ kind: 'terminal', shellId, cwd: '' })

export const useStore = create<State>((set, get) => ({
  shells: [],
  workspaces: {},
  order: [],
  activeId: null,

  init: async () => {
    const shells = await api.listShells()
    set({ shells })
    const state = await api.loadAppState()
    if (state && state.openWorkspaceIds.length > 0) {
      const loaded = await Promise.all(state.openWorkspaceIds.map(id => api.loadWorkspace(id)))
      const workspaces: Record<string, Workspace> = {}
      for (const ws of loaded) if (ws) workspaces[ws.id] = ws
      const order = state.openWorkspaceIds.filter(id => workspaces[id])
      set({ workspaces, order, activeId: state.activeWorkspaceId ?? order[0] ?? null })
    } else {
      get().newWorkspace('Workspace 1')
    }
  },

  newWorkspace: (name) => {
    const ws = createWorkspace(name, uuid)
    set(s => ({
      workspaces: { ...s.workspaces, [ws.id]: ws },
      order: [...s.order, ws.id],
      activeId: ws.id
    }))
    return ws.id
  },

  setActive: (id) => set({ activeId: id }),

  setLayout: (wsId, layout) => set(s => ({
    workspaces: { ...s.workspaces, [wsId]: { ...s.workspaces[wsId], layout } }
  })),

  addTerminal: (wsId, targetPaneId, dir) => {
    const ws = get().workspaces[wsId]
    const shellId = get().shells[0]?.id ?? 'cmd'
    const cfg = defaultTerminal(shellId)
    const r = ws.layout === null || targetPaneId === null
      ? addFirstPane(ws, cfg, uuid)
      : splitPane(ws, targetPaneId, dir, cfg, uuid)
    set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
    return r.paneId
  },

  closePane: (wsId, paneId) => {
    const ws = removePane(get().workspaces[wsId], paneId)
    set(s => ({ workspaces: { ...s.workspaces, [wsId]: ws } }))
    api.ptyKill(paneId)
  },

  save: async (wsId) => {
    await api.saveWorkspace(get().workspaces[wsId])
    await api.saveAppState({
      schemaVersion: 1, openWorkspaceIds: get().order, activeWorkspaceId: get().activeId
    })
  }
}))
```

- [ ] **Step 2 (verify): Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: renderer api wrapper + zustand workspace store"
```

---

## Task 11: TerminalPane (xterm.js wired to a pty)

**Files:**
- Create: `src/renderer/components/TerminalPane.tsx`

- [ ] **Step 1: Create `src/renderer/components/TerminalPane.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import type { TerminalConfig } from '@shared/types'

export function TerminalPane({ paneId, config }: { paneId: string; config: TerminalConfig }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({ fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    fit.fit()

    let disposed = false
    api.ptySpawn({
      id: paneId, shellId: config.shellId, cwd: config.cwd,
      cols: term.cols, rows: term.rows
    })

    const offData = api.onPtyData((id, data) => { if (id === paneId) term.write(data) })
    const offExit = api.onPtyExit((id) => { if (id === paneId && !disposed) term.write('\r\n[process exited]\r\n') })
    const inputDisp = term.onData(d => api.ptyWrite({ id: paneId, data: d }))

    const ro = new ResizeObserver(() => {
      fit.fit()
      api.ptyResize({ id: paneId, cols: term.cols, rows: term.rows })
    })
    ro.observe(hostRef.current!)

    return () => {
      disposed = true
      ro.disconnect(); inputDisp.dispose(); offData(); offExit(); term.dispose()
    }
  }, [paneId, config.shellId, config.cwd])

  return <div data-testid={`terminal-${paneId}`} ref={hostRef} style={{ width: '100%', height: '100%' }} />
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: xterm.js terminal pane wired to pty over ipc"
```

---

## Task 12: WorkspaceView (react-mosaic) + WorkspaceTabs + App

**Files:**
- Create: `src/renderer/components/WorkspaceView.tsx`, `src/renderer/components/WorkspaceTabs.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create `src/renderer/components/WorkspaceView.tsx`**

```tsx
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import type { MosaicNode as ModelNode, Workspace } from '@shared/types'
import { useStore } from '../store'
import { TerminalPane } from './TerminalPane'

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const closePane = useStore(s => s.closePane)

  if (ws.layout === null) {
    return (
      <div data-testid="empty-workspace" style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <button data-testid="add-first-terminal" onClick={() => addTerminal(ws.id, null, 'row')}>
          + New Terminal
        </button>
      </div>
    )
  }

  return (
    <Mosaic<string>
      value={ws.layout as ModelNode & string}
      onChange={(node) => setLayout(ws.id, (node as ModelNode) ?? null)}
      renderTile={(paneId, path) => {
        const pane = ws.panes[paneId]
        return (
          <MosaicWindow<string>
            path={path}
            title={pane?.config.name ?? 'Terminal'}
            toolbarControls={[
              <button key="split" data-testid={`split-${paneId}`}
                onClick={() => addTerminal(ws.id, paneId, 'row')}>Split</button>,
              <button key="close" data-testid={`close-${paneId}`}
                onClick={() => closePane(ws.id, paneId)}>✕</button>
            ]}
          >
            {pane ? <TerminalPane paneId={paneId} config={pane.config} /> : <div>missing pane</div>}
          </MosaicWindow>
        )
      }}
    />
  )
}
```

> Note: `react-mosaic`'s `MosaicNode` and our model's `MosaicNode` are structurally identical (string leaves + `{direction, first, second, splitPercentage}`). The `as` casts bridge the nominal type names; no runtime conversion is needed.

- [ ] **Step 2: Create `src/renderer/components/WorkspaceTabs.tsx`**

```tsx
import { useStore } from '../store'

export function WorkspaceTabs() {
  const { order, workspaces, activeId, setActive, newWorkspace, save } = useStore()
  return (
    <div data-testid="workspace-tabs" style={{ display: 'flex', gap: 4, padding: 4, background: '#1e1e1e' }}>
      {order.map(id => (
        <button key={id} data-testid={`tab-${id}`}
          onClick={() => setActive(id)}
          style={{ fontWeight: id === activeId ? 700 : 400 }}>
          {workspaces[id].name}
        </button>
      ))}
      <button data-testid="new-workspace" onClick={() => newWorkspace(`Workspace ${order.length + 1}`)}>+</button>
      <button data-testid="save-workspace"
        onClick={() => { if (activeId) save(activeId) }}>Save</button>
    </div>
  )
}
```

- [ ] **Step 3: Replace `src/renderer/App.tsx`**

```tsx
import { useEffect } from 'react'
import { useStore } from './store'
import { WorkspaceTabs } from './components/WorkspaceTabs'
import { WorkspaceView } from './components/WorkspaceView'

export default function App() {
  const init = useStore(s => s.init)
  const { activeId, workspaces } = useStore()
  useEffect(() => { init() }, [init])

  const active = activeId ? workspaces[activeId] : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <WorkspaceTabs />
      <div style={{ flex: 1, position: 'relative' }} className="mosaic-blueprint-theme">
        {active ? <WorkspaceView ws={active} /> : <div data-testid="app-title">Termhalla</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 5: Manual/dev check**

Run: `npm run dev`
Expected: window opens with one workspace tab and a "+ New Terminal" button; clicking it spawns a live shell you can type into; "Split" tiles a second terminal; "✕" closes one.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: tiled workspace view, workspace tabs, app shell"
```

---

## Task 13: Playwright-for-Electron smoke loop

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']]
})
```

- [ ] **Step 2: Create `tests/e2e/smoke.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'

test('launches, opens a terminal, echoes input', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const win = await app.firstWindow()

  await win.getByTestId('add-first-terminal').click()
  // a terminal tile mounts
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // type a command into the focused xterm and expect to see the echoed text
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo termhalla-ok')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('termhalla-ok', { timeout: 15_000 })

  await win.screenshot({ path: 'test-results/smoke-terminal.png' })
  await app.close()
})

test('split creates a second terminal tile', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  const split = win.locator('[data-testid^="split-"]').first()
  await split.click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await win.screenshot({ path: 'test-results/smoke-split.png' })
  await app.close()
})
```

- [ ] **Step 3: Build then run the smoke loop**

Run: `npm run build && npm run e2e`
Expected: both tests PASS; screenshots written to `test-results/`. Open `smoke-terminal.png` to confirm the terminal rendered the echoed text. This is the per-build self-feedback loop — re-run it after any renderer/main change.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: playwright-for-electron smoke loop (launch, terminal echo, split)"
```

---

## Task 14: Save / restore workspace end-to-end (Playwright)

**Files:**
- Modify: `tests/e2e/smoke.spec.ts` (add a persistence test using an isolated userData dir)

- [ ] **Step 1: Add the persistence test**

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('saves a workspace and restores its layout on relaunch', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'termh-e2e-'))
  const launch = () => electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`]
  })

  // Session 1: create two tiled terminals, then save.
  let app = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2)
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(500) // allow async save to flush
  await app.close()

  // Session 2: relaunch with same userData → layout restored (2 terminals, no empty state).
  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await expect(win.getByTestId('empty-workspace')).toHaveCount(0)
  await win.screenshot({ path: 'test-results/restore.png' })
  await app.close()
})
```

> `--user-data-dir` is honored by Electron automatically (Chromium switch), so the app's `userData` points at the temp dir without code changes. This keeps the test isolated from the real profile.

- [ ] **Step 2: Run it**

Run: `npm run build && npm run e2e`
Expected: all three tests PASS; `restore.png` shows two terminals after relaunch.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: end-to-end workspace save/restore across relaunch"
```

---

## Task 15: Phase 1 verification pass

- [ ] **Step 1: Full check**

Run: `npm run typecheck && npm run test && npm run build && npm run e2e`
Expected: typecheck clean; all vitest unit tests pass; build succeeds; all Playwright tests pass.

- [ ] **Step 2: Manual acceptance against the spec slice**

Confirm by hand in `npm run dev`:
- Multiple terminals open at once across different shells (pick each from… — *note:* a per-pane shell picker UI is the one spec-adjacent affordance not yet built; Phase 1 defaults new terminals to the first discovered shell. Add a shell dropdown in the `MosaicWindow` toolbar if desired before sign-off, or defer to a small follow-up.)
- Split horizontally/vertically (mosaic supports both via drag; `Split` button defaults to row — add a 'column' variant button if desired), resize via drag handles, rearrange via drag.
- Save a workspace, close the app, reopen → layout restored with fresh shells.
- Resize/move/maximize the window, reopen → window geometry restored.

- [ ] **Step 3: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: phase 1 verification adjustments"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** multiple terminals ✓ (Tasks 8–12), tiled split/resize/rearrange ✓ (react-mosaic, Task 12), workspace tabs ✓ (Task 12), save/restore layout + shell + cwd ✓ (Tasks 7,10,14), window-state memory ✓ (Tasks 5,9), common Windows shells ✓ (Task 6). Per-terminal **styling** (theme/font) and **naming**, and the **status/alert** engine are intentionally **Phase 2** scope, not Phase 1.
- **Open affordances flagged, not hidden:** per-pane shell picker and an explicit column-split button are called out in Task 15 as small additions/deferrals rather than silently omitted.
- **Type consistency:** `addFirstPane`/`splitPane`/`removePane` signatures and the `{ workspace, paneId }` return shape are consistent across Tasks 4, 10, 12. IPC channel names come from the single `CH` map (Task 9) used by both `register.ts` and `preload`.
- **Native build:** node-pty Spectre/`.bat` pitfalls documented in Tasks 1 & 7 with the exact fixes.
```