# Saved Per-Pane Run Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named, persisted, run-on-click commands (Test/Build/Watch) for terminal panes at pane and workspace scope, run via the existing send-to-terminal path.

**Architecture:** A shared-types + renderer-store + UI feature with no new IPC. Commands persist on `TerminalConfig.runCommands` (pane) and `Workspace.runCommands` (workspace) in the workspace JSON. A `RunCommandsMenu` Modal (mirroring `ScheduleDialog`) lists and edits them; running one calls a thin `store.runCommand` that does `api.ptyWrite({ id, data: encodeBroadcast(command, 'keys', true) })`. Pure list helpers live in `src/shared/run-commands.ts`.

**Tech Stack:** TypeScript, React, zustand, vitest, Playwright-for-Electron.

## Global Constraints

- **Path alias:** import shared code as `@shared/...`.
- **TDD:** failing test first for the pure helpers (`run-commands.ts`); UI/persistence verified by the e2e. Plumbing verified by `npm run typecheck`.
- **`noUnusedLocals` / `noUnusedParameters` = true** (tsconfig.json).
- **Persistence is versioned:** `SCHEMA_VERSION` in `src/shared/types.ts` goes 4→5. Additive optional fields only; `migrate` is identity for `version <= SCHEMA_VERSION`, so no migration code is needed (a v4 workspace loads with `runCommands` undefined).
- **Send mode:** run commands are sent as `encodeBroadcast(command, 'keys', true)` — raw keystrokes + CR. No per-command mode toggle.
- **e2e is `workers: 1`; `npm run build` before `npm run e2e`.**
- **Reuse, don't reinvent:** sending reuses `encodeBroadcast` (`src/shared/broadcast.ts`) + `api.ptyWrite`; pane persistence reuses the existing `updatePaneConfig` store action; the dialog reuses the `Modal` component.

---

## Task 1: `RunCommand` type + pure list helpers

**Files:**
- Modify: `src/shared/types.ts` (add `RunCommand`; add `runCommands?` to `TerminalConfig` + `Workspace`; bump `SCHEMA_VERSION`)
- Create: `src/shared/run-commands.ts`
- Test: `tests/shared/run-commands.test.ts`

**Interfaces:**
- Produces: `RunCommand` interface; `MenuEntry` interface; `addRunCommand`, `updateRunCommand`, `removeRunCommand`, `mergeForMenu`.

- [ ] **Step 1: Add the types**

In `src/shared/types.ts`:

Add the `RunCommand` interface (place it near `ScheduledTask`):
```ts
/** A saved, named command a user can run on click in a terminal. Persisted (pane- or
 *  workspace-scoped). Runtime sending reuses encodeBroadcast(command, 'keys', true). */
export interface RunCommand {
  id: string
  label: string
  command: string
}
```

Add `runCommands?: RunCommand[]` to `TerminalConfig` (after `theme?`):
```ts
  runCommands?: RunCommand[]   // pane-scoped saved run commands
```

Add `runCommands?: RunCommand[]` to `Workspace` (after `theme?`):
```ts
  runCommands?: RunCommand[]   // workspace-scoped saved run commands (shown on every terminal)
```

Bump the schema version:
```ts
export const SCHEMA_VERSION = 5
```

- [ ] **Step 2: Write the failing test**

Create `tests/shared/run-commands.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { addRunCommand, updateRunCommand, removeRunCommand, mergeForMenu } from '../../src/shared/run-commands'
import type { RunCommand } from '../../src/shared/types'

const a: RunCommand = { id: 'a', label: 'Test', command: 'npm test' }
const b: RunCommand = { id: 'b', label: 'Build', command: 'npm run build' }

describe('addRunCommand', () => {
  it('appends immutably and treats undefined as empty', () => {
    const out = addRunCommand(undefined, a)
    expect(out).toEqual([a])
    const out2 = addRunCommand([a], b)
    expect(out2).toEqual([a, b])
    expect(out2).not.toBe(out)   // new array
  })
})

describe('updateRunCommand', () => {
  it('patches the matching id and leaves others', () => {
    const out = updateRunCommand([a, b], 'a', { label: 'Test!', command: 'npm t' })
    expect(out).toEqual([{ id: 'a', label: 'Test!', command: 'npm t' }, b])
  })
  it('no-ops for an unknown id', () => {
    expect(updateRunCommand([a], 'zzz', { label: 'x' })).toEqual([a])
  })
  it('treats undefined as empty', () => {
    expect(updateRunCommand(undefined, 'a', { label: 'x' })).toEqual([])
  })
})

describe('removeRunCommand', () => {
  it('filters by id; no-op on unknown', () => {
    expect(removeRunCommand([a, b], 'a')).toEqual([b])
    expect(removeRunCommand([a], 'zzz')).toEqual([a])
    expect(removeRunCommand(undefined, 'a')).toEqual([])
  })
})

describe('mergeForMenu', () => {
  it('returns workspace entries before pane entries, each tagged with scope', () => {
    const out = mergeForMenu([a], [b])
    expect(out).toEqual([
      { scope: 'workspace', cmd: a },
      { scope: 'pane', cmd: b }
    ])
  })
  it('handles either side undefined', () => {
    expect(mergeForMenu(undefined, [b])).toEqual([{ scope: 'pane', cmd: b }])
    expect(mergeForMenu([a], undefined)).toEqual([{ scope: 'workspace', cmd: a }])
    expect(mergeForMenu(undefined, undefined)).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/shared/run-commands.test.ts`
Expected: FAIL — cannot find module `run-commands`.

- [ ] **Step 4: Write the implementation**

Create `src/shared/run-commands.ts`:
```ts
import type { RunCommand } from './types'

export interface MenuEntry { scope: 'workspace' | 'pane'; cmd: RunCommand }

/** Append a command immutably. `undefined` is treated as an empty list. */
export function addRunCommand(list: RunCommand[] | undefined, cmd: RunCommand): RunCommand[] {
  return [...(list ?? []), cmd]
}

/** Patch the command with matching id (id itself is never changed). No-op for an unknown id. */
export function updateRunCommand(
  list: RunCommand[] | undefined,
  id: string,
  patch: Partial<Omit<RunCommand, 'id'>>
): RunCommand[] {
  return (list ?? []).map(c => (c.id === id ? { ...c, ...patch, id: c.id } : c))
}

/** Remove the command with matching id. No-op for an unknown id. */
export function removeRunCommand(list: RunCommand[] | undefined, id: string): RunCommand[] {
  return (list ?? []).filter(c => c.id !== id)
}

/** Workspace commands first, then pane commands, each tagged with its scope (for the run menu). */
export function mergeForMenu(
  ws: RunCommand[] | undefined,
  pane: RunCommand[] | undefined
): MenuEntry[] {
  return [
    ...(ws ?? []).map((cmd): MenuEntry => ({ scope: 'workspace', cmd })),
    ...(pane ?? []).map((cmd): MenuEntry => ({ scope: 'pane', cmd }))
  ]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/shared/run-commands.test.ts`
Expected: PASS (all groups).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/shared/types.ts src/shared/run-commands.ts tests/shared/run-commands.test.ts
git commit -m "feat(run): RunCommand type + pure list helpers, schema 4->5"
```

---

## Task 2: store slice — `setWorkspaceRunCommands` + `runCommand`

**Files:**
- Create: `src/renderer/store/run-commands-slice.ts`
- Modify: `src/renderer/store/types.ts` (add the two actions to `State`)
- Modify: `src/renderer/store.ts` (compose the slice)

**Interfaces:**
- Consumes: `RunCommand` (Task 1); `encodeBroadcast` (`@shared/broadcast`); existing `SliceDeps` (`set`, `get`, `scheduleAutosave`); existing `api.ptyWrite`.
- Produces:
  - `setWorkspaceRunCommands(wsId: string, runCommands: RunCommand[]): void`
  - `runCommand(paneId: string, command: string): void`

- [ ] **Step 1: Add the action types**

In `src/renderer/store/types.ts`:

Add `RunCommand` to the `@shared/types` import list:
```ts
  TerminalLaunch, AiSession, UsageMetrics, EditorDraft, ScheduledTask, Theme, EnvVaultState, GitStatus, RunCommand
```

Add to the `State` interface (near `schedules`/`addSchedule`):
```ts
  setWorkspaceRunCommands: (wsId: string, runCommands: RunCommand[]) => void
  runCommand: (paneId: string, command: string) => void
```

- [ ] **Step 2: Create the slice**

Create `src/renderer/store/run-commands-slice.ts`:
```ts
import { encodeBroadcast } from '@shared/broadcast'
import { api } from '../api'
import type { State, SliceDeps } from './types'

type RunCommandsSlice = Pick<State, 'setWorkspaceRunCommands' | 'runCommand'>

/** Saved run commands: workspace-scoped list persisted on the Workspace (pane-scoped list reuses
 *  updatePaneConfig), plus the send action that runs a command in a terminal — raw keystrokes + CR
 *  via the shared encodeBroadcast path (same plumbing as broadcast / scheduled commands). */
export function createRunCommandsSlice({ set, get, scheduleAutosave }: SliceDeps): RunCommandsSlice {
  return {
    setWorkspaceRunCommands: (wsId, runCommands) => {
      const ws = get().workspaces[wsId]
      if (!ws) return
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: { ...ws, runCommands } } }))
      scheduleAutosave()
    },

    runCommand: (paneId, command) => {
      api.ptyWrite({ id: paneId, data: encodeBroadcast(command, 'keys', true) })
    }
  }
}
```

- [ ] **Step 3: Compose the slice**

In `src/renderer/store.ts`:

Add the import (next to `createScheduleSlice`):
```ts
import { createRunCommandsSlice } from './store/run-commands-slice'
```

Add to the domain-slices block (after `...createScheduleSlice(deps),`):
```ts
    ...createRunCommandsSlice(deps),
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/renderer/store/run-commands-slice.ts src/renderer/store/types.ts src/renderer/store.ts
git commit -m "feat(run): store slice (workspace run commands + run action)"
```

---

## Task 3: `RunCommandsMenu` component + toolbar button

**Files:**
- Create: `src/renderer/components/RunCommandsMenu.tsx`
- Modify: `src/renderer/components/PaneTile.tsx` (extend `PaneMenu`, render the menu)
- Modify: `src/renderer/components/PaneToolbar.tsx` (add the `▷` button)

**Interfaces:**
- Consumes: `mergeForMenu`/`addRunCommand`/`updateRunCommand`/`removeRunCommand` (Task 1); `setWorkspaceRunCommands`/`runCommand` (Task 2); existing `updatePaneConfig`; `Modal` (`./Modal`); `useStore`; `uuid`.
- Produces: `RunCommandsMenu` component (`{ wsId, paneId, onClose }`); `PaneMenu` gains `'run'`.

- [ ] **Step 1: Create the component**

Create `src/renderer/components/RunCommandsMenu.tsx`:
```tsx
import { useState } from 'react'
import { v4 as uuid } from 'uuid'
import { useStore } from '../store'
import { addRunCommand, updateRunCommand, removeRunCommand, mergeForMenu } from '@shared/run-commands'
import type { RunCommand } from '@shared/types'
import { Modal } from './Modal'

type Scope = 'pane' | 'workspace'

/** Modal listing + editing a terminal's saved run commands (workspace- and pane-scoped) and
 *  running them. Sending reuses store.runCommand (encodeBroadcast keys+CR). Pane edits persist via
 *  updatePaneConfig; workspace edits via setWorkspaceRunCommands. */
export function RunCommandsMenu({ wsId, paneId, onClose }: { wsId: string; paneId: string; onClose: () => void }) {
  const ws = useStore(s => s.workspaces[wsId])
  const paneCfg = ws?.panes[paneId]?.config
  const paneCmds = paneCfg?.kind === 'terminal' ? paneCfg.runCommands : undefined
  const wsCmds = ws?.runCommands
  const updatePaneConfig = useStore(s => s.updatePaneConfig)
  const setWorkspaceRunCommands = useStore(s => s.setWorkspaceRunCommands)
  const runCommand = useStore(s => s.runCommand)

  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [scope, setScope] = useState<Scope>('pane')
  const [editId, setEditId] = useState<string | null>(null)

  const entries = mergeForMenu(wsCmds, paneCmds)

  // Persist a new list for the given scope.
  const persist = (s: Scope, next: RunCommand[]) => {
    if (s === 'pane') updatePaneConfig(wsId, paneId, { runCommands: next })
    else setWorkspaceRunCommands(wsId, next)
  }
  const listFor = (s: Scope) => (s === 'pane' ? paneCmds : wsCmds)

  const resetForm = () => { setLabel(''); setCommand(''); setEditId(null); setScope('pane') }

  const submit = () => {
    const l = label.trim(); const c = command.trim()
    if (!l || !c) return
    if (editId) persist(scope, updateRunCommand(listFor(scope), editId, { label: l, command: c }))
    else persist(scope, addRunCommand(listFor(scope), { id: uuid(), label: l, command: c }))
    resetForm()
  }

  const startEdit = (s: Scope, cmd: RunCommand) => { setScope(s); setEditId(cmd.id); setLabel(cmd.label); setCommand(cmd.command) }
  const del = (s: Scope, id: string) => { persist(s, removeRunCommand(listFor(s), id)); if (editId === id) resetForm() }
  const run = (command: string) => { runCommand(paneId, command); onClose() }

  const section = (s: Scope, title: string) => {
    const list = entries.filter(e => e.scope === s)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>{title}</div>
        {list.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-dim, #aaa)' }}>None yet.</div>}
        {list.map(({ cmd }) => (
          <div key={cmd.id} data-testid={`run-row-${cmd.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button data-testid={`run-cmd-${cmd.id}`} onClick={() => run(cmd.command)}>▷</button>
            <span onClick={() => startEdit(s, cmd)} title={cmd.command}
              style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
              {cmd.label} — {cmd.command.split('\n')[0]}
            </span>
            <button data-testid={`run-del-${cmd.id}`} onClick={() => del(s, cmd.id)}>×</button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <Modal onClose={onClose} backdropTestId="run-commands-dialog" card={{ padding: 12, width: 460 }}>
      <div style={{ fontWeight: 600 }}>Run commands</div>
      {section('workspace', 'This workspace')}
      {section('pane', 'This terminal')}
      <div style={{ borderTop: '1px solid var(--border, #444)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input data-testid="run-cmd-label" placeholder="Label (e.g. Test)" value={label}
          onChange={e => setLabel(e.target.value)} autoFocus />
        <input data-testid="run-cmd-command" placeholder="Command (e.g. npm test)" value={command}
          onChange={e => setCommand(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>Scope:&nbsp;
            <select data-testid="run-cmd-scope" value={scope} onChange={e => setScope(e.target.value as Scope)}>
              <option value="pane">This terminal</option>
              <option value="workspace">This workspace</option>
            </select>
          </label>
          <span style={{ flex: 1 }} />
          {editId && <button data-testid="run-cmd-cancel" onClick={resetForm}>Cancel</button>}
          <button data-testid="run-cmd-add" disabled={!label.trim() || !command.trim()} onClick={submit}>
            {editId ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Wire the tile**

In `src/renderer/components/PaneTile.tsx`:

Extend the `PaneMenu` type:
```ts
export type PaneMenu = 'proc' | 'cwd' | 'schedule' | 'git' | 'run'
```

Add the import (near the `ScheduleDialog` import):
```ts
import { RunCommandsMenu } from './RunCommandsMenu'
```

Render it alongside the other menus (near the `menu === 'schedule'` line):
```tsx
        {menu === 'run' && <RunCommandsMenu wsId={wsId} paneId={paneId} onClose={close} />}
```

- [ ] **Step 3: Add the toolbar button**

In `src/renderer/components/PaneToolbar.tsx`, add the run button immediately before the schedule chip (inside the `isTerminal` block, before the `schedule-chip` button):
```tsx
          <button type="button" data-testid={`run-chip-${paneId}`} title="Run commands"
            onClick={() => toggle('run')}>▷</button>
```

- [ ] **Step 4: Typecheck + build + commit**

Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds.

```bash
git add src/renderer/components/RunCommandsMenu.tsx src/renderer/components/PaneTile.tsx src/renderer/components/PaneToolbar.tsx
git commit -m "feat(run): RunCommandsMenu modal + toolbar button"
```

---

## Task 4: End-to-end test

**Files:**
- Create: `tests/e2e/run-commands.spec.ts`

**Interfaces:**
- Consumes: the whole feature (`run-chip-*`, `run-cmd-label`, `run-cmd-command`, `run-cmd-scope`, `run-cmd-add`, `run-cmd-<id>`).

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 2: Write the e2e spec**

Create `tests/e2e/run-commands.spec.ts` (helpers mirror `tests/e2e/schedule.spec.ts`):
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('saves, runs, and persists pane + workspace run commands', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-run-'))
  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Add a PANE command and run it.
  await win.locator('[data-testid^="run-chip-"]').first().click()
  await win.getByTestId('run-cmd-label').fill('Echo')
  await win.getByTestId('run-cmd-command').fill('echo run-4242')
  await win.getByTestId('run-cmd-scope').selectOption('pane')
  await win.getByTestId('run-cmd-add').click()
  // Run it (running closes the dialog).
  await win.locator('[data-testid^="run-cmd-"]').first().click()
  await expect(win.locator('.xterm-rows')).toContainText('run-4242', { timeout: 15_000 })

  // Add a WORKSPACE command.
  await win.locator('[data-testid^="run-chip-"]').first().click()
  await win.getByTestId('run-cmd-label').fill('Hi')
  await win.getByTestId('run-cmd-command').fill('echo workspace-cmd')
  await win.getByTestId('run-cmd-scope').selectOption('workspace')
  await win.getByTestId('run-cmd-add').click()
  // Close the dialog (click backdrop).
  await win.getByTestId('run-commands-dialog').click({ position: { x: 5, y: 5 } })

  // Split a second terminal; its run menu shows the workspace command.
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })
  await win.locator('[data-testid^="run-chip-"]').nth(1).click()
  await expect(win.getByTestId('run-commands-dialog')).toContainText('workspace-cmd')
  await win.getByTestId('run-commands-dialog').click({ position: { x: 5, y: 5 } })

  // Save + relaunch -> both commands persist.
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(800)
  const pid1 = app.process().pid; if (pid1) killTree(pid1)

  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator('[data-testid^="run-chip-"]').first()).toBeVisible({ timeout: 20_000 })
  await win.locator('[data-testid^="run-chip-"]').first().click()
  await expect(win.getByTestId('run-commands-dialog')).toContainText('run-4242')
  await expect(win.getByTestId('run-commands-dialog')).toContainText('workspace-cmd')

  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})
```

- [ ] **Step 3: Run the e2e**

Run: `npm run e2e -- run-commands`
Expected: PASS (1 test). If the `save-workspace` testid or `shell-picker` value differs, mirror `tests/e2e/schedule.spec.ts` / `tests/e2e/cwd.spec.ts` exactly.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/run-commands.spec.ts
git commit -m "test(run): e2e for saved run commands (run + persist, pane + workspace)"
```

---

## Task 5: Docs

**Files:**
- Create: `docs/features/run-commands.md`
- Modify: `CHANGELOG.md`, `CLAUDE.md` (Where things live), `docs/architecture.md` (if it enumerates persisted pane/workspace config)

- [ ] **Step 1: Feature doc**

Create `docs/features/run-commands.md`: the data flow (menu → store.runCommand → encodeBroadcast/ptyWrite), pane vs workspace scope and how they merge in the menu, persistence on `TerminalConfig`/`Workspace` (schema 5, additive), the send semantics (keys + CR, no mode toggle), and the relationship to scheduled commands (this is the persisted, manually-triggered sibling; both share `encodeBroadcast`). Non-goals: on-success URL (v2), output drawer, project scope, reordering. Match the style of an existing `docs/features/*.md`.

- [ ] **Step 2: Changelog + CLAUDE.md + architecture.md**

Add a CHANGELOG entry. Add a CLAUDE.md "Where things live" row:
```
| Saved run commands | `src/shared/run-commands.ts`, `src/renderer/store/run-commands-slice.ts` | [run-commands](docs/features/run-commands.md) |
```
If `docs/architecture.md` enumerates persisted config fields, note `runCommands` on terminal/workspace.

- [ ] **Step 3: Commit**

```bash
git add docs/features/run-commands.md CHANGELOG.md CLAUDE.md docs/architecture.md
git commit -m "docs(run): document saved run commands feature"
```

---

## Self-Review

**Spec coverage:**
- Pane + workspace scope → Task 1 (`runCommands` on both types), Task 2 (`setWorkspaceRunCommands` + reuse `updatePaneConfig`), Task 3 (two sections + scope toggle). ✓
- Run via existing path (no new IPC) → Task 2 `runCommand` uses `encodeBroadcast` + `api.ptyWrite`. ✓
- Persisted, schema 4→5 additive → Task 1. ✓
- Pure helpers + unit tests → Task 1. ✓
- Button → menu list UI (Modal like ScheduleDialog) → Task 3. ✓
- Add/edit/delete with blank-rejection → Task 3 (`submit` guards; Add/Save disabled). ✓
- On-success URL deferred → not in any task (correct; it's a Non-goal). ✓
- Tests: unit (Task 1) + e2e run+persist, pane+workspace (Task 4). ✓
- Docs → Task 5. ✓

**Placeholder scan:** none — all code is complete.

**Type consistency:** `RunCommand` (`id`/`label`/`command`) is identical across types.ts, the pure helpers, the slice, and the component. `MenuEntry` (`scope`/`cmd`) matches between `mergeForMenu` and the component's `entries.filter`. Store action names `setWorkspaceRunCommands`/`runCommand` match across `State`, the slice, and the component. Test ids (`run-chip-`, `run-commands-dialog`, `run-cmd-label`/`-command`/`-scope`/`-add`, `run-cmd-<id>`) match between Task 3 and Task 4.

**Deviation from spec (intentional):** `RunCommandsMenu` uses the `Modal` component (portaled, centered) — `ScheduleDialog` does the same. The spec's UI section was corrected to match (an earlier draft said anchored-absolute popover).
