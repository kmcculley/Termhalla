# Terminal Clipboard Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give terminals working copy (Ctrl+C on a selection) and paste (Ctrl+V + right-click), with paste honoring bracketed-paste mode.

**Architecture:** Clipboard access lives in the **main** process (Electron `clipboard` module) behind two new IPC channels, consistent with the app's "all privilege in main" rule. The renderer's key-to-action decision is a pure, unit-tested function; `TerminalPane` wires it to xterm's `attachCustomKeyEventHandler` and a `contextmenu` listener, and pastes via `term.paste()` so multi-line pastes don't auto-execute.

**Tech Stack:** Electron `clipboard`, `@xterm/xterm` 5.5, TypeScript, vitest (unit), Playwright-for-Electron (e2e).

**Reference:** Design spec at `docs/superpowers/specs/2026-06-16-terminal-clipboard-design.md`.

**Verified facts about this repo (do not re-derive):**
- `src/renderer/api.ts` is just `export const api: TermhallaApi = window.termhalla` — a wholesale re-export. So adding methods to `TermhallaApi` + implementing them in preload is enough; **`api.ts` needs no change**.
- The only path alias is `@shared` (→ `src/shared`). There is **no `@renderer` alias** — renderer unit tests import the component under test with a **relative path** (see `tests/renderer/explorer-tree.test.ts`: `'../../src/renderer/components/explorer-tree'`).
- `tests/e2e/seed.ts` exports only `seedWorkspace` (NOT a `test` fixture). Specs either launch Electron inline (`editor.spec.ts`) or use the inline `app` fixture defined in `tests/e2e/smoke.spec.ts`. This feature opens a fresh terminal via the `add-first-terminal` button (no seeding needed), so reuse the **smoke.spec.ts fixture pattern**.
- e2e runs against `out/` — `npm run build` is required before `npm run e2e`.

---

### Task 1: IPC contract — add clipboard channels + API methods

**Files:**
- Modify: `src/shared/ipc-contract.ts`

- [ ] **Step 1: Add the two channels to the `CH` map**

In `src/shared/ipc-contract.ts`, find the `CH` object. Add these two entries
(group them near the other renderer→main entries; order is not significant):

```ts
  clipboardWrite: 'clipboard:write',   // renderer -> main
  clipboardRead: 'clipboard:read',     // renderer -> main
```

- [ ] **Step 2: Add the two methods to the `TermhallaApi` interface**

In the same file, find the `TermhallaApi` interface and add:

```ts
  clipboardWrite(text: string): void
  clipboardRead(): Promise<string>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: it now reports that `src/preload/index.ts`'s `api` object is missing
`clipboardWrite`/`clipboardRead` (the `const api: TermhallaApi = { ... }` no longer
satisfies the interface). That is EXPECTED and fixed in Task 3. `api.ts` will NOT
error (it re-exports `window.termhalla` wholesale). Proceed.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-contract.ts
git commit -m "feat(ipc): add clipboard:read/write channels to the contract"
```

---

### Task 2: Main — clipboard registrar

**Files:**
- Create: `src/main/ipc/register-clipboard.ts`
- Modify: `src/main/ipc/register.ts`

- [ ] **Step 1: Create the registrar**

Create `src/main/ipc/register-clipboard.ts`:

```ts
import { ipcMain, clipboard } from 'electron'
import { CH } from '@shared/ipc-contract'

/** System clipboard access for the renderer (Electron's clipboard lives in main).
 *  Read is request/response; write is fire-and-forget. No long-lived resources, so
 *  no disposer. */
export function registerClipboard(): void {
  ipcMain.on(CH.clipboardWrite, (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle(CH.clipboardRead, () => clipboard.readText())
}
```

- [ ] **Step 2: Wire it into `register.ts`**

In `src/main/ipc/register.ts`, add the import alongside the other `register-*`
imports:

```ts
import { registerClipboard } from './register-clipboard'
```

Then call it in `registerHandlers`, next to the other no-disposer registrars
(e.g. right after `registerEnv(win, envVault, send)`):

```ts
  registerClipboard()
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no NEW errors from these two files (the pre-existing preload error from
Task 1 still shows until Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/register-clipboard.ts src/main/ipc/register.ts
git commit -m "feat(main): clipboard read/write registrar"
```

---

### Task 3: Preload — expose the two methods

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the passthroughs**

In `src/preload/index.ts`, inside the `api` object, add (these are NOT push
channels, so do NOT use `pushChannel` — they are a plain `send` and `invoke`):

```ts
  clipboardWrite: (text) => ipcRenderer.send(CH.clipboardWrite, text),
  clipboardRead: () => ipcRenderer.invoke(CH.clipboardRead),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (clean — the preload error from Task 1 is resolved, and `api.ts`
needs no change).

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose clipboardWrite/clipboardRead"
```

---

### Task 4: Pure key-action logic (TDD)

**Files:**
- Create: `src/renderer/components/terminal-clipboard.ts`
- Test: `tests/renderer/terminal-clipboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/terminal-clipboard.test.ts` (note the RELATIVE import —
there is no `@renderer` alias):

```ts
import { describe, it, expect } from 'vitest'
import { clipboardKeyAction } from '../../src/renderer/components/terminal-clipboard'

type KE = Parameters<typeof clipboardKeyAction>[0]
const ev = (over: Partial<KE>): KE => ({
  type: 'keydown', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: 'a', ...over
})

describe('clipboardKeyAction', () => {
  it('Ctrl+C with a selection -> copy', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'c' }), true)).toBe('copy')
  })
  it('Ctrl+C with no selection -> null (so ^C passes through)', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'c' }), false)).toBeNull()
  })
  it('Ctrl+V -> paste (regardless of selection)', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'v' }), false)).toBe('paste')
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'v' }), true)).toBe('paste')
  })
  it('Cmd+V (metaKey) -> paste', () => {
    expect(clipboardKeyAction(ev({ metaKey: true, key: 'v' }), false)).toBe('paste')
  })
  it('matches C/V case-insensitively', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, key: 'C' }), true)).toBe('copy')
  })
  it('ignores non-keydown events', () => {
    expect(clipboardKeyAction(ev({ type: 'keyup', ctrlKey: true, key: 'c' }), true)).toBeNull()
  })
  it('ignores Alt+Ctrl+C and Ctrl+Shift+C/V', () => {
    expect(clipboardKeyAction(ev({ ctrlKey: true, altKey: true, key: 'c' }), true)).toBeNull()
    expect(clipboardKeyAction(ev({ ctrlKey: true, shiftKey: true, key: 'c' }), true)).toBeNull()
    expect(clipboardKeyAction(ev({ ctrlKey: true, shiftKey: true, key: 'v' }), false)).toBeNull()
  })
  it('ignores plain c/v without a modifier', () => {
    expect(clipboardKeyAction(ev({ key: 'c' }), true)).toBeNull()
    expect(clipboardKeyAction(ev({ key: 'v' }), false)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/terminal-clipboard.test.ts`
Expected: FAIL — cannot resolve `terminal-clipboard` (module does not exist yet).

- [ ] **Step 3: Implement the pure function**

Create `src/renderer/components/terminal-clipboard.ts`:

```ts
export type ClipboardAction = 'copy' | 'paste' | null

/** Decide what a terminal key event means for the clipboard.
 *  - Ctrl/Cmd+C with a selection -> 'copy'; without -> null (let ^C through to the PTY).
 *  - Ctrl/Cmd+V -> 'paste'.
 *  - Anything else (non-keydown, Alt or Shift held, other keys) -> null. */
export function clipboardKeyAction(
  e: Pick<KeyboardEvent, 'type' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key'>,
  hasSelection: boolean
): ClipboardAction {
  if (e.type !== 'keydown') return null
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null
  const key = e.key.toLowerCase()
  if (key === 'c') return hasSelection ? 'copy' : null
  if (key === 'v') return 'paste'
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/terminal-clipboard.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/terminal-clipboard.ts tests/renderer/terminal-clipboard.test.ts
git commit -m "feat(renderer): pure clipboardKeyAction + unit tests"
```

---

### Task 5: Wire clipboard into TerminalPane

**Files:**
- Modify: `src/renderer/components/TerminalPane.tsx`

- [ ] **Step 1: Add the import**

At the top of `src/renderer/components/TerminalPane.tsx`, add (next to the other
local imports):

```ts
import { clipboardKeyAction } from './terminal-clipboard'
```

- [ ] **Step 2: Install the handlers in the mount effect**

In the mount effect, AFTER `fit.fit()` and `termRef.current = term`, and BEFORE
the `return () => { ... }` cleanup, add:

```ts
    const paste = async () => {
      const text = await api.clipboardRead()
      if (text) term.paste(text)   // term.paste honors bracketed-paste mode; flows out via onData
    }
    term.attachCustomKeyEventHandler(e => {
      const action = clipboardKeyAction(e, term.hasSelection())
      if (action === 'copy') { api.clipboardWrite(term.getSelection()); term.clearSelection(); return false }
      if (action === 'paste') { void paste(); return false }
      return true
    })
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); void paste() }
    hostRef.current!.addEventListener('contextmenu', onContextMenu)
```

- [ ] **Step 3: Remove the contextmenu listener on cleanup**

In the SAME effect's existing cleanup function (the `return () => { ... }`), add
this line next to the other teardown calls (e.g. after `ro.disconnect()`):

```ts
      hostRef.current?.removeEventListener('contextmenu', onContextMenu)
```

(The custom key handler needs no removal — it is disposed with `term.dispose()`.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (clean).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TerminalPane.tsx
git commit -m "feat(renderer): copy on Ctrl+C selection, paste on Ctrl+V + right-click"
```

---

### Task 6: e2e test — copy and paste against the real app

**Files:**
- Create: `tests/e2e/clipboard.spec.ts`

- [ ] **Step 1: Confirm the fixture + terminal-open pattern**

Run: `sed -n '1,45p' tests/e2e/smoke.spec.ts`
Confirm the inline `test`/`app` fixture (a `base.extend` that launches Electron
against `out/main/index.js` and `killTree`s on teardown), that a terminal opens via
`win.getByTestId('add-first-terminal').click()`, and that the screen is
`win.locator('.xterm-screen')`. The spec below copies that fixture verbatim.

- [ ] **Step 2: Write the e2e spec**

Create `tests/e2e/clipboard.spec.ts`:

```ts
import { test as base, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch { /* already gone */ }
}

const test = base.extend<{ app: ElectronApplication }>({
  app: async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'termh-clip-'))
    const app = await electron.launch({
      args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
    })
    await use(app)
    const pid = app.process().pid
    if (pid) killTree(pid)
  }
})

async function openTerminal(app: ElectronApplication) {
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })
  return win
}

test('copies a selected line with Ctrl+C', async ({ app }) => {
  const win = await openTerminal(app)
  await win.locator('.xterm-screen').click()
  await win.keyboard.type('echo CLIP-COPY-TOKEN')
  await win.keyboard.press('Enter')
  await expect(win.locator('.xterm-rows')).toContainText('CLIP-COPY-TOKEN', { timeout: 15_000 })

  // Triple-click the echoed output line to select it, then copy.
  await win.locator('.xterm-rows').getByText('CLIP-COPY-TOKEN', { exact: false }).first()
    .click({ clickCount: 3 })
  await win.keyboard.press('Control+c')

  await expect.poll(
    () => app.evaluate(({ clipboard }) => clipboard.readText()),
    { timeout: 5_000 }
  ).toContain('CLIP-COPY-TOKEN')
})

test('pastes the clipboard with Ctrl+V', async ({ app }) => {
  const win = await openTerminal(app)
  await app.evaluate(({ clipboard }) => clipboard.writeText('PASTE-V-TOKEN'))
  await win.locator('.xterm-screen').click()
  await win.keyboard.press('Control+v')
  await expect(win.locator('.xterm-rows')).toContainText('PASTE-V-TOKEN', { timeout: 15_000 })
})

test('pastes the clipboard on right-click', async ({ app }) => {
  const win = await openTerminal(app)
  await app.evaluate(({ clipboard }) => clipboard.writeText('PASTE-RMB-TOKEN'))
  await win.locator('.xterm-screen').click({ button: 'right' })
  await expect(win.locator('.xterm-rows')).toContainText('PASTE-RMB-TOKEN', { timeout: 15_000 })
})
```

- [ ] **Step 3: Build (required — e2e runs against `out/`)**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Run the new e2e spec**

Run: `npx playwright test clipboard.spec.ts`
Expected: 3 passed.

Troubleshooting: the triple-click selects the whole row (incl. trailing spaces);
`.toContain('CLIP-COPY-TOKEN')` tolerates that. The paste tests click
`.xterm-screen` first to ensure focus before the key/right-click.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/clipboard.spec.ts
git commit -m "test(e2e): terminal copy (Ctrl+C) and paste (Ctrl+V, right-click)"
```

---

### Task 7: Full regression + docs

**Files:**
- Modify: `docs/features/workspaces.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all green (existing + the new `terminal-clipboard` tests).

- [ ] **Step 2: Run the full e2e suite**

Run: `npm run e2e`
Expected: all specs pass (the suite is pinned to `workers: 1`).

- [ ] **Step 3: Document the terminal clipboard behavior**

In `docs/features/workspaces.md`, add this subsection under the terminal behavior
(find the section describing terminal panes / input):

```markdown
### Clipboard

- **Copy:** select text with the mouse and press **Ctrl+C**. With a selection,
  Ctrl+C copies it (and clears the selection); with no selection, Ctrl+C sends the
  interrupt signal (`^C`) as usual.
- **Paste:** **Ctrl+V** or **right-click**. Paste goes through xterm's
  bracketed-paste path, so pasting multi-line text into a shell or a TUI does not
  auto-execute each line.
- Clipboard access is handled in the main process (Electron `clipboard`) over the
  `clipboard:read` / `clipboard:write` IPC channels; the renderer never touches the
  OS clipboard directly.
```

- [ ] **Step 4: Add a changelog entry**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, add:

```markdown
- **Terminal clipboard** — copy a mouse selection with **Ctrl+C** (falls back to
  `^C` interrupt when nothing is selected), and paste with **Ctrl+V** or
  **right-click** (bracketed-paste-safe, so multi-line pastes don't auto-run).
```

- [ ] **Step 5: Commit**

```bash
git add docs/features/workspaces.md CHANGELOG.md
git commit -m "docs: terminal clipboard (copy/paste) behavior + changelog"
```

---

## Notes for the implementer

- **xterm API used:** `term.hasSelection()`, `term.getSelection()`,
  `term.clearSelection()`, `term.paste(text)`, `term.attachCustomKeyEventHandler(cb)`.
  All exist in `@xterm/xterm` 5.5. `attachCustomKeyEventHandler`'s callback returns
  `boolean`: `false` = xterm does NOT process the key (so it is not sent to the PTY);
  `true` = normal handling.
- **Why `term.paste()` not `api.ptyWrite()`:** `paste()` wraps the text in
  bracketed-paste markers when the app has enabled that mode and emits it through the
  existing `term.onData → api.ptyWrite` path. A raw `ptyWrite` would bypass bracketing
  and could auto-execute pasted newlines.
- **Copy is fire-and-forget** (`ipcRenderer.send`); **read is async** (`invoke`), so
  the paste helper is `async`.
- Do NOT add copy-on-select, a context menu, Shift variants, or toasts — explicitly
  out of scope per the spec.
```
