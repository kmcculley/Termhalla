# Git Status on Pane Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact git indicator (branch + dirty dot) on each terminal pane's toolbar for panes sitting in a git working tree, with full detail in a popover.

**Architecture:** A main-process `GitStatusService` (mirroring `CloudStatusService`: abortable, `unref()`'d `execFile` children, signature-based dedup) is fed the existing per-pane cwd signal and the status-engine's command-done signal. It resolves each pane's repo root, ref-counts one targeted `.git` chokidar watch per root, runs `git status --porcelain=v2 --branch`, and pushes a `GitStatus` (or `null`) over a new pane-scoped `git:status` IPC channel into a per-pane renderer map rendered by `PaneToolbar`/`GitPopover`.

**Tech Stack:** Electron, TypeScript, React, zustand, chokidar v4, vitest, Playwright-for-Electron.

## Global Constraints

- **Path alias:** import shared code as `@shared/...`.
- **IPC naming:** `domain:verb` → the new channel is `git:status` (main→renderer push).
- **TDD:** failing test first for all pure logic (`parse-status`, `git-status-service`, `clearPaneRuntime`); plumbing tasks verified by `npm run typecheck` (+ `npm run build` where noted); the e2e lands last.
- **`noUnusedLocals` / `noUnusedParameters` are `true`** (tsconfig.json) — every declared param/local must be used. `GitPopover` therefore takes only the props it renders.
- **No secrets persisted; runtime-only.** `GitStatus` is NOT persisted and does NOT bump `SCHEMA_VERSION`.
- **`execFile` children must be abortable + `.unref()`'d** (the load-bearing shutdown rule).
- **chokidar v4** (no glob support): watch literal paths/dirs; `ignored` takes a function/regex. Mirror `src/main/fs/watch-manager.ts`.
- **e2e is `workers: 1`; `npm run build` before `npm run e2e`.**
- **Degrade silently:** any git error, non-repo, or remote/SSH cwd → push `null`, no chip. Never surface a git error to the user.

---

## Task 1: `GitStatus` type + `parseStatus` (pure, unit-tested)

**Files:**
- Modify: `src/shared/types.ts` (add `GitStatus` interface near `ProcInfo` at line ~179)
- Create: `src/main/git/parse-status.ts`
- Test: `tests/main/parse-status.test.ts`

**Interfaces:**
- Produces: `GitStatus` interface (shared); `parseStatus(stdout: string): Omit<GitStatus, 'root'>`.

- [ ] **Step 1: Add the `GitStatus` type**

In `src/shared/types.ts`, add (place it just after the `ProcInfo` interface):

```ts
/** Live git status for a pane's repo root. Runtime-only (not persisted). `branch` holds the
 *  short commit sha when `detached` is true. `dirty` = staged + unstaged + untracked > 0. */
export interface GitStatus {
  root: string
  branch: string
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  dirty: boolean
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/parse-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseStatus } from '../../src/main/git/parse-status'

const CLEAN = [
  '# branch.oid 1111111111111111111111111111111111111111',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
  ''
].join('\n')

const DIRTY = [
  '# branch.oid 2222222222222222222222222222222222222222',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 aaa bbb staged.txt',
  '1 .M N... 100644 100644 100644 ccc ddd unstaged.txt',
  '1 MM N... 100644 100644 100644 eee fff both.txt',
  '? untracked.txt',
  ''
].join('\n')

const DETACHED = [
  '# branch.oid deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  '# branch.head (detached)',
  ''
].join('\n')

const NO_UPSTREAM = [
  '# branch.oid 3333333333333333333333333333333333333333',
  '# branch.head feature',
  ''
].join('\n')

const UNTRACKED_ONLY = [
  '# branch.oid 4444444444444444444444444444444444444444',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
  '? new.txt',
  ''
].join('\n')

describe('parseStatus', () => {
  it('parses a clean repo with an upstream', () => {
    const s = parseStatus(CLEAN)
    expect(s).toMatchObject({ branch: 'main', detached: false, upstream: 'origin/main',
      ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: false })
  })

  it('counts staged/unstaged/untracked and ahead/behind', () => {
    const s = parseStatus(DIRTY)
    // M.→staged, .M→unstaged, MM→both
    expect(s.staged).toBe(2)
    expect(s.unstaged).toBe(2)
    expect(s.untracked).toBe(1)
    expect(s.dirty).toBe(true)
    expect(s.ahead).toBe(2)
    expect(s.behind).toBe(1)
  })

  it('reports detached HEAD with a short sha', () => {
    const s = parseStatus(DETACHED)
    expect(s.detached).toBe(true)
    expect(s.branch).toBe('deadbee')
    expect(s.upstream).toBeNull()
    expect(s.dirty).toBe(false)
  })

  it('handles a branch with no upstream', () => {
    const s = parseStatus(NO_UPSTREAM)
    expect(s.branch).toBe('feature')
    expect(s.upstream).toBeNull()
    expect(s.ahead).toBe(0)
    expect(s.behind).toBe(0)
  })

  it('treats untracked-only as dirty', () => {
    const s = parseStatus(UNTRACKED_ONLY)
    expect(s.dirty).toBe(true)
    expect(s.untracked).toBe(1)
    expect(s.staged).toBe(0)
    expect(s.unstaged).toBe(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/main/parse-status.test.ts`
Expected: FAIL — cannot find module `parse-status` / `parseStatus is not a function`.

- [ ] **Step 4: Write the implementation**

Create `src/main/git/parse-status.ts`:

```ts
import type { GitStatus } from '@shared/types'

/** Parse `git status --porcelain=v2 --branch` output. Pure: the caller attaches `root`.
 *  Porcelain v2 header lines start with `# branch.*`; entry lines start with `1`/`2`
 *  (changed/renamed, with a two-char XY index/worktree field), `u` (unmerged), `?` (untracked). */
export function parseStatus(stdout: string): Omit<GitStatus, 'root'> {
  let head = ''
  let oid = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0

  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length).trim()
    else if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice('# branch.upstream '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) { ahead = Number(m[1]); behind = Number(m[2]) }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.split(' ')[1] ?? '..'
      if (xy[0] !== '.') staged++
      if (xy[1] !== '.') unstaged++
    } else if (line.startsWith('u ')) {
      unstaged++
    } else if (line.startsWith('? ')) {
      untracked++
    }
  }

  const detached = head === '(detached)'
  const branch = detached ? (oid ? oid.slice(0, 7) : '(detached)') : head
  const dirty = staged + unstaged + untracked > 0
  return { branch, detached, upstream, ahead, behind, staged, unstaged, untracked, dirty }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/main/parse-status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/git/parse-status.ts tests/main/parse-status.test.ts
git commit -m "feat(git): GitStatus type + porcelain-v2 parser"
```

---

## Task 2: git probe module (`git/probe.ts`)

**Files:**
- Create: `src/main/git/probe.ts`
- Test: `tests/main/git-probe.test.ts`

**Interfaces:**
- Consumes: `parseStatus` (Task 1) — only in the test.
- Produces:
  - `resolveGitRoot(cwd: string, signal?: AbortSignal): Promise<string | null>`
  - `runGitStatus(root: string, signal?: AbortSignal): Promise<string | null>`

- [ ] **Step 1: Write the failing test (real git against a temp repo — deterministic)**

Create `tests/main/git-probe.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveGitRoot, runGitStatus } from '../../src/main/git/probe'
import { parseStatus } from '../../src/main/git/parse-status'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitprobe-'))
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 't@example.com'])
  git(['config', 'user.name', 'T'])
  writeFileSync(join(dir, 'a.txt'), 'hi')
  git(['add', '.'])
  git(['commit', '-m', 'init'])
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('git probe', () => {
  it('resolves the root and parses a clean repo', async () => {
    const root = await resolveGitRoot(dir)
    expect(root).toBeTruthy()
    const out = await runGitStatus(root!)
    expect(out).not.toBeNull()
    const st = parseStatus(out!)
    expect(st.branch).toBe('main')
    expect(st.dirty).toBe(false)
  })

  it('returns null for a non-repo directory', async () => {
    const non = mkdtempSync(join(tmpdir(), 'nonrepo-'))
    expect(await resolveGitRoot(non)).toBeNull()
    rmSync(non, { recursive: true, force: true })
  })

  it('detects a dirty working tree', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed')
    const root = await resolveGitRoot(dir)
    const st = parseStatus((await runGitStatus(root!))!)
    expect(st.dirty).toBe(true)
    expect(st.unstaged).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/git-probe.test.ts`
Expected: FAIL — cannot find module `probe`.

- [ ] **Step 3: Write the implementation**

Create `src/main/git/probe.ts`:

```ts
import { execFile } from 'node:child_process'

const GIT_TIMEOUT_MS = 8000
const MAX_BUFFER = 4 * 1024 * 1024

/** Run a git subcommand. Resolves to stdout, or null on ANY failure (not installed, not a repo,
 *  timeout, abort, signal). Never rejects. The child is unref'd so a slow git can't keep the main
 *  process alive and stall app shutdown; `signal` aborts an in-flight call on stop(). */
function runGit(args: string[], signal?: AbortSignal): Promise<string | null> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(null); return }
    const child = execFile(
      'git', args,
      { timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_BUFFER, killSignal: 'SIGKILL', signal },
      (err, stdout) => resolve(err ? null : (stdout ?? ''))
    )
    child.unref()
  })
}

/** Repo root for a cwd (git normalizes to forward slashes), or null if cwd is not in a repo. */
export function resolveGitRoot(cwd: string, signal?: AbortSignal): Promise<string | null> {
  return runGit(['-C', cwd, 'rev-parse', '--show-toplevel'], signal)
    .then(out => { const t = out?.trim(); return t ? t : null })
}

/** Raw `git status --porcelain=v2 --branch` stdout for a root, or null on error. */
export function runGitStatus(root: string, signal?: AbortSignal): Promise<string | null> {
  return runGit(['-C', root, 'status', '--porcelain=v2', '--branch'], signal)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/git-probe.test.ts`
Expected: PASS (3 tests). (Requires `git` on PATH — present on dev + CI Windows runners.)

- [ ] **Step 5: Commit**

```bash
git add src/main/git/probe.ts tests/main/git-probe.test.ts
git commit -m "feat(git): abortable, unref'd git root + status probe"
```

---

## Task 3: `GitStatusService` (orchestration, unit-tested with fakes)

**Files:**
- Create: `src/main/git/git-status-service.ts`
- Test: `tests/main/git-status-service.test.ts`

**Interfaces:**
- Consumes: `resolveGitRoot`, `runGitStatus` (Task 2); `parseStatus` (Task 1); `GitStatus` (Task 1).
- Produces: class `GitStatusService` with:
  - `constructor(onStatus: (paneId: string, status: GitStatus | null) => void, resolveRoot?, runStatus?, makeWatcher?, debounceMs = 150)`
  - `setCwd(paneId: string, cwd: string): Promise<void>`
  - `onCommandDone(paneId: string): void`
  - `removePane(paneId: string): void`
  - `stop(): void`
  - exported type `Watcher = { close(): void | Promise<void> }`
  - exported type `WatchFactory = (root: string, onChange: () => void) => Watcher`

- [ ] **Step 1: Write the failing test**

Create `tests/main/git-status-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { GitStatusService } from '../../src/main/git/git-status-service'

const CLEAN = [
  '# branch.oid abc',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
  ''
].join('\n')

const DIRTY = CLEAN + '? new.txt\n'

function makeService(roots: Record<string, string | null>, statusByRoot: Record<string, string>) {
  const pushed: Array<[string, unknown]> = []
  const watchers: Array<{ root: string; trigger: () => void; closed: boolean; close: () => void }> = []
  const resolveRoot = vi.fn(async (cwd: string) => (cwd in roots ? roots[cwd] : null))
  const runStatus = vi.fn(async (root: string) => statusByRoot[root] ?? null)
  const makeWatcher = (root: string, onChange: () => void) => {
    const w = { root, trigger: onChange, closed: false, close() { this.closed = true } }
    watchers.push(w)
    return w
  }
  const svc = new GitStatusService(
    (id, st) => pushed.push([id, st]),
    resolveRoot, runStatus, makeWatcher, 0
  )
  return { svc, pushed, watchers, resolveRoot, runStatus }
}

/** Let queued microtasks + a 0ms debounce timer flush. */
const flush = () => new Promise(r => setTimeout(r, 5))

describe('GitStatusService', () => {
  it('pushes git status for a repo cwd', async () => {
    const { svc, pushed } = makeService({ '/r': '/r' }, { '/r': CLEAN })
    await svc.setCwd('p1', '/r')
    expect(pushed).toContainEqual(['p1', expect.objectContaining({ branch: 'main', root: '/r', dirty: false })])
  })

  it('pushes null for a non-repo cwd', async () => {
    const { svc, pushed } = makeService({}, {})
    await svc.setCwd('p1', '/x')
    expect(pushed).toContainEqual(['p1', null])
  })

  it('dedups an identical status on watch re-trigger', async () => {
    const { svc, pushed, watchers } = makeService({ '/r': '/r' }, { '/r': CLEAN })
    await svc.setCwd('p1', '/r')
    const before = pushed.length
    watchers[0].trigger()
    await flush()
    expect(pushed.length).toBe(before)
  })

  it('re-pushes when the status changes (clean -> dirty)', async () => {
    const status: Record<string, string> = { '/r': CLEAN }
    const { svc, pushed, watchers } = makeService({ '/r': '/r' }, status)
    await svc.setCwd('p1', '/r')
    status['/r'] = DIRTY
    watchers[0].trigger()
    await flush()
    expect(pushed.at(-1)).toEqual(['p1', expect.objectContaining({ dirty: true })])
  })

  it('re-probes on command-done', async () => {
    const status: Record<string, string> = { '/r': CLEAN }
    const { svc, pushed, runStatus } = makeService({ '/r': '/r' }, status)
    await svc.setCwd('p1', '/r')
    const calls = runStatus.mock.calls.length
    status['/r'] = DIRTY
    svc.onCommandDone('p1')
    await flush()
    expect(runStatus.mock.calls.length).toBeGreaterThan(calls)
    expect(pushed.at(-1)).toEqual(['p1', expect.objectContaining({ dirty: true })])
  })

  it('shares one watcher across panes in the same root, closing it when the last leaves', async () => {
    const { svc, watchers } = makeService({ '/a': '/r', '/b': '/r' }, { '/r': CLEAN })
    await svc.setCwd('p1', '/a')
    await svc.setCwd('p2', '/b')
    expect(watchers.length).toBe(1)
    svc.removePane('p1')
    expect(watchers[0].closed).toBe(false)
    svc.removePane('p2')
    expect(watchers[0].closed).toBe(true)
  })

  it('closes all watchers on stop()', async () => {
    const { svc, watchers } = makeService({ '/a': '/r' }, { '/r': CLEAN })
    await svc.setCwd('p1', '/a')
    svc.stop()
    expect(watchers[0].closed).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/git-status-service.test.ts`
Expected: FAIL — cannot find module `git-status-service`.

- [ ] **Step 3: Write the implementation**

Create `src/main/git/git-status-service.ts`:

```ts
import path from 'node:path'
import chokidar from 'chokidar'
import type { GitStatus } from '@shared/types'
import { resolveGitRoot as defaultResolveRoot, runGitStatus as defaultRunStatus } from './probe'
import { parseStatus } from './parse-status'

export type Watcher = { close(): void | Promise<void> }
export type WatchFactory = (root: string, onChange: () => void) => Watcher

/** Real chokidar watch of a repo's .git dir, ignoring the noisy objects/ and logs/ subtrees. Catches
 *  HEAD/index/refs/MERGE_HEAD/FETCH_HEAD writes (commits, staging, checkout, fetch). Unstaged
 *  working-tree edits don't touch .git — those are covered by the command-done re-probe. */
function defaultWatchFactory(root: string, onChange: () => void): Watcher {
  const gitDir = path.join(root, '.git')
  const w = chokidar.watch(gitDir, {
    ignoreInitial: true,
    ignored: (p: string) => /[\\/](?:objects|logs)[\\/]/.test(p),
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 }
  })
  for (const ev of ['add', 'unlink', 'change', 'addDir', 'unlinkDir'] as const) {
    w.on(ev, (() => onChange()) as never)
  }
  return { close: () => w.close() }
}

interface PaneEntry { cwd: string; root: string | null; sig: string }
interface RootEntry { refs: Set<string>; watcher: Watcher; timer: ReturnType<typeof setTimeout> | null }

function sigOf(status: GitStatus | null): string {
  if (!status) return 'null'
  const s = status
  return `${s.root}|${s.branch}|${s.detached}|${s.upstream ?? ''}|${s.ahead}|${s.behind}|${s.staged}|${s.unstaged}|${s.untracked}`
}

/** Per-pane git status driven by cwd changes + a targeted .git watch + command-done re-probe.
 *  Mirrors CloudStatusService: shared AbortController re-armed on stop(), one in-flight probe per
 *  root (coalesced), signature dedup before pushing. Watches are ref-counted by repo root so panes
 *  sharing a repo share one watch + one probe. */
export class GitStatusService {
  private panes = new Map<string, PaneEntry>()
  private roots = new Map<string, RootEntry>()
  private probing = new Set<string>()
  private abort = new AbortController()

  constructor(
    private readonly onStatus: (paneId: string, status: GitStatus | null) => void,
    private readonly resolveRoot: (cwd: string, signal?: AbortSignal) => Promise<string | null> = defaultResolveRoot,
    private readonly runStatus: (root: string, signal?: AbortSignal) => Promise<string | null> = defaultRunStatus,
    private readonly makeWatcher: WatchFactory = defaultWatchFactory,
    private readonly debounceMs = 150
  ) {}

  async setCwd(paneId: string, cwd: string): Promise<void> {
    const prev = this.panes.get(paneId)
    if (prev?.cwd === cwd) return
    // Claim the slot synchronously so a concurrent setCwd can be detected after the await.
    this.panes.set(paneId, { cwd, root: prev?.root ?? null, sig: prev?.sig ?? '' })
    const root = await this.resolveRoot(cwd, this.abort.signal)
    const cur = this.panes.get(paneId)
    if (!cur || cur.cwd !== cwd) return   // superseded by a newer setCwd / removed
    if (prev?.root && prev.root !== root) this.unref(prev.root, paneId)
    cur.root = root
    if (!root) { this.push(paneId, null); return }
    this.ref(root, paneId)
    await this.probeRoot(root)
  }

  onCommandDone(paneId: string): void {
    const root = this.panes.get(paneId)?.root
    if (root) this.scheduleProbe(root)
  }

  removePane(paneId: string): void {
    const p = this.panes.get(paneId)
    if (!p) return
    if (p.root) this.unref(p.root, paneId)
    this.panes.delete(paneId)
  }

  stop(): void {
    this.abort.abort()
    this.abort = new AbortController()
    for (const r of this.roots.values()) { if (r.timer) clearTimeout(r.timer); void r.watcher.close() }
    this.roots.clear()
    this.panes.clear()
    this.probing.clear()
  }

  private ref(root: string, paneId: string): void {
    let r = this.roots.get(root)
    if (!r) {
      r = { refs: new Set(), watcher: this.makeWatcher(root, () => this.scheduleProbe(root)), timer: null }
      this.roots.set(root, r)
    }
    r.refs.add(paneId)
  }

  private unref(root: string, paneId: string): void {
    const r = this.roots.get(root)
    if (!r) return
    r.refs.delete(paneId)
    if (r.refs.size === 0) {
      if (r.timer) clearTimeout(r.timer)
      void r.watcher.close()
      this.roots.delete(root)
    }
  }

  private scheduleProbe(root: string): void {
    const r = this.roots.get(root)
    if (!r) return
    if (r.timer) clearTimeout(r.timer)
    r.timer = setTimeout(() => { r.timer = null; void this.probeRoot(root) }, this.debounceMs)
    ;(r.timer as { unref?: () => void }).unref?.()
  }

  // One in-flight probe per root; a burst of watch events + a command-done collapse into at most one
  // git call (the trailing debounce schedules the next). Matches CloudStatusService's refresh guard.
  private async probeRoot(root: string): Promise<void> {
    if (this.probing.has(root)) return
    this.probing.add(root)
    try {
      const out = await this.runStatus(root, this.abort.signal)
      const r = this.roots.get(root)
      if (!r) return   // root released while probing
      const status: GitStatus | null = out == null ? null : { root, ...parseStatus(out) }
      for (const paneId of r.refs) this.push(paneId, status)
    } finally {
      this.probing.delete(root)
    }
  }

  private push(paneId: string, status: GitStatus | null): void {
    const p = this.panes.get(paneId)
    if (!p) return
    const sig = sigOf(status)
    if (p.sig === sig) return
    p.sig = sig
    this.onStatus(paneId, status)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/git-status-service.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/git/git-status-service.ts tests/main/git-status-service.test.ts
git commit -m "feat(git): GitStatusService (refcounted .git watch, debounce, dedup)"
```

---

## Task 4: IPC wiring (contract, preload, api, routing, registrars)

**Files:**
- Modify: `src/shared/ipc-contract.ts` (CH constant + `TermhallaApi` method + import)
- Modify: `src/preload/index.ts` (expose `onGitStatus`)
- Modify: `src/main/window-manager.ts:31-34` (add `CH.gitStatus` to `PANE_SCOPED`)
- Create: `src/main/ipc/register-git.ts`
- Modify: `src/main/ipc/register-pty.ts` (forward cwd / command-done / pane-gone hooks)
- Modify: `src/main/ipc/register.ts` (build the git service, wire hooks, add disposer)

**Interfaces:**
- Consumes: `GitStatusService` (Task 3); `GitStatus` (Task 1).
- Produces: `CH.gitStatus = 'git:status'`; `TermhallaApi.onGitStatus`; `registerGit(send): { service: GitStatusService; dispose: Disposer }`; three new optional `registerPty` deps (`onCwd`, `onCommandDone`, `onPaneGone`).

- [ ] **Step 1: Extend the IPC contract**

In `src/shared/ipc-contract.ts`:

Add `GitStatus` to the type import on line 1:
```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore, ProcInfo, CloudStatus, AiSession, UsageMetrics, EditorDraft, EnvVaultData, RecState, EnvVaultState, GitStatus } from './types'
```

Add the channel inside `CH` (next to `ptyProcs`):
```ts
  gitStatus: 'git:status',         // main -> renderer event
```

Add the method to `TermhallaApi` (next to `onPtyProcs`):
```ts
  onGitStatus(cb: (id: string, status: GitStatus | null) => void): () => void
```

- [ ] **Step 2: Expose it in preload**

In `src/preload/index.ts`, add after the `onPtyProcs` line (line ~62):
```ts
  onGitStatus: pushChannel<[string, import('@shared/types').GitStatus | null]>(CH.gitStatus),
```

- [ ] **Step 3: Route it per-pane**

In `src/main/window-manager.ts`, add `CH.gitStatus` to the `PANE_SCOPED` set (line 31-34):
```ts
const PANE_SCOPED = new Set<string>([
  CH.ptyData, CH.ptyExit, CH.ptyStatus, CH.ptyCwd, CH.ptyProcs, CH.gitStatus,
  CH.aiSession, CH.usageMetrics, CH.recState, CH.termSerialize
])
```

- [ ] **Step 4: Create the git registrar**

Create `src/main/ipc/register-git.ts`:
```ts
import { CH } from '@shared/ipc-contract'
import { GitStatusService } from '../git/git-status-service'
import type { Send, Disposer } from './types'

/** Build the per-pane git status service. It owns no ipcMain handlers — it is driven by the cwd /
 *  command-done / pane-gone hooks that registerPty forwards (the StatusEngine already emits those
 *  signals). Returns the service so register.ts can wire those hooks, plus a disposer that stops it
 *  (aborts in-flight probes, closes all .git watchers) on app shutdown. */
export function registerGit(send: Send): { service: GitStatusService; dispose: Disposer } {
  const service = new GitStatusService((paneId, status) => send(CH.gitStatus, paneId, status))
  return { service, dispose: () => service.stop() }
}
```

- [ ] **Step 5: Forward the signals from registerPty**

In `src/main/ipc/register-pty.ts`:

Extend the `deps` object type (after `replayInto?`):
```ts
    replayInto?: (paneId: string) => void
    // Git status hooks: forward the cwd + command-done + pane-gone signals the engine already emits.
    onCwd?: (paneId: string, cwd: string) => void
    onCommandDone?: (paneId: string) => void
    onPaneGone?: (paneId: string) => void
```

Change the engine construction (lines 39-44) to forward `onCwd` and `onCommandDone`:
```ts
  const engine = new StatusEngine(
    (id, status) => { send(CH.ptyStatus, id, status); tracker.setBusy(id, status.state === 'busy') },
    (id, cwd) => { send(CH.ptyCwd, id, cwd); deps.onCwd?.(id, cwd) },
    undefined,
    (id) => { ai.commandDone(id); deps.onCommandDone?.(id) }
  )
```

Change the PtyManager onExit (line 47) to also fire `onPaneGone`:
```ts
    (id, code) => { send(CH.ptyExit, id, code); tracker.unregister(id); ai.unregister(id); recorder.stop(id); send(CH.recState, id, { recording: false, file: null }); deps.onPaneGone?.(id) },
```

Change the `ptyKill` handler (line 66) to also fire `onPaneGone`:
```ts
  ipcMain.on(CH.ptyKill, (_e, id: string) => { pty.kill(id); tracker.unregister(id); ai.unregister(id); deps.onPaneGone?.(id) })
```

- [ ] **Step 6: Wire it in the composition root**

In `src/main/ipc/register.ts`:

Add the import (after `registerClipboard`):
```ts
import { registerGit } from './register-git'
```

Build the service before `registerPty` and pass the hooks (replace the `registerPty` call, lines 29-34):
```ts
  const win = wm.mainWindow()
  const { service: git, dispose: disposeGit } = registerGit(send)
  const pty = registerPty(win, {
    shells, recorder, envVault, scriptDir, send,
    claimPane: (id, sender) => wm.claimPane(id, sender),
    replayInto: (id) => wm.replayInto(id),
    onCwd: (id, cwd) => { void git.setCwd(id, cwd) },
    onCommandDone: (id) => git.onCommandDone(id),
    onPaneGone: (id) => git.removePane(id)
  })
```

Add `disposeGit` to the disposers array (lines 40-45):
```ts
  const disposers: Disposer[] = [
    registerFs(win, send),
    registerCloud(win, send),
    registerUsage(send),
    registerRecording({ pty, recorder, userDataDir: dir, send }),
    disposeGit
  ]
```

- [ ] **Step 7: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: builds to `out/` with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/window-manager.ts src/main/ipc/register-git.ts src/main/ipc/register-pty.ts src/main/ipc/register.ts
git commit -m "feat(git): wire git:status IPC channel + service into the pty stack"
```

---

## Task 5: Renderer store (map, setter, clear, subscription)

**Files:**
- Modify: `src/renderer/store/types.ts` (State: `gitStatus` map + `setGitStatus`; import `GitStatus`)
- Modify: `src/renderer/store/runtime-slice.ts` (`setGitStatus` setter + Pick type)
- Modify: `src/renderer/store.ts` (initial state `gitStatus: {}`)
- Modify: `src/renderer/store/internals.ts` (`clearPaneRuntime` includes `gitStatus`)
- Modify: `src/renderer/App.tsx` (subscribe `onGitStatus`)
- Test: `tests/renderer/clear-pane-runtime.test.ts`

**Interfaces:**
- Consumes: `GitStatus` (Task 1); `TermhallaApi.onGitStatus` (Task 4).
- Produces: `state.gitStatus: Record<string, GitStatus>`; `state.setGitStatus(id, status | null)`.

- [ ] **Step 1: Write the failing test for `clearPaneRuntime`**

Create `tests/renderer/clear-pane-runtime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { clearPaneRuntime } from '../../src/renderer/store/internals'
import type { State } from '../../src/renderer/store/types'

// clearPaneRuntime only reads the per-pane maps; cast a minimal partial to State.
function stateWith(): State {
  return {
    statuses: { p1: { state: 'idle' } as never, p2: { state: 'idle' } as never },
    cwds: { p1: '/a', p2: '/b' },
    procs: {}, aiSessions: {}, usage: {}, recording: {},
    gitStatus: { p1: { root: '/a', branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: false }, p2: { root: '/b', branch: 'dev', detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: true } }
  } as unknown as State
}

describe('clearPaneRuntime', () => {
  it('drops gitStatus for the cleared panes (and keeps the others)', () => {
    const out = clearPaneRuntime(stateWith(), ['p1'])
    expect(out.gitStatus.p1).toBeUndefined()
    expect(out.gitStatus.p2).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/clear-pane-runtime.test.ts`
Expected: FAIL — `out.gitStatus` is `undefined` (property not yet in the return), so `out.gitStatus.p1` throws.

- [ ] **Step 3: Add the state shape**

In `src/renderer/store/types.ts`:

Add `GitStatus` to the `@shared/types` import list (line 3-6):
```ts
  TerminalLaunch, AiSession, UsageMetrics, EditorDraft, ScheduledTask, Theme, EnvVaultState, GitStatus
```

Add to the `State` interface, right after the `procs` / `setProcs` pair (line 57-58):
```ts
  gitStatus: Record<string, GitStatus>
  setGitStatus: (id: string, status: GitStatus | null) => void
```

- [ ] **Step 4: Add the setter**

In `src/renderer/store/runtime-slice.ts`:

Add `'setGitStatus'` to the `RuntimeSlice` Pick type (line 7-9):
```ts
type RuntimeSlice = Pick<State,
  'setStatus' | 'setCwd' | 'setProcs' | 'setGitStatus' | 'setAiSession' | 'setUsage' | 'setRecording' |
  'setCloud' | 'refreshCloud' | 'setEnvState'>
```

Add the setter (after `setProcs`, mirroring its delete-on-null shape):
```ts
    setGitStatus: (id, status) => set(s => {
      const gitStatus = { ...s.gitStatus }
      if (status) gitStatus[id] = status
      else delete gitStatus[id]
      return { gitStatus }
    }),
```

- [ ] **Step 5: Add initial state**

In `src/renderer/store.ts`, add to the initial state object (after `procs: {},` at line 87):
```ts
    gitStatus: {},
```

- [ ] **Step 6: Include it in `clearPaneRuntime`**

In `src/renderer/store/internals.ts`, update the function (lines 33-38):
```ts
export function clearPaneRuntime(s: State, paneIds: string[]): Pick<State, 'statuses' | 'cwds' | 'procs' | 'aiSessions' | 'usage' | 'recording' | 'gitStatus'> {
  const statuses = { ...s.statuses }, cwds = { ...s.cwds }, procs = { ...s.procs }
  const aiSessions = { ...s.aiSessions }, usage = { ...s.usage }, recording = { ...s.recording }, gitStatus = { ...s.gitStatus }
  for (const pid of paneIds) { delete statuses[pid]; delete cwds[pid]; delete procs[pid]; delete aiSessions[pid]; delete usage[pid]; delete recording[pid]; delete gitStatus[pid] }
  return { statuses, cwds, procs, aiSessions, usage, recording, gitStatus }
}
```

- [ ] **Step 7: Subscribe in App**

In `src/renderer/App.tsx`, add to the `offs` array (after the `onPtyProcs` line, ~43):
```ts
      api.onGitStatus((id, g) => s().setGitStatus(id, g)),
```

- [ ] **Step 8: Run the test + typecheck**

Run: `npx vitest run tests/renderer/clear-pane-runtime.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/store/types.ts src/renderer/store/runtime-slice.ts src/renderer/store.ts src/renderer/store/internals.ts src/renderer/App.tsx tests/renderer/clear-pane-runtime.test.ts
git commit -m "feat(git): renderer store gitStatus map + subscription"
```

---

## Task 6: UI — chip + `GitPopover`

**Files:**
- Create: `src/renderer/components/GitPopover.tsx`
- Modify: `src/renderer/components/PaneTile.tsx` (read `gitStatus`, pass to toolbar, `data-git-branch`, render popover, extend `PaneMenu`)
- Modify: `src/renderer/components/PaneToolbar.tsx` (render the git chip)

**Interfaces:**
- Consumes: `GitStatus` (Task 1); `state.gitStatus` (Task 5); `Z`, `SURFACE` from `./Modal`.
- Produces: `GitPopover` component; `PaneMenu` gains `'git'`; `PaneToolbar` gains a `gitStatus` prop.

- [ ] **Step 1: Create the popover (read-only; takes only the props it renders — `noUnusedParameters`)**

Create `src/renderer/components/GitPopover.tsx`:
```tsx
import type { GitStatus } from '@shared/types'
import { Z, SURFACE } from './Modal'

/** Read-only in-tile popover with full git detail. Positioned like ProcessPopover (absolute within
 *  the position:relative tile); closed by toggling the chip again. */
export function GitPopover({ status }: { status: GitStatus }) {
  return (
    <div data-testid="git-menu" onClick={e => e.stopPropagation()}
      style={{ ...SURFACE, position: 'absolute', left: 4, top: 28, zIndex: Z.popover, padding: 6,
        maxWidth: 320, fontSize: 12, fontFamily: 'var(--mono)' }}>
      <div>{status.detached ? `detached @ ${status.branch}` : status.branch}</div>
      {status.upstream && (
        <div style={{ color: 'var(--fg-dim, #aaa)' }}>{status.upstream} · ↑{status.ahead} ↓{status.behind}</div>
      )}
      <div style={{ color: 'var(--fg-dim, #aaa)' }}>
        staged {status.staged} · unstaged {status.unstaged} · untracked {status.untracked}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render the chip in the toolbar**

In `src/renderer/components/PaneToolbar.tsx`:

Add `GitStatus` import + the `gitStatus` prop. Update the imports and signature:
```tsx
import { useStore } from '../store'
import { api } from '../api'
import type { GitStatus } from '@shared/types'
import type { PaneMenu } from './PaneTile'

export function PaneToolbar(
  { wsId, paneId, isTerminal, chipText, gitStatus, recording, toggle }: {
    wsId: string
    paneId: string
    isTerminal: boolean
    chipText: string
    gitStatus: GitStatus | undefined
    recording: boolean
    toggle: (menu: PaneMenu) => void
  }
) {
```

Add the git chip immediately after the `rec` button, inside the `isTerminal` block (after line 34's `</button>` for rec, before the closing `</>`):
```tsx
          {gitStatus && (
            <button type="button" data-testid={`git-chip-${paneId}`} title="Git status"
              style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={() => toggle('git')}>
              {gitStatus.detached ? '⎇ ' : ''}{gitStatus.branch}{gitStatus.dirty ? ' ●' : ''}
            </button>
          )}
```

- [ ] **Step 3: Wire the tile**

In `src/renderer/components/PaneTile.tsx`:

Extend the `PaneMenu` type (line 15):
```ts
export type PaneMenu = 'proc' | 'cwd' | 'schedule' | 'git'
```

Add the import (after the `ProcessPopover` import, line 12):
```ts
import { GitPopover } from './GitPopover'
```

Read the git status (after the `cwd` selector, line 29):
```ts
  const gitStatus = useStore(s => s.gitStatus[paneId])
```

Pass it to `PaneToolbar` (line 93-94):
```tsx
        <PaneToolbar wsId={wsId} paneId={paneId} isTerminal={!!termCfg} chipText={chipText}
          gitStatus={gitStatus} recording={recording} toggle={toggle} />
```

Add `data-git-branch` to the tile div (line 102-103) — alongside `data-cwd`:
```tsx
      <div ref={tileRef} className="term-tile" data-status={state}
        data-testid={`tile-${paneId}`} data-cwd={cwd} data-git-branch={gitStatus?.branch ?? ''}
```

Render the popover (after the `menu === 'proc'` block, line 105-107):
```tsx
        {menu === 'git' && gitStatus && <GitPopover status={gitStatus} />}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: builds to `out/` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/GitPopover.tsx src/renderer/components/PaneTile.tsx src/renderer/components/PaneToolbar.tsx
git commit -m "feat(git): pane chip + read-only git detail popover"
```

---

## Task 7: End-to-end test

**Files:**
- Create: `tests/e2e/git-status.spec.ts`

**Interfaces:**
- Consumes: the whole feature (chip `data-testid="git-chip-*"`, tile `data-git-branch`).

- [ ] **Step 1: Build (e2e runs against `out/`)**

Run: `npm run build`
Expected: success.

- [ ] **Step 2: Write the e2e spec**

Create `tests/e2e/git-status.spec.ts` (helpers `killTree`/`launch` copied from `tests/e2e/cwd.spec.ts`, which is the established pattern):

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { execSync, execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('shows git branch + dirty state on the pane chip, and clears it outside a repo', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-git-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-gitproj-'))
  const git = (args: string[]) => execFileSync('git', args, { cwd: proj })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 't@example.com'])
  git(['config', 'user.name', 'T'])
  writeFileSync(join(proj, 'a.txt'), 'hi', 'utf8')
  git(['add', '.'])
  git(['commit', '-m', 'init'])
  const nonRepo = mkdtempSync(join(tmpdir(), 'termh-nonrepo-'))

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  const app = await launch()
  const win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()

  // Enter the repo -> branch chip appears.
  await win.keyboard.type(`Set-Location '${proj}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="tile-"][data-git-branch="main"]')).toHaveCount(1, { timeout: 25_000 })

  // Create an untracked file from inside the terminal -> the completing command triggers a re-probe
  // -> dirty dot appears on the chip.
  await win.keyboard.type('Set-Content extra.txt hi')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="git-chip-"]')).toContainText('●', { timeout: 25_000 })

  // Leave the repo -> chip disappears.
  await win.keyboard.type(`Set-Location '${nonRepo}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="tile-"][data-git-branch="main"]')).toHaveCount(0, { timeout: 25_000 })

  const pid = app.process().pid
  await app.close().catch(() => {})
  if (pid) killTree(pid)
})
```

- [ ] **Step 3: Run the e2e**

Run: `npm run e2e -- git-status`
Expected: PASS (1 test). If the shell-picker option value differs, mirror the exact value used in `tests/e2e/cwd.spec.ts` (`'powershell'`).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/git-status.spec.ts
git commit -m "test(git): e2e for pane chip branch + dirty state"
```

---

## Task 8: Docs

**Files:**
- Create: `docs/features/git-status.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md` (the "Where things live" table — add a Git status row)
- Modify: `docs/architecture.md:119-123` (add `gitStatus` to the per-pane runtime maps list)

- [ ] **Step 1: Write the feature doc**

Create `docs/features/git-status.md` documenting: the data flow (cwd → service → `git:status` → store → chip), the `.git`-watch + command-idle dual trigger and the unstaged-edit rationale, the read-only-in-v1 scope, and the non-goals (no actions, no submodule recursion, no SSH/remote, not persisted). Note the linked-worktree limitation: for a worktree whose `.git` is a *file*, the watch is less precise and updates rely on the command-idle re-probe.

- [ ] **Step 2: Update the changelog**

Add an entry under the current/unreleased section of `CHANGELOG.md` summarizing the feature.

- [ ] **Step 3: Update CLAUDE.md + architecture.md**

Add a row to the CLAUDE.md "Where things live" table:
```
| Git status on pane chip | `src/main/git/` | [git-status](docs/features/git-status.md) |
```
In `docs/architecture.md` (lines 119-123), add `gitStatus` to the enumerated per-pane runtime maps.

- [ ] **Step 4: Commit**

```bash
git add docs/features/git-status.md CHANGELOG.md CLAUDE.md docs/architecture.md
git commit -m "docs(git): document git-status-on-pane-chip feature"
```

---

## Self-Review

**Spec coverage:**
- Architecture (service mirrors cloud, fed by cwd) → Tasks 3, 4. ✓
- `parse-status.ts` / single porcelain-v2 probe → Tasks 1, 2. ✓
- `git-root.ts` resolution → folded into `probe.ts` (`resolveGitRoot`); the spec listed a separate `git-root.ts` "if any pure parsing there" — there is none (it is one execFile + trim), so it lives in `probe.ts`. ✓ (deviation noted)
- Per-root refcounted `.git` watch + ignore objects/logs → Task 3 `defaultWatchFactory`. ✓
- Command-idle re-probe → Tasks 3 (`onCommandDone`) + 4 (forwarded from `StatusEngine.onCommandDone`). ✓
- Coalescing + signature dedup → Task 3 (`probing` guard, `sigOf`). ✓
- Abort/unref/timeout/stop-on-closed → Task 2 (`unref`, `signal`, timeout), Task 3 (`stop`, abort), Task 4 (disposer via `onAllWindowsClosed`). ✓
- Keyed by paneId in store + `clearPaneRuntime` → Task 5. ✓
- Pane-scoped routing → Task 4 (PANE_SCOPED). ✓
- Chip (branch + dirty dot, detached glyph) + read-only popover → Task 6. ✓
- `data-git-branch` e2e hook → Task 6. ✓
- Degrade silently (non-repo/SSH/error → null) → Task 2 (null on error), Task 3 (push null). SSH: a remote/nonexistent local cwd fails `rev-parse` → null; no explicit SSH-target threading needed (simplification vs. the spec's "detected via spawn spec", same user-visible outcome — no chip). ✓
- Tests (unit bulk + one e2e) → Tasks 1, 2, 3, 5 (unit), 7 (e2e). ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `GitStatus` fields (`root/branch/detached/upstream/ahead/behind/staged/unstaged/untracked/dirty`) are identical across types.ts, `parseStatus` return (`Omit<…,'root'>`), `sigOf`, store map, and UI. `GitStatusService` method names (`setCwd`/`onCommandDone`/`removePane`/`stop`) match their call sites in `register.ts` (`git.setCwd`/`git.onCommandDone`/`git.removePane`) and the disposer (`service.stop`). `onGitStatus` matches across contract, preload, and App. `git-chip-`/`git-menu`/`data-git-branch` test ids match between Task 6 and Task 7.

**Deviations from spec (intentional, same outcome):**
1. `git-root.ts` merged into `probe.ts` (no separable pure logic).
2. SSH handled by probe-failure rather than spawn-spec threading.
3. `GitStatus` gained an explicit `detached: boolean` (the spec described detached behavior without naming the field) so the UI can pick the `⎇` glyph without string-sniffing.
4. `GitPopover` does not portal to `<body>` — it mirrors `ProcessPopover`/`CwdMenu`, which are `position: absolute` children of the `position: relative` tile (the portal gotcha applies to `position: fixed` overlays like `PaneContextMenu`/`Modal`, not these anchored popovers). The spec's "portal to body" note was corrected to match the actual sibling popovers.
