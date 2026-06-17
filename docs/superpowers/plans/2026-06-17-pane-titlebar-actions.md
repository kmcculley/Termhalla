# Pane Title-Bar Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click pane title-bar context menu (Rename, Move to workspace, Settings, Close), a maximize toggle (button + shortcut), and slim the title bar by removing the env/settings/style buttons.

**Architecture:** A renderer-only feature. Moving a pane between workspaces in the same window mutates the two workspaces' layout trees; the PTY in main never dies (idempotent `pty:spawn` re-adopts via `pty.has`), and terminal scrollback rides a renderer-side snapshot stash consumed on remount. Maximize keeps siblings **mounted but hidden** via CSS (`!important` over react-mosaic's inline tile geometry) — no layout-tree change, no teardown, no persistence hazard.

**Tech Stack:** Electron, React, zustand, react-mosaic-component, xterm (`@xterm/addon-serialize`), Vitest, Playwright-for-Electron.

---

## Background the implementer needs

- **Pane title bar** is react-mosaic's `MosaicWindow`. Today `PaneTile.tsx` passes `title` + `toolbarControls={<PaneToolbar .../>}`. We switch to its `renderToolbar` prop so we own the whole toolbar DOM (right-clickable, hosts inline rename). `MosaicWindow` supports `renderToolbar?: (props) => JSX` (verified in `node_modules/react-mosaic-component/lib/MosaicWindow.js`).
- **Leaf tile DOM** is `<div key={paneId} className="mosaic-tile" style={inlineGeometry}>` (MosaicRoot.js). It has **no** per-pane data attribute, but a `data-*` attribute we set imperatively is NOT managed by React and survives mosaic re-renders; `!important` CSS overrides the inline geometry. This is how maximize works.
- **Workspaces** each render their own `<Mosaic>` (`WorkspaceView.tsx`); all stay mounted, inactive hidden via `visibility:hidden` (`App.tsx`). Moving a paneId from workspace A's tree to B's unmounts the `PaneTile` in A and mounts a fresh one in B — within a single synchronous React passive-effect flush, so no IPC interleaves and no PTY bytes are dropped.
- **`pty:spawn` is idempotent** (`register-pty.ts`): `if (pty.has(a.id)) { deps.replayInto?.(a.id); return }`. For a same-window move, main holds no snapshot/transit for the pane, so `replayInto` is a harmless no-op; the renderer stash supplies scrollback.
- **DO NOT reuse `closePane`'s teardown for moves.** `closePane` calls `teardownPanes` → `api.ptyKill` (`store/internals.ts:43`), which would kill the PTY.
- **Editor drafts:** `use-editor-tabs.ts:191` *deletes* drafts on unmount. A move must instead *flush* them — gated by a "pane in transit" flag.
- **House context-menu pattern:** positioned `div` + backdrop, `Z.menu`/`SURFACE` from `Modal.tsx` — see `WorkspaceTabs.tsx:106-123`. Reuse it.
- **Shortcuts:** typed in `src/shared/keymap.ts`, dispatched in `App.tsx:58-89`.
- **Theme model:** `resolveTheme(app, ws, pane)`. New workspace gets no theme. "Move to New Workspace" clones the source workspace's `theme` override so the moved pane renders the same.

## File Structure

- `src/shared/types.ts` — add `name?` to `EditorConfig`/`ExplorerConfig`.
- `src/shared/workspace-model.ts` — add pure `movePane(from, to, paneId)`.
- `src/renderer/components/terminal-registry.ts` — add snapshot stash (`stashSnapshot`/`consumeSnapshot`).
- `src/renderer/components/pane-transit.ts` — NEW: in-transit pane-id set for the editor draft guard.
- `src/renderer/store/types.ts` — add `maximized`, `focusedPaneId`, and new action signatures to `State`.
- `src/renderer/store.ts` — add initial state + `movePaneToWorkspace`, `movePaneToNewWorkspace`, `toggleMaximize`, `setFocusedPane`; clear-maximize wiring.
- `src/renderer/components/TerminalPane.tsx` — consume the snapshot stash on mount.
- `src/renderer/editor/use-editor-tabs.ts` — flush (not delete) drafts on unmount when in transit.
- `src/renderer/components/PaneToolbar.tsx` — remove env/gear/theme buttons; add maximize toggle.
- `src/renderer/components/PaneContextMenu.tsx` — NEW: the right-click menu.
- `src/renderer/components/PaneTile.tsx` — `renderToolbar`, `onContextMenu`, inline rename, `data-max` tile effect, focus tracking.
- `src/renderer/components/WorkspaceView.tsx` — wrapper class when a pane is maximized.
- `src/renderer/index.css` — maximize CSS rules.
- `src/shared/keymap.ts` + `src/renderer/App.tsx` — `toggle-maximize-pane` shortcut.
- Tests: `tests/move-pane.test.ts`, `tests/pane-transit.test.ts`, `tests/e2e/pane-actions.spec.ts`.

---

## Task 1: `movePane` pure helper + `name?` on editor/explorer configs

**Files:**
- Modify: `src/shared/types.ts:95-106`
- Modify: `src/shared/workspace-model.ts` (append after `removePane`, ~line 59)
- Test: `tests/move-pane.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/move-pane.test.ts
import { describe, it, expect } from 'vitest'
import { movePane } from '@shared/workspace-model'
import type { Workspace, PaneNode } from '@shared/types'

const term = (id: string): PaneNode => ({ paneId: id, config: { kind: 'terminal', shellId: 'pwsh', cwd: '' } })

function ws(id: string, layout: Workspace['layout'], panes: PaneNode[]): Workspace {
  return { id, name: id, layout, panes: Object.fromEntries(panes.map(p => [p.paneId, p])) }
}

describe('movePane', () => {
  it('moves a pane into an empty target as the sole pane', () => {
    const from = ws('A', 'a', [term('a')])
    const to = ws('B', null, [])
    const r = movePane(from, to, 'a')
    expect(r.from.layout).toBe(null)
    expect(r.from.panes.a).toBeUndefined()
    expect(r.to.layout).toBe('a')
    expect(r.to.panes.a).toEqual(term('a'))
  })

  it('splits the target to the right when it already has panes', () => {
    const from = ws('A', { direction: 'row', first: 'a', second: 'a2' }, [term('a'), term('a2')])
    const to = ws('B', 'b', [term('b')])
    const r = movePane(from, to, 'a')
    expect(r.from.layout).toBe('a2')              // collapses to the remaining leaf
    expect(r.to.layout).toEqual({ direction: 'row', first: 'b', second: 'a' })
    expect(r.to.panes.a).toEqual(term('a'))
  })

  it('is a no-op when the source does not hold the pane', () => {
    const from = ws('A', 'a', [term('a')])
    const to = ws('B', null, [])
    const r = movePane(from, to, 'zzz')
    expect(r.from).toBe(from)
    expect(r.to).toBe(to)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- move-pane`
Expected: FAIL — `movePane` is not exported from `@shared/workspace-model`.

- [ ] **Step 3: Add `name?` to the configs**

In `src/shared/types.ts`, add `name?: string` to both interfaces (TerminalConfig already has it):

```ts
export interface EditorConfig {
  kind: 'editor'
  files: string[]
  activePath?: string
  name?: string
  theme?: Partial<Theme>
}

export interface ExplorerConfig {
  kind: 'explorer'
  root: string
  name?: string
  theme?: Partial<Theme>
}
```

- [ ] **Step 4: Implement `movePane`**

In `src/shared/workspace-model.ts`, add after `removePane` (the `MosaicNode` import already exists at the top):

```ts
/** Move a pane (with its config + any per-pane theme) from one workspace to another, returning
 *  both updated workspaces. The pane is removed from `from`'s layout and added to `to` — as the
 *  sole pane when `to` is empty, otherwise split to the right of `to`'s current layout. No-op
 *  (returns the same objects) when `from` doesn't hold the pane. The pane id is unchanged, so its
 *  live PTY (kept in main) is re-adopted by the destination's idempotent pty:spawn. */
export function movePane(from: Workspace, to: Workspace, paneId: string): { from: Workspace; to: Workspace } {
  const pane = from.panes[paneId]
  if (!pane) return { from, to }
  const nextFrom = removePane(from, paneId)
  const layout: MosaicNode = to.layout === null ? paneId : { direction: 'row', first: to.layout, second: paneId }
  const nextTo: Workspace = { ...to, layout, panes: { ...to.panes, [paneId]: pane } }
  return { from: nextFrom, to: nextTo }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- move-pane`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/shared/types.ts src/shared/workspace-model.ts tests/move-pane.test.ts
git commit -m "feat(workspace): movePane helper + name on editor/explorer configs"
```

---

## Task 2: Snapshot stash + pane-transit registry

**Files:**
- Modify: `src/renderer/components/terminal-registry.ts`
- Create: `src/renderer/components/pane-transit.ts`
- Test: `tests/pane-transit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/pane-transit.test.ts
import { describe, it, expect } from 'vitest'
import { stashSnapshot, consumeSnapshot } from '../src/renderer/components/terminal-registry'
import { beginPaneTransit, endPaneTransit, isPaneInTransit } from '../src/renderer/components/pane-transit'

describe('snapshot stash', () => {
  it('returns the stashed snapshot once then empties', () => {
    stashSnapshot('p1', 'ANSI-DATA')
    expect(consumeSnapshot('p1')).toBe('ANSI-DATA')
    expect(consumeSnapshot('p1')).toBe('')        // consumed once
  })
  it('returns empty string for an unknown pane', () => {
    expect(consumeSnapshot('nope')).toBe('')
  })
})

describe('pane transit', () => {
  it('tracks in-transit pane ids', () => {
    expect(isPaneInTransit('p2')).toBe(false)
    beginPaneTransit('p2')
    expect(isPaneInTransit('p2')).toBe(true)
    endPaneTransit('p2')
    expect(isPaneInTransit('p2')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pane-transit`
Expected: FAIL — `stashSnapshot`/`pane-transit` not found.

- [ ] **Step 3: Add the stash to `terminal-registry.ts`**

Append to `src/renderer/components/terminal-registry.ts`:

```ts
/** Scrollback handed off when a pane moves between workspaces in the same window. The source
 *  TerminalPane's serialized ANSI is stashed here just before the layout move unmounts it, then
 *  consumed (once) by the destination TerminalPane on mount so the move keeps full scrollback. */
const pendingRestore = new Map<string, string>()
export function stashSnapshot(paneId: string, data: string): void { pendingRestore.set(paneId, data) }
export function consumeSnapshot(paneId: string): string {
  const d = pendingRestore.get(paneId)
  pendingRestore.delete(paneId)
  return d ?? ''
}
```

- [ ] **Step 4: Create `pane-transit.ts`**

```ts
// src/renderer/components/pane-transit.ts
/** Pane ids currently being moved between workspaces. An editor pane consults this on unmount so a
 *  move (which unmounts then remounts the pane) flushes its unsaved-edit draft instead of deleting
 *  it. Terminals don't need this — their scrollback rides the snapshot stash in terminal-registry. */
const moving = new Set<string>()
export function beginPaneTransit(paneId: string): void { moving.add(paneId) }
export function endPaneTransit(paneId: string): void { moving.delete(paneId) }
export function isPaneInTransit(paneId: string): boolean { return moving.has(paneId) }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- pane-transit`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/terminal-registry.ts src/renderer/components/pane-transit.ts tests/pane-transit.test.ts
git commit -m "feat(panes): snapshot stash + in-transit registry for cross-workspace moves"
```

---

## Task 3: Store — maximize state, focus tracking, and move actions

**Files:**
- Modify: `src/renderer/store/types.ts:20-107`
- Modify: `src/renderer/store.ts`

(Store actions import `../api` transitively, so they're exercised by the e2e in Task 11, not vitest — per CLAUDE.md.)

- [ ] **Step 1: Extend the `State` interface**

In `src/renderer/store/types.ts`, add these members inside `interface State` (place near `setLayout`):

```ts
  maximized: Record<string, string>   // wsId -> the paneId currently maximized in that workspace
  focusedPaneId: string | null
  toggleMaximize: (wsId: string, paneId: string) => void
  setFocusedPane: (paneId: string) => void
  movePaneToWorkspace: (paneId: string, fromWsId: string, toWsId: string) => void
  movePaneToNewWorkspace: (paneId: string, fromWsId: string) => void
```

- [ ] **Step 2: Add imports + initial state in `store.ts`**

In `src/renderer/store.ts`, extend the import from workspace-model (line 5) and the terminal-registry import (line 14):

```ts
import { createWorkspace, removePane, reorderIds, movePane } from '@shared/workspace-model'
```
```ts
import { readPaneSnapshot, stashSnapshot } from './components/terminal-registry'
import { beginPaneTransit } from './components/pane-transit'
```

Add to the initial-state block (after `lastEditorPaneId: null,`, line 76):

```ts
    maximized: {},
    focusedPaneId: null,
```

- [ ] **Step 3: Add the actions**

In `src/renderer/store.ts`, add these to the core actions object (after `setLayout`, ~line 200). They live here (not in a slice) because they use the `reportAssignment` closure:

```ts
    toggleMaximize: (wsId, paneId) => set(s => {
      const maximized = { ...s.maximized }
      if (maximized[wsId] === paneId) delete maximized[wsId]
      else maximized[wsId] = paneId
      return { maximized }
    }),

    setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

    /** Move a pane to another workspace THIS window already hosts, following it with the active tab.
     *  Terminals keep scrollback (snapshot stash) + their running PTY (re-adopted by pty:spawn);
     *  editors keep unsaved edits (in-transit draft flush). Never tears down the PTY. */
    movePaneToWorkspace: (paneId, fromWsId, toWsId) => {
      const s = get()
      const from = s.workspaces[fromWsId]
      const to = s.workspaces[toWsId]
      if (!from || !to || fromWsId === toWsId || !from.panes[paneId]) return
      const kind = from.panes[paneId].config.kind
      if (kind === 'terminal') { const snap = readPaneSnapshot(paneId); if (snap) stashSnapshot(paneId, snap) }
      if (kind === 'editor') beginPaneTransit(paneId)
      const moved = movePane(from, to, paneId)
      set(st => {
        const maximized = { ...st.maximized }
        if (maximized[fromWsId] === paneId) delete maximized[fromWsId]
        return { workspaces: { ...st.workspaces, [fromWsId]: moved.from, [toWsId]: moved.to }, activeId: toWsId, maximized }
      })
      scheduleAutosave()
      reportAssignment()
    },

    /** Move a pane into a brand-new workspace, carrying the source workspace's theme override so the
     *  pane renders the same in its new home. */
    movePaneToNewWorkspace: (paneId, fromWsId) => {
      const from = get().workspaces[fromWsId]
      if (!from?.panes[paneId]) return
      const newId = get().newWorkspace(`Workspace ${get().order.length + 1}`)
      if (from.theme) set(s => ({ workspaces: { ...s.workspaces, [newId]: { ...s.workspaces[newId], theme: { ...from.theme } } } }))
      get().movePaneToWorkspace(paneId, fromWsId, newId)
    },
```

- [ ] **Step 4: Clear maximize on structural changes**

Still in `store.ts`, clear the workspace's maximize flag when a pane is closed or added (so a hidden pane can't get stranded behind a maximize). In `closePane` (line 211-216), change the `set` to also drop the flag:

```ts
    closePane: (wsId, paneId) => {
      const ws = removePane(get().workspaces[wsId], paneId)
      teardownPanes([paneId])
      set(s => {
        const maximized = { ...s.maximized }
        if (maximized[wsId] === paneId) delete maximized[wsId]
        return { workspaces: { ...s.workspaces, [wsId]: ws }, maximized, ...clearPaneRuntime(s, [paneId]), schedules: schedulesWithout(s.schedules, [paneId]) }
      })
      scheduleAutosave()
    },
```

In `commitPane` (line 46-54), clear the flag for the target workspace so a freshly split pane is visible:

```ts
    set(s => {
      const maximized = { ...s.maximized }
      delete maximized[wsId]
      return markEditor
        ? { workspaces: { ...s.workspaces, [wsId]: r.workspace }, maximized, lastEditorPaneId: r.paneId }
        : { workspaces: { ...s.workspaces, [wsId]: r.workspace }, maximized }
    })
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no missing members on `State`).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store/types.ts src/renderer/store.ts
git commit -m "feat(store): maximize state, focus tracking, cross-workspace move actions"
```

---

## Task 4: TerminalPane consumes the snapshot stash on mount

**Files:**
- Modify: `src/renderer/components/TerminalPane.tsx:12,36-43`

- [ ] **Step 1: Import the consumer**

Change the terminal-registry import (line 12):

```ts
import { registerSerializer, unregisterSerializer, consumeSnapshot } from './terminal-registry'
```

- [ ] **Step 2: Write the stashed scrollback before spawning**

In the mount effect, immediately after `fit.fit()` (line 37) and before `api.ptySpawn(...)`, insert:

```ts
    // A cross-workspace move stashed this pane's prior scrollback; write it before spawn so it lands
    // ahead of any live output. For a fresh terminal this is '' (no-op). The PTY itself is re-adopted
    // by main (pty:spawn sees pty.has) — this only restores the renderer-side buffer.
    const restored = consumeSnapshot(paneId)
    if (restored) term.write(restored)
```

- [ ] **Step 3: Build + smoke check**

Run: `npm run build`
Expected: build succeeds. (Behavior is verified by the e2e in Task 11.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TerminalPane.tsx
git commit -m "feat(terminal): restore stashed scrollback on remount after a move"
```

---

## Task 5: Editor flushes (not deletes) drafts when in transit

**Files:**
- Modify: `src/renderer/editor/use-editor-tabs.ts:191`

- [ ] **Step 1: Import the transit guard**

Add near the top imports of `use-editor-tabs.ts`:

```ts
import { isPaneInTransit, endPaneTransit } from '../components/pane-transit'
```

- [ ] **Step 2: Guard the unmount cleanup**

Replace the per-tab cleanup loop (line 191) so that, during a move, drafts are persisted instead of deleted:

```ts
    return () => {
      focusDisp.dispose(); ed.dispose()
      clearDraftTimers()
      const moving = isPaneInTransit(paneId)
      for (const t of tabs.current.values()) {
        api.fsUnwatch(draftKey(paneId, t.path))
        // A move unmounts then remounts this pane: flush the draft so the remount restores unsaved
        // edits. A real close deletes it (no stale draft for a gone pane).
        if (moving) persistDraft(t.path)
        else api.draftsDelete(draftKey(paneId, t.path))
        t.disp.dispose(); t.model.dispose()
      }
      tabs.current.clear()
      if (moving) endPaneTransit(paneId)
    }
```

Confirm `persistDraft` is in scope in this effect (it is — destructured from `useEditorDrafts` at line 44). If TypeScript flags `persistDraft` as missing from the effect's closure, add it to the cleanup via the already-available `persist` binding used elsewhere in the file.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds. (Verified by e2e in Task 11.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/editor/use-editor-tabs.ts
git commit -m "feat(editor): flush drafts instead of deleting them during a pane move"
```

---

## Task 6: Slim the toolbar — remove env/gear/theme, add maximize

**Files:**
- Modify: `src/renderer/components/PaneToolbar.tsx`

- [ ] **Step 1: Rewrite `PaneToolbar.tsx`**

Remove the env (🔑), gear (⚙), and theme (🎨) buttons; add a maximize/restore toggle (universal). The component now reads `maximized`/`toggleMaximize` from the store:

```tsx
import { useStore } from '../store'
import { api } from '../api'
import type { PaneMenu } from './PaneTile'

/** The MosaicWindow toolbar for one pane: the process/usage chip, per-terminal action buttons, the
 *  folder menu, split controls, a maximize toggle, and close. Env/terminal/appearance settings moved
 *  to the title-bar right-click menu (see PaneContextMenu). */
export function PaneToolbar(
  { wsId, paneId, isTerminal, chipText, recording, toggle }: {
    wsId: string
    paneId: string
    isTerminal: boolean
    chipText: string
    recording: boolean
    toggle: (menu: PaneMenu) => void
  }
) {
  const addTerminal = useStore(s => s.addTerminal)
  const closePane = useStore(s => s.closePane)
  const toggleMaximize = useStore(s => s.toggleMaximize)
  const isMax = useStore(s => s.maximized[wsId] === paneId)
  return (
    <>
      {isTerminal && (
        <>
          <button type="button" data-testid={`proc-chip-${paneId}`} title="Running process"
            style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={() => toggle('proc')}>{chipText}</button>
          <button type="button" data-testid={`schedule-chip-${paneId}`} title="Schedule a command"
            onClick={() => toggle('schedule')}>⏱</button>
          <button type="button" data-testid={`rec-${paneId}`}
            title={recording ? 'Stop recording' : 'Record session'}
            style={{ color: recording ? '#ff6b6b' : undefined }}
            onClick={() => recording ? api.recStop(paneId) : api.recStart(paneId)}>⏺</button>
        </>
      )}
      <button data-testid={`cwd-${paneId}`} title="Folder actions" onClick={() => toggle('cwd')}>📁</button>
      <button data-testid={`split-${paneId}`} title="Split right" onClick={() => addTerminal(wsId, paneId, 'row')}>⬌</button>
      <button data-testid={`split-col-${paneId}`} title="Split down" onClick={() => addTerminal(wsId, paneId, 'column')}>⬍</button>
      <button data-testid={`max-${paneId}`} title={isMax ? 'Restore pane' : 'Maximize pane'}
        onClick={() => toggleMaximize(wsId, paneId)}>{isMax ? '🗗' : '🗖'}</button>
      <button data-testid={`close-${paneId}`} onClick={() => closePane(wsId, paneId)}>✕</button>
    </>
  )
}
```

Note: the `envActive` prop is gone — PaneTile must stop passing it (Task 7).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: TypeScript error in `PaneTile.tsx` (still passes `envActive`) — fixed in Task 7. If running standalone, defer the build check to Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/PaneToolbar.tsx
git commit -m "feat(toolbar): drop env/settings/style buttons, add maximize toggle"
```

---

## Task 7: PaneContextMenu component

**Files:**
- Create: `src/renderer/components/PaneContextMenu.tsx`

- [ ] **Step 1: Create the menu component**

Reuses the `WorkspaceTabs` menu pattern (backdrop + `SURFACE` + `Z.menu`). Two views: the root list, and the "Move to workspace" target list. `onRename` is supplied by PaneTile (it drives the inline title editor).

```tsx
import { useState } from 'react'
import { useStore } from '../store'
import { Z, SURFACE } from './Modal'

/** Right-click menu for a pane's title bar: Rename, Move to workspace ▸ (other workspaces this
 *  window hosts, plus New Workspace), Settings, Close. Mirrors the WorkspaceTabs menu chrome. */
export function PaneContextMenu(
  { wsId, paneId, x, y, onRename, onClose }:
  { wsId: string; paneId: string; x: number; y: number; onRename: () => void; onClose: () => void }
) {
  const order = useStore(s => s.order)
  const names = useStore(s => Object.fromEntries(s.order.map(id => [id, s.workspaces[id]?.name ?? id])))
  const openSettings = useStore(s => s.openSettings)
  const closePane = useStore(s => s.closePane)
  const moveToWorkspace = useStore(s => s.movePaneToWorkspace)
  const moveToNew = useStore(s => s.movePaneToNewWorkspace)
  const [view, setView] = useState<'root' | 'move'>('root')

  const others = order.filter(id => id !== wsId)
  const menuStyle = { ...SURFACE, position: 'fixed' as const, left: x, top: y, zIndex: Z.menu + 1, padding: 4, display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 160, fontSize: 'var(--font-size, 13px)' }

  return (
    <>
      <div onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }}
        style={{ position: 'fixed', inset: 0, zIndex: Z.menu }} />
      <div data-testid="pane-menu" style={menuStyle}>
        {view === 'root' ? (
          <>
            <button data-testid="pane-menu-rename" onClick={() => { onClose(); onRename() }}>Rename</button>
            <button data-testid="pane-menu-move" onClick={() => setView('move')}>Move to workspace ▸</button>
            <button data-testid="pane-menu-settings"
              onClick={() => { openSettings({ section: 'terminal', paneId }); onClose() }}>Settings</button>
            <button data-testid="pane-menu-close" onClick={() => { closePane(wsId, paneId); onClose() }}>Close</button>
          </>
        ) : (
          <>
            {others.map(id => (
              <button key={id} data-testid={`move-target-${id}`}
                onClick={() => { moveToWorkspace(paneId, wsId, id); onClose() }}>{names[id]}</button>
            ))}
            <button data-testid="move-new-workspace"
              onClick={() => { moveToNew(paneId, wsId); onClose() }}>New Workspace ＋</button>
          </>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build` (still expects PaneTile wiring from Task 8). Standalone, this file typechecks against the store actions added in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/PaneContextMenu.tsx
git commit -m "feat(panes): right-click pane title-bar context menu"
```

---

## Task 8: Wire PaneTile — renderToolbar, context menu, inline rename, maximize tile, focus

**Files:**
- Modify: `src/renderer/components/PaneTile.tsx`

- [ ] **Step 1: Rewrite `PaneTile.tsx`**

Switches to `renderToolbar` (so the whole toolbar is right-clickable and can host the rename input), adds the context menu + inline rename state, the `data-max` tile effect, and focus tracking. Title now reads `config.name` for any kind.

```tsx
import { useLayoutEffect, useRef, useState } from 'react'
import { MosaicWindow, type MosaicBranch } from 'react-mosaic-component'
import { resolveAlerts } from '@shared/alerts'
import { themeCssVarsPartial } from '@shared/theme'
import { useStore, paneCwd } from '../store'
import { TerminalPane } from './TerminalPane'
import { EditorPane } from './EditorPane'
import { ExplorerPane } from './ExplorerPane'
import { ScheduleDialog } from './ScheduleDialog'
import { PaneToolbar } from './PaneToolbar'
import { PaneContextMenu } from './PaneContextMenu'
import { ProcessPopover } from './ProcessPopover'
import { CwdMenu } from './CwdMenu'

export type PaneMenu = 'proc' | 'cwd' | 'schedule'

const SHELL_CHIP_LABEL: Record<string, string> = {
  'Windows PowerShell': 'pwsh',
  'Command Prompt': 'cmd'
}

export function PaneTile({ wsId, paneId, path }: { wsId: string; paneId: string; path: MosaicBranch[] }) {
  const pane = useStore(s => s.workspaces[wsId]?.panes[paneId])
  const status = useStore(s => s.statuses[paneId])
  const procInfo = useStore(s => s.procs[paneId])
  const aiSession = useStore(s => s.aiSessions[paneId])
  const usage = useStore(s => s.usage[paneId])
  const recording = useStore(s => !!s.recording[paneId])
  const cwd = useStore(s => paneCwd(s, paneId))
  const shells = useStore(s => s.shells)
  const isMax = useStore(s => s.maximized[wsId] === paneId)
  const setFocusedPane = useStore(s => s.setFocusedPane)
  const updatePaneConfig = useStore(s => s.updatePaneConfig)

  const [menu, setMenu] = useState<PaneMenu | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const toggle = (m: PaneMenu) => setMenu(cur => (cur === m ? null : m))
  const close = () => setMenu(null)
  const tileRef = useRef<HTMLDivElement>(null)

  const termCfg = pane?.config.kind === 'terminal' ? pane.config : undefined
  const rawShellLabel = termCfg ? (shells.find(sh => sh.id === termCfg.shellId)?.label ?? termCfg.shellId) : ''
  const shellLabel = SHELL_CHIP_LABEL[rawShellLabel] ?? rawShellLabel
  const chipText = aiSession ? `✨ ${aiSession.label}${usage ? ` ${usage.contextPct}%` : ''}`
    : procInfo && procInfo.foreground ? `▶ ${procInfo.foreground}` : shellLabel

  const alerts = resolveAlerts(termCfg?.alerts)
  const state = status?.state ?? 'idle'
  const statusClass = alerts.border ? `term-status term-${state}` : ''
  const needsInput = state === 'needs-input'
  const baseName = pane?.config.name ?? pane?.config.kind ?? 'Pane'
  const title = (needsInput ? '🔔 ' : '') + baseName

  // Maximize: mark this pane's mosaic tile so CSS can fill it and hide siblings. The attribute is
  // not React-managed, so it survives react-mosaic re-renders; !important CSS overrides the inline
  // tile geometry. Re-applied whenever the maximize flag changes.
  useLayoutEffect(() => {
    const tile = tileRef.current?.closest('.mosaic-tile') as HTMLElement | null
    if (!tile) return
    if (isMax) tile.setAttribute('data-max', '1')
    else tile.removeAttribute('data-max')
    return () => { tile.removeAttribute('data-max') }
  }, [isMax])

  const startRename = () => { setRenameText(pane?.config.name ?? '') ; setRenaming(true) }
  const commitRename = () => {
    const n = renameText.trim()
    updatePaneConfig(wsId, paneId, { name: n || undefined })
    setRenaming(false)
  }

  // MosaicWindow already wraps this return in `.mosaic-window-toolbar` and applies connectDragSource
  // to it (verified in MosaicWindow.js:172-174), so drag-to-rearrange is preserved. Return a SINGLE
  // element (no extra `.mosaic-window-toolbar` class — that would double-nest and shift the strip
  // height, the editor.spec gotcha) carrying onContextMenu over the whole bar.
  const renderToolbar = () => (
    <div data-testid={`titlebar-${paneId}`}
      onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }) }}
      style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      {renaming ? (
        <input data-testid={`pane-rename-${paneId}`} autoFocus value={renameText}
          onFocus={e => e.currentTarget.select()}
          onChange={e => setRenameText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenaming(false) }}
          onBlur={commitRename}
          style={{ flex: 1, minWidth: 0 }} />
      ) : (
        <div className="mosaic-window-title" title={title} style={{ flex: 1, minWidth: 0 }}>{title}</div>
      )}
      <div className="mosaic-window-controls" style={{ display: 'flex', alignItems: 'center' }}>
        <PaneToolbar wsId={wsId} paneId={paneId} isTerminal={!!termCfg} chipText={chipText}
          recording={recording} toggle={toggle} />
      </div>
    </div>
  )

  return (
    <MosaicWindow<string> path={path} title={title} className={statusClass} renderToolbar={renderToolbar}>
      <div ref={tileRef} className="term-tile" data-status={state}
        data-testid={`tile-${paneId}`} data-cwd={cwd}
        onMouseDownCapture={() => setFocusedPane(paneId)}
        style={{ ...themeCssVarsPartial(pane?.config.theme ?? {}), position: 'relative', height: '100%' }}>
        {menu === 'proc' && (
          <ProcessPopover paneId={paneId} procInfo={procInfo} aiSession={aiSession} usage={usage} onClose={close} />
        )}
        {menu === 'schedule' && <ScheduleDialog paneId={paneId} onClose={close} />}
        {menu === 'cwd' && <CwdMenu wsId={wsId} paneId={paneId} cwd={cwd} onClose={close} />}
        {pane?.config.kind === 'terminal' && termCfg && <TerminalPane paneId={paneId} wsId={wsId} config={termCfg} />}
        {pane?.config.kind === 'editor' && <EditorPane paneId={paneId} wsId={wsId} config={pane.config} />}
        {pane?.config.kind === 'explorer' && <ExplorerPane paneId={paneId} wsId={wsId} config={pane.config} />}
        {!pane && <div>missing pane</div>}
      </div>
      {ctx && <PaneContextMenu wsId={wsId} paneId={paneId} x={ctx.x} y={ctx.y}
        onRename={startRename} onClose={() => setCtx(null)} />}
    </MosaicWindow>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds (PaneToolbar no longer receives `envActive`; PaneContextMenu wired).

- [ ] **Step 3: Run the existing editor e2e guard**

Run: `npm run e2e -- editor`
Expected: PASS — confirms the toolbar box change didn't perturb Monaco layout. If it fails on tab-strip height, verify `renderToolbar` keeps the same `.mosaic-window-toolbar` element/height as before (it does — we reuse that class and add no border/padding/font to it).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/PaneTile.tsx
git commit -m "feat(panes): renderToolbar + right-click menu, inline rename, maximize tile, focus"
```

---

## Task 9: WorkspaceView wrapper + maximize CSS

**Files:**
- Modify: `src/renderer/components/WorkspaceView.tsx:26-32`
- Modify: `src/renderer/index.css` (append near the other chrome rules, ~line 188)

- [ ] **Step 1: Wrap the Mosaic with the maximize class**

In `WorkspaceView.tsx`, read the maximize flag and wrap the returned `<Mosaic>`:

```tsx
export function WorkspaceView({ ws }: { ws: Workspace }) {
  const setLayout = useStore(s => s.setLayout)
  const addTerminal = useStore(s => s.addTerminal)
  const addEditor = useStore(s => s.addEditor)
  const addExplorer = useStore(s => s.addExplorer)
  const maximized = useStore(s => !!s.maximized[ws.id])

  if (ws.layout === null) {
    /* ...unchanged empty-workspace branch... */
  }

  return (
    <div className={maximized ? 'ws-mosaic ws-max' : 'ws-mosaic'} data-testid={`ws-mosaic-${ws.id}`}
      style={{ position: 'relative', height: '100%' }}>
      <Mosaic<string>
        value={ws.layout as ModelNode & string}
        onChange={(node) => setLayout(ws.id, (node as ModelNode) ?? null)}
        renderTile={(paneId, path) => <PaneTile wsId={ws.id} paneId={paneId} path={path} />}
      />
    </div>
  )
}
```

(Keep the existing `if (ws.layout === null)` early-return block exactly as it is.)

- [ ] **Step 2: Add the CSS**

Append to `src/renderer/index.css`:

```css
/* Pane maximize: the flagged tile fills the workspace; siblings stay MOUNTED (xterm scrollback and
   Monaco models alive) but hidden — same visibility:hidden pattern as inactive workspaces, so no
   FitAddon/PTY-grid thrash. !important overrides react-mosaic's inline tile geometry; the maximized
   pane gets one legitimate resize. data-max is set imperatively by PaneTile. */
.ws-max .mosaic-tile { visibility: hidden; pointer-events: none; }
.ws-max .mosaic-split { visibility: hidden; pointer-events: none; }
.ws-max .mosaic-tile[data-max="1"] {
  visibility: visible; pointer-events: auto;
  inset: 0 !important; width: 100% !important; height: 100% !important; z-index: 3;
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/WorkspaceView.tsx src/renderer/index.css
git commit -m "feat(panes): CSS maximize — fill one tile, hide mounted siblings"
```

---

## Task 10: Maximize keyboard shortcut

**Files:**
- Modify: `src/shared/keymap.ts`
- Modify: `src/renderer/App.tsx:67-85`

- [ ] **Step 1: Add the shortcut type + binding**

In `src/shared/keymap.ts`, add to the `Shortcut` union:

```ts
  | { type: 'toggle-maximize-pane' }
```

And add the binding in `matchShortcut` (Ctrl+Shift+M — avoids readline bindings, parallels the existing Ctrl+Shift chords):

```ts
  if (k === 'm' && e.shiftKey) return { type: 'toggle-maximize-pane' }
```

(Place it before the digit/`jump-workspace` check.)

- [ ] **Step 2: Handle it in App.tsx**

Add a case to the `switch (sc.type)` block in `App.tsx`:

```ts
        case 'toggle-maximize-pane': {
          const pane = s.focusedPaneId
          if (pane && activeId && s.workspaces[activeId]?.panes[pane]) s.toggleMaximize(activeId, pane)
          break
        }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds (the `switch` is now exhaustive over the `Shortcut` union).

- [ ] **Step 4: Commit**

```bash
git add src/shared/keymap.ts src/renderer/App.tsx
git commit -m "feat(panes): Ctrl+Shift+M toggles maximize for the focused pane"
```

---

## Task 11: End-to-end tests

**Files:**
- Create: `tests/e2e/pane-actions.spec.ts`

Mirror the app-launch boilerplate from `tests/e2e/editor.spec.ts` (the established Electron-launch helper, `_electron.launch`, the page handle, and the helper that creates a terminal pane). Read that file first and copy its setup verbatim; the bodies below assume a launched `page` with one workspace containing one terminal pane, and a helper to read a pane id.

- [ ] **Step 1: Build first (e2e runs against `out/`)**

Run: `npm run build`

- [ ] **Step 2: Write the spec**

```ts
// tests/e2e/pane-actions.spec.ts
import { test, expect } from '@playwright/test'
// ...copy the _electron launch fixture + a `firstPaneId(page)` helper from editor.spec.ts...

test('right-click title bar shows the four menu items', async () => {
  const page = await launchApp()                 // from copied fixture
  const paneId = await firstPaneId(page)
  await page.getByTestId(`titlebar-${paneId}`).click({ button: 'right' })
  await expect(page.getByTestId('pane-menu')).toBeVisible()
  await expect(page.getByTestId('pane-menu-rename')).toBeVisible()
  await expect(page.getByTestId('pane-menu-move')).toBeVisible()
  await expect(page.getByTestId('pane-menu-settings')).toBeVisible()
  await expect(page.getByTestId('pane-menu-close')).toBeVisible()
  await closeApp(page)
})

test('rename updates the pane title', async () => {
  const page = await launchApp()
  const paneId = await firstPaneId(page)
  await page.getByTestId(`titlebar-${paneId}`).click({ button: 'right' })
  await page.getByTestId('pane-menu-rename').click()
  const input = page.getByTestId(`pane-rename-${paneId}`)
  await input.fill('My Shell')
  await input.press('Enter')
  await expect(page.getByTestId(`titlebar-${paneId}`)).toContainText('My Shell')
  await closeApp(page)
})

test('env/settings/style buttons are gone; Settings opens the panel', async () => {
  const page = await launchApp()
  const paneId = await firstPaneId(page)
  await expect(page.getByTestId(`env-chip-${paneId}`)).toHaveCount(0)
  await expect(page.getByTestId(`gear-${paneId}`)).toHaveCount(0)
  await expect(page.getByTestId(`theme-chip-${paneId}`)).toHaveCount(0)
  await page.getByTestId(`titlebar-${paneId}`).click({ button: 'right' })
  await page.getByTestId('pane-menu-settings').click()
  await expect(page.getByTestId('settings-panel')).toBeVisible()   // match the SettingsPanel testid
  await closeApp(page)
})

test('move to a new workspace keeps the terminal alive and active', async () => {
  const page = await launchApp()
  const paneId = await firstPaneId(page)
  // type a marker into the terminal so we can assert scrollback survives
  await page.getByTestId(`terminal-${paneId}`).click()
  await page.keyboard.type('echo MOVE_MARKER')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId(`tile-${paneId}`)).toContainText('MOVE_MARKER')

  await page.getByTestId(`titlebar-${paneId}`).click({ button: 'right' })
  await page.getByTestId('pane-menu-move').click()
  await page.getByTestId('move-new-workspace').click()

  // same pane id now lives in the newly-active workspace, with its scrollback intact
  await expect(page.getByTestId(`tile-${paneId}`)).toBeVisible()
  await expect(page.getByTestId(`tile-${paneId}`)).toContainText('MOVE_MARKER')
  await closeApp(page)
})

test('maximize hides siblings; restore brings them back', async () => {
  const page = await launchApp()
  const a = await firstPaneId(page)
  // split to create a sibling
  await page.getByTestId(`split-${a}`).click()
  const tiles = page.locator('[data-testid^="tile-"]')
  await expect(tiles).toHaveCount(2)
  const b = (await tiles.nth(1).getAttribute('data-testid'))!.replace('tile-', '')

  await page.getByTestId(`max-${a}`).click()
  await expect(page.getByTestId(`tile-${a}`)).toBeVisible()
  await expect(page.getByTestId(`tile-${b}`)).not.toBeVisible()   // hidden via visibility:hidden

  await page.getByTestId(`max-${a}`).click()                      // restore
  await expect(page.getByTestId(`tile-${b}`)).toBeVisible()
  await closeApp(page)
})
```

- [ ] **Step 3: Run the e2e**

Run: `npm run e2e -- pane-actions`
Expected: all tests PASS. If `settings-panel`/`terminal-${paneId}` testids differ, adjust to the actual ids (grep `data-testid` in `SettingsPanel.tsx` / `TerminalPane.tsx`).

- [ ] **Step 4: Full suite regression**

Run: `npm test && npm run build && npm run e2e`
Expected: unit + e2e green (especially `editor.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/pane-actions.spec.ts
git commit -m "test(e2e): pane title-bar menu, rename, move, maximize"
```

---

## Task 12: Docs + changelog

**Files:**
- Modify: `CHANGELOG.md`
- Modify/Create: a feature doc under `docs/features/` (e.g. `workspaces.md` — add a "Pane title-bar actions" section) and the follow-ups doc if any Minor items are deferred.

- [ ] **Step 1: Update the changelog**

Add an entry summarizing: pane title-bar right-click menu (Rename / Move to workspace / Settings / Close), maximize toggle (button + Ctrl+Shift+M), and the removal of the env/settings/style title-bar buttons.

- [ ] **Step 2: Update the feature doc**

Document: move preserves the running PTY + scrollback (snapshot stash + idempotent `pty:spawn` adopt) and editor unsaved edits (in-transit draft flush); maximize keeps siblings mounted-but-hidden via CSS; theme carries over to a new workspace.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md docs/features
git commit -m "docs: pane title-bar actions (menu, move, rename, maximize)"
```

---

## Self-review notes (resolved)

- **Spec coverage:** Move-to-workspace incl. New Workspace + theme carry-over (Tasks 1,3,7,11) ✓; Rename (Tasks 1,8,11) ✓; Settings entry + removal of env/settings/style buttons (Tasks 6,8,11) ✓; Close (Tasks 7,11) ✓; Maximize button + shortcut (Tasks 3,6,8,9,10,11) ✓; preserve process+scrollback (Tasks 2,3,4) ✓; editor edits preserved (Tasks 2,5) ✓.
- **Two spec open items, now resolved:** (a) focused-pane signal didn't exist → added `focusedPaneId` set on pane mousedown (Task 3,8); (b) editor drafts are *deleted* on unmount → added the in-transit flush guard (Tasks 2,5).
- **Design change vs spec:** the spec floated a main-side transit buffer for the move's in-flight bytes; analysis showed the same-window unmount→remount happens in one synchronous React passive-effect flush with no IPC interleave and the PTY never dies, so a renderer-only snapshot stash suffices — no IPC/main changes. Maximize uses CSS-hide (siblings stay mounted) rather than any layout-tree swap, avoiding sibling teardown and the persistence hazard.
- **Type consistency:** `movePane`, `stashSnapshot`/`consumeSnapshot`, `beginPaneTransit`/`endPaneTransit`/`isPaneInTransit`, `maximized`/`focusedPaneId`/`toggleMaximize`/`setFocusedPane`/`movePaneToWorkspace`/`movePaneToNewWorkspace` names are used identically across tasks. `PaneToolbar` no longer takes `envActive` (Task 6) and PaneTile stops passing it (Task 8).
