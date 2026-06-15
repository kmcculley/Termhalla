# Broadcast Input to All Terminals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Send a block of text to every terminal in the active workspace, as a bracketed paste or as raw keystrokes, with optional trailing Enter.

**Architecture:** Pure `encodeBroadcast`/`terminalPaneIds` in `src/shared/broadcast.ts`; a store action `broadcastInput` that `ptyWrite`s each terminal pane; a `BroadcastDialog` modal opened from a `WorkspaceTabs` button and `Ctrl+Shift+Enter`. No main-process change.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-broadcast-input-design.md`

---

## Task 1: Pure helpers

**Files:** Create `src/shared/broadcast.ts`; Test `tests/shared/broadcast.test.ts`.

- [ ] **Step 1: Failing test** — `tests/shared/broadcast.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { encodeBroadcast, terminalPaneIds } from '../../src/shared/broadcast'
import type { Workspace } from '../../src/shared/types'

describe('encodeBroadcast', () => {
  it('keys mode sends raw bytes with newlines as CR', () => {
    expect(encodeBroadcast('a\nb', 'keys', false)).toBe('a\rb')
  })
  it('paste mode wraps in bracketed-paste markers', () => {
    expect(encodeBroadcast('x', 'paste', false)).toBe('\x1b[200~x\x1b[201~')
  })
  it('appends a trailing CR (outside the paste wrapper) when enter is true', () => {
    expect(encodeBroadcast('x', 'keys', true)).toBe('x\r')
    expect(encodeBroadcast('x', 'paste', true)).toBe('\x1b[200~x\x1b[201~\r')
  })
})

describe('terminalPaneIds', () => {
  it('returns only terminal pane ids', () => {
    const ws = { id: 'w', name: 'W', layout: 'a', panes: {
      a: { paneId: 'a', config: { kind: 'terminal', shellId: 's', cwd: '' } },
      b: { paneId: 'b', config: { kind: 'editor', files: [] } },
      c: { paneId: 'c', config: { kind: 'terminal', shellId: 's', cwd: '' } }
    } } as unknown as Workspace
    expect(terminalPaneIds(ws).sort()).toEqual(['a', 'c'])
  })
  it('is empty when there are no terminals', () => {
    const ws = { id: 'w', name: 'W', layout: null, panes: {} } as unknown as Workspace
    expect(terminalPaneIds(ws)).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/shared/broadcast.test.ts` → module not found.

- [ ] **Step 3: Implement** — `src/shared/broadcast.ts`:
```ts
import type { Workspace } from './types'

/** Build the byte string to write to a PTY for a broadcast send.
 *  Newlines normalize to CR; paste mode wraps in bracketed-paste markers; a trailing
 *  Enter (CR) is appended outside the wrapper. */
export function encodeBroadcast(text: string, mode: 'paste' | 'keys', enter: boolean): string {
  const body = text.replace(/\r\n|\n/g, '\r')
  const wrapped = mode === 'paste' ? `\x1b[200~${body}\x1b[201~` : body
  return enter ? `${wrapped}\r` : wrapped
}

/** Ids of the terminal panes in a workspace (stable order). */
export function terminalPaneIds(ws: Workspace): string[] {
  return Object.keys(ws.panes).filter(id => ws.panes[id].config.kind === 'terminal')
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run tests/shared/broadcast.test.ts` → all pass.

- [ ] **Step 5: Commit**
```bash
git add src/shared/broadcast.ts tests/shared/broadcast.test.ts
git commit -m "feat(broadcast): pure encodeBroadcast + terminalPaneIds"
```

---

## Task 2: Store action + modal state

**Files:** Modify `src/renderer/store.ts`.

- [ ] **Step 1: Imports** — add to the `@shared/...` imports:
```ts
import { encodeBroadcast, terminalPaneIds } from '@shared/broadcast'
```

- [ ] **Step 2: State interface** — in the `State` interface, near `paletteOpen`, add:
```ts
  broadcastOpen: boolean
  setBroadcastOpen: (open: boolean) => void
  broadcastInput: (text: string, mode: 'paste' | 'keys', enter: boolean) => void
```

- [ ] **Step 3: Initial state** — next to `paletteOpen: false,` add:
```ts
    broadcastOpen: false,
```

- [ ] **Step 4: Implement the actions** — add alongside the other action definitions (e.g. after `setPaletteOpen` if present, else near `launchCommand`):
```ts
    setBroadcastOpen: (open) => set({ broadcastOpen: open }),

    broadcastInput: (text, mode, enter) => {
      const s = get()
      const ws = s.activeId ? s.workspaces[s.activeId] : null
      if (!ws) return
      const data = encodeBroadcast(text, mode, enter)
      for (const id of terminalPaneIds(ws)) api.ptyWrite({ id, data })
    },
```

- [ ] **Step 5: Typecheck** — `npm run typecheck` → no errors.

- [ ] **Step 6: Commit**
```bash
git add src/renderer/store.ts
git commit -m "feat(broadcast): store broadcastInput + modal state"
```

---

## Task 3: BroadcastDialog + toolbar button + shortcut

**Files:** Create `src/renderer/components/BroadcastDialog.tsx`; Modify `src/renderer/components/WorkspaceTabs.tsx`, `src/renderer/App.tsx`.

- [ ] **Step 1: Create `BroadcastDialog.tsx`**
```tsx
import { useState } from 'react'
import { useStore } from '../store'
import { terminalPaneIds } from '@shared/broadcast'

export function BroadcastDialog() {
  const open = useStore(s => s.broadcastOpen)
  const setOpen = useStore(s => s.setBroadcastOpen)
  const broadcastInput = useStore(s => s.broadcastInput)
  const ws = useStore(s => (s.activeId ? s.workspaces[s.activeId] : null))
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'paste' | 'keys'>('keys')
  const [enter, setEnter] = useState(true)
  if (!open) return null
  const count = ws ? terminalPaneIds(ws).length : 0
  const send = () => { broadcastInput(text, mode, enter); setOpen(false); setText('') }
  return (
    <div data-testid="broadcast-dialog" onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#252526', color: '#eee', border: '1px solid #444', borderRadius: 6, padding: 12, width: 460, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Broadcast to all terminals</div>
        <textarea data-testid="broadcast-text" value={text} onChange={e => setText(e.target.value)} rows={4}
          autoFocus style={{ fontFamily: 'Consolas, monospace', fontSize: 13 }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label>Send as:&nbsp;
            <select data-testid="broadcast-mode" value={mode} onChange={e => setMode(e.target.value as 'paste' | 'keys')}>
              <option value="keys">Keystrokes</option>
              <option value="paste">Paste</option>
            </select>
          </label>
          <label><input data-testid="broadcast-enter" type="checkbox" checked={enter} onChange={e => setEnter(e.target.checked)} /> Send Enter after</label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ opacity: 0.7 }}>Send to {count} terminal{count === 1 ? '' : 's'}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setOpen(false)}>Cancel</button>
            <button data-testid="broadcast-send" disabled={count === 0} onClick={send}>Send</button>
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Toolbar button in `WorkspaceTabs.tsx`** — destructure `setBroadcastOpen` and `broadcastOpen` from the `useStore()` call at the top of the component, then add a button just before the `save-workspace` button:
```tsx
      <button data-testid="broadcast-button" title="Broadcast to all terminals (Ctrl+Shift+Enter)"
        onClick={() => setBroadcastOpen(!broadcastOpen)}>⇉</button>
```

- [ ] **Step 3: Mount the dialog + shortcut in `App.tsx`** — add the import:
```tsx
import { BroadcastDialog } from './components/BroadcastDialog'
```
Mount it next to `<CommandPalette />`:
```tsx
      <BroadcastDialog />
```
And in the existing keydown effect (the one handling `Ctrl+K`), add, before the closing of the handler:
```tsx
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        const s = useStore.getState()
        s.setBroadcastOpen(!s.broadcastOpen)
      }
```

- [ ] **Step 4: Typecheck + build** — `npm run typecheck` and `npm run build` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/renderer/components/BroadcastDialog.tsx src/renderer/components/WorkspaceTabs.tsx src/renderer/App.tsx
git commit -m "feat(broadcast): BroadcastDialog + toolbar button + Ctrl+Shift+Enter"
```

---

## Task 4: e2e

**Files:** Create `tests/e2e/broadcast.spec.ts`.

- [ ] **Step 1: Write the spec** (model on `smoke.spec.ts`):
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('broadcasts a command to all terminals in the workspace', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-bcast-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(2, { timeout: 15_000 })

  await win.getByTestId('broadcast-button').click()
  await win.getByTestId('broadcast-text').fill('echo bcast-7788')
  await win.getByTestId('broadcast-send').click()

  // Both terminals echoed the broadcast command.
  const rows = win.locator('.xterm-rows')
  await expect(rows.nth(0)).toContainText('bcast-7788', { timeout: 15_000 })
  await expect(rows.nth(1)).toContainText('bcast-7788', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 2: Build + run** — `npm run build` then `npx playwright test tests/e2e/broadcast.spec.ts` → 1 passed.

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/broadcast.spec.ts
git commit -m "test(broadcast): e2e broadcast to all terminals"
```

---

## Task 5: Verify + docs

- [ ] **Step 1:** `npm run typecheck` (exit 0), `npm test`, `npm run e2e` → all green.
- [ ] **Step 2:** New feature doc `docs/features/broadcast-input.md` (what/how/key files/testing); `CHANGELOG.md` `[Unreleased] → Added`: "Broadcast a command to all terminals in a workspace (Ctrl+Shift+Enter)."
```bash
git add docs/features/broadcast-input.md CHANGELOG.md
git commit -m "docs: document broadcast input"
```

---

## Self-review notes
- Spec coverage: pure helpers (T1), store (T2), dialog/button/shortcut (T3), e2e (T4), docs (T5).
- Type consistency: `encodeBroadcast(text, mode, enter)` and `terminalPaneIds(ws)` used identically across store, dialog, tests.
- Non-goals respected (no live mirror, active workspace only, all terminals).
