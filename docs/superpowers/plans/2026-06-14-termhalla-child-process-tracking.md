# Child-Process Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each terminal's foreground child-process as a toolbar chip plus an expandable descendant-process tree, driven by a busy-gated Windows process-table snapshot.

**Architecture:** A new main-process `ProcessTracker` keeps a `{ paneId → shellPid }` registry (PID from `node-pty`'s `IPty.pid`) and a busy flag fed from the status engine. While ≥1 terminal is busy it polls (~1s) a single `Get-CimInstance Win32_Process` snapshot, computes each busy terminal's descendant tree + foreground process via pure helpers, and emits `(paneId, ProcInfo | null)` over a new `pty:procs` channel. The renderer shows a `▶ <process>` chip (or the shell name when idle) with a tree popover. Because detection is OS-level, it works for every shell including `cmd` and SSH.

**Tech Stack:** Electron + TypeScript (strict), electron-vite, React, zustand, react-mosaic, node-pty, `child_process.execFile` + PowerShell CIM, vitest, @playwright/test (Electron). Path alias `@shared/*` → `src/shared/*`.

**Spec:** `docs/superpowers/specs/2026-06-14-termhalla-child-process-tracking-design.md`

---

## File Structure

**New files:**
- `src/main/proc/proc-tree.ts` — pure core: `CimRow`, `parseCimRows`, `parseCimDate`, `cleanName`, `descendantsOf`, `pickForeground`, `buildProcInfo`.
- `src/main/proc/cim-query.ts` — `queryProcesses()` wrapping `execFile('powershell', …)` + `parseCimRows` (not unit-tested; spawns PowerShell).
- `src/main/proc/process-tracker.ts` — `ProcessTracker` (registry, busy flag, `pollOnce`, timer, dedup-emit).
- `tests/main/proc-tree.test.ts`, `tests/main/process-tracker.test.ts`, `tests/e2e/procs.spec.ts`.

**Modified files:**
- `src/shared/types.ts` — `ProcNode`, `ProcInfo`.
- `src/shared/ipc-contract.ts` — `pty:procs` channel + `onPtyProcs` API method.
- `src/preload/index.ts` — expose `onPtyProcs`.
- `src/main/pty/pty-manager.ts` — public `pidOf(id)`.
- `src/main/ipc/register.ts` — construct + wire `ProcessTracker` (busy feed, register/unregister, emit).
- `src/renderer/store.ts` — `procs` state, `setProcs`, `closePane` map cleanup.
- `src/renderer/App.tsx` — `onPtyProcs` effect.
- `src/renderer/components/WorkspaceView.tsx` — chip toolbar control + tree popover.

---

## Task 1: Pure process-tree core

**Files:**
- Create: `src/main/proc/proc-tree.ts`
- Test: `tests/main/proc-tree.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `ProcNode` / `ProcInfo` to `src/shared/types.ts`**

Append after the `FsChange` interface (before `export const SCHEMA_VERSION = 3`):

```ts
/** One process in a terminal's descendant tree. `depth` = 0 for direct children of the shell. */
export interface ProcNode {
  pid: number
  ppid: number
  name: string      // image name without ".exe", e.g. "node"
  command: string   // full CommandLine, or the name when CommandLine is empty
  depth: number
}

/** Foreground process + descendant tree for one terminal. */
export interface ProcInfo {
  foreground: string   // leaf process name shown on the chip when busy
  tree: ProcNode[]     // DFS pre-order; render indented by `depth`
}
```

- [ ] **Step 2: Write the failing test `tests/main/proc-tree.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  parseCimRows, parseCimDate, cleanName, descendantsOf, pickForeground, buildProcInfo
} from '../../src/main/proc/proc-tree'

// shell pid = 100. Tree: 100 -> 200(node) -> 300(node) ; 100 -> 250(git). 999 unrelated.
const rows = [
  { ProcessId: 200, ParentProcessId: 100, Name: 'node.exe', CommandLine: 'node app.js', CreationDate: '/Date(1000)/' },
  { ProcessId: 300, ParentProcessId: 200, Name: 'node.exe', CommandLine: 'node child.js', CreationDate: '/Date(3000)/' },
  { ProcessId: 250, ParentProcessId: 100, Name: 'git.exe', CommandLine: 'git status', CreationDate: '/Date(2000)/' },
  { ProcessId: 999, ParentParentTypo: 0, ParentProcessId: 1, Name: 'svc.exe', CommandLine: null, CreationDate: null }
]

describe('parseCimRows', () => {
  it('parses an array form', () => {
    expect(parseCimRows(JSON.stringify(rows)).length).toBe(4)
  })
  it('wraps a single-object form into a one-element array', () => {
    const one = parseCimRows(JSON.stringify(rows[0]))
    expect(one).toHaveLength(1)
    expect(one[0].ProcessId).toBe(200)
  })
  it('returns [] on malformed JSON and drops rows without numeric ids', () => {
    expect(parseCimRows('not json')).toEqual([])
    expect(parseCimRows(JSON.stringify([{ Name: 'x' }]))).toEqual([])
  })
})

describe('parseCimDate', () => {
  it('reads the /Date(ms)/ form', () => { expect(parseCimDate('/Date(1718000000000)/')).toBe(1718000000000) })
  it('reads an ISO string', () => { expect(parseCimDate('2026-06-14T00:00:00.000Z')).toBe(Date.parse('2026-06-14T00:00:00.000Z')) })
  it('returns 0 for null/garbage', () => { expect(parseCimDate(null)).toBe(0); expect(parseCimDate('nope')).toBe(0) })
})

describe('cleanName', () => {
  it('strips a trailing .exe case-insensitively', () => {
    expect(cleanName('node.exe')).toBe('node')
    expect(cleanName('PING.EXE')).toBe('PING')
    expect(cleanName('bash')).toBe('bash')
  })
})

describe('descendantsOf', () => {
  it('returns the subtree DFS pre-order with depth, excluding the shell and unrelated procs', () => {
    const out = descendantsOf(parseCimRows(JSON.stringify(rows)), 100)
    expect(out.map(n => [n.pid, n.depth])).toEqual([[200, 0], [300, 1], [250, 0]])
    expect(out.find(n => n.pid === 999)).toBeUndefined()
    expect(out[0]).toMatchObject({ name: 'node', command: 'node app.js' })
  })
  it('returns [] when the shell pid has no children', () => {
    expect(descendantsOf(parseCimRows(JSON.stringify(rows)), 100000)).toEqual([])
  })
})

describe('pickForeground', () => {
  it('follows the most-recently-created child to the deepest leaf', () => {
    // 100 -> children {200@1000, 250@2000}; newest=250(git, leaf). So foreground = git.
    const fg = pickForeground(parseCimRows(JSON.stringify(rows)), 100)
    expect(fg?.ProcessId).toBe(250)
  })
  it('descends a chain to its leaf', () => {
    const chain = [
      { ProcessId: 2, ParentProcessId: 1, Name: 'a.exe', CommandLine: null, CreationDate: '/Date(1)/' },
      { ProcessId: 3, ParentProcessId: 2, Name: 'b.exe', CommandLine: null, CreationDate: '/Date(2)/' }
    ]
    expect(pickForeground(parseCimRows(JSON.stringify(chain)), 1)?.ProcessId).toBe(3)
  })
  it('returns null when the shell has no children', () => {
    expect(pickForeground(parseCimRows(JSON.stringify(rows)), 100000)).toBeNull()
  })
})

describe('buildProcInfo', () => {
  it('combines the foreground name and the descendant tree', () => {
    const info = buildProcInfo(parseCimRows(JSON.stringify(rows)), 100)
    expect(info.foreground).toBe('git')
    expect(info.tree.map(n => n.pid)).toEqual([200, 300, 250])
  })
  it('yields an empty foreground + tree when nothing runs under the shell', () => {
    expect(buildProcInfo(parseCimRows(JSON.stringify(rows)), 100000)).toEqual({ foreground: '', tree: [] })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- proc-tree`
Expected: FAIL — `Cannot find module '../../src/main/proc/proc-tree'`.

- [ ] **Step 4: Create `src/main/proc/proc-tree.ts`**

```ts
import type { ProcInfo, ProcNode } from '@shared/types'

export interface CimRow {
  ProcessId: number
  ParentProcessId: number
  Name: string
  CommandLine: string | null
  CreationDate: string | null
}

/** Parse `ConvertTo-Json` output. PowerShell emits a single result as one object, many as an array. */
export function parseCimRows(json: string): CimRow[] {
  let data: unknown
  try { data = JSON.parse(json) } catch { return [] }
  const arr: unknown[] = Array.isArray(data) ? data : data ? [data] : []
  const rows: CimRow[] = []
  for (const r of arr) {
    const o = r as Record<string, unknown>
    const pid = Number(o?.ProcessId)
    const ppid = Number(o?.ParentProcessId)
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue
    rows.push({
      ProcessId: pid,
      ParentProcessId: ppid,
      Name: typeof o.Name === 'string' ? o.Name : '',
      CommandLine: typeof o.CommandLine === 'string' ? o.CommandLine : null,
      CreationDate: typeof o.CreationDate === 'string' ? o.CreationDate : null
    })
  }
  return rows
}

/** Accept both the WMI `/Date(ms)/` form and an ISO string; 0 when unknown. */
export function parseCimDate(s: string | null): number {
  if (!s) return 0
  const m = /\/Date\((\d+)\)\//.exec(s)
  if (m) return Number(m[1])
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

export function cleanName(name: string): string {
  return name.replace(/\.exe$/i, '')
}

function childrenMap(rows: CimRow[]): Map<number, CimRow[]> {
  const byParent = new Map<number, CimRow[]>()
  for (const r of rows) {
    const list = byParent.get(r.ParentProcessId) ?? []
    list.push(r)
    byParent.set(r.ParentProcessId, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => parseCimDate(a.CreationDate) - parseCimDate(b.CreationDate))
  }
  return byParent
}

function toNode(r: CimRow, depth: number): ProcNode {
  const command = r.CommandLine && r.CommandLine.trim() ? r.CommandLine.trim() : cleanName(r.Name)
  return { pid: r.ProcessId, ppid: r.ParentProcessId, name: cleanName(r.Name), command, depth }
}

/** Flatten the subtree under `shellPid` (excluding the shell) DFS pre-order, with depth. */
export function descendantsOf(rows: CimRow[], shellPid: number): ProcNode[] {
  const byParent = childrenMap(rows)
  const out: ProcNode[] = []
  const seen = new Set<number>([shellPid])
  const walk = (pid: number, depth: number): void => {
    for (const c of byParent.get(pid) ?? []) {
      if (seen.has(c.ProcessId)) continue
      seen.add(c.ProcessId)
      out.push(toNode(c, depth))
      walk(c.ProcessId, depth + 1)
    }
  }
  walk(shellPid, 0)
  return out
}

/** Follow the most-recently-created child from the shell to the deepest leaf. */
export function pickForeground(rows: CimRow[], shellPid: number): CimRow | null {
  const byParent = childrenMap(rows)
  let parent = shellPid
  let chosen: CimRow | null = null
  const guard = new Set<number>([shellPid])
  for (;;) {
    const children = byParent.get(parent) ?? []
    if (children.length === 0) break
    const best = children[children.length - 1] // childrenMap sorts ascending by CreationDate
    if (guard.has(best.ProcessId)) break
    guard.add(best.ProcessId)
    chosen = best
    parent = best.ProcessId
  }
  return chosen
}

export function buildProcInfo(rows: CimRow[], shellPid: number): ProcInfo {
  const fg = pickForeground(rows, shellPid)
  return { foreground: fg ? cleanName(fg.Name) : '', tree: descendantsOf(rows, shellPid) }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- proc-tree`
Expected: PASS (all groups green).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/proc/proc-tree.ts tests/main/proc-tree.test.ts
git commit -m "feat(procs): pure process-tree core (parse, descendants, foreground)"
```

---

## Task 2: Types/IPC channel + CIM query

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Create: `src/main/proc/cim-query.ts`

- [ ] **Step 1: Add the channel + API method to `src/shared/ipc-contract.ts`**

Add `ProcInfo` to the type import on line 1 (append it to the existing `from './types'` list):

```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore, ProcInfo } from './types'
```

Add a channel to the `CH` object (after `homeDir: 'app:homeDir'` — add a comma after it):

```ts
  homeDir: 'app:homeDir',
  ptyProcs: 'pty:procs'   // main -> renderer event
} as const
```

Add the method to the `TermhallaApi` interface (after `onPtyCwd(...)`):

```ts
  onPtyProcs(cb: (id: string, info: ProcInfo | null) => void): () => void
```

- [ ] **Step 2: Expose it in `src/preload/index.ts`**

Add to the `api` object (after the `onPtyCwd` block):

```ts
  onPtyProcs: (cb) => {
    const h = (_e: unknown, id: string, info: import('@shared/types').ProcInfo | null) => cb(id, info)
    ipcRenderer.on(CH.ptyProcs, h as never)
    return () => ipcRenderer.removeListener(CH.ptyProcs, h as never)
  },
```

- [ ] **Step 3: Create `src/main/proc/cim-query.ts`**

```ts
import { execFile } from 'node:child_process'
import { parseCimRows, type CimRow } from './proc-tree'

const PS_CMD =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress'

/** One Windows process-table snapshot. Resolves to [] on any failure/timeout (never rejects). */
export function queryProcesses(timeoutMs = 2000): Promise<CimRow[]> {
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_CMD],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? [] : parseCimRows(stdout))
    )
  })
}
```

- [ ] **Step 4: Build to typecheck the contract/preload/query wiring**

Run: `npm run build`
Expected: SUCCESS — no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/proc/cim-query.ts
git commit -m "feat(procs): pty:procs IPC channel + CIM process query"
```

---

## Task 3: ProcessTracker + PtyManager pid + main wiring

**Files:**
- Create: `src/main/proc/process-tracker.ts`
- Test: `tests/main/process-tracker.test.ts`
- Modify: `src/main/pty/pty-manager.ts`
- Modify: `src/main/ipc/register.ts`

- [ ] **Step 1: Write the failing test `tests/main/process-tracker.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { ProcessTracker } from '../../src/main/proc/process-tracker'
import type { CimRow } from '../../src/main/proc/proc-tree'

// shell pid 100 -> child 200 (node)
const rows: CimRow[] = [
  { ProcessId: 200, ParentProcessId: 100, Name: 'node.exe', CommandLine: 'node app.js', CreationDate: '/Date(1)/' }
]
const pidOf = () => 100
const runQuery = () => Promise.resolve(rows)

describe('ProcessTracker.pollOnce', () => {
  it('emits ProcInfo for a busy session', async () => {
    const emit = vi.fn()
    const t = new ProcessTracker(pidOf, emit, runQuery)
    t.register('a'); t.setBusy('a', true)
    emit.mockClear()                 // ignore the register/setBusy housekeeping emits
    await t.pollOnce()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('a', expect.objectContaining({ foreground: 'node' }))
    t.dispose()
  })

  it('does not query when nothing is busy', async () => {
    const q = vi.fn(runQuery)
    const t = new ProcessTracker(pidOf, vi.fn(), q)
    t.register('a')                  // registered but idle
    await t.pollOnce()
    expect(q).not.toHaveBeenCalled()
    t.dispose()
  })

  it('dedups repeated identical snapshots', async () => {
    const emit = vi.fn()
    const t = new ProcessTracker(pidOf, emit, runQuery)
    t.register('a'); t.setBusy('a', true); emit.mockClear()
    await t.pollOnce()
    await t.pollOnce()
    expect(emit).toHaveBeenCalledTimes(1)
    t.dispose()
  })

  it('emits a single null (cleared) when a session goes idle', async () => {
    const emit = vi.fn()
    const t = new ProcessTracker(pidOf, emit, runQuery)
    t.register('a'); t.setBusy('a', true); await t.pollOnce(); emit.mockClear()
    t.setBusy('a', false)
    t.setBusy('a', false)            // second call must not re-emit
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('a', null)
    t.dispose()
  })

  it('clears a busy session whose pid has vanished', async () => {
    const emit = vi.fn()
    const t = new ProcessTracker(() => undefined, emit, runQuery)
    t.register('a'); t.setBusy('a', true); emit.mockClear()
    await t.pollOnce()
    expect(emit).toHaveBeenCalledWith('a', null)
    t.dispose()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- process-tracker`
Expected: FAIL — `Cannot find module '../../src/main/proc/process-tracker'`.

- [ ] **Step 3: Create `src/main/proc/process-tracker.ts`**

```ts
import type { ProcInfo } from '@shared/types'
import { buildProcInfo, type CimRow } from './proc-tree'
import { queryProcesses } from './cim-query'

type RunQuery = () => Promise<CimRow[]>

const CLEARED = '∅' // sentinel signature meaning "emitted null"

/** Polls the OS process table (only while a session is busy) and emits each busy
 *  terminal's foreground/tree. Idle sessions get a single null (chip falls back to shell name). */
export class ProcessTracker {
  private sessions = new Map<string, { busy: boolean }>()
  private lastSig = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private querying = false

  constructor(
    private readonly pidOf: (id: string) => number | undefined,
    private readonly onProcs: (id: string, info: ProcInfo | null) => void,
    private readonly runQuery: RunQuery = queryProcesses,
    private readonly intervalMs = 1000
  ) {}

  register(id: string): void {
    this.sessions.set(id, { busy: false })
    this.ensureTimer()
  }

  unregister(id: string): void {
    if (this.sessions.delete(id)) {
      this.lastSig.delete(id)
      this.onProcs(id, null)
    }
    if (this.sessions.size === 0) this.stopTimer()
  }

  setBusy(id: string, busy: boolean): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.busy = busy
    if (!busy) this.clear(id) // back to shell-name fallback immediately
  }

  /** One query+emit cycle. No-op when nothing is busy or a query is already in flight. */
  async pollOnce(): Promise<void> {
    if (this.querying) return
    const busyIds = [...this.sessions.entries()].filter(([, s]) => s.busy).map(([id]) => id)
    if (busyIds.length === 0) return
    this.querying = true
    let rows: CimRow[]
    try { rows = await this.runQuery() } finally { this.querying = false }
    for (const id of busyIds) {
      if (!this.sessions.get(id)?.busy) continue // may have gone idle during the await
      const pid = this.pidOf(id)
      if (pid === undefined) { this.clear(id); continue }
      const info = buildProcInfo(rows, pid)
      const sig = info.foreground + '|' + info.tree.map(n => n.pid).join(',')
      if (this.lastSig.get(id) !== sig) {
        this.lastSig.set(id, sig)
        this.onProcs(id, info)
      }
    }
  }

  dispose(): void {
    this.sessions.clear()
    this.lastSig.clear()
    this.stopTimer()
  }

  private clear(id: string): void {
    if (!this.sessions.has(id)) return
    if (this.lastSig.get(id) !== CLEARED) {
      this.lastSig.set(id, CLEARED)
      this.onProcs(id, null)
    }
  }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.pollOnce() }, this.intervalMs)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- process-tracker`
Expected: PASS (5 cases green).

- [ ] **Step 5: Add a public `pidOf` to `src/main/pty/pty-manager.ts`**

Add this method to the `PtyManager` class (next to `write`/`resize`):

```ts
  pidOf(id: string): number | undefined { return this.sessions.get(id)?.proc.pid }
```

- [ ] **Step 6: Wire the tracker in `src/main/ipc/register.ts`**

Add the import near the other main imports:

```ts
import { ProcessTracker } from '../proc/process-tracker'
```

Replace the existing engine + pty construction block (the `const engine = new StatusEngine(...)` and `const pty = new PtyManager(...)` lines) with this — it forward-declares `tracker`, feeds busy state from the status callback, and unregisters on exit:

```ts
  let tracker: ProcessTracker | undefined
  const engine = new StatusEngine(
    (id, status) => { safeSend(CH.ptyStatus, id, status); tracker?.setBusy(id, status.state === 'busy') },
    (id, cwd) => safeSend(CH.ptyCwd, id, cwd)
  )
  const pty = new PtyManager(
    (id, data) => safeSend(CH.ptyData, id, data),
    (id, code) => { safeSend(CH.ptyExit, id, code); tracker?.unregister(id) },
    engine, scriptDir
  )
  tracker = new ProcessTracker(
    (id) => pty.pidOf(id),
    (id, info) => safeSend(CH.ptyProcs, id, info)
  )
```

Then register the session with the tracker in the `ptySpawn` handler (after the existing `pty.spawn(...)` call):

```ts
  ipcMain.handle(CH.ptySpawn, (_e, a: PtySpawnArgs) => {
    const shell = shells.find(s => s.id === a.shellId) ?? shells[0]
    pty.spawn(a.id, shell, a.cwd, a.cols, a.rows, a.launch)
    tracker.register(a.id)
  })
```

And unregister in the `ptyKill` handler:

```ts
  ipcMain.on(CH.ptyKill, (_e, id: string) => { pty.kill(id); tracker.unregister(id) })
```

- [ ] **Step 7: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — bundles typecheck; new `proc-tree` + `process-tracker` suites green; no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/main/proc/process-tracker.ts tests/main/process-tracker.test.ts src/main/pty/pty-manager.ts src/main/ipc/register.ts
git commit -m "feat(procs): ProcessTracker, pty pid accessor, main wiring"
```

---

## Task 4: Renderer store + App subscription

**Files:**
- Modify: `src/renderer/store.ts`
- Modify: `src/renderer/App.tsx`

This task has no unit test (store/App depend on the Electron `api`); verified by build + the Task 6 e2e.

- [ ] **Step 1: Add `procs` state + `setProcs` to `src/renderer/store.ts`**

Add `ProcInfo` to the `@shared/types` type import. In the `State` interface, after the `cwds` / `setCwd` members add:

```ts
  procs: Record<string, ProcInfo>
  setProcs: (id: string, info: ProcInfo | null) => void
```

Add the initial value next to `cwds: {}`:

```ts
    procs: {},
```

Add the action (near `setCwd`):

```ts
    setProcs: (id, info) => set(s => {
      const procs = { ...s.procs }
      if (info) procs[id] = info
      else delete procs[id]
      return { procs }
    }),
```

- [ ] **Step 2: Clean up the runtime maps in `closePane`**

Replace the existing `closePane` action with one that also drops the per-pane `statuses`, `cwds`, and `procs` entries (closing the long-standing cleanup-parity follow-up):

```ts
    closePane: (wsId, paneId) => {
      const ws = removePane(get().workspaces[wsId], paneId)
      set(s => {
        const statuses = { ...s.statuses }; delete statuses[paneId]
        const cwds = { ...s.cwds }; delete cwds[paneId]
        const procs = { ...s.procs }; delete procs[paneId]
        return { workspaces: { ...s.workspaces, [wsId]: ws }, statuses, cwds, procs }
      })
      api.ptyKill(paneId)
      scheduleAutosave()
    },
```

- [ ] **Step 3: Subscribe to `pty:procs` in `src/renderer/App.tsx`**

Add an effect next to the existing `onPtyCwd` effect:

```tsx
  useEffect(() => {
    const off = api.onPtyProcs((id, info) => useStore.getState().setProcs(id, info))
    return off
  }, [])
```

- [ ] **Step 4: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — no TypeScript errors; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store.ts src/renderer/App.tsx
git commit -m "feat(procs): renderer procs state, subscription, closePane cleanup"
```

---

## Task 5: Toolbar chip + tree popover

**Files:**
- Modify: `src/renderer/components/WorkspaceView.tsx`

Verified by build + the Task 6 e2e. Keep the `data-testid`s exactly (the e2e depends on them).

- [ ] **Step 1: Read the chip data in `WorkspaceView`**

In `WorkspaceView`, alongside the existing selectors (`statuses`, `cwds`, …), add:

```tsx
  const procs = useStore(s => s.procs)
  const shells = useStore(s => s.shells)
```

And add a popover-open state next to `cwdMenuFor`:

```tsx
  const [procsMenuFor, setProcsMenuFor] = useState<string | null>(null)
```

- [ ] **Step 2: Compute the chip label inside `renderTile`**

Inside the `renderTile` callback, after `const termCfg = …`, add:

```tsx
        const procInfo = procs[paneId]
        const shellLabel = termCfg ? (shells.find(sh => sh.id === termCfg.shellId)?.label ?? termCfg.shellId) : ''
        const chipText = procInfo && procInfo.foreground ? `▶ ${procInfo.foreground}` : shellLabel
```

- [ ] **Step 3: Add the chip as the first toolbar control (terminal panes only)**

In the `toolbarControls={[ … ]}` array, prepend a chip button that is included only for terminal panes. Change the array to spread a conditional chip first:

```tsx
            toolbarControls={[
              ...(termCfg ? [
                <button key="proc" data-testid={`proc-chip-${paneId}`} title="Running process"
                  style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => setProcsMenuFor(procsMenuFor === paneId ? null : paneId)}>{chipText}</button>
              ] : []),
              <button key="cwd" data-testid={`cwd-${paneId}`} title="Folder actions"
                onClick={() => setCwdMenuFor(cwdMenuFor === paneId ? null : paneId)}>📁</button>,
              <button key="gear" data-testid={`gear-${paneId}`} title="Terminal settings"
                onClick={() => setSettingsFor(settingsFor === paneId ? null : paneId)}>⚙</button>,
              <button key="split-row" data-testid={`split-${paneId}`} title="Split right"
                onClick={() => addTerminal(ws.id, paneId, 'row')}>⬌</button>,
              <button key="split-col" data-testid={`split-col-${paneId}`} title="Split down"
                onClick={() => addTerminal(ws.id, paneId, 'column')}>⬍</button>,
              <button key="close" data-testid={`close-${paneId}`}
                onClick={() => closePane(ws.id, paneId)}>✕</button>
            ]}
```

- [ ] **Step 4: Render the tree popover in the tile body**

Inside the tile `div` (next to the existing `cwdMenuFor === paneId` popover), add:

```tsx
              {procsMenuFor === paneId && (
                <div data-testid="proc-menu" onClick={e => e.stopPropagation()}
                  style={{ position: 'absolute', left: 4, top: 28, zIndex: 10, background: '#252526',
                    color: '#eee', border: '1px solid #444', borderRadius: 4, padding: 6, maxWidth: 460,
                    maxHeight: 240, overflow: 'auto', fontSize: 12, fontFamily: 'Consolas, monospace' }}>
                  {(!procInfo || procInfo.tree.length === 0) && <div style={{ opacity: 0.6 }}>No child processes.</div>}
                  {procInfo && procInfo.tree.map(n => (
                    <div key={n.pid} data-testid={`proc-row-${n.pid}`}
                      style={{ paddingLeft: n.depth * 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ opacity: 0.7 }}>{n.name}</span>
                      <span style={{ opacity: 0.45 }}>  {n.command}</span>
                    </div>
                  ))}
                </div>
              )}
```

- [ ] **Step 5: Build to typecheck**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/WorkspaceView.tsx
git commit -m "feat(procs): toolbar process chip + descendant-tree popover"
```

---

## Task 6: End-to-end test + full verification

**Files:**
- Create: `tests/e2e/procs.spec.ts`

Hermetic, mirrors `tests/e2e/cwd.spec.ts` (launch flags, `killTree` teardown). Runs a real long-running foreground command and asserts the chip + popover reflect it. READ `tests/e2e/cwd.spec.ts` first.

- [ ] **Step 1: Write `tests/e2e/procs.spec.ts`**

```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('shows the foreground process on the chip and in the tree popover', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-procs-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // The chip exists (idle: shows the shell name).
  await expect(win.locator('[data-testid^="proc-chip-"]')).toBeVisible({ timeout: 15_000 })

  // Run a long foreground command -> the chip picks up "ping" (busy-gated CIM poll ~1s).
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('ping -n 15 127.0.0.1')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="proc-chip-"]')).toContainText('ping', { timeout: 20_000 })

  // The tree popover lists a ping row.
  await win.locator('[data-testid^="proc-chip-"]').click()
  await expect(win.getByTestId('proc-menu')).toBeVisible()
  await expect(win.getByTestId('proc-menu')).toContainText('ping')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 2: Build so e2e runs against fresh `out/`**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 3: Run the new e2e**

Run: `npm run e2e -- procs`
Expected: PASS — chip is visible idle, shows `ping` while the command runs, and the popover lists a `ping` row.

If `ping` resolves too fast to stay busy (localhost replies are immediate; `-n 15` paces ~1s apart so it runs ~14s — ample), increase the count; do NOT weaken the chip/popover assertions. If the chip text assertion is flaky due to CIM-poll timing, raise the timeout (the poll is ~1s + the busy-detection lag), but keep asserting `ping`.

- [ ] **Step 4: Full regression gate**

Run: `npm test && npm run e2e`
Expected: PASS — all vitest suites and all Playwright specs (smoke, persistence, editor, explorer, status, cwd, ssh-quick, procs) green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/procs.spec.ts
git commit -m "test(procs): e2e for foreground chip + tree popover"
```

---

## Self-Review

**1. Spec coverage:**
- §3 architecture (ProcessTracker, `{paneId→shellPid}`, busy-gated poll, `pty:procs`, cleared-on-idle) → Task 3 (`ProcessTracker`, register/setBusy/unregister, `pidOf`, wiring) + Task 2 (channel). ✓
- §4 CIM parse (single-object + array), `descendantsOf`, foreground heuristic (most-recent child), naming (chip = image name, popover = command line) → Task 1 (`parseCimRows`, `descendantsOf`, `pickForeground`, `cleanName`, `buildProcInfo`) + Task 2 (`cim-query` PS command) + Task 5 (chip shows `foreground` name; popover shows `command`). ✓
- §5 types `ProcNode`/`ProcInfo`, channel, runtime-only → Task 1 (types) + Task 2 (channel/preload) + Task 4 (store map, not persisted). ✓
- §6 chip (`▶ <fg>` busy / shell name idle, left of 📁) + popover (indented tree, "No child processes.") → Task 5. ✓
- §7 busy-gated, single spawn, ~2s timeout, no overlap, failure→empty, map cleanup → Task 2 (`queryProcesses` timeout/`[]`-on-error), Task 3 (`querying` guard, busy gate, vanished-pid clear), Task 4 (closePane cleanup). ✓
- §8 unit (parse/descendants/foreground) + e2e (`ping`) → Task 1 + Task 3 tests + Task 6 e2e. ✓
- §9 non-goals respected (no stats/kill/remote/sub-second; Windows-only). ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. The Task 6 Step 3 contingency is an explicit bounded fallback (raise timeout / increase count), not a placeholder.

**3. Type consistency:** `ProcNode {pid,ppid,name,command,depth}` and `ProcInfo {foreground,tree}` are defined once (Task 1) and consumed identically in `buildProcInfo`/`descendantsOf` (Task 1), the channel/preload (`ProcInfo | null`, Task 2), `ProcessTracker.onProcs` (Task 3), the store `procs`/`setProcs` (Task 4), and the chip/popover (`procInfo.foreground`, `procInfo.tree`, `n.depth`, `n.name`, `n.command`, Task 5). `CimRow` is shared between `proc-tree.ts`, `cim-query.ts`, and the tracker test. `pidOf`/`register`/`unregister`/`setBusy`/`pollOnce` names match between `ProcessTracker` (Task 3), its test (Task 3), and the wiring (Task 3). Channel `ptyProcs: 'pty:procs'` and `onPtyProcs` align across contract/preload/App.
