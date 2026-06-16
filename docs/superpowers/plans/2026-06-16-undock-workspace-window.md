# Undock Workspace Into Its Own Window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a workspace tab off the strip to tear it into its own real OS window (positionable on any monitor), drag it back / dock-button / native-X to re-dock, with live PTYs surviving the move, xterm scrollback preserved, and the multi-window arrangement restored on relaunch.

**Architecture:** The main-process service layer (PtyManager, status/proc/ai trackers, stores) is built **once** at startup instead of per-window. A new `WindowManager` owns the set of `BrowserWindow`s, the `paneId → windowId` ownership table, cross-window cursor hit-testing, and routes every pane-scoped push event to the window that owns the pane. Tear-off serializes each terminal (via `@xterm/addon-serialize`) before the source window disposes it; the new window adopts the still-running PTY (an idempotent `pty:spawn` that attaches + replays the snapshot instead of respawning).

**Tech Stack:** Electron (multi `BrowserWindow`), React + zustand, xterm.js (`@xterm/xterm` v5 + `@xterm/addon-serialize`), node-pty, Playwright-for-Electron, vitest.

**Spec:** [`docs/superpowers/specs/2026-06-16-undock-workspace-window-design.md`](../specs/2026-06-16-undock-workspace-window-design.md)

---

## Conventions for this plan

- Run unit tests with `npm test -- <path>` (vitest). Run e2e with `npm run build && npm run e2e -- <spec>`.
- Commit after every green step. Branch is `feat/undock-workspace-window` (already created).
- "r→m" = renderer→main IPC; "m→r" = main→renderer push event.

---

## Phase 0 — Dependency & data model

### Task 1: Add the serialize addon

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install @xterm/addon-serialize@^0.13.0`
Expected: `package.json` gains `"@xterm/addon-serialize"` under dependencies; `package-lock.json` updates.

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require.resolve('@xterm/addon-serialize')"`
Expected: prints a path, exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @xterm/addon-serialize for terminal handoff snapshots"
```

---

### Task 2: New `AppState` / `WindowLayout` types

**Files:**
- Modify: `src/shared/types.ts:139-151` (the `AppState` + `WindowState` block), `src/shared/types.ts:216` (`SCHEMA_VERSION`)

- [ ] **Step 1: Replace `AppState` with the multi-window shape**

In `src/shared/types.ts`, replace the existing `AppState` interface (currently `schemaVersion/openWorkspaceIds/activeWorkspaceId`) with:

```ts
/** One OS window: which workspaces it hosts (tab order), its active tab, and its bounds. */
export interface WindowLayout {
  workspaceIds: string[]
  activeId: string | null
  bounds: WindowState
  isMain: boolean        // exactly one window is the main/root window
}

export interface AppState {
  schemaVersion: number
  windows: WindowLayout[]   // windows[0] is the main window
}
```

Leave `WindowState` (lines 145-151) exactly as-is — `WindowLayout.bounds` reuses it.

- [ ] **Step 2: Bump the schema version**

Change `export const SCHEMA_VERSION = 3` to `export const SCHEMA_VERSION = 4`.

- [ ] **Step 3: Typecheck (expect errors — they're the to-do list)**

Run: `npm run typecheck`
Expected: FAIL. Errors point at every old `openWorkspaceIds`/`activeWorkspaceId`/`saveAppState({schemaVersion:1,...})` use (renderer `store.ts:90-106`, main `store.ts:9`). Those are fixed in later tasks; do not fix them here.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): multi-window AppState (WindowLayout[]) + schema v4"
```

---

### Task 3: `AppState` migration (pure)

**Files:**
- Create: `src/shared/app-state-model.ts`
- Test: `tests/shared/app-state-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { migrateAppState } from '@shared/app-state-model'
import { SCHEMA_VERSION, type WindowState } from '@shared/types'

const bounds: WindowState = { width: 1200, height: 800, x: 0, y: 0, maximized: false }

describe('migrateAppState', () => {
  it('lifts a legacy single-window state into windows[0] (main)', () => {
    const legacy = { schemaVersion: 1, openWorkspaceIds: ['a', 'b'], activeWorkspaceId: 'b' }
    const out = migrateAppState(legacy, bounds)
    expect(out).toEqual({
      schemaVersion: SCHEMA_VERSION,
      windows: [{ workspaceIds: ['a', 'b'], activeId: 'b', bounds, isMain: true }]
    })
  })

  it('passes a current multi-window state through unchanged', () => {
    const cur = { schemaVersion: SCHEMA_VERSION, windows: [
      { workspaceIds: ['a'], activeId: 'a', bounds, isMain: true },
      { workspaceIds: ['b'], activeId: 'b', bounds, isMain: false }
    ] }
    expect(migrateAppState(cur, bounds)).toEqual(cur)
  })

  it('returns null for an unrecognizable blob', () => {
    expect(migrateAppState({ nonsense: true }, bounds)).toBeNull()
    expect(migrateAppState(null, bounds)).toBeNull()
  })

  it('rejects a future schema version', () => {
    expect(migrateAppState({ schemaVersion: SCHEMA_VERSION + 1, windows: [] }, bounds)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test -- tests/shared/app-state-model.test.ts`
Expected: FAIL — `migrateAppState` not found.

- [ ] **Step 3: Implement**

```ts
// src/shared/app-state-model.ts
import { SCHEMA_VERSION, type AppState, type WindowState, type WindowLayout } from './types'

/** Normalize any persisted app-state blob to the current multi-window AppState.
 *  `fallbackBounds` seeds the main window's bounds when lifting a legacy state
 *  (legacy bounds lived in window-state.json). Returns null for junk / future versions. */
export function migrateAppState(raw: unknown, fallbackBounds: WindowState): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.schemaVersion !== 'number') return null
  if (o.schemaVersion > SCHEMA_VERSION) return null

  // Current shape: already has windows[].
  if (Array.isArray(o.windows)) {
    return { schemaVersion: SCHEMA_VERSION, windows: o.windows as WindowLayout[] }
  }
  // Legacy shape: openWorkspaceIds + activeWorkspaceId → a single main window.
  if (Array.isArray(o.openWorkspaceIds)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      windows: [{
        workspaceIds: o.openWorkspaceIds as string[],
        activeId: (o.activeWorkspaceId as string | null) ?? null,
        bounds: fallbackBounds,
        isMain: true
      }]
    }
  }
  return null
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- tests/shared/app-state-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/app-state-model.ts tests/shared/app-state-model.test.ts
git commit -m "feat(shared): migrate legacy single-window app-state to windows[]"
```

---

## Phase 1 — Window ownership core (pure, no Electron)

### Task 4: `window-manager-core` — ownership transfers + drop hit-testing

**Files:**
- Create: `src/main/window-manager-core.ts`
- Test: `tests/main/window-manager-core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  windowOf, undock, redock, decideDrop,
  type CoreState, type Strip
} from '../../src/main/window-manager-core'

const base: CoreState = { windows: [
  { id: 'main', isMain: true, workspaceIds: ['a', 'b'], activeId: 'b' },
  { id: 'w2', isMain: false, workspaceIds: ['c'], activeId: 'c' }
] }

describe('windowOf', () => {
  it('finds the window hosting a workspace', () => {
    expect(windowOf(base, 'a')).toBe('main')
    expect(windowOf(base, 'c')).toBe('w2')
    expect(windowOf(base, 'zzz')).toBeNull()
  })
})

describe('undock', () => {
  it('moves the workspace into a fresh window and fixes the source active tab', () => {
    const next = undock(base, 'b', 'w3')
    expect(windowOf(next, 'b')).toBe('w3')
    const main = next.windows.find(w => w.id === 'main')!
    expect(main.workspaceIds).toEqual(['a'])
    expect(main.activeId).toBe('a')                 // 'b' was active, fell back to 'a'
    const w3 = next.windows.find(w => w.id === 'w3')!
    expect(w3).toMatchObject({ isMain: false, workspaceIds: ['b'], activeId: 'b' })
  })
})

describe('redock', () => {
  it('appends to the target and makes it active', () => {
    const { state, closedWindowId } = redock(base, 'c', 'main')
    const main = state.windows.find(w => w.id === 'main')!
    expect(main.workspaceIds).toEqual(['a', 'b', 'c'])
    expect(main.activeId).toBe('c')
    expect(closedWindowId).toBe('w2')               // emptied non-main window closes
    expect(state.windows.find(w => w.id === 'w2')).toBeUndefined()
  })

  it('never removes the main window even when emptied', () => {
    const start: CoreState = { windows: [
      { id: 'main', isMain: true, workspaceIds: ['a'], activeId: 'a' },
      { id: 'w2', isMain: false, workspaceIds: ['b'], activeId: 'b' }
    ] }
    const { state, closedWindowId } = redock(start, 'a', 'w2')
    expect(state.windows.find(w => w.id === 'main')!.workspaceIds).toEqual([])
    expect(closedWindowId).toBeNull()
  })
})

describe('decideDrop', () => {
  const strips: Strip[] = [
    { windowId: 'main', x: 0, y: 0, width: 800, height: 36 },
    { windowId: 'w2', x: 900, y: 0, width: 400, height: 36 }
  ]
  it('undocks when the cursor is over no strip', () => {
    expect(decideDrop({ x: 500, y: 500 }, 'main', strips)).toEqual({ action: 'undock' })
  })
  it('re-docks when over another window strip', () => {
    expect(decideDrop({ x: 950, y: 10 }, 'main', strips)).toEqual({ action: 'redock', targetWindowId: 'w2' })
  })
  it('is a no-op when dropped back on its own strip', () => {
    expect(decideDrop({ x: 100, y: 10 }, 'main', strips)).toEqual({ action: 'none' })
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test -- tests/main/window-manager-core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/main/window-manager-core.ts

export interface CoreWindow {
  id: string
  isMain: boolean
  workspaceIds: string[]
  activeId: string | null
}
export interface CoreState { windows: CoreWindow[] }

export interface Point { x: number; y: number }
/** A window's tab-strip rectangle in screen coordinates. */
export interface Strip { windowId: string; x: number; y: number; width: number; height: number }

export type DropDecision =
  | { action: 'undock' }
  | { action: 'redock'; targetWindowId: string }
  | { action: 'none' }

export function windowOf(state: CoreState, workspaceId: string): string | null {
  return state.windows.find(w => w.workspaceIds.includes(workspaceId))?.id ?? null
}

/** Drop `workspaceId` into a brand-new window `newWindowId`. */
export function undock(state: CoreState, workspaceId: string, newWindowId: string): CoreState {
  const windows = state.windows.map(w => {
    if (!w.workspaceIds.includes(workspaceId)) return w
    const workspaceIds = w.workspaceIds.filter(id => id !== workspaceId)
    const activeId = w.activeId === workspaceId ? (workspaceIds[0] ?? null) : w.activeId
    return { ...w, workspaceIds, activeId }
  })
  windows.push({ id: newWindowId, isMain: false, workspaceIds: [workspaceId], activeId: workspaceId })
  return { windows }
}

/** Move `workspaceId` into `targetWindowId`; close the source window if it is a now-empty
 *  non-main window. Returns the closed window id (if any) so the shell can destroy it. */
export function redock(
  state: CoreState, workspaceId: string, targetWindowId: string
): { state: CoreState; closedWindowId: string | null } {
  const sourceId = windowOf(state, workspaceId)
  let windows = state.windows.map(w => {
    if (w.id === sourceId) {
      const workspaceIds = w.workspaceIds.filter(id => id !== workspaceId)
      const activeId = w.activeId === workspaceId ? (workspaceIds[0] ?? null) : w.activeId
      return { ...w, workspaceIds, activeId }
    }
    if (w.id === targetWindowId) {
      return { ...w, workspaceIds: [...w.workspaceIds, workspaceId], activeId: workspaceId }
    }
    return w
  })
  const source = windows.find(w => w.id === sourceId)
  let closedWindowId: string | null = null
  if (source && !source.isMain && source.workspaceIds.length === 0 && sourceId !== targetWindowId) {
    closedWindowId = source.id
    windows = windows.filter(w => w.id !== sourceId)
  }
  return { state: { windows }, closedWindowId }
}

function inStrip(p: Point, s: Strip): boolean {
  return p.x >= s.x && p.x <= s.x + s.width && p.y >= s.y && p.y <= s.y + s.height
}

/** Decide what a tab drop means given the cursor, the dragged tab's source window, and every
 *  window's strip rect. Over no strip → undock; over another window's strip → redock; over its
 *  own strip → none. */
export function decideDrop(cursor: Point, sourceWindowId: string, strips: Strip[]): DropDecision {
  const hit = strips.find(s => inStrip(cursor, s))
  if (!hit) return { action: 'undock' }
  if (hit.windowId === sourceWindowId) return { action: 'none' }
  return { action: 'redock', targetWindowId: hit.windowId }
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- tests/main/window-manager-core.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/window-manager-core.ts tests/main/window-manager-core.test.ts
git commit -m "feat(main): pure window-ownership core (undock/redock/decideDrop)"
```

---

## Phase 2 — IPC contract surface

### Task 5: Channels, arg types, and `TermhallaApi` methods

**Files:**
- Modify: `src/shared/ipc-contract.ts` (`CH` map ~line 49, arg types ~line 55, `TermhallaApi` ~line 110)

- [ ] **Step 1: Add channels**

In the `CH` object (before the closing `} as const`), add:

```ts
  winDragEnd: 'win:dragEnd',         // renderer -> main
  winRedock: 'win:redock',           // renderer -> main
  winAssignment: 'win:assignment',   // main -> renderer event
  termSerialize: 'term:serialize',   // main -> renderer event (request a snapshot)
  termSnapshot: 'term:snapshot',     // renderer -> main (the snapshot reply)
```

- [ ] **Step 2: Add arg/payload types**

After the existing `PtyResizeArgs` interface, add:

```ts
export interface WinDragEndArgs { workspaceId: string; cursor: { x: number; y: number } }
export interface WinRedockArgs { workspaceId: string; targetWindowId: string }
export interface WinAssignment { windowId: string; isMain: boolean; workspaceIds: string[]; activeId: string | null }
export interface TermSnapshotArgs { paneId: string; data: string }
```

- [ ] **Step 3: Add `TermhallaApi` methods**

Inside `TermhallaApi`, add:

```ts
  winDragEnd(args: WinDragEndArgs): void
  winRedock(args: WinRedockArgs): void
  onWinAssignment(cb: (a: WinAssignment) => void): () => void
  onTermSerialize(cb: (paneId: string) => void): () => void
  termSnapshot(args: TermSnapshotArgs): void
```

Also add the new types to the top-of-file `import type { ... }` from `./types` only if referenced there — they are declared locally here, so no `types.ts` import change is needed.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: still FAILs on the Task 2 call-sites + new "not implemented in preload" once preload is typed against the interface (fixed in Task 11). No *new* errors inside `ipc-contract.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts
git commit -m "feat(ipc): channels/types for undock, redock, assignment, serialize"
```

---

## Phase 3 — Main process: build-once services + WindowManager

> This phase is the structural core. After it, the app still runs as a single window (no UI to tear off yet), but the service layer is window-agnostic and event routing goes through the ownership table.

### Task 6: Add `PtyManager.has()` + idempotent attach hook

**Files:**
- Modify: `src/main/pty/pty-manager.ts`
- Test: `tests/main/pty-manager-has.test.ts` (only if PtyManager already has a unit-test seam; otherwise assert via the existing pattern in that file's neighbors)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { PtyManager } from '../../src/main/pty/pty-manager'

describe('PtyManager.has', () => {
  it('reports whether a pane currently has a live pty', () => {
    const mgr = new PtyManager(vi.fn(), vi.fn(), { /* engine stub */ } as never, '/tmp')
    expect(mgr.has('nope')).toBe(false)
  })
})
```

(If `PtyManager`'s constructor is awkward to stub, instead add the `has` method and assert it through the existing PtyManager test file's setup — match that file's style.)

- [ ] **Step 2: Run it, expect failure**

Run: `npm test -- tests/main/pty-manager-has.test.ts`
Expected: FAIL — `has` is not a function.

- [ ] **Step 3: Implement `has`**

In `pty-manager.ts`, the manager keys live ptys in a `Map` (find the field, e.g. `private sessions = new Map<...>()`). Add:

```ts
  has(id: string): boolean { return this.sessions.has(id) }
```

(Use the actual map field name from the file.)

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- tests/main/pty-manager-has.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/pty-manager.ts tests/main/pty-manager-has.test.ts
git commit -m "feat(pty): PtyManager.has() to detect an already-running pane"
```

---

### Task 7: Extract `buildServices()` from `registerHandlers`

**Files:**
- Create: `src/main/services.ts`
- Modify: `src/main/ipc/register.ts`, every `register-*.ts` that currently closes over a single `win`-bound `send`

**Why:** today `registerHandlers(win)` constructs `PtyManager`/trackers/stores *and* binds `send` to one window. We split construction (once, window-agnostic) from per-window concerns.

- [ ] **Step 1: Create the services builder**

```ts
// src/main/services.ts
import { join } from 'node:path'
import { detectShells } from './pty/shells'
import { writeIntegrationScripts } from './status/integration-scripts'
import { WorkspaceStore } from './persistence/store'
import { QuickStore } from './persistence/quick-store'
import { userDataDir } from './persistence/paths'
import { Recorder } from './recording/recorder'
import { EnvVault } from './env-vault/env-vault'

export interface Services {
  dir: string
  store: WorkspaceStore
  quick: QuickStore
  shells: ReturnType<typeof detectShells>
  recorder: Recorder
  envVault: EnvVault
  scriptDir: string
}

/** Build the privileged service layer ONCE for the whole app (not per window). PTYs and stores
 *  are global; windows are just views routed to by the WindowManager. */
export function buildServices(): Services {
  const dir = userDataDir()
  const scriptDir = join(dir, 'shell-integration')
  writeIntegrationScripts(scriptDir)
  return {
    dir,
    store: new WorkspaceStore(dir),
    quick: new QuickStore(dir),
    shells: detectShells(),
    recorder: new Recorder(),
    envVault: new EnvVault(dir),
    scriptDir
  }
}
```

- [ ] **Step 2: Introduce a `Router` seam for `send`**

The registrars currently take `send: Send`. Keep that signature, but `send` will now be supplied by the WindowManager (Task 8) and route by pane id. Change `register.ts` so `registerHandlers` accepts the prebuilt services + a router instead of building services itself:

```ts
// src/main/ipc/register.ts  (new signature)
import type { Services } from '../services'
import type { Router } from '../window-manager'
import type { PtyManager } from '../pty/pty-manager'
// ...existing per-domain imports...

/** Register all IPC handlers once. `router.routeToPane`/`router.broadcast` replace the old
 *  win-bound send; pane-scoped events go to the owning window, app-global events broadcast. */
export function registerHandlers(services: Services, router: Router): PtyManager {
  const { store, quick, shells, recorder, envVault, scriptDir, dir } = services

  // pane-scoped events carry the pane/terminal id as their FIRST arg → route by owner.
  const send = (channel: string, ...args: unknown[]): void => {
    const paneId = typeof args[0] === 'string' ? (args[0] as string) : null
    if (paneId && router.isPaneScoped(channel)) router.routeToPane(paneId, channel, ...args)
    else router.broadcast(channel, ...args)
  }

  const pty = registerPty(router.anyWindow(), { shells, recorder, envVault, scriptDir, send })
  registerWorkspaces({ store, quick, shells })
  registerEnv(router.anyWindow(), envVault, send)
  registerClipboard()
  registerDrafts(router.anyWindow(), dir)

  const disposers = [
    registerFs(router.anyWindow(), send),
    registerCloud(router.anyWindow(), send),
    registerUsage(send),
    registerRecording({ pty, recorder, userDataDir: dir, send })
  ]
  router.onAllWindowsClosed(() => { for (const d of disposers) d() })
  return pty
}
```

> Note: `registerPty`/`registerEnv`/`registerFs`/`registerDrafts`/`registerCloud` take a `win` only for `win.show()/focus()` on notify, dialogs, and reveal. `router.anyWindow()` returns the currently-focused-or-main `BrowserWindow` for those interactive cases. Keep their internals unchanged.

- [ ] **Step 3: Decide pane-scoped channels**

`router.isPaneScoped(channel)` returns true for: `pty:data`, `pty:exit`, `pty:status`, `pty:cwd`, `pty:procs`, `ai:session`, `usage:metrics`, `rec:state`, `term:serialize`, `win:assignment` (assignment is targeted, handled specially — see Task 8). All others (`cloud:status`, `env:state`, `fs:change`) broadcast.

- [ ] **Step 4: Typecheck (router type lands in Task 8)**

Run: `npm run typecheck`
Expected: FAIL only on the missing `Router`/WindowManager import (created next). No logic errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/services.ts src/main/ipc/register.ts
git commit -m "refactor(main): build services once; route IPC via a Router seam"
```

---

### Task 8: `WindowManager` (Electron shell) + window lifecycle

**Files:**
- Create: `src/main/window-manager.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Implement the WindowManager**

```ts
// src/main/window-manager.ts
import { BrowserWindow, screen, ipcMain } from 'electron'
import { resolve } from 'node:path'
import { v4 as uuid } from 'uuid'
import { CH, type WinDragEndArgs, type WinRedockArgs, type WinAssignment, type TermSnapshotArgs } from '@shared/ipc-contract'
import type { AppState, WindowState } from '@shared/types'
import { clampWindowState } from './window-state'
import {
  undock, redock, decideDrop, windowOf,
  type CoreState, type CoreWindow, type Strip
} from './window-manager-core'

const STRIP_HEIGHT = 36   // px; the WorkspaceTabs strip sits at the top of each window's content

const PANE_SCOPED = new Set([
  CH.ptyData, CH.ptyExit, CH.ptyStatus, CH.ptyCwd, CH.ptyProcs,
  CH.aiSession, CH.usageMetrics, CH.recState, CH.termSerialize
])

export interface Router {
  isPaneScoped(channel: string): boolean
  routeToPane(paneId: string, channel: string, ...args: unknown[]): void
  broadcast(channel: string, ...args: unknown[]): void
  anyWindow(): BrowserWindow
  onAllWindowsClosed(cb: () => void): void
}

export class WindowManager implements Router {
  private wins = new Map<string, BrowserWindow>()      // windowId -> BrowserWindow
  private core: CoreState = { windows: [] }
  private paneOwner = new Map<string, string>()        // paneId -> windowId
  private transit = new Map<string, string[]>()        // paneId -> buffered pty:data while moving
  private snapshots = new Map<string, string>()        // paneId -> pending serialize snapshot
  private pendingSerialize = new Map<string, (data: string) => void>()
  private closedCbs: (() => void)[] = []

  constructor(private readonly persist: (s: AppState) => void) {}

  // ---- Router impl ----
  isPaneScoped(channel: string) { return PANE_SCOPED.has(channel) }

  routeToPane(paneId: string, channel: string, ...args: unknown[]) {
    // Buffer live terminal output while a pane is mid-handoff (owner window not yet attached).
    if (channel === CH.ptyData && this.transit.has(paneId)) {
      this.transit.get(paneId)!.push(args[1] as string)
      return
    }
    const winId = this.paneOwner.get(paneId)
    const win = winId ? this.wins.get(winId) : undefined
    this.safeSend(win, channel, ...args)
  }

  broadcast(channel: string, ...args: unknown[]) {
    for (const win of this.wins.values()) this.safeSend(win, channel, ...args)
  }

  anyWindow(): BrowserWindow {
    return BrowserWindow.getFocusedWindow() ?? this.mainWindow()
  }

  onAllWindowsClosed(cb: () => void) { this.closedCbs.push(cb) }

  private safeSend(win: BrowserWindow | undefined, channel: string, ...args: unknown[]) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try { win.webContents.send(channel, ...args) } catch { /* torn down mid-send */ }
  }

  private mainWindow(): BrowserWindow {
    const id = this.core.windows.find(w => w.isMain)?.id
    return this.wins.get(id!)!
  }

  // ---- lifecycle ----
  /** Recreate every window from a restored AppState (or a fresh single main window). */
  restore(state: AppState | null) {
    const displays = screen.getAllDisplays().map(d => d.workArea)
    const windows = state?.windows.length
      ? state.windows
      : [{ workspaceIds: [], activeId: null, bounds: undefined as unknown as WindowState, isMain: true }]
    for (const layout of windows) {
      const id = uuid()
      this.core.windows.push({ id, isMain: layout.isMain, workspaceIds: layout.workspaceIds, activeId: layout.activeId })
      this.createBrowserWindow(id, clampWindowState(layout.bounds, displays), layout.isMain)
    }
    this.registerIpc()
  }

  private createBrowserWindow(id: string, bounds: WindowState, isMain: boolean): BrowserWindow {
    const win = new BrowserWindow({
      width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, show: false,
      webPreferences: {
        preload: resolve(import.meta.dirname, '../preload/index.mjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: false
      }
    })
    if (bounds.maximized) win.maximize()
    this.wins.set(id, win)
    win.once('ready-to-show', () => win.show())
    win.webContents.once('did-finish-load', () => this.sendAssignment(id))

    const persist = () => this.persistState()
    win.on('resize', persist); win.on('move', persist)

    win.on('close', (e) => {
      const cw = this.core.windows.find(w => w.id === id)
      // A floating window's native X re-docks its workspaces instead of killing them.
      if (cw && !cw.isMain && cw.workspaceIds.length > 0) {
        e.preventDefault()
        for (const wsId of [...cw.workspaceIds]) this.applyRedock(wsId, this.mainWindowId())
        return
      }
      this.persistState()
    })
    win.on('closed', () => {
      this.wins.delete(id)
      this.core.windows = this.core.windows.filter(w => w.id !== id)
      if (this.wins.size === 0) for (const cb of this.closedCbs) cb()
    })

    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else win.loadFile(resolve(import.meta.dirname, '../renderer/index.html'))
    return win
  }

  private mainWindowId(): string { return this.core.windows.find(w => w.isMain)!.id }

  private registerIpc() {
    ipcMain.on(CH.winDragEnd, (_e, a: WinDragEndArgs) => this.onDragEnd(a))
    ipcMain.on(CH.winRedock, (_e, a: WinRedockArgs) => this.applyRedock(a.workspaceId, a.targetWindowId))
    ipcMain.on(CH.termSnapshot, (_e, a: TermSnapshotArgs) => {
      this.snapshots.set(a.paneId, a.data)
      this.pendingSerialize.get(a.paneId)?.(a.data)
    })
  }

  // ---- the handoff ----
  private async onDragEnd(a: WinDragEndArgs) {
    const sourceWinId = windowOf(this.core, a.workspaceId)
    if (!sourceWinId) return
    const strips = this.strips()
    const decision = decideDrop(a.cursor, sourceWinId, strips)
    if (decision.action === 'none') return
    if (decision.action === 'redock') { this.applyRedock(a.workspaceId, decision.targetWindowId); return }
    // undock: snapshot panes, create window, transfer, replay.
    const paneIds = await this.requestSnapshots(sourceWinId, a.workspaceId)
    for (const pid of paneIds) this.transit.set(pid, [])   // start buffering live output
    const newWinId = uuid()
    this.core = undock(this.core, a.workspaceId, newWinId)
    for (const pid of paneIds) this.paneOwner.set(pid, newWinId)
    const displays = screen.getAllDisplays().map(d => d.workArea)
    this.core.windows.find(w => w.id === newWinId)!  // exists
    const bounds = clampWindowState(
      { width: 900, height: 640, x: a.cursor.x, y: a.cursor.y, maximized: false }, displays)
    this.createBrowserWindow(newWinId, bounds, false)
    this.sendAssignment(sourceWinId)   // source drops the workspace → unmounts (disposes xterms)
    this.persistState()
  }

  private applyRedock(workspaceId: string, targetWindowId: string) {
    const { state, closedWindowId } = redock(this.core, workspaceId, targetWindowId)
    this.core = state
    const target = this.core.windows.find(w => w.id === targetWindowId)
    if (target) for (const pid of this.panesFor(workspaceId)) this.paneOwner.set(pid, targetWindowId)
    if (closedWindowId) { this.wins.get(closedWindowId)?.destroy(); this.wins.delete(closedWindowId) }
    this.sendAssignment(targetWindowId)
    this.persistState()
  }

  /** Ask the source window to serialize each pane of a workspace; resolve once all replies land. */
  private requestSnapshots(sourceWinId: string, workspaceId: string): Promise<string[]> {
    const paneIds = this.panesFor(workspaceId)
    const win = this.wins.get(sourceWinId)
    return new Promise(resolveAll => {
      let remaining = paneIds.length
      if (remaining === 0) { resolveAll([]); return }
      const timeout = setTimeout(() => resolveAll(paneIds), 500) // never hang the drag
      for (const pid of paneIds) {
        this.pendingSerialize.set(pid, () => {
          this.pendingSerialize.delete(pid)
          if (--remaining === 0) { clearTimeout(timeout); resolveAll(paneIds) }
        })
        this.safeSend(win, CH.termSerialize, pid)
      }
    })
  }

  /** Called by register-pty's spawn handler when a pane already has a live pty: replay the
   *  captured snapshot + buffered live bytes into the (new) owning window instead of respawning. */
  replayInto(paneId: string) {
    const winId = this.paneOwner.get(paneId)
    const win = winId ? this.wins.get(winId) : undefined
    const snap = this.snapshots.get(paneId)
    if (snap) { this.safeSend(win, CH.ptyData, paneId, snap); this.snapshots.delete(paneId) }
    const buffered = this.transit.get(paneId)
    this.transit.delete(paneId)             // stop buffering; live output flows again
    if (buffered) for (const chunk of buffered) this.safeSend(win, CH.ptyData, paneId, chunk)
  }

  // ---- helpers ----
  private panesFor(_workspaceId: string): string[] {
    // The renderer owns workspace pane maps; main learns pane ids lazily as ptys spawn.
    // paneOwner already tracks every live pane. Filter to those whose workspace is moving by
    // asking the source renderer (it includes paneIds in the serialize request flow). For the
    // pure transfer we operate on the paneOwner set captured during requestSnapshots.
    return [...this.paneOwner.keys()].filter(pid => this.movingPanes.has(pid))
  }
  private movingPanes = new Set<string>()

  private strips(): Strip[] {
    return this.core.windows.map(w => {
      const b = this.wins.get(w.id)!.getContentBounds()
      return { windowId: w.id, x: b.x, y: b.y, width: b.width, height: STRIP_HEIGHT }
    })
  }

  private sendAssignment(windowId: string) {
    const cw = this.core.windows.find(w => w.id === windowId)
    if (!cw) return
    const payload: WinAssignment = { windowId, isMain: cw.isMain, workspaceIds: cw.workspaceIds, activeId: cw.activeId }
    this.safeSend(this.wins.get(windowId), CH.winAssignment, payload)
  }

  private persistState() {
    const state: AppState = {
      schemaVersion: 4,
      windows: this.core.windows.map(w => {
        const b = this.wins.get(w.id)?.getBounds()
        const maximized = this.wins.get(w.id)?.isMaximized() ?? false
        return {
          workspaceIds: w.workspaceIds, activeId: w.activeId, isMain: w.isMain,
          bounds: b ? { ...b, maximized } : { width: 1200, height: 800, maximized: false }
        }
      })
    }
    this.persist(state)
  }

  killAllWindows() { for (const w of this.wins.values()) w.destroy() }
}
```

> **Note on `panesFor`/`movingPanes`:** the renderer knows a workspace's pane ids; main only learns them as ptys spawn. The serialize request must therefore include pane ids. Simplest correct approach: the renderer answers `term:serialize` requests by *itself* iterating its workspace's panes — so main asks "serialize workspace W" and the renderer streams a `term:snapshot` per pane. Adjust `requestSnapshots` to send a workspace-level serialize request (`CH.termSerialize` carrying the workspaceId) and collect snapshots until an end marker. **Resolve this interface in Step 2 before implementing**, picking the workspace-level request to avoid main guessing pane ids.

- [ ] **Step 2: Reconcile the serialize interface (decide pane vs workspace granularity)**

Change `CH.termSerialize` to carry a `workspaceId` and have the source renderer reply with one `term:snapshot { paneId, data }` per terminal pane plus a final `term:snapshot { paneId: '__end__:'+workspaceId, data: '' }` sentinel. Update `WindowManager.requestSnapshots` to resolve on the sentinel and record the real pane ids into `movingPanes`/`paneOwner`. Update the contract `onTermSerialize` callback to receive `workspaceId: string`.

- [ ] **Step 3: Wire `index.ts` to the WindowManager**

```ts
// src/main/index.ts
import { app } from 'electron'
import { buildServices } from './services'
import { WindowManager } from './window-manager'
import { registerHandlers } from './ipc/register'

app.whenReady().then(async () => {
  const services = buildServices()
  const wm = new WindowManager(state => { void services.store.saveAppState(state) })
  const pty = registerHandlers(services, wm)
  ;(wm as unknown as { replayPty?: unknown }).replayPty = pty // see Task 9 wiring note
  const state = await services.store.loadAppState()
  wm.restore(state)
  app.on('window-all-closed', () => { pty.killAll(); if (process.platform !== 'darwin') app.quit() })
})
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: FAIL only on register-pty's not-yet-added replay hook (Task 9) and renderer (Phase 4). Main-side WindowManager itself type-clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/window-manager.ts src/main/index.ts
git commit -m "feat(main): WindowManager — multi-window lifecycle, routing, handoff"
```

---

### Task 9: Idempotent `pty:spawn` (attach + replay if already running)

**Files:**
- Modify: `src/main/ipc/register-pty.ts:49-53` (the `ptySpawn` handler), and pass the WindowManager's `replayInto`

- [ ] **Step 1: Thread `replayInto` into register-pty**

Add an optional `onAttachExisting?: (paneId: string) => void` to `registerPty`'s `deps`, supplied from `register.ts` as `router.replayInto.bind(router)` (widen the `Router` interface with `replayInto(paneId: string): void`).

- [ ] **Step 2: Make spawn idempotent**

Replace the `ptySpawn` handler body with:

```ts
  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    if (pty.has(a.id)) {            // pane moved windows: adopt the live pty, don't respawn
      deps.onAttachExisting?.(a.id)
      return
    }
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    tracker.register(a.id)
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows, a.launch, envVault.envFor(a.envId))
  })
```

- [ ] **Step 3: Typecheck + run existing pty tests**

Run: `npm run typecheck` then `npm test -- tests/main`
Expected: typecheck passes for main; existing main tests still green.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/register-pty.ts src/main/ipc/register.ts src/main/window-manager.ts
git commit -m "feat(pty): attach + replay snapshot when a moved pane re-spawns"
```

---

### Task 10: Update `WorkspaceStore` app-state read to migrate

**Files:**
- Modify: `src/main/persistence/store.ts:6-10,48-59`
- Test: `tests/main/store.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/main/store.test.ts`:

```ts
it('migrates a legacy app-state on load', async () => {
  const store = new WorkspaceStore(tmpDir)   // tmpDir from existing setup
  await writeFile(join(tmpDir, 'app-state.json'),
    JSON.stringify({ schemaVersion: 1, openWorkspaceIds: ['x'], activeWorkspaceId: 'x' }))
  const loaded = await store.loadAppState()
  expect(loaded?.windows).toHaveLength(1)
  expect(loaded?.windows[0]).toMatchObject({ workspaceIds: ['x'], activeId: 'x', isMain: true })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test -- tests/main/store.test.ts`
Expected: FAIL — `loaded.windows` undefined (old shape passthrough).

- [ ] **Step 3: Implement**

Replace `isAppState` + `loadAppState`:

```ts
import { migrateAppState } from '@shared/app-state-model'
import { DEFAULT_WINDOW_STATE } from '../window-state'

// ...
  async loadAppState(): Promise<AppState | null> {
    try {
      const data: unknown = JSON.parse(await readFile(this.appStateFile(), 'utf8'))
      return migrateAppState(data, DEFAULT_WINDOW_STATE)
    } catch { return null }
  }
```

Remove the now-unused `isAppState` helper. `saveAppState` is unchanged (it already writes whatever `AppState` it's given).

- [ ] **Step 4: Run it, expect pass**

Run: `npm test -- tests/main/store.test.ts`
Expected: PASS (including the existing app-state round-trip test — update that test's expected object to the `windows[]` shape if it asserted the old fields).

- [ ] **Step 5: Commit**

```bash
git add src/main/persistence/store.ts tests/main/store.test.ts
git commit -m "feat(persistence): migrate app-state to windows[] on load"
```

---

## Phase 4 — Renderer: assignment-driven windows, drag tear-off, serialize

### Task 11: Preload + `api.ts` for the new channels

**Files:**
- Modify: `src/preload/index.ts`, `src/renderer/api.ts`

- [ ] **Step 1: Preload**

Add to the `window.api` object in `src/preload/index.ts` (match existing send/invoke/on patterns):

```ts
  winDragEnd: (args) => ipcRenderer.send(CH.winDragEnd, args),
  winRedock: (args) => ipcRenderer.send(CH.winRedock, args),
  onWinAssignment: (cb) => { const h = (_e, a) => cb(a); ipcRenderer.on(CH.winAssignment, h); return () => ipcRenderer.removeListener(CH.winAssignment, h) },
  onTermSerialize: (cb) => { const h = (_e, wsId) => cb(wsId); ipcRenderer.on(CH.termSerialize, h); return () => ipcRenderer.removeListener(CH.termSerialize, h) },
  termSnapshot: (args) => ipcRenderer.send(CH.termSnapshot, args),
```

- [ ] **Step 2: api.ts**

Re-export those through `src/renderer/api.ts` exactly as the surrounding methods are re-exported (the file typically spreads `window.api`; if it lists methods explicitly, add these five).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: preload/api now satisfy `TermhallaApi`; remaining errors are the store ones (next task).

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/api.ts
git commit -m "feat(preload): expose undock/redock/assignment/serialize bridge"
```

---

### Task 12: Store — window-local assignment + workspace-only saveAll

**Files:**
- Modify: `src/renderer/store.ts:84-107` (`init`, `saveAll`) and add `windowId`, `applyAssignment`, `serializeWorkspacePanes`
- Modify: `src/renderer/store/types.ts` (State type additions)

- [ ] **Step 1: Add state fields & action types**

In `src/renderer/store/types.ts`, add to `State`:

```ts
  windowId: string | null
  isMainWindow: boolean
  applyAssignment(a: { windowId: string; isMain: boolean; workspaceIds: string[]; activeId: string | null }): Promise<void>
```

- [ ] **Step 2: Replace `init` to be assignment-driven**

```ts
    init: async () => {
      const shells = await api.listShells()
      set({ shells, newTerminalShellId: shells[0]?.id ?? null })
      const [quick, home, drafts] = await Promise.all([api.loadQuick(), api.homeDir(), api.draftsLoad()])
      set({ quick, home, drafts })
      // Each window is told which workspaces it owns via win:assignment (wired in App.tsx).
      // The very first assignment hydrates this window; main owns the windows[] arrangement.
    },

    applyAssignment: async ({ windowId, isMain, workspaceIds, activeId }) => {
      set({ windowId, isMainWindow: isMain })
      const have = get().workspaces
      const missing = workspaceIds.filter(id => !have[id])
      const loaded = await Promise.all(missing.map(id => api.loadWorkspace(id)))
      set(s => {
        const workspaces = { ...s.workspaces }
        for (const ws of loaded) if (ws) workspaces[ws.id] = ws
        // Drop workspaces this window no longer owns (moved to another window).
        for (const id of Object.keys(workspaces)) if (!workspaceIds.includes(id)) delete workspaces[id]
        const order = workspaceIds.filter(id => workspaces[id])
        if (order.length === 0) return { workspaces, order, activeId: null }
        return { workspaces, order, activeId: activeId ?? order[0] }
      })
      // Only the main window seeds a starter workspace when it has nothing (cold first run);
      // a floating window legitimately closes itself when emptied, so it must NOT re-seed.
      if (isMain && get().order.length === 0) get().newWorkspace('Workspace 1')
    },
```

`isMain` comes straight from the `win:assignment` payload (Task 5/8), so the renderer never has to guess which window it is.

- [ ] **Step 3: Make `saveAll` save workspaces only (main owns arrangement)**

```ts
    saveAll: async () => {
      const { order, workspaces, cwds } = get()
      await Promise.all(order.map(id => api.saveWorkspace(applyCwds(workspaces[id], cwds))))
      // NOTE: app-state (the windows[] arrangement) is persisted by main's WindowManager, not here.
    },
```

- [ ] **Step 4: Add `windowId: null` to initial state**

In the initial-state block (around line 58) add `windowId: null,` and `isMainWindow: true,` (true by default so a never-assigned first paint shows the full tab strip, not the floating header).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (renderer compiles; no more `openWorkspaceIds` references).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store.ts src/renderer/store/types.ts
git commit -m "feat(store): window-local assignment; main owns windows[] arrangement"
```

---

### Task 13: Wire assignment + serialize in `App.tsx`

**Files:**
- Modify: `src/renderer/App.tsx:33-46` (push-event subscription)

- [ ] **Step 1: Subscribe to assignment + serialize**

Add to the `offs` array in the existing push-event `useEffect`:

```ts
      api.onWinAssignment((a) => { void s().applyAssignment(a) }),
      api.onTermSerialize((wsId) => s().serializeWorkspace(wsId)),
```

- [ ] **Step 2: Add `serializeWorkspace` to the store (delegates to panes)**

In the store, add an action that, for a workspace, asks each terminal pane to emit its snapshot. Terminals register a serializer via a module-level registry (Task 14 fills it):

```ts
    serializeWorkspace: (wsId: string) => {
      const ws = get().workspaces[wsId]
      if (!ws) { api.termSnapshot({ paneId: `__end__:${wsId}`, data: '' }); return }
      for (const paneId of Object.keys(ws.panes)) {
        if (ws.panes[paneId].config.kind !== 'terminal') continue
        const data = readPaneSnapshot(paneId)          // from the terminal registry
        api.termSnapshot({ paneId, data })
      }
      api.termSnapshot({ paneId: `__end__:${wsId}`, data: '' })   // sentinel: main resolves
    },
```

Add the registry helper module:

```ts
// src/renderer/components/terminal-registry.ts
const serializers = new Map<string, () => string>()
export function registerSerializer(paneId: string, fn: () => string) { serializers.set(paneId, fn) }
export function unregisterSerializer(paneId: string) { serializers.delete(paneId) }
export function readPaneSnapshot(paneId: string): string { return serializers.get(paneId)?.() ?? '' }
```

Import `readPaneSnapshot` in the store and add `serializeWorkspace` to the `State` type.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS once `serializeWorkspace`/`readPaneSnapshot` are declared and imported.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx src/renderer/store.ts src/renderer/store/types.ts src/renderer/components/terminal-registry.ts
git commit -m "feat(renderer): apply window assignments; serialize on request"
```

---

### Task 14: `TerminalPane` — register a serializer; load the serialize addon

**Files:**
- Modify: `src/renderer/components/TerminalPane.tsx:1-3,23-27,65-70`

- [ ] **Step 1: Load the addon and register a serializer**

After the FitAddon setup (line ~24), add:

```ts
    const serialize = new SerializeAddon()
    term.loadAddon(serialize)
    registerSerializer(paneId, () => serialize.serialize({ scrollback: 1000 }))
```

Imports at the top:

```ts
import { SerializeAddon } from '@xterm/addon-serialize'
import { registerSerializer, unregisterSerializer } from './terminal-registry'
```

- [ ] **Step 2: Unregister on cleanup**

In the effect's cleanup (line ~68), add `unregisterSerializer(paneId)` before `term.dispose()`.

- [ ] **Step 3: Build + smoke check that nothing regressed**

Run: `npm run build`
Expected: build succeeds. (No new unit test — covered by e2e Task 16.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TerminalPane.tsx
git commit -m "feat(terminal): serialize-addon snapshot registered per pane"
```

---

### Task 15: `WorkspaceTabs` — ghost-drag tear-off; floating-window dock header

**Files:**
- Modify: `src/renderer/components/WorkspaceTabs.tsx`
- Create: `src/renderer/components/FloatingHeader.tsx`
- Modify: `src/renderer/App.tsx` (render `FloatingHeader` when this window is not the main one)

- [ ] **Step 1: Replace HTML5 tab drag with a pointer-drag that reports drop position**

Replace the tab `<button>`'s `draggable`/`onDragStart`/`onDragOver`/`onDrop` (lines 84-87) with a pointer-drag. On `pointerdown`, start tracking; show a ghost element following the cursor; on `pointerup`, call `api.winDragEnd({ workspaceId: id, cursor: { x: e.screenX, y: e.screenY } })`. Reordering within the strip still uses the existing `moveWorkspace` when the drop lands on another tab (decided in main via `decideDrop` returning `none` → renderer keeps intra-strip reorder by also handling pointer-over-tab locally).

```tsx
const onTabPointerDown = (id: string) => (e: React.PointerEvent) => {
  e.preventDefault()
  setDraggedId(id)
  const onMove = (me: PointerEvent) => setGhost({ x: me.clientX, y: me.clientY, id })
  const onUp = (ue: PointerEvent) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    setGhost(null); setDraggedId(null)
    // Intra-strip reorder: if released over another tab in THIS strip, reorder locally.
    const overTab = (ue.target as HTMLElement)?.closest('[data-tab-id]') as HTMLElement | null
    const overId = overTab?.dataset.tabId
    if (overId && overId !== id) { moveWorkspace(id, overId); return }
    // Otherwise let main decide undock/redock by screen position.
    api.winDragEnd({ workspaceId: id, cursor: { x: ue.screenX, y: ue.screenY } })
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
```

Give each tab button `data-tab-id={id}` and `onPointerDown={onTabPointerDown(id)}`; keep `onClick`/`onDoubleClick`/`onContextMenu`. Add `const [ghost, setGhost] = useState<{x:number;y:number;id:string}|null>(null)` and render a fixed-position ghost label following the cursor when `ghost` is set.

- [ ] **Step 2: Floating window header (dock button)**

```tsx
// src/renderer/components/FloatingHeader.tsx
import { useStore } from '../store'
import { api } from '../api'

/** Slim header shown only in undocked (non-main) windows: name + a Dock button. */
export function FloatingHeader() {
  const { windowId, order, workspaces } = useStore(s => ({ windowId: s.windowId, order: s.order, workspaces: s.workspaces }))
  const wsId = order[0]
  if (!wsId) return null
  return (
    <div data-testid="floating-header" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 4, background: 'var(--panel,#1e1e1e)' }}>
      <span style={{ flex: 1 }}>{workspaces[wsId]?.name}</span>
      <button data-testid="dock-button" title="Dock back into main window"
        onClick={() => api.winRedock({ workspaceId: wsId, targetWindowId: 'main' })}>⤓ Dock</button>
    </div>
  )
}
```

> `targetWindowId: 'main'`: the renderer doesn't know main's internal id. Have `applyRedock` treat the literal `'main'` as "the main window" (resolve to `this.mainWindowId()` when `targetWindowId === 'main'`). Add that one-line guard in `WindowManager.applyRedock`.

- [ ] **Step 3: Show the right chrome per window in App.tsx**

`isMainWindow` is already in the store (from the `win:assignment` `isMain` flag, Task 12). In `App.tsx`, select it (`const isMainWindow = useStore(s => s.isMainWindow)`) and render `{isMainWindow ? <WorkspaceTabs /> : <FloatingHeader />}` in place of the current unconditional `<WorkspaceTabs />`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/WorkspaceTabs.tsx src/renderer/components/FloatingHeader.tsx src/renderer/App.tsx src/main/window-manager.ts src/shared/ipc-contract.ts src/renderer/store.ts src/renderer/store/types.ts
git commit -m "feat(ui): ghost-drag tear-off + floating-window dock header"
```

---

## Phase 5 — End-to-end verification

### Task 16: e2e — tear-off, survival, re-dock, restart

**Files:**
- Create: `tests/e2e/undock.spec.ts`

- [ ] **Step 1: Write the e2e**

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('tear a workspace into its own window, keep scrollback, then re-dock', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'th-undock-'))
  const app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`]
  })
  const main = await app.firstWindow()

  // Create a 2nd workspace so the main window keeps one tab after tear-off.
  await main.getByTestId('new-workspace').click()
  // Type a marker into the first workspace's terminal.
  await main.getByTestId(/^tab-/).first().click()
  const term = main.locator('.xterm-helper-textarea').first()
  await term.focus(); await term.type('echo TEAR_MARKER\r')
  await expect(main.locator('.xterm-rows')).toContainText('TEAR_MARKER')

  // Drag the first tab off-window (drop far outside the main window bounds).
  const tab = main.getByTestId(/^tab-/).first()
  const box = await tab.boundingBox()
  await main.mouse.move(box!.x + 5, box!.y + 5)
  await main.mouse.down()
  await main.mouse.move(box!.x + 5, box!.y + 600, { steps: 8 })  // drag downward, off the strip
  await main.mouse.up()

  // A second BrowserWindow should now exist, showing the preserved marker.
  await expect.poll(() => app.windows().length).toBeGreaterThan(1)
  const floating = app.windows().find(w => w !== main)!
  await expect(floating.locator('.xterm-rows')).toContainText('TEAR_MARKER')

  // PTY survived: type in the floating window and see echo.
  const ftext = floating.locator('.xterm-helper-textarea').first()
  await ftext.focus(); await ftext.type('echo STILL_ALIVE\r')
  await expect(floating.locator('.xterm-rows')).toContainText('STILL_ALIVE')

  // Re-dock via the dock button → floating window closes, tab returns to main.
  await floating.getByTestId('dock-button').click()
  await expect.poll(() => app.windows().length).toBe(1)

  await app.close()
})
```

- [ ] **Step 2: Build then run**

Run: `npm run build && npm run e2e -- tests/e2e/undock.spec.ts`
Expected: PASS. If the drag-threshold/strip math needs tuning, adjust `STRIP_HEIGHT` or the drop offset; the assertion that matters is "a 2nd window appears owning the workspace with the marker".

- [ ] **Step 3: Restart persistence check (extend the same spec or a 2nd test)**

Add a second test: after tearing off, `await app.close()`, relaunch with the same `userDataDir`, and assert `app.windows().length === 2` with each window owning the expected workspace (match by terminal marker text after fresh restore — note restore spawns fresh PTYs, so assert on workspace *names*/tab presence rather than scrollback).

```ts
test('restores two windows after restart', async () => {
  // ...tear off as above, capture workspace names, app.close()...
  const app2 = await electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`] })
  await expect.poll(() => app2.windows().length).toBe(2)
  await app2.close()
})
```

- [ ] **Step 4: Full regression**

Run: `npm test && npm run build && npm run e2e`
Expected: all unit + e2e green (existing `workspace-switch`, `persistence`, `clipboard` specs included — confirm the single→multi-window change didn't break them; update any that assumed exactly one window).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/undock.spec.ts
git commit -m "test(e2e): undock tear-off, PTY survival, re-dock, restart"
```

---

## Phase 6 — Docs

### Task 17: Feature doc, architecture/CLAUDE updates, changelog

**Files:**
- Create: `docs/features/window-management.md`
- Modify: `docs/architecture.md` (process model: now N windows + WindowManager routing), `CLAUDE.md` (Where-things-live row + a load-bearing gotcha for the single-owner/handoff invariant), `CHANGELOG.md`

- [ ] **Step 1: Write `docs/features/window-management.md`**

Cover: what it does (tear-off/re-dock/persist), how it works (build-once services, `WindowManager` ownership table + routing, the serialize→adopt-pty handoff, idempotent `pty:spawn`), key files table, behaviors/edge-cases (native-X re-docks, empty floating window closes, orphan fallback, transit buffering), and testing.

- [ ] **Step 2: Update architecture.md + CLAUDE.md**

- architecture.md "Process model": note that `index.ts` now `buildServices()` once and `WindowManager.restore()` creates N windows; push events route by pane ownership instead of a single win-bound `send`.
- CLAUDE.md "Where things live": add a row `Multi-window / undock | src/main/window-manager.ts (+ -core) | docs/features/window-management.md`.
- CLAUDE.md "Load-bearing gotchas": add the **single-owner invariant** (exactly one window renders a pane / one xterm per PTY) and the **handoff ordering** (serialize before dispose; buffer live bytes in `transit` until the new window adopts the pty via idempotent `pty:spawn`).

- [ ] **Step 3: Changelog**

Add a `CHANGELOG.md` entry under the current version: "Undock a workspace tab into its own OS window (any monitor); drag back / dock button / native-X to re-dock; live shells survive with scrollback; multi-window layout persists across restart."

- [ ] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md CHANGELOG.md
git commit -m "docs: window management (undock/re-dock) feature + arch/gotcha notes"
```

---

## Self-review checklist (run before handing off)

- [ ] Spec coverage: real OS window (Task 8), preserve scrollback (Tasks 8/14 serialize→replay), drag-back + dock button (Task 15), native-X re-docks without killing PTYs (Task 8 `close` handler), persist across restart (Tasks 8/10/16), ghost-tab drag (Task 15). ✓
- [ ] Type consistency: `WinAssignment` gains `isMain` in Task 15 — ensure the contract (Task 5) and `sendAssignment` (Task 8) both include it; reconcile when reaching Task 15.
- [ ] Open interface to finalize during implementation (flagged in Task 8 Step 2): `term:serialize` is **workspace-granular**, with a `__end__:<wsId>` sentinel; `WindowManager.requestSnapshots`, `onTermSerialize`, and the store `serializeWorkspace` must all agree on that shape.
- [ ] `targetWindowId: 'main'` literal is resolved to the real main window id in `applyRedock` (Task 15 Step 2 note).
```
