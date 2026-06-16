# Terminal Clipboard Support — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming → ready for implementation plan)

## Problem

Terminals have no working clipboard. Selecting text and pressing **Ctrl+C** does
nothing useful (Ctrl+C is the interrupt/`^C` signal), selecting + Enter does
nothing, and there is no paste path at all. Users need to copy terminal text out
and paste text in.

## Goals

- **Copy:** Ctrl+C copies the current selection when there is one, and otherwise
  sends `^C` (interrupt) exactly as today. After a copy, the selection is cleared.
- **Paste:** Ctrl+V pastes, and right-click pastes.
- Pasting is **bracketed-paste-safe** — pasting multi-line text into a shell or a
  TUI (e.g. Claude) must not auto-execute each line.

## Non-goals (YAGNI)

- Copy-on-select (auto-copy on mouse release).
- A full right-click context menu (Copy/Paste/Select-All entries).
- Ctrl+Shift+C / Ctrl+Shift+V variants.
- Copy-success toasts / visual feedback.

## Decisions

| Question | Decision |
|---|---|
| Ctrl+C overload | Copy selection if one exists (then clear it); otherwise send `^C`. |
| Right-click | Always paste (no context menu, no copy-if-selecting). |
| Clipboard access | Electron `clipboard` module in **main**, over the IPC bridge — not `navigator.clipboard` (keeps all privilege in main, consistent with the rest of the app). |
| Paste mechanism | `term.paste(text)` (honors bracketed-paste mode), not a raw `ptyWrite`. |

## Architecture

Fits the existing three-layer split (main owns privilege, preload is the only
bridge, renderer never touches Node).

### IPC contract (`src/shared/ipc-contract.ts`)

Add two channels and two `TermhallaApi` methods:

```ts
clipboardWrite: 'clipboard:write'   // renderer -> main (send)
clipboardRead:  'clipboard:read'    // renderer -> main (invoke)
```

```ts
clipboardWrite(text: string): void
clipboardRead(): Promise<string>
```

### Main (`src/main/ipc/register-clipboard.ts`, new)

A small per-domain registrar mirroring the others:

```ts
import { ipcMain, clipboard } from 'electron'
import { CH } from '@shared/ipc-contract'

export function registerClipboard(): void {
  ipcMain.on(CH.clipboardWrite, (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle(CH.clipboardRead, () => clipboard.readText())
}
```

Wired into `register.ts` (no disposer needed — no long-lived resources).

### Preload (`src/preload/index.ts`)

Two plain passthroughs (these are request/response + send, **not** push
channels, so they do not use `pushChannel`):

```ts
clipboardWrite: (text) => ipcRenderer.send(CH.clipboardWrite, text),
clipboardRead: () => ipcRenderer.invoke(CH.clipboardRead),
```

### Renderer pure logic (`src/renderer/components/terminal-clipboard.ts`, new)

The key-to-action decision is pure and unit-tested (repo convention: pure logic
beside the impure shell):

```ts
export type ClipboardAction = 'copy' | 'paste' | null

/** Decide what a key event means for the terminal clipboard.
 *  - Ctrl/Cmd+C with a selection -> 'copy'; without -> null (let ^C through).
 *  - Ctrl/Cmd+V -> 'paste'.
 *  - Anything else (incl. non-keydown, Alt held, Shift+C/V) -> null. */
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

### Renderer wiring (`src/renderer/components/TerminalPane.tsx`)

In the mount effect, after `term.open(...)`:

```ts
const paste = async () => { const t = await api.clipboardRead(); if (t) term.paste(t) }

term.attachCustomKeyEventHandler(e => {
  const action = clipboardKeyAction(e, term.hasSelection())
  if (action === 'copy') { api.clipboardWrite(term.getSelection()); term.clearSelection(); return false }
  if (action === 'paste') { void paste(); return false }
  return true   // not a clipboard key -> xterm handles it normally
})

const onContextMenu = (e: MouseEvent) => { e.preventDefault(); void paste() }
hostRef.current!.addEventListener('contextmenu', onContextMenu)
```

Cleanup (in the effect's existing teardown): remove the `contextmenu` listener.
The custom key handler is disposed with the terminal — no explicit removal.

Paste data leaves via the existing `term.onData(d => api.ptyWrite(...))` path
because `term.paste()` emits through `onData`; nothing new is needed there.

## Data flow

- **Copy:** keydown → `clipboardKeyAction` returns `copy` → `api.clipboardWrite(selection)` → `ipcRenderer.send` → main `clipboard.writeText`. Handler returns `false` so `^C` is not sent.
- **Paste (Ctrl+V or right-click):** → `api.clipboardRead()` → main `clipboard.readText()` → `term.paste(text)` → (bracketed) `onData` → `api.ptyWrite` → PTY.
- **Interrupt:** Ctrl+C with no selection → `clipboardKeyAction` returns `null` → handler returns `true` → xterm sends `^C` as before.

## Testing

### Unit — `tests/renderer/terminal-clipboard.test.ts`
`clipboardKeyAction` covering:
- Ctrl+C with selection → `copy`; Ctrl+C without selection → `null`.
- Ctrl+V → `paste`; Cmd+V (metaKey) → `paste`.
- Non-keydown (`keyup`) → `null`.
- Alt+Ctrl+C, Ctrl+Shift+C, Ctrl+Shift+V, plain `c`/`v` → `null`.

### e2e — `tests/e2e/clipboard.spec.ts`
Launches the real app (against `out/`, so a build is required first):
- **Copy:** open a terminal, `echo CLIP-COPY-TOKEN`, triple-click the output line
  to select it, press Ctrl+C, then assert
  `app.evaluate(({ clipboard }) => clipboard.readText())` contains `CLIP-COPY-TOKEN`.
- **Paste (Ctrl+V):** `app.evaluate(({ clipboard }) => clipboard.writeText('PASTE-V-TOKEN'))`,
  focus the terminal, press Ctrl+V, assert the rows show `PASTE-V-TOKEN`.
- **Paste (right-click):** write `PASTE-RMB-TOKEN` to the clipboard, right-click the
  terminal, assert the rows show it.

## Files touched

| File | Change |
|---|---|
| `src/shared/ipc-contract.ts` | +2 channels, +2 API methods |
| `src/main/ipc/register-clipboard.ts` | new registrar |
| `src/main/ipc/register.ts` | call `registerClipboard()` |
| `src/preload/index.ts` | +2 passthroughs |
| `src/renderer/components/terminal-clipboard.ts` | new pure `clipboardKeyAction` |
| `src/renderer/components/TerminalPane.tsx` | key handler + contextmenu + paste helper |
| `tests/renderer/terminal-clipboard.test.ts` | new unit test |
| `tests/e2e/clipboard.spec.ts` | new e2e test |
| `docs/features/workspaces.md` | document terminal copy/paste behavior |
| `CHANGELOG.md` | `Added` entry |
