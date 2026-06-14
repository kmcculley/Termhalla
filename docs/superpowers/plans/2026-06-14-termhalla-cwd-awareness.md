# Termhalla — CWD Awareness + Explorer-to-cwd — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track each terminal's live working directory (from the shell-integration scripts), persist it for restore, inherit it on splits, and add "Open Explorer here" / "Reveal in File Explorer" per-terminal actions.

**Architecture:** The injected shell scripts emit a cwd report each prompt (PowerShell → OSC 9;9, bash → OSC 7). A pure `CwdParser` in main extracts it from the same byte stream that feeds the status engine; the `StatusEngine` gains an `onCwd` callback. cwd flows to the renderer over a new `pty:cwd` channel into a per-terminal map, is folded into `TerminalConfig.cwd` at save (restore), and powers the two explorer actions.

**Tech Stack:** (unchanged) Electron, TypeScript, node-pty, React, zustand, vitest, @playwright/test.

**Pre-req:** Phases 1–3 merged to `main` (default branch). Create the branch before Task 1:
`git checkout -b feat/cwd-awareness`

All commits append the trailer and use the identity flag if needed:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
`git -c user.name='Termhalla Dev' -c user.email='kevin.mcculley@gmail.com' commit ...`. Use the PowerShell tool for npm/npx (Windows).

---

## File Structure

```
src/main/status/
  cwd-parser.ts          # NEW: CwdParser (pure) — OSC 9;9 + OSC 7 -> Windows path
  integration-scripts.ts # MODIFY: emit cwd report (ps1 OSC 9;9, sh OSC 7)
  status-engine.ts       # MODIFY: onCwd callback + per-session CwdParser
src/shared/ipc-contract.ts # MODIFY: CH.ptyCwd + CH.revealPath; TermhallaApi.onPtyCwd/revealPath
src/preload/index.ts       # MODIFY: onPtyCwd + revealPath
src/main/ipc/register.ts   # MODIFY: wire engine onCwd -> safeSend(ptyCwd); shell.openPath handler
src/renderer/
  store.ts                 # MODIFY: cwds map, setCwd, cwd-folding in saveAll, split inherit, openExplorerHere
  App.tsx                  # MODIFY: subscribe onPtyCwd -> setCwd
  components/WorkspaceView.tsx # MODIFY: cwd button + menu (open here / reveal) + data-cwd attr
tests/main/cwd-parser.test.ts   # NEW
tests/main/status-engine.test.ts # MODIFY: add an onCwd arg + a cwd test
tests/e2e/cwd.spec.ts            # NEW
```

---

## Task 1: CwdParser (pure, TDD)

**Files:** Create `src/main/status/cwd-parser.ts`, `tests/main/cwd-parser.test.ts`

- [ ] **Step 1: Write the failing test `tests/main/cwd-parser.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import { CwdParser } from '../../src/main/status/cwd-parser'

const ESC = '\x1b', BEL = '\x07'

describe('CwdParser', () => {
  it('extracts an OSC 9;9 Windows path (PowerShell form)', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]9;9;C:\\dev\\Termhalla${BEL}`)).toBe('C:\\dev\\Termhalla')
  })
  it('extracts an OSC 7 dos-style file URL', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]7;file://host/C:/dev/app${BEL}`)).toBe('C:\\dev\\app')
  })
  it('translates an OSC 7 msys path (/c/...) to a Windows path', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]7;file://host/c/dev/app${BEL}`)).toBe('C:\\dev\\app')
  })
  it('translates an OSC 7 WSL mount (/mnt/c/...) to a Windows path', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]7;file://host/mnt/c/work${BEL}`)).toBe('C:\\work')
  })
  it('URL-decodes spaces in an OSC 7 path', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]7;file://host/C:/my%20dir${BEL}`)).toBe('C:\\my dir')
  })
  it('returns the most recent cwd when several arrive in one chunk', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]9;9;C:\\a${BEL}out${ESC}]9;9;C:\\b${BEL}`)).toBe('C:\\b')
  })
  it('handles a report split across two chunks', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]9;9;C:\\de`)).toBeNull()
    expect(p.push(`v${BEL}`)).toBe('C:\\dev')
  })
  it('ignores unrelated OSC sequences (title, status markers)', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]0;some title${BEL}${ESC}]133;A${BEL}`)).toBeNull()
  })
  it('returns null on plain output', () => {
    const p = new CwdParser()
    expect(p.push('just regular output\r\n')).toBeNull()
  })
})
```

- [ ] **Step 2: Run (FAIL)** — `npx vitest run tests/main/cwd-parser.test.ts` → module not found.

- [ ] **Step 3: Create `src/main/status/cwd-parser.ts`**
```ts
const OSC = '\x1b]'

/** Convert an OSC 7 file URL body (file://host/<path>) to a Windows path, best-effort. */
function fileUrlToWindows(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data)
  if (!m) return null
  let p = decodeURIComponent(m[1])
  let dos = /^\/([a-zA-Z]):(.*)$/.exec(p)        // /C:/dev
  if (dos) return `${dos[1].toUpperCase()}:${dos[2]}`.replace(/\//g, '\\')
  const wsl = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p) // /mnt/c/work
  if (wsl) return `${wsl[1].toUpperCase()}:${wsl[2] ?? ''}`.replace(/\//g, '\\')
  const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(p)    // /c/dev
  if (msys) return `${msys[1].toUpperCase()}:${msys[2] ?? ''}`.replace(/\//g, '\\')
  return p                                          // leave non-Windows paths as-is
}

function parseOsc(body: string): string | null {
  const sep = body.indexOf(';')
  if (sep === -1) return null
  const num = body.slice(0, sep)
  const data = body.slice(sep + 1)
  if (num === '9' && data.startsWith('9;')) return data.slice(2)   // OSC 9;9;<windows path>
  if (num === '7') return fileUrlToWindows(data)                   // OSC 7;file://...
  return null
}

/** Stateful scanner: feed PTY output chunks, get the latest reported cwd (or null). */
export class CwdParser {
  private buf = ''

  push(chunk: string): string | null {
    this.buf += chunk
    let cwd: string | null = null
    while (true) {
      const start = this.buf.indexOf(OSC)
      if (start === -1) break
      const from = start + OSC.length
      const bel = this.buf.indexOf('\x07', from)
      const st = this.buf.indexOf('\x1b\\', from)
      let end = -1, termLen = 0
      if (bel !== -1 && (st === -1 || bel < st)) { end = bel; termLen = 1 }
      else if (st !== -1) { end = st; termLen = 2 }
      if (end === -1) { this.buf = this.buf.slice(start); return cwd }  // incomplete; keep
      const c = parseOsc(this.buf.slice(from, end))
      if (c !== null && c !== '') cwd = c
      this.buf = this.buf.slice(end + termLen)
    }
    const lastEsc = this.buf.lastIndexOf('\x1b')
    this.buf = lastEsc !== -1 && OSC.startsWith(this.buf.slice(lastEsc)) ? this.buf.slice(lastEsc) : ''
    return cwd
  }
}
```

- [ ] **Step 4: Run (PASS)** — `npx vitest run tests/main/cwd-parser.test.ts` → 9 pass. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**
```
git add -A && git commit -m "feat: cwd report parser (OSC 9;9 + OSC 7 -> windows path)"
```

---

## Task 2: Emit cwd reports from the shell-integration scripts

**Files:** Modify `src/main/status/integration-scripts.ts`

The PowerShell prompt currently emits OSC 133 D + A. Add OSC 9;9 with the filesystem path. The bash `__th_prompt` emits D + A; add OSC 7.

- [ ] **Step 1: Edit `POWERSHELL_INTEGRATION`** — in the `prompt` function, after the two `[Console]::Write(...133...)` lines, add a cwd report:
```powershell
  [Console]::Write("$e]9;9;$($pwd.ProviderPath)$b")
```
(So the prompt function emits `D`, `A`, then `9;9;<path>`. `$pwd.ProviderPath` is the filesystem path even on PSDrives.)

- [ ] **Step 2: Edit `BASH_INTEGRATION`** — change the `__th_prompt` line to also emit OSC 7 with the cwd. Replace:
```
'__th_prompt() { local c=$?; printf \'\\033]133;D;%s\\007\\033]133;A\\007\' "$c"; }\n' +
```
with:
```
'__th_prompt() { local c=$?; printf \'\\033]133;D;%s\\007\\033]133;A\\007\\033]7;file://%s%s\\007\' "$c" "$HOSTNAME" "$PWD"; }\n' +
```
(`$PWD` in Git Bash is `/c/dev/...`; in WSL `/home/...` or `/mnt/c/...` — the CwdParser translates the Windows-mapped forms and leaves pure-Linux paths as-is.)

- [ ] **Step 3: Add a content assertion test** to `tests/main/shell-integration.test.ts` (append inside the existing describe — confirm the scripts carry a cwd report so a future edit doesn't silently drop it):
```ts
import { POWERSHELL_INTEGRATION, BASH_INTEGRATION } from '../../src/main/status/integration-scripts'

describe('integration scripts emit a cwd report', () => {
  it('PowerShell emits OSC 9;9 with the provider path', () => {
    expect(POWERSHELL_INTEGRATION).toContain(']9;9;')
    expect(POWERSHELL_INTEGRATION).toContain('ProviderPath')
  })
  it('bash emits OSC 7 file URL', () => {
    expect(BASH_INTEGRATION).toContain(']7;file://')
  })
})
```

- [ ] **Step 4: Run + typecheck + commit**
Run: `npx vitest run tests/main/shell-integration.test.ts` → pass. `npm run typecheck` → clean.
```
git add -A && git commit -m "feat: shell-integration scripts report cwd each prompt"
```

---

## Task 3: StatusEngine emits cwd changes

**Files:** Modify `src/main/status/status-engine.ts`, `tests/main/status-engine.test.ts`

- [ ] **Step 1: Update the engine test** `tests/main/status-engine.test.ts` — the constructor gains an `onCwd` second arg (before `now`). Update BOTH existing `new StatusEngine(...)` calls to pass a cwd collector, and add a cwd test.

Change each existing construction from:
```ts
engine = new StatusEngine((id, st) => events.push([id, { ...st }]), () => clock)
```
to:
```ts
engine = new StatusEngine((id, st) => events.push([id, { ...st }]), () => {}, () => clock)
```
Then add this test inside the `describe('StatusEngine', ...)` block:
```ts
it('emits cwd changes (deduped) from OSC 9;9 reports', () => {
  const cwds: Array<[string, string]> = []
  let clock = 0
  engine = new StatusEngine(() => {}, (id, cwd) => cwds.push([id, cwd]), () => clock)
  engine.register('t1')
  engine.feed('t1', `${ESC}]9;9;C:\\a${BEL}`)
  engine.feed('t1', 'output')                 // no cwd -> no emit
  engine.feed('t1', `${ESC}]9;9;C:\\a${BEL}`)  // same cwd -> no emit
  engine.feed('t1', `${ESC}]9;9;C:\\b${BEL}`)  // changed -> emit
  expect(cwds).toEqual([['t1', 'C:\\a'], ['t1', 'C:\\b']])
})
```
(`ESC` and `BEL` consts already exist at the top of this test file.)

- [ ] **Step 2: Run (FAIL)** — `npx vitest run tests/main/status-engine.test.ts` → fails (constructor arity / cwd test).

- [ ] **Step 3: Edit `src/main/status/status-engine.ts`**
Add the import and extend the session + constructor.
```ts
import { CwdParser } from './cwd-parser'
```
Change the `Session` interface to include a cwd parser + last cwd:
```ts
interface Session { parser: Osc133Parser; tracker: StatusTracker; last: string; cwdParser: CwdParser; lastCwd: string }
```
Change the constructor signature to add `onCwd`:
```ts
  constructor(
    private readonly onStatus: (id: string, status: TerminalStatus) => void,
    private readonly onCwd: (id: string, cwd: string) => void,
    private readonly now: () => number = () => Date.now()
  ) {}
```
In `register`, create the cwd parser:
```ts
    this.sessions.set(id, {
      parser: new Osc133Parser(),
      tracker: new StatusTracker(this.now(), defaultConfig()),
      last: '',
      cwdParser: new CwdParser(),
      lastCwd: ''
    })
```
In `feed`, after the existing marker/output handling and before `this.emit(id)`, parse + emit cwd:
```ts
    const cwd = s.cwdParser.push(data)
    if (cwd && cwd !== s.lastCwd) { s.lastCwd = cwd; this.onCwd(id, cwd) }
```

- [ ] **Step 4: Run (PASS) + suite** — `npx vitest run tests/main/status-engine.test.ts` → pass. `npm test` → full suite green. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**
```
git add -A && git commit -m "feat: status engine parses and emits per-terminal cwd"
```

---

## Task 4: IPC contract + preload (pty:cwd + reveal)

**Files:** Modify `src/shared/ipc-contract.ts`, `src/preload/index.ts`

- [ ] **Step 1: Edit `src/shared/ipc-contract.ts`**
Add channels to `CH` (before `} as const`; ensure trailing comma on the prior line):
```ts
  ptyCwd: 'pty:cwd',          // main -> renderer event
  revealPath: 'shell:reveal'
```
Add to `TermhallaApi`:
```ts
  onPtyCwd(cb: (id: string, cwd: string) => void): () => void
  revealPath(path: string): Promise<void>
```

- [ ] **Step 2: Edit `src/preload/index.ts`** — add to the `api` object:
```ts
  revealPath: (path) => ipcRenderer.invoke(CH.revealPath, path),
  onPtyCwd: (cb) => {
    const h = (_e: unknown, id: string, cwd: string) => cb(id, cwd)
    ipcRenderer.on(CH.ptyCwd, h as never)
    return () => ipcRenderer.removeListener(CH.ptyCwd, h as never)
  },
```

- [ ] **Step 3: Typecheck + build + commit**
Run: `npm run typecheck` → clean (preload conformance). `npm run build` → succeeds; `grep -o "preload/index\.[a-z]*" out/main/index.js` → `preload/index.mjs`.
```
git add -A && git commit -m "feat: pty:cwd + reveal IPC contract and preload"
```

---

## Task 5: Wire cwd + reveal in main

**Files:** Modify `src/main/ipc/register.ts`

- [ ] **Step 1: Add `shell` to the electron import** — change `import { ipcMain, Notification, dialog, type BrowserWindow } from 'electron'` to also import `shell`:
```ts
import { ipcMain, Notification, dialog, shell, type BrowserWindow } from 'electron'
```

- [ ] **Step 2: Pass `onCwd` when constructing the engine** — change:
```ts
  const engine = new StatusEngine((id, status) => safeSend(CH.ptyStatus, id, status))
```
to:
```ts
  const engine = new StatusEngine(
    (id, status) => safeSend(CH.ptyStatus, id, status),
    (id, cwd) => safeSend(CH.ptyCwd, id, cwd)
  )
```

- [ ] **Step 3: Add the reveal handler** — near the dialog handlers, add:
```ts
  ipcMain.handle(CH.revealPath, async (_e, path: string) => { await shell.openPath(path) })
```

- [ ] **Step 4: Typecheck + build + suite + commit**
Run: `npm run typecheck` → clean. `npm run build` → succeeds. `npm test` → green.
```
git add -A && git commit -m "feat: forward pty:cwd to renderer and handle reveal-in-explorer"
```

---

## Task 6: Renderer store — cwd map + persistence + subscription

**Files:** Modify `src/renderer/store.ts`, `src/renderer/App.tsx`

- [ ] **Step 1: Edit `src/renderer/store.ts`**
Add a module-level helper above `export const useStore` (returns a workspace with each terminal pane's `config.cwd` set from the live cwds map):
```ts
function applyCwds(ws: import('@shared/types').Workspace, cwds: Record<string, string>): import('@shared/types').Workspace {
  let changed = false
  const panes = { ...ws.panes }
  for (const id of Object.keys(panes)) {
    const pane = panes[id]
    if (pane.config.kind === 'terminal' && cwds[id] && cwds[id] !== pane.config.cwd) {
      panes[id] = { ...pane, config: { ...pane.config, cwd: cwds[id] } }
      changed = true
    }
  }
  return changed ? { ...ws, panes } : ws
}

export function paneCwd(s: { cwds: Record<string, string>; workspaces: Record<string, import('@shared/types').Workspace> }, paneId: string): string {
  if (s.cwds[paneId]) return s.cwds[paneId]
  for (const ws of Object.values(s.workspaces)) {
    const pane = ws.panes[paneId]
    if (pane?.config.kind === 'terminal') return pane.config.cwd
  }
  return ''
}
```
Add to the `State` interface:
```ts
  cwds: Record<string, string>
  setCwd: (id: string, cwd: string) => void
```
Add `cwds: {},` to the initial state.
Add the action (after `setStatus`):
```ts
    setCwd: (id, cwd) => {
      if (get().cwds[id] === cwd) return
      set(s => ({ cwds: { ...s.cwds, [id]: cwd } }))
      scheduleAutosave()   // persist into config.cwd (debounced) so restore uses it
    },
```
Change `saveAll` to fold cwds into each workspace before saving:
```ts
    saveAll: async () => {
      const { order, workspaces, activeId, cwds } = get()
      await Promise.all(order.map(id => api.saveWorkspace(applyCwds(workspaces[id], cwds))))
      await api.saveAppState({
        schemaVersion: 1, openWorkspaceIds: order, activeWorkspaceId: activeId
      })
    },
```

- [ ] **Step 2: Edit `src/renderer/App.tsx`** — add a subscription effect (after the existing `onPtyStatus` effect):
```tsx
  useEffect(() => {
    const off = api.onPtyCwd((id, cwd) => useStore.getState().setCwd(id, cwd))
    return off
  }, [])
```

- [ ] **Step 3: Typecheck + suite + commit**
Run: `npm run typecheck` → clean. `npm test` → green.
```
git add -A && git commit -m "feat: track per-terminal cwd in the renderer and persist for restore"
```

---

## Task 7: Store — split inherit + openExplorerHere

**Files:** Modify `src/renderer/store.ts`

- [ ] **Step 1: Make a split inherit the source terminal's cwd** — in `addTerminal`, derive the cwd from the target pane:
Change the body of `addTerminal` so the new terminal config carries the inherited cwd:
```ts
    addTerminal: (wsId, targetPaneId, dir) => {
      const ws = get().workspaces[wsId]
      const shellId = get().newTerminalShellId ?? get().shells[0]?.id ?? 'cmd'
      const cwd = targetPaneId ? paneCwd(get(), targetPaneId) : ''
      const cfg: TerminalConfig = { kind: 'terminal', shellId, cwd }
      const r = ws.layout === null || targetPaneId === null
        ? addFirstPane(ws, cfg, uuid)
        : splitPane(ws, targetPaneId, dir, cfg, uuid)
      set(s => ({ workspaces: { ...s.workspaces, [wsId]: r.workspace } }))
      scheduleAutosave()
      return r.paneId
    },
```
(`paneCwd` is the helper from Task 6. `defaultTerminal` is no longer needed by `addTerminal`; leave the `defaultTerminal` helper if other code uses it, otherwise inline as above.)

- [ ] **Step 2: Add `openExplorerHere`** — add to the `State` interface:
```ts
  openExplorerHere: (wsId: string, paneId: string) => void
```
Add the action (after `addExplorer`):
```ts
    openExplorerHere: (wsId, paneId) => {
      const root = paneCwd(get(), paneId)
      if (!root) return
      get().addExplorer(wsId, paneId, 'row', root)
    },
```

- [ ] **Step 3: Typecheck + suite + commit**
Run: `npm run typecheck` → clean. `npm test` → green. `npm run build` → succeeds.
```
git add -A && git commit -m "feat: new terminals inherit source cwd; openExplorerHere action"
```

---

## Task 8: WorkspaceView — cwd button, menu, and data-cwd

**Files:** Modify `src/renderer/components/WorkspaceView.tsx`

- [ ] **Step 1: Add cwd state + selectors** — near the other `useStore`/`useState` calls in `WorkspaceView`, add:
```tsx
  const cwds = useStore(s => s.cwds)
  const openExplorerHere = useStore(s => s.openExplorerHere)
  const [cwdMenuFor, setCwdMenuFor] = useState<string | null>(null)
```

- [ ] **Step 2: In `renderTile`, compute the pane cwd and add a toolbar button + data attribute.**
Inside the `renderTile` callback, after `const pane = ws.panes[paneId]`, add:
```tsx
        const cwd = cwds[paneId] ?? (pane?.config.kind === 'terminal' ? pane.config.cwd : '')
```
Add a 📁 toolbar control as the FIRST entry of `toolbarControls` (only meaningful for terminals, but harmless elsewhere):
```tsx
              <button key="cwd" data-testid={`cwd-${paneId}`} title="Folder actions"
                onClick={() => setCwdMenuFor(cwdMenuFor === paneId ? null : paneId)}>📁</button>,
```
On the tile wrapper `<div className={...} data-status={state} ...>`, add the cwd attribute:
```tsx
              data-cwd={cwd}
```
Inside that tile `<div>`, alongside the `TerminalSettings` popover, add the cwd menu:
```tsx
              {cwdMenuFor === paneId && (
                <div data-testid="cwd-menu" onClick={e => e.stopPropagation()}
                  style={{ position: 'absolute', right: 4, top: 28, zIndex: 10, background: '#252526',
                    color: '#eee', border: '1px solid #444', borderRadius: 4, padding: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button data-testid={`open-explorer-here-${paneId}`} disabled={!cwd}
                    onClick={() => { openExplorerHere(ws.id, paneId); setCwdMenuFor(null) }}>Open Explorer here</button>
                  <button data-testid={`reveal-here-${paneId}`} disabled={!cwd}
                    onClick={() => { void api.revealPath(cwd); setCwdMenuFor(null) }}>Reveal in File Explorer</button>
                </div>
              )}
```
Ensure `api` is imported (`import { api } from '../api'`) and `useState` is imported from React (it already is for `settingsFor`).

- [ ] **Step 3: Typecheck + build + existing e2e + commit**
Run: `npm run typecheck` → clean. `npm run build` → succeeds. `npm run e2e` → existing suite still green (the new button doesn't break Phase 1–3 tests; the cwd-button is an extra toolbar control).
```
git add -A && git commit -m "feat: per-terminal folder menu (open explorer here / reveal) + data-cwd"
```

---

## Task 9: End-to-end (cwd update, open-here, restore)

**Files:** Create `tests/e2e/cwd.spec.ts`

- [ ] **Step 1: Create `tests/e2e/cwd.spec.ts`**
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try { if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {}
}

test('tracks cwd, opens explorer here, and restores the directory', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-cwd-'))
  const proj = mkdtempSync(join(tmpdir(), 'termh-cwdproj-'))
  const sub = join(proj, 'subdir')
  mkdirSync(sub)
  writeFileSync(join(sub, 'marker.txt'), 'x', 'utf8')

  const launch = () => electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })

  // Session 1: PowerShell terminal, cd into the subdir, assert cwd tracked.
  let app: ElectronApplication = await launch()
  let win = await app.firstWindow()
  await win.getByTestId('shell-picker').selectOption('powershell')
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  await win.locator('.xterm-screen').click()
  await win.keyboard.type(`Set-Location '${sub}'`)
  await win.keyboard.press('Enter')
  // the tile's data-cwd reflects the new directory
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${sub}"]`)).toHaveCount(1, { timeout: 15_000 })

  // Open Explorer here -> an explorer pane rooted at the subdir shows marker.txt
  await win.locator('[data-testid^="cwd-"]').first().click()
  await win.locator('[data-testid^="open-explorer-here-"]').first().click()
  await expect(win.getByTestId('entry-marker.txt')).toBeVisible({ timeout: 15_000 })

  // Save + relaunch -> the terminal restored at the subdir
  await win.getByTestId('save-workspace').click()
  await win.waitForTimeout(800)
  const pid1 = app.process().pid; if (pid1) killTree(pid1)

  app = await launch()
  win = await app.firstWindow()
  await expect(win.locator(`[data-testid^="tile-"][data-cwd="${sub}"]`)).toHaveCount(1, { timeout: 20_000 })
  const pid2 = app.process().pid; await app.close().catch(() => {}); if (pid2) killTree(pid2)
})
```

- [ ] **Step 2: Build + run**
Run: `npm run build && npx playwright test tests/e2e/cwd.spec.ts`
Expected: PASS. If `data-cwd` never updates, the PowerShell OSC 9;9 report isn't reaching the parser — capture the renderer/main console and check the `prompt` script emits `]9;9;` and `CwdParser`/engine wiring. If "Open Explorer here" shows no `marker.txt`, confirm `openExplorerHere` roots the explorer at the cwd and `paneCwd` returns it. Do NOT loosen assertions — investigate the real cause.

- [ ] **Step 3: Full e2e + commit**
Run: `npm run e2e` → all pass (Phase 1–3 + this one).
```
git add -A && git commit -m "test: e2e cwd tracking, open-explorer-here, and restore"
```

---

## Task 10: Verification pass

- [ ] **Step 1: Full gates**
Run: `npm run typecheck && npm test && npm run build && npm run e2e`
Expected: typecheck clean; all unit tests pass (adds cwd-parser ~9 + engine cwd 1 + script-content 2); build succeeds; all e2e pass.

- [ ] **Step 2: Manual acceptance**
In `npm run dev`, confirm by hand:
- A PowerShell terminal: `cd` around → the 📁 menu's actions target the current directory; "Open Explorer here" opens an in-app explorer at that dir; "Reveal in File Explorer" opens Windows Explorer there.
- Split a terminal whose cwd is some subdir → the new terminal starts in that subdir.
- Save + restart → terminals reopen at their last directory.
- A cmd terminal: no live cwd updates (uses its spawn dir) — the menu still targets that spawn dir.

- [ ] **Step 3: Commit any adjustments**
```
git add -A && git commit -m "chore: cwd-awareness verification adjustments"
```

---

## Self-Review notes (resolved)

- **Spec coverage:** live cwd via shell-integration reports, integration-only (§3) ✓ Tasks 1–3; pwsh OSC 9;9 + bash OSC 7 ✓ Task 2; `pty:cwd` channel + per-terminal map ✓ Tasks 4–6; persist into `TerminalConfig.cwd` for restore ✓ Task 6 (`applyCwds` in saveAll); Open Explorer here (new in-app pane) ✓ Tasks 7–8; Reveal in OS via `shell.openPath` ✓ Tasks 5,8; inherit cwd on terminal split ✓ Task 7; testing unit+e2e ✓ Tasks 1,3,9.
- **Type consistency:** `CwdParser.push -> string|null`, `StatusEngine(onStatus, onCwd, now?)`, `CH.ptyCwd`/`CH.revealPath`, `onPtyCwd`/`revealPath`, store `cwds`/`setCwd`/`paneCwd`/`openExplorerHere`, and the `applyCwds` fold are used consistently across tasks. `addExplorer(wsId, targetPaneId, dir, root)` (Phase 3) is reused by `openExplorerHere`.
- **Scope notes flagged:** WSL pure-Linux cwds (e.g. `/home/...`) can't be opened by Windows Explorer — the parser leaves them as-is and Reveal will fail gracefully (a known limitation, noted). cmd has no live cwd (spawn dir only), consistent with status.
- **No placeholders:** every code step is complete.
```