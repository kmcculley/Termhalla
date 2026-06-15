# Claude Code / Codex Session Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize when a terminal is running Claude Code / Codex and surface it as a first-class AI session — a `✨ <tool>` pane chip, a workspace-tab indicator, a working/awaiting-input state, and an "is waiting for you" notification.

**Architecture:** A main-process `AiSessionTracker` SETS a per-terminal active tool from sub-project C's process-tree emissions (via a pure `classifyAiSession`) and CLEARS it on the shell command-done signal (OSC 133 D marker, exposed by a new `StatusEngine.onCommandDone` callback) or pane close. It emits `ai:session` to the renderer, which shows the chip/tab indicator and derives working/awaiting from the existing status. No new polling.

**Tech Stack:** Electron + TypeScript (strict), React, zustand, vitest, @playwright/test (Electron). Path alias `@shared/*` → `src/shared/*`.

**Spec:** `docs/superpowers/specs/2026-06-14-termhalla-ai-session-awareness-design.md`

---

## File Structure

**New files:**
- `src/main/ai/classify-ai.ts` — `AiToolPattern`, `AI_TOOLS`, pure `classifyAiSession(tree)`.
- `src/main/ai/ai-session-tracker.ts` — `AiSessionTracker` (set/clear/emit, pure event logic).
- `tests/main/classify-ai.test.ts`, `tests/main/ai-session-tracker.test.ts`, `tests/e2e/ai-session.spec.ts`.

**Modified files:**
- `src/shared/types.ts` — `AiSession`.
- `src/main/status/status-engine.ts` — `onCommandDone` callback (fired on OSC 133 D + pty exit).
- `tests/main/status-engine.test.ts` — a test for `onCommandDone`.
- `src/shared/ipc-contract.ts` — `ai:session` channel + `onAiSession`.
- `src/preload/index.ts` — expose `onAiSession`.
- `src/main/ipc/register.ts` — construct + wire `AiSessionTracker`.
- `src/renderer/store.ts` — `aiSessions` state, `setAiSession`, `aiState` helper, `closePane` cleanup, AI-aware notification.
- `src/renderer/App.tsx` — subscribe to `ai:session`.
- `src/renderer/components/WorkspaceView.tsx` — `✨ <label>` chip.
- `src/renderer/components/WorkspaceTabs.tsx` — tab AI indicator.

---

## Task 1: Pure AI-session classifier

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/ai/classify-ai.ts`
- Test: `tests/main/classify-ai.test.ts`

- [ ] **Step 1: Add `AiSession` to `src/shared/types.ts`**

Append after the `ProcInfo` interface (before `CloudState`/`SCHEMA_VERSION`):

```ts
/** A detected AI coding-agent session running in a terminal. */
export interface AiSession {
  tool: string    // 'claude' | 'codex'
  label: string   // 'Claude' | 'Codex'
}
```

- [ ] **Step 2: Write the failing test `tests/main/classify-ai.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { classifyAiSession } from '../../src/main/ai/classify-ai'
import type { ProcNode } from '@shared/types'

const node = (command: string, name = 'node'): ProcNode => ({ pid: 1, ppid: 0, name, command, depth: 0 })

describe('classifyAiSession', () => {
  it('matches a node invocation of the claude-code CLI', () => {
    const tree = [node('node C:\\Users\\k\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js')]
    expect(classifyAiSession(tree)).toEqual({ tool: 'claude', label: 'Claude' })
  })
  it('matches a claude.cmd shim by name/command', () => {
    expect(classifyAiSession([node('C:\\Windows\\system32\\cmd.exe /c "C:\\tools\\claude.cmd"', 'cmd.exe')]))
      .toEqual({ tool: 'claude', label: 'Claude' })
  })
  it('matches a bare claude program', () => {
    expect(classifyAiSession([node('claude --resume', 'claude')])).toEqual({ tool: 'claude', label: 'Claude' })
  })
  it('matches codex', () => {
    expect(classifyAiSession([node('node /usr/lib/node_modules/@openai/codex/bin.js')]))
      .toEqual({ tool: 'codex', label: 'Codex' })
  })
  it('does NOT match a claude.md file argument (false-positive guard)', () => {
    expect(classifyAiSession([node('vim claude.md', 'vim')])).toBeNull()
    expect(classifyAiSession([node('node build.js --out claudeesque.md')])).toBeNull()
  })
  it('finds the tool anywhere in the tree', () => {
    const tree = [node('pwsh', 'pwsh'), node('claude.cmd', 'claude.cmd'), node('rg foo', 'rg')]
    expect(classifyAiSession(tree)?.tool).toBe('claude')
  })
  it('returns null for an ordinary tree', () => {
    expect(classifyAiSession([node('npm run dev'), node('node vite.js')])).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- classify-ai`
Expected: FAIL — `Cannot find module '../../src/main/ai/classify-ai'`.

- [ ] **Step 4: Create `src/main/ai/classify-ai.ts`**

```ts
import type { AiSession, ProcNode } from '@shared/types'

export interface AiToolPattern { tool: string; label: string; re: RegExp }

/** Patterns are anchored on path/word boundaries and only accept EXECUTABLE extensions
 *  (.exe/.cmd/.bat/.ps1) so a doc argument like `claude.md` is NOT a false positive,
 *  while `claude`, `claude.cmd`, the `claude-code` package, and `@anthropic-ai/claude` all match. */
export const AI_TOOLS: AiToolPattern[] = [
  { tool: 'claude', label: 'Claude',
    re: /(^|[\\/\s"])claude(\.(?:exe|cmd|bat|ps1))?($|[\s"])|claude-code|@anthropic-ai[\\/]claude/i },
  { tool: 'codex', label: 'Codex',
    re: /(^|[\\/\s"])codex(\.(?:exe|cmd|bat|ps1))?($|[\s"])|@openai[\\/]codex/i }
]

/** Detect a Claude/Codex session anywhere in a terminal's descendant process tree, or null. */
export function classifyAiSession(tree: ProcNode[]): AiSession | null {
  for (const t of AI_TOOLS) {
    for (const n of tree) {
      if (t.re.test(n.command) || t.re.test(n.name)) return { tool: t.tool, label: t.label }
    }
  }
  return null
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- classify-ai`
Expected: PASS (all cases, incl. the `claude.md` non-match).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/ai/classify-ai.ts tests/main/classify-ai.test.ts
git commit -m "feat(ai): pure Claude/Codex session classifier"
```

---

## Task 2: AiSessionTracker

**Files:**
- Create: `src/main/ai/ai-session-tracker.ts`
- Test: `tests/main/ai-session-tracker.test.ts`

- [ ] **Step 1: Write the failing test `tests/main/ai-session-tracker.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { AiSessionTracker } from '../../src/main/ai/ai-session-tracker'
import type { ProcInfo } from '@shared/types'

const claudeInfo: ProcInfo = {
  foreground: 'node',
  tree: [{ pid: 2, ppid: 1, name: 'node', command: 'node ...\\claude-code\\cli.js', depth: 0 }]
}
const plainInfo: ProcInfo = {
  foreground: 'node', tree: [{ pid: 2, ppid: 1, name: 'node', command: 'npm run dev', depth: 0 }]
}

describe('AiSessionTracker', () => {
  it('sets an AI session when claude is detected, and dedups', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.onProcs('a', claudeInfo)
    t.onProcs('a', claudeInfo)   // same -> no second emit
    expect(onAi).toHaveBeenCalledTimes(1)
    expect(onAi).toHaveBeenCalledWith('a', { tool: 'claude', label: 'Claude' })
  })

  it('does not set or clear on a non-AI snapshot or a null (idle) snapshot', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.onProcs('a', plainInfo)
    t.onProcs('a', null)
    expect(onAi).not.toHaveBeenCalled()
  })

  it('persists through a busy->idle (null) sequence and clears only on command-done', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.onProcs('a', claudeInfo)   // set
    t.onProcs('a', null)         // idle clear from C -> must NOT clear the AI flag
    expect(onAi).toHaveBeenCalledTimes(1)
    t.commandDone('a')           // shell command (claude) ended -> clear
    expect(onAi).toHaveBeenCalledTimes(2)
    expect(onAi).toHaveBeenLastCalledWith('a', null)
  })

  it('clears on unregister', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.onProcs('a', claudeInfo)
    t.unregister('a')
    expect(onAi).toHaveBeenLastCalledWith('a', null)
  })

  it('commandDone/unregister on an unknown id is a no-op', () => {
    const onAi = vi.fn()
    const t = new AiSessionTracker(onAi)
    t.commandDone('x'); t.unregister('x')
    expect(onAi).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ai-session-tracker`
Expected: FAIL — `Cannot find module '../../src/main/ai/ai-session-tracker'`.

- [ ] **Step 3: Create `src/main/ai/ai-session-tracker.ts`**

```ts
import type { AiSession, ProcInfo } from '@shared/types'
import { classifyAiSession } from './classify-ai'

type OnAi = (id: string, ai: AiSession | null) => void

/** Tracks active Claude/Codex sessions per terminal. SET from sub-project C's process info
 *  (sticky — persists across busy->idle); CLEARED on the shell command-done marker or close. */
export class AiSessionTracker {
  private active = new Map<string, AiSession>()

  constructor(private readonly onAi: OnAi) {}

  /** Feed from ProcessTracker. Only SETS (never clears); clearing is command-done driven. */
  onProcs(id: string, info: ProcInfo | null): void {
    if (!info) return
    const ai = classifyAiSession(info.tree)
    if (!ai) return
    const cur = this.active.get(id)
    if (!cur || cur.tool !== ai.tool) {
      this.active.set(id, ai)
      this.onAi(id, ai)
    }
  }

  /** The foreground shell command completed (OSC 133 D / pty exit) -> the session ended. */
  commandDone(id: string): void {
    if (this.active.delete(id)) this.onAi(id, null)
  }

  unregister(id: string): void {
    if (this.active.delete(id)) this.onAi(id, null)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- ai-session-tracker`
Expected: PASS (5 cases green).

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/ai-session-tracker.ts tests/main/ai-session-tracker.test.ts
git commit -m "feat(ai): AiSessionTracker (sticky set, command-done clear)"
```

---

## Task 3: StatusEngine command-done callback

**Files:**
- Modify: `src/main/status/status-engine.ts`
- Test: `tests/main/status-engine.test.ts`

- [ ] **Step 1: Add a failing test to `tests/main/status-engine.test.ts`**

Append this test (inside the existing top-level `describe`, or as a new `describe` block — match the file's structure):

```ts
import { describe, it, expect, vi } from 'vitest'
import { StatusEngine } from '../../src/main/status/status-engine'

describe('StatusEngine.onCommandDone', () => {
  it('fires on an OSC 133 D marker and on markExit', () => {
    const done = vi.fn()
    const engine = new StatusEngine(() => {}, () => {}, () => 1000, done)
    engine.register('a')
    engine.feed('a', 'some output')
    expect(done).not.toHaveBeenCalled()
    engine.feed('a', '\x1b]133;D;0\x07')   // command finished
    expect(done).toHaveBeenCalledWith('a')
    done.mockClear()
    engine.markExit('a', 0)
    expect(done).toHaveBeenCalledWith('a')
    engine.dispose()
  })
})
```

(If the file already imports `describe/it/expect/vi` at the top, don't re-import — just add the `describe` block and reuse the existing imports.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- status-engine`
Expected: FAIL — `onCommandDone` is not a constructor param / not fired.

- [ ] **Step 3: Add the `onCommandDone` param + fire it in `src/main/status/status-engine.ts`**

Change the constructor (add a 4th optional param, defaulting to a no-op so existing 3-arg callers are unaffected):

```ts
  constructor(
    private readonly onStatus: (id: string, status: TerminalStatus) => void,
    private readonly onCwd: (id: string, cwd: string) => void,
    private readonly now: () => number = () => Date.now(),
    private readonly onCommandDone: (id: string) => void = () => {}
  ) {}
```

Update `feed` to fire `onCommandDone` when a D marker is seen:

```ts
  feed(id: string, data: string): void {
    const s = this.sessions.get(id); if (!s) return
    const t = this.now()
    let done = false
    for (const m of s.parser.push(data)) {
      s.tracker.onMarker(m.kind, m.exit, t)
      if (m.kind === 'D') done = true
    }
    s.tracker.onOutput(data, t)
    const cwd = s.cwdParser.push(data)
    if (cwd && cwd !== s.lastCwd) { s.lastCwd = cwd; this.onCwd(id, cwd) }
    this.emit(id)
    if (done) this.onCommandDone(id)
  }
```

Update `markExit` to also fire it (the pty exited → the foreground command ended):

```ts
  markExit(id: string, code: number): void {
    const s = this.sessions.get(id); if (!s) return
    const t = this.now()
    s.tracker.onMarker('D', code, t)
    s.tracker.onMarker('A', undefined, t)
    this.emit(id)
    this.onCommandDone(id)
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- status-engine`
Expected: PASS — the new `onCommandDone` test plus the existing status-engine tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/status/status-engine.ts tests/main/status-engine.test.ts
git commit -m "feat(ai): StatusEngine.onCommandDone fired on OSC 133 D + pty exit"
```

---

## Task 4: IPC channel + main wiring

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/register.ts`

- [ ] **Step 1: Add the channel + API method to `src/shared/ipc-contract.ts`**

Add `AiSession` to the type import on line 1 (append to the existing `from './types'` list):

```ts
import type { ShellInfo, Workspace, AppState, TerminalStatus, DirEntry, ReadResult, StatResult, FsChange, TerminalLaunch, QuickStore, ProcInfo, CloudStatus, AiSession } from './types'
```

Add a channel to the `CH` object (after `cloudRefresh: 'cloud:refresh'` — add a comma after it):

```ts
  cloudRefresh: 'cloud:refresh',
  aiSession: 'ai:session'   // main -> renderer event
} as const
```

Add the method to the `TermhallaApi` interface (after `cloudRefresh(): Promise<void>`):

```ts
  onAiSession(cb: (id: string, ai: AiSession | null) => void): () => void
```

- [ ] **Step 2: Expose it in `src/preload/index.ts`**

Add to the `api` object (after the `onCloudStatus`/`cloudRefresh` block):

```ts
  onAiSession: (cb) => {
    const h = (_e: unknown, id: string, ai: import('@shared/types').AiSession | null) => cb(id, ai)
    ipcRenderer.on(CH.aiSession, h as never)
    return () => ipcRenderer.removeListener(CH.aiSession, h as never)
  },
```

- [ ] **Step 3: Wire `AiSessionTracker` in `src/main/ipc/register.ts`**

Add the import near the other main imports:

```ts
import { AiSessionTracker } from '../ai/ai-session-tracker'
```

Replace the engine + pty + tracker construction block so it forward-declares `ai`, wires `onCommandDone` into the engine, feeds the AI tracker from the process tracker, and constructs the AI tracker. The current block is:

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

Replace it with:

```ts
  let tracker: ProcessTracker | undefined
  let ai: AiSessionTracker | undefined
  const engine = new StatusEngine(
    (id, status) => { safeSend(CH.ptyStatus, id, status); tracker?.setBusy(id, status.state === 'busy') },
    (id, cwd) => safeSend(CH.ptyCwd, id, cwd),
    undefined,
    (id) => ai?.commandDone(id)
  )
  const pty = new PtyManager(
    (id, data) => safeSend(CH.ptyData, id, data),
    (id, code) => { safeSend(CH.ptyExit, id, code); tracker?.unregister(id); ai?.unregister(id) },
    engine, scriptDir
  )
  tracker = new ProcessTracker(
    (id) => pty.pidOf(id),
    (id, info) => { safeSend(CH.ptyProcs, id, info); ai?.onProcs(id, info) }
  )
  ai = new AiSessionTracker((id, session) => safeSend(CH.aiSession, id, session))
```

Then add `ai` cleanup to the `ptyKill` handler — change it from:

```ts
  ipcMain.on(CH.ptyKill, (_e, id: string) => { pty.kill(id); tracker!.unregister(id) })
```

to:

```ts
  ipcMain.on(CH.ptyKill, (_e, id: string) => { pty.kill(id); tracker!.unregister(id); ai!.unregister(id) })
```

- [ ] **Step 4: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — bundles typecheck; new ai suites + status-engine test green; no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/register.ts
git commit -m "feat(ai): ai:session IPC + AiSessionTracker wiring (procs feed, command-done clear)"
```

---

## Task 5: Renderer store (aiSessions, aiState, notification)

**Files:**
- Modify: `src/renderer/store.ts`
- Modify: `src/renderer/App.tsx`

No unit test (store/App depend on the Electron `api`); verified by build + the Task 7 e2e.

- [ ] **Step 1: Extend imports + the `State` interface in `src/renderer/store.ts`**

Add `AiSession` to the existing `@shared/types` type import. In the `State` interface, after the `procs`/`setProcs` members add:

```ts
  aiSessions: Record<string, AiSession>
  setAiSession: (id: string, ai: AiSession | null) => void
```

- [ ] **Step 2: Add the `aiState` pure helper near the other exported helpers**

Near the top-level `paneCwd` export (outside the store), add:

```ts
/** Display state for an AI session pane: 'working' when busy, 'awaiting' when quiet, null if not an AI session. */
export function aiState(
  s: { aiSessions: Record<string, AiSession>; statuses: Record<string, TerminalStatus> },
  paneId: string
): 'working' | 'awaiting' | null {
  if (!s.aiSessions[paneId]) return null
  return s.statuses[paneId]?.state === 'busy' ? 'working' : 'awaiting'
}
```

- [ ] **Step 3: Add the initial value + `setAiSession` action**

Add the initial value next to `procs: {}`:

```ts
    aiSessions: {},
```

Add the action (near `setProcs`):

```ts
    setAiSession: (id, ai) => set(s => {
      const aiSessions = { ...s.aiSessions }
      if (ai) aiSessions[id] = ai
      else delete aiSessions[id]
      return { aiSessions }
    }),
```

- [ ] **Step 4: Clean up `aiSessions` in `closePane`**

In the existing `closePane` action's `set(s => { ... })`, add the `aiSessions` deletion alongside the others:

```ts
    closePane: (wsId, paneId) => {
      const ws = removePane(get().workspaces[wsId], paneId)
      set(s => {
        const statuses = { ...s.statuses }; delete statuses[paneId]
        const cwds = { ...s.cwds }; delete cwds[paneId]
        const procs = { ...s.procs }; delete procs[paneId]
        const aiSessions = { ...s.aiSessions }; delete aiSessions[paneId]
        return { workspaces: { ...s.workspaces, [wsId]: ws }, statuses, cwds, procs, aiSessions }
      })
      api.ptyKill(paneId)
      scheduleAutosave()
    },
```

- [ ] **Step 5: AI-aware notification in `setStatus`**

Replace the `setStatus` action's notification block. The current action ends with:

```ts
      set(s => ({ statuses: { ...s.statuses, [id]: eff } }))
      if (status.state === 'needs-input' && prev?.state !== 'needs-input'
          && alerts.needsInput && alerts.osNotification
          && typeof document !== 'undefined' && !document.hasFocus()) {
        api.notify({ title: 'Terminal needs input', body: termCfg?.name ?? 'A terminal is waiting for input' })
      }
    },
```

Replace from `set(s => ({ statuses... ` through the end of the action with:

```ts
      set(s => ({ statuses: { ...s.statuses, [id]: eff } }))
      const ai = get().aiSessions[id]
      const unfocused = typeof document !== 'undefined' && !document.hasFocus()
      if (ai) {
        // AI session: notify when it flips from working (busy) to awaiting (quiet).
        if (prev?.state === 'busy' && status.state !== 'busy'
            && alerts.needsInput && alerts.osNotification && unfocused) {
          api.notify({ title: `${ai.label} is waiting for you`, body: termCfg?.name ?? `${ai.label} needs your input` })
        }
      } else if (status.state === 'needs-input' && prev?.state !== 'needs-input'
          && alerts.needsInput && alerts.osNotification && unfocused) {
        api.notify({ title: 'Terminal needs input', body: termCfg?.name ?? 'A terminal is waiting for input' })
      }
    },
```

- [ ] **Step 6: Subscribe to `ai:session` in `src/renderer/App.tsx`**

Add an effect next to the existing `onCloudStatus` effect:

```tsx
  useEffect(() => {
    const off = api.onAiSession((id, ai) => useStore.getState().setAiSession(id, ai))
    return off
  }, [])
```

- [ ] **Step 7: Build + full unit suite**

Run: `npm run build && npm test`
Expected: SUCCESS / PASS — no TypeScript errors; no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/store.ts src/renderer/App.tsx
git commit -m "feat(ai): renderer aiSessions state, aiState helper, awaiting notification"
```

---

## Task 6: UI — pane chip + tab indicator

**Files:**
- Modify: `src/renderer/components/WorkspaceView.tsx`
- Modify: `src/renderer/components/WorkspaceTabs.tsx`

Verified by build + the Task 7 e2e. Keep the `data-testid`s exact.

- [ ] **Step 1: Show `✨ <label>` on the pane chip in `src/renderer/components/WorkspaceView.tsx`**

Add `aiSessions` to the store selectors (next to `procs`/`shells`):

```tsx
  const aiSessions = useStore(s => s.aiSessions)
```

In `renderTile`, where `chipText` is computed (currently:
`const chipText = procInfo && procInfo.foreground ? \`▶ ${procInfo.foreground}\` : shellLabel`),
replace that line with an AI-aware version:

```tsx
        const aiSession = aiSessions[paneId]
        const chipText = aiSession ? `✨ ${aiSession.label}`
          : procInfo && procInfo.foreground ? `▶ ${procInfo.foreground}` : shellLabel
```

(The chip already toggles the process popover on click — leave that behavior unchanged; for an AI session the popover still shows the underlying process tree, which is useful.)

- [ ] **Step 2: Build to typecheck the chip**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 3: Add the tab AI indicator in `src/renderer/components/WorkspaceTabs.tsx`**

Replace the `tabBadge` function and its call site so the badge also reflects AI sessions. New `tabBadge`:

```tsx
function tabBadge(
  ws: Workspace,
  statuses: Record<string, { state: string }>,
  aiSessions: Record<string, unknown>
): string {
  let needs = 0, busy = false, ai = false, aiAwaiting = false
  for (const paneId of Object.keys(ws.panes)) {
    const cfg = ws.panes[paneId].config
    if (cfg.kind !== 'terminal') continue
    if (aiSessions[paneId]) {
      ai = true
      if (statuses[paneId]?.state !== 'busy') aiAwaiting = true
    }
    if (!resolveAlerts(cfg.alerts).tabBadge) continue
    const st = statuses[paneId]?.state
    if (st === 'needs-input') needs++
    else if (st === 'busy') busy = true
  }
  const aiPart = ai ? (aiAwaiting ? ' ✨⏳' : ' ✨') : ''
  if (needs > 0) return `${aiPart} 🔔${needs}`
  if (busy) return `${aiPart} •`
  return aiPart
}
```

Pull `aiSessions` from the store in `WorkspaceTabs` (add it to the destructured `useStore()` call):

```tsx
  const {
    order, workspaces, activeId, setActive, newWorkspace,
    saveAll, shells, newTerminalShellId, setNewTerminalShell, statuses,
    addTerminal, addEditor, addExplorer, aiSessions
  } = useStore()
```

And update the call site in the tab button:

```tsx
          {workspaces[id].name}{tabBadge(workspaces[id], statuses, aiSessions)}
```

- [ ] **Step 4: Build to typecheck**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/WorkspaceView.tsx src/renderer/components/WorkspaceTabs.tsx
git commit -m "feat(ai): pane chip (✨ Claude) + workspace-tab AI indicator"
```

---

## Task 7: End-to-end test + full verification

**Files:**
- Create: `tests/e2e/ai-session.spec.ts`

Hermetic, mirrors `tests/e2e/cwd.spec.ts` (launch flags, `killTree`). The test seeds a stub program named `claude.cmd` (so the process tree contains `claude.cmd` → detection), runs it in a PowerShell terminal, asserts the chip + tab indicator appear, then satisfies the stub's input read so it exits → asserts the indicator clears (command-done). READ `tests/e2e/cwd.spec.ts` first.

- [ ] **Step 1: Write `tests/e2e/ai-session.spec.ts`**

```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('detects a Claude session and clears it when the command ends', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-ai-'))
  const stubDir = mkdtempSync(join(tmpdir(), 'termh-aistub-'))
  // A "claude.cmd" that prints output for a couple seconds (stays busy long enough to be
  // detected by C's busy-gated poll) then waits on a line of input, then exits.
  const stub = join(stubDir, 'claude.cmd')
  writeFileSync(stub,
    '@echo off\r\n' +
    'echo Claude Code starting\r\n' +
    'ping -n 3 127.0.0.1 >nul\r\n' +
    'echo Claude Code ready\r\n' +
    'set /p x=\r\n', 'utf8')

  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Run the stub -> its process tree contains "claude.cmd" -> detected as a Claude session.
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`& '${stub}'`)
  await win.keyboard.press('Enter')

  // The pane chip shows the AI session, and the tab shows the ✨ indicator.
  await expect(win.locator('[data-testid^="proc-chip-"]')).toContainText('Claude', { timeout: 25_000 })
  await expect(win.locator('[data-testid^="tab-"]').first()).toContainText('✨', { timeout: 5_000 })

  // Satisfy the stub's `set /p` read so it exits -> command-done -> the AI indicator clears.
  await win.keyboard.type('done')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-testid^="proc-chip-"]')).not.toContainText('Claude', { timeout: 20_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); if (pid) killTree(pid)
})
```

- [ ] **Step 2: Build so e2e runs against fresh `out/`**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 3: Run the new e2e**

Run: `npm run e2e -- ai-session`
Expected: PASS — chip shows `✨ Claude` and the tab shows `✨` while the stub runs; after the stub exits, the chip no longer shows `Claude`. Run twice to confirm stability.

If detection is flaky because the stub goes quiet before C's busy poll samples it, lengthen the busy phase (increase the `ping -n` count from 3 to e.g. 5) — do NOT weaken the chip/tab assertions. If `[data-testid^="proc-chip-"]` strict-mode-matches multiple elements, scope with `.first()`.

- [ ] **Step 4: Full regression gate**

Run: `npm test && npm run e2e`
Expected: PASS — all vitest suites and all Playwright specs (smoke, persistence, editor, explorer, status, cwd, ssh-quick, procs, cloud, ai-session) green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ai-session.spec.ts
git commit -m "test(ai): e2e for Claude session detect + command-done clear"
```

---

## Self-Review

**1. Spec coverage:**
- §3 architecture (AiSessionTracker set-from-procs / clear-on-command-done / unregister; emits ai:session; pure) → Task 2 (tracker) + Task 3 (StatusEngine onCommandDone) + Task 4 (wiring). ✓
- §4 working/awaiting reinterpretation (active+busy→working, active+!busy→awaiting; clear on D not idle) → Task 5 (`aiState` helper) + Task 3 (D-marker clear, not idle). ✓
- §5 detection (pure classifier; claude/codex; exec-extension guard vs claude.md; tree scan) → Task 1 (`classifyAiSession`, `AI_TOOLS`). ✓
- §6 types `AiSession`, `ai:session` channel, `onCommandDone`, runtime-only → Task 1 (type) + Task 4 (channel/preload) + Task 3 (callback). ✓
- §7 chip `✨ <label>`, tab `✨`/`✨⏳`, awaiting notification, store `aiSessions`/`setAiSession`/`aiState`, closePane cleanup, App subscription → Task 5 + Task 6. ✓
- §8 unit (classifier, tracker) + e2e (stub claude detect + clear) → Task 1/2/3 tests + Task 7. ✓
- §9 non-goals respected (no deep state, no always-on polling, cmd-linger documented, read-only). ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. Task 7 Step 3's "lengthen busy phase / `.first()`" is an explicit, bounded contingency, not a placeholder.

**3. Type consistency:** `AiSession {tool,label}` is defined once (Task 1) and used identically in `classifyAiSession` (Task 1), `AiSessionTracker` (Task 2), the channel/preload (`AiSession | null`, Task 4), the store `aiSessions`/`setAiSession`/`aiState` (Task 5), and the chip/tab (`aiSession.label`, Task 6). `onCommandDone: (id: string) => void` matches between StatusEngine (Task 3) and register's `(id) => ai?.commandDone(id)` (Task 4). `AiSessionTracker` methods `onProcs`/`commandDone`/`unregister` match between the class (Task 2), its test (Task 2), and the wiring (Task 4). Channel `aiSession: 'ai:session'` and `onAiSession` align across contract/preload/App. `classifyAiSession(tree: ProcNode[])` consumes the `ProcInfo.tree` shape from sub-project C unchanged.
