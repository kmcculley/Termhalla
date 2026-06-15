# Claude Usage Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For a detected Claude session in a terminal, surface live token usage (in/out/cache) + a context-window % gauge by parsing its transcript, shown as a `✨ Claude 78%` chip headline + a token breakdown in the chip popover.

**Architecture:** A main-process `UsageTracker` resolves a terminal's cwd to its Claude transcript (`cwd → <claudeHome>/projects/<encoded>/` newest `.jsonl`), chokidar-watches it, and re-parses (debounced) via a pure `parseClaudeUsage`, emitting `usage:metrics`. A renderer `UsageWatcher` starts/stops watches from the E `aiSessions` + A `cwds` state; the store holds metrics; the WorkspaceView chip/popover render them.

**Tech Stack:** Electron + TypeScript (strict), React, zustand, chokidar, vitest, @playwright/test (Electron). Path alias `@shared/*` → `src/shared/*`.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-claude-usage-metrics-design.md`

---

## File Structure

**New files:**
- `src/main/usage/project-dir.ts` — `encodeProjectDir`, `pickNewestTranscript` (pure).
- `src/main/usage/parse-usage.ts` — `windowFor`, `parseClaudeUsage` (pure).
- `src/main/usage/usage-tracker.ts` — `UsageTracker` (chokidar watch + debounced re-parse; impure).
- `src/renderer/components/UsageWatcher.tsx` — reconciles watches from aiSessions+cwds (renders null).
- `tests/main/usage-core.test.ts`, `tests/e2e/usage.spec.ts`.

**Modified files:**
- `src/shared/types.ts` — `UsageMetrics`.
- `src/shared/ipc-contract.ts` — `usage:watch`/`usage:unwatch`/`usage:metrics` + API methods.
- `src/preload/index.ts` — expose `usageWatch`/`usageUnwatch`/`onUsageMetrics`.
- `src/main/ipc/register.ts` — construct + wire `UsageTracker`.
- `src/renderer/store.ts` — `usage` state, `setUsage`, `closePane` cleanup.
- `src/renderer/App.tsx` — `usage:metrics` subscription + mount `<UsageWatcher />`.
- `src/renderer/components/WorkspaceView.tsx` — chip % headline + popover usage section.

---

## Task 1: Pure core (encode, pick-newest, parse)

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/usage/project-dir.ts`, `src/main/usage/parse-usage.ts`
- Test: `tests/main/usage-core.test.ts`

- [ ] **Step 1: Add `UsageMetrics` to `src/shared/types.ts`**

Append after the `AiSession` interface (before `SCHEMA_VERSION`):

```ts
/** Live usage metrics for a Claude session, parsed from its transcript. */
export interface UsageMetrics {
  input: number          // cumulative non-cached input tokens
  output: number         // cumulative output tokens
  cacheRead: number      // cumulative cache-read tokens
  cacheCreation: number  // cumulative cache-creation tokens
  contextTokens: number  // current context size (last assistant turn's input-side total)
  contextWindow: number  // the model's context window (e.g. 200000)
  contextPct: number     // round(contextTokens / contextWindow * 100)
}
```

- [ ] **Step 2: Write the failing test `tests/main/usage-core.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { encodeProjectDir, pickNewestTranscript } from '../../src/main/usage/project-dir'
import { windowFor, parseClaudeUsage } from '../../src/main/usage/parse-usage'

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric char with a dash (Claude project-dir rule)', () => {
    expect(encodeProjectDir('C:\\dev\\Termhalla')).toBe('C--dev-Termhalla')
    expect(encodeProjectDir('C:\\dev\\my.app two')).toBe('C--dev-my-app-two')
  })
})

describe('pickNewestTranscript', () => {
  it('returns the .jsonl with the greatest mtime', () => {
    expect(pickNewestTranscript([
      { name: 'a.jsonl', mtimeMs: 10 },
      { name: 'b.jsonl', mtimeMs: 30 },
      { name: 'c.jsonl', mtimeMs: 20 }
    ])).toBe('b.jsonl')
  })
  it('ignores non-jsonl and returns null when none', () => {
    expect(pickNewestTranscript([{ name: 'notes.txt', mtimeMs: 99 }])).toBeNull()
    expect(pickNewestTranscript([])).toBeNull()
  })
})

describe('windowFor', () => {
  it('defaults to 200000 and uses 1000000 for [1m] models', () => {
    expect(windowFor('claude-opus-4')).toBe(200000)
    expect(windowFor('claude-opus-4-8[1m]')).toBe(1000000)
  })
})

describe('parseClaudeUsage', () => {
  const jsonl = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } }),
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    'not json — skipped',
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0 } } })
  ].join('\n')

  it('sums token fields, takes the last turn as context, and computes pct', () => {
    const m = parseClaudeUsage(jsonl)
    expect(m.input).toBe(220)
    expect(m.output).toBe(130)
    expect(m.cacheRead).toBe(151000)
    expect(m.cacheCreation).toBe(200)
    expect(m.contextTokens).toBe(150120)   // last assistant: 120 + 150000 + 0
    expect(m.contextWindow).toBe(200000)
    expect(m.contextPct).toBe(75)           // round(150120/200000*100)
  })
  it('returns all-zero for an empty/assistant-less transcript', () => {
    expect(parseClaudeUsage('')).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, contextTokens: 0, contextWindow: 200000, contextPct: 0 })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- usage-core`
Expected: FAIL — `Cannot find module '../../src/main/usage/project-dir'`.

- [ ] **Step 4: Create `src/main/usage/project-dir.ts`**

```ts
/** Encode an absolute path the way Claude Code names its project dir: every
 *  non-alphanumeric character becomes '-'. e.g. C:\dev\Termhalla -> C--dev-Termhalla */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** The `.jsonl` entry with the greatest mtime (the active session), or null. */
export function pickNewestTranscript(entries: { name: string; mtimeMs: number }[]): string | null {
  let best: { name: string; mtimeMs: number } | null = null
  for (const e of entries) {
    if (!e.name.endsWith('.jsonl')) continue
    if (!best || e.mtimeMs > best.mtimeMs) best = e
  }
  return best ? best.name : null
}
```

- [ ] **Step 5: Create `src/main/usage/parse-usage.ts`**

```ts
import type { UsageMetrics } from '@shared/types'

const DEFAULT_WINDOW = 200000

/** The model's context window: 1M for [1m] variants, else 200k. */
export function windowFor(model: string): number {
  return /\[1m\]/i.test(model) ? 1_000_000 : DEFAULT_WINDOW
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Sum token usage across assistant turns; the last turn's input side is the current context. */
export function parseClaudeUsage(jsonl: string): UsageMetrics {
  let input = 0, output = 0, cacheRead = 0, cacheCreation = 0, contextTokens = 0, model = ''
  for (const line of jsonl.split('\n')) {
    const t = line.trim()
    if (!t) continue
    let obj: { type?: string; message?: { model?: string; usage?: Record<string, unknown> } }
    try { obj = JSON.parse(t) } catch { continue }
    const u = obj?.message?.usage
    if (obj?.type !== 'assistant' || !u) continue
    const it = num(u.input_tokens), cr = num(u.cache_read_input_tokens), cc = num(u.cache_creation_input_tokens)
    input += it; output += num(u.output_tokens); cacheRead += cr; cacheCreation += cc
    contextTokens = it + cr + cc
    if (typeof obj.message?.model === 'string') model = obj.message.model
  }
  const contextWindow = windowFor(model)
  const contextPct = contextWindow > 0 ? Math.round((contextTokens / contextWindow) * 100) : 0
  return { input, output, cacheRead, cacheCreation, contextTokens, contextWindow, contextPct }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- usage-core`
Expected: PASS (all groups green).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/usage/project-dir.ts src/main/usage/parse-usage.ts tests/main/usage-core.test.ts
git commit -m "feat(usage): pure core - project-dir encoding, transcript parse, window table"
```

---

## Task 2: UsageTracker (watch + re-parse)

**Files:**
- Create: `src/main/usage/usage-tracker.ts`

No unit test — it does chokidar + fs (verified by build + the Task 6 e2e), mirroring `WatchManager`. The logic it depends on (`encodeProjectDir`/`pickNewestTranscript`/`parseClaudeUsage`) is unit-tested in Task 1.

- [ ] **Step 1: Create `src/main/usage/usage-tracker.ts`**

```ts
import chokidar, { type FSWatcher } from 'chokidar'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageMetrics } from '@shared/types'
import { encodeProjectDir, pickNewestTranscript } from './project-dir'
import { parseClaudeUsage } from './parse-usage'

interface Session { watcher: FSWatcher | null; timer: ReturnType<typeof setTimeout> | null }

/** Watches a Claude session's transcript (resolved from the terminal's cwd) and emits live
 *  usage metrics, re-parsing on change (debounced). Driven by usage:watch / usage:unwatch. */
export class UsageTracker {
  private sessions = new Map<string, Session>()

  constructor(
    private readonly onMetrics: (id: string, m: UsageMetrics | null) => void,
    private readonly claudeHome: string = process.env.TERMHALLA_CLAUDE_HOME ?? join(homedir(), '.claude'),
    private readonly debounceMs = 750
  ) {}

  async watch(id: string, cwd: string): Promise<void> {
    this.stop(id) // replace any existing watch for this terminal (no clear emit)
    const file = await this.resolveTranscript(cwd)
    if (!file) { this.onMetrics(id, null); return }
    const sess: Session = { watcher: null, timer: null }
    this.sessions.set(id, sess)
    await this.reparse(id, file) // immediate
    if (!this.sessions.has(id)) return // unwatched during the await
    const w = chokidar.watch(file, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })
    w.on('change', () => this.schedule(id, file))
    sess.watcher = w
  }

  unwatch(id: string): void {
    if (!this.sessions.has(id)) return
    this.stop(id)
    this.onMetrics(id, null)
  }

  dispose(): void { for (const id of [...this.sessions.keys()]) this.stop(id) }

  private stop(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    if (s.watcher) void s.watcher.close()
    this.sessions.delete(id)
  }

  private schedule(id: string, file: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => { void this.reparse(id, file) }, this.debounceMs)
  }

  private async reparse(id: string, file: string): Promise<void> {
    if (!this.sessions.has(id)) return
    let content: string
    try { content = await readFile(file, 'utf8') } catch { return }
    if (!this.sessions.has(id)) return
    this.onMetrics(id, parseClaudeUsage(content))
  }

  private async resolveTranscript(cwd: string): Promise<string | null> {
    const dir = join(this.claudeHome, 'projects', encodeProjectDir(cwd))
    let names: string[]
    try { names = await readdir(dir) } catch { return null }
    const entries = await Promise.all(names.filter(n => n.endsWith('.jsonl')).map(async n => {
      try { const s = await stat(join(dir, n)); return { name: n, mtimeMs: s.mtimeMs } } catch { return { name: n, mtimeMs: 0 } }
    }))
    const newest = pickNewestTranscript(entries)
    return newest ? join(dir, newest) : null
  }
}
```

- [ ] **Step 2: Build to typecheck**

Run: `npm run build`
Expected: SUCCESS — no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/usage/usage-tracker.ts
git commit -m "feat(usage): UsageTracker - resolve transcript, watch, debounced re-parse"
```

---

## Task 3: IPC channels + main wiring

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/register.ts`

- [ ] **Step 1: Add channels + API methods to `src/shared/ipc-contract.ts`**

Add `UsageMetrics` to the type import on line 1 (append to the existing `from './types'` list):

```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore, ProcInfo, CloudStatus, AiSession, UsageMetrics } from './types'
```

Add three channels to the `CH` object (after `aiSession: 'ai:session'` — add a comma after it):

```ts
  aiSession: 'ai:session',         // main -> renderer event
  usageWatch: 'usage:watch',
  usageUnwatch: 'usage:unwatch',
  usageMetrics: 'usage:metrics'    // main -> renderer event
} as const
```

Add the methods to the `TermhallaApi` interface (after `onAiSession(...)`):

```ts
  usageWatch(id: string, cwd: string): void
  usageUnwatch(id: string): void
  onUsageMetrics(cb: (id: string, metrics: UsageMetrics | null) => void): () => void
```

- [ ] **Step 2: Expose them in `src/preload/index.ts`**

Add to the `api` object (after the `onAiSession` block):

```ts
  usageWatch: (id, cwd) => ipcRenderer.send(CH.usageWatch, id, cwd),
  usageUnwatch: (id) => ipcRenderer.send(CH.usageUnwatch, id),
  onUsageMetrics: (cb) => {
    const h = (_e: unknown, id: string, m: import('@shared/types').UsageMetrics | null) => cb(id, m)
    ipcRenderer.on(CH.usageMetrics, h as never)
    return () => ipcRenderer.removeListener(CH.usageMetrics, h as never)
  },
```

- [ ] **Step 3: Wire `UsageTracker` in `src/main/ipc/register.ts`**

Add the import near the other main imports (e.g. after the `AiSessionTracker` import):

```ts
import { UsageTracker } from '../usage/usage-tracker'
```

After the `ai = new AiSessionTracker(...)` line, construct the usage tracker and register its handlers:

```ts
  const usage = new UsageTracker((id, metrics) => safeSend(CH.usageMetrics, id, metrics))
  ipcMain.on(CH.usageWatch, (_e, id: string, cwd: string) => { void usage.watch(id, cwd) })
  ipcMain.on(CH.usageUnwatch, (_e, id: string) => usage.unwatch(id))
  win.on('closed', () => usage.dispose())
```

- [ ] **Step 4: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — bundles typecheck; usage-core green; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/register.ts
git commit -m "feat(usage): usage IPC channels + UsageTracker wiring"
```

---

## Task 4: Renderer store + UsageWatcher + App

**Files:**
- Modify: `src/renderer/store.ts`
- Create: `src/renderer/components/UsageWatcher.tsx`
- Modify: `src/renderer/App.tsx`

No unit test (store/components depend on the Electron `api`); verified by build + the Task 6 e2e.

- [ ] **Step 1: Add `usage` state + `setUsage` to `src/renderer/store.ts`**

Add `UsageMetrics` to the existing `@shared/types` type import. In the `State` interface, after the `aiSessions`/`setAiSession` members add:

```ts
  usage: Record<string, UsageMetrics>
  setUsage: (id: string, metrics: UsageMetrics | null) => void
```

Add the initial value next to `aiSessions: {}`:

```ts
    usage: {},
```

Add the action (near `setAiSession`):

```ts
    setUsage: (id, metrics) => set(s => {
      const usage = { ...s.usage }
      if (metrics) usage[id] = metrics
      else delete usage[id]
      return { usage }
    }),
```

- [ ] **Step 2: Clean up `usage` in `closePane`**

In the existing `closePane` `set(s => { ... })`, add the `usage` deletion alongside the others:

```ts
    closePane: (wsId, paneId) => {
      const ws = removePane(get().workspaces[wsId], paneId)
      set(s => {
        const statuses = { ...s.statuses }; delete statuses[paneId]
        const cwds = { ...s.cwds }; delete cwds[paneId]
        const procs = { ...s.procs }; delete procs[paneId]
        const aiSessions = { ...s.aiSessions }; delete aiSessions[paneId]
        const usage = { ...s.usage }; delete usage[paneId]
        return { workspaces: { ...s.workspaces, [wsId]: ws }, statuses, cwds, procs, aiSessions, usage }
      })
      api.ptyKill(paneId)
      scheduleAutosave()
    },
```

- [ ] **Step 3: Create `src/renderer/components/UsageWatcher.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'

/** Reconciles main-process usage watches with the set of Claude AI sessions that have a known
 *  cwd. Watches on detect, unwatches on clear. Renders nothing. */
export function UsageWatcher() {
  const aiSessions = useStore(s => s.aiSessions)
  const cwds = useStore(s => s.cwds)
  const watched = useRef<Record<string, string>>({})

  useEffect(() => {
    const desired: Record<string, string> = {}
    for (const id of Object.keys(aiSessions)) {
      if (aiSessions[id]?.tool === 'claude' && cwds[id]) desired[id] = cwds[id]
    }
    for (const id of Object.keys(desired)) {
      if (watched.current[id] !== desired[id]) {
        api.usageWatch(id, desired[id])
        watched.current[id] = desired[id]
      }
    }
    for (const id of Object.keys(watched.current)) {
      if (!desired[id]) {
        api.usageUnwatch(id)
        delete watched.current[id]
      }
    }
  }, [aiSessions, cwds])

  return null
}
```

- [ ] **Step 4: Subscribe + mount in `src/renderer/App.tsx`**

Add the import:

```tsx
import { UsageWatcher } from './components/UsageWatcher'
```

Add an effect next to the existing `onAiSession` effect:

```tsx
  useEffect(() => {
    const off = api.onUsageMetrics((id, m) => useStore.getState().setUsage(id, m))
    return off
  }, [])
```

Mount `<UsageWatcher />` next to the other always-on components (e.g. after `<StatusBar />`):

```tsx
      <StatusBar />
      <UsageWatcher />
      <CommandPalette />
```

- [ ] **Step 5: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — no TypeScript errors; no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store.ts src/renderer/components/UsageWatcher.tsx src/renderer/App.tsx
git commit -m "feat(usage): renderer usage state, UsageWatcher reconciler, subscription"
```

---

## Task 5: UI — chip % + popover usage section

**Files:**
- Modify: `src/renderer/components/WorkspaceView.tsx`

Verified by build + the Task 6 e2e. Keep `data-testid`s exact.

- [ ] **Step 1: Read usage + define a token formatter in `WorkspaceView`**

Add a `usage` selector next to the existing `aiSessions` selector:

```tsx
  const usages = useStore(s => s.usage)
```

Add a module-scope token formatter (above the `WorkspaceView` function, near the imports):

```tsx
/** Compact token count: 999 -> "999", 1234 -> "1.2k", 156000 -> "156k". */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
}
```

- [ ] **Step 2: Append the context % to the chip headline**

In `renderTile`, find the `chipText` computation (post-E it is):

```tsx
        const aiSession = aiSessions[paneId]
        const chipText = aiSession ? `✨ ${aiSession.label}`
          : procInfo && procInfo.foreground ? `▶ ${procInfo.foreground}` : shellLabel
```

Replace it with a version that appends the context % when usage is present:

```tsx
        const aiSession = aiSessions[paneId]
        const usage = usages[paneId]
        const chipText = aiSession ? `✨ ${aiSession.label}${usage ? ` ${usage.contextPct}%` : ''}`
          : procInfo && procInfo.foreground ? `▶ ${procInfo.foreground}` : shellLabel
```

- [ ] **Step 3: Add the usage section to the proc popover**

In the `procsMenuFor === paneId` popover (the `proc-menu` div), add a usage section as the FIRST child (before the `No child processes.` / tree rows). READ the current popover block first; insert right after the opening `<div data-testid="proc-menu" ...>`:

```tsx
                  {usage && (
                    <div data-testid={`usage-${paneId}`}
                      style={{ borderBottom: '1px solid #444', paddingBottom: 4, marginBottom: 4 }}>
                      <div>context {fmtTokens(usage.contextTokens)} / {fmtTokens(usage.contextWindow)} · {usage.contextPct}%</div>
                      <div style={{ opacity: 0.7 }}>
                        in {fmtTokens(usage.input)} · out {fmtTokens(usage.output)} · cache r {fmtTokens(usage.cacheRead)} / w {fmtTokens(usage.cacheCreation)}
                      </div>
                    </div>
                  )}
```

(The `usage` const from Step 2 is in scope within `renderTile`. Leave the existing process-tree rows unchanged after this section.)

- [ ] **Step 4: Build to typecheck**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/WorkspaceView.tsx
git commit -m "feat(usage): chip context-% headline + token breakdown in popover"
```

---

## Task 6: End-to-end test + full verification

**Files:**
- Create: `tests/e2e/usage.spec.ts`

Hermetic, mirrors `tests/e2e/cwd.spec.ts` (launch flags, `killTree`) + the E `claude.cmd` stub. It points `TERMHALLA_CLAUDE_HOME` at a temp dir, `cd`s a terminal to a temp cwd, reads back the cwd Termhalla actually reports (so the seeded transcript dir matches the app's encoding exactly), seeds a transcript with known token totals, runs the stub `claude.cmd` so the session is detected, and asserts the chip % + popover breakdown. READ `tests/e2e/cwd.spec.ts` and `tests/e2e/ai-session.spec.ts` first.

- [ ] **Step 1: Write `tests/e2e/usage.spec.ts`**

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
function encodeProjectDir(cwd: string): string { return cwd.replace(/[^a-zA-Z0-9]/g, '-') }

test('shows Claude context % on the chip and token breakdown in the popover', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-usage-'))
  const claudeHome = join(mkdtempSync(join(tmpdir(), 'termh-claudehome-')), '.claude')
  mkdirSync(join(claudeHome, 'projects'), { recursive: true })
  const projDir = mkdtempSync(join(tmpdir(), 'termh-usageproj-'))

  // E stub: a claude.cmd that stays busy then waits, so the session is detected + stays active.
  const stubDir = mkdtempSync(join(tmpdir(), 'termh-usagestub-'))
  const stub = join(stubDir, 'claude.cmd')
  writeFileSync(stub, '@echo off\r\necho claude\r\nping -n 8 127.0.0.1 >nul\r\nset /p x=\r\n', 'utf8')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
    env: { ...process.env, TERMHALLA_CLAUDE_HOME: claudeHome }
  })
  const win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // cd into the temp project dir; wait for Termhalla to report that cwd on the tile.
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`Set-Location '${projDir}'`)
  await win.keyboard.press('Enter')
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${csspath(projDir)}"]`)).toHaveCount(1, { timeout: 15_000 })

  // Seed the transcript under the dir the app derives from the reported cwd (encode exactly).
  const reported = await win.locator('[data-testid^="tile-"]').first().getAttribute('data-cwd')
  const sessionDir = join(claudeHome, 'projects', encodeProjectDir(reported!))
  mkdirSync(sessionDir, { recursive: true })
  const transcript = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4', usage: { input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0 } } })
  ].join('\n')
  writeFileSync(join(sessionDir, 'sess.jsonl'), transcript, 'utf8')

  // Run the stub -> detected as a Claude session -> usage watch resolves the transcript.
  await win.keyboard.type(`& '${stub}'`)
  await win.keyboard.press('Enter')

  // Chip shows the context % (last turn: 120 + 150000 = 150120 / 200000 = 75%).
  await expect(win.locator('[data-testid^="proc-chip-"]').first()).toContainText('75%', { timeout: 25_000 })

  // Popover shows the token breakdown (input total 220).
  await win.locator('[data-testid^="proc-chip-"]').first().click()
  await expect(win.locator('[data-testid^="usage-"]').first()).toBeVisible()
  await expect(win.locator('[data-testid^="usage-"]').first()).toContainText('220')

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 2: Build so e2e runs against fresh `out/`**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 3: Run the new e2e**

Run: `npm run e2e -- usage`
Expected: PASS — chip shows `75%`, popover shows the `220` input total. Run twice to confirm stability.

If detection is flaky (the stub goes quiet before C's busy poll samples it), lengthen the busy phase (raise `ping -n 8` higher) — do NOT weaken the assertions. If the reported cwd differs in casing/short-path form from `projDir`, the `getAttribute('data-cwd')` readback (used to build `sessionDir`) already handles it — the seed uses the app's actual cwd string. If `[data-testid^="proc-chip-"]` strict-mode-matches multiple elements, `.first()` is already used.

- [ ] **Step 4: Full regression gate**

Run: `npm test && npm run e2e`
Expected: PASS — all vitest suites and ALL Playwright specs (smoke, persistence, editor, explorer, status, cwd, ssh-quick, procs, cloud, ai-session, usage) green. The full e2e runs serially (`workers: 1`). If ANY spec fails, STOP and report it (do NOT dismiss as pre-existing — prior sub-projects' e2e verification caught real regressions this way).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/usage.spec.ts
git commit -m "test(usage): e2e for Claude context-% chip + token-breakdown popover"
```

---

## Self-Review

**1. Spec coverage:**
- §3 architecture (UsageTracker resolve→watch→debounced reparse→emit; renderer reconciles from aiSessions+cwds) → Task 2 (tracker) + Task 3 (IPC/wiring) + Task 4 (UsageWatcher). ✓
- §4 pure core (encodeProjectDir, pickNewestTranscript, parseClaudeUsage, windowFor) → Task 1. ✓
- §5 types `UsageMetrics`, channels, `TERMHALLA_CLAUDE_HOME` → Task 1 (type) + Task 3 (channels) + Task 2 (env default in tracker ctor). ✓
- §6 renderer wiring (UsageWatcher ref-reconcile claude+cwd; store usage/setUsage; closePane cleanup; App subscription) → Task 4. ✓
- §7 chip `✨ <label> <pct>%` + popover usage section (token breakdown + context line) → Task 5. ✓
- §8 error handling (no transcript→null; malformed-line skip; guarded fs; debounced single reparse) → Task 1 (parse skips bad lines) + Task 2 (resolve/read guarded, debounce, stop). ✓
- §9 unit (encode/pick/window/parse) + e2e (seeded transcript + stub claude → chip %/popover) → Task 1 + Task 6. ✓
- §10 non-goals respected (Claude only, no cost/model/aggregate, whole-file reparse). ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. Task 6 Step 3's contingencies (lengthen busy phase / `.first()`) are explicit bounded fallbacks.

**3. Type consistency:** `UsageMetrics {input,output,cacheRead,cacheCreation,contextTokens,contextWindow,contextPct}` is defined once (Task 1) and consumed identically in `parseClaudeUsage` (Task 1), `UsageTracker.onMetrics` (Task 2), the channel/preload (`UsageMetrics | null`, Task 3), the store `usage`/`setUsage` (Task 4), and the chip/popover (`usage.contextPct`/`.input`/etc., Task 5). `encodeProjectDir`/`pickNewestTranscript` (Task 1) are used by `UsageTracker.resolveTranscript` (Task 2). Channels `usageWatch`/`usageUnwatch`/`usageMetrics` and API `usageWatch`/`usageUnwatch`/`onUsageMetrics` align across contract/preload/register/App/UsageWatcher. The e2e's `encodeProjectDir` replicates Task 1's exact rule.
