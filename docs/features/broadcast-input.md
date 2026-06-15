# Broadcast Input

> Send the same text to every terminal in the active workspace at once — as a bracketed paste or as raw keystrokes.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-broadcast-input-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-broadcast-input.md)

## What it does

Open the broadcast modal (the `⇉` button in the workspace tab bar, or `Ctrl+Shift+Enter`), type a command, and send it to **all terminal panes in the active workspace** at once. Choose **Keystrokes** (raw bytes, "as if typed") or **Paste** (wrapped in bracketed-paste escapes for apps that treat pastes specially), and optionally append Enter. Handy for running one command across many shells or SSH sessions.

## How it works

Pure `src/shared/broadcast.ts`: `encodeBroadcast(text, mode, enter)` normalizes newlines to CR, wraps in `\x1b[200~…\x1b[201~` for paste mode, and appends a trailing `\r` (outside the wrapper) when `enter` is set; `terminalPaneIds(ws)` returns the workspace's terminal pane ids. The store action `broadcastInput(text, mode, enter)` (`store.ts`) enumerates those ids and calls `api.ptyWrite({ id, data })` for each — reusing the existing PTY write IPC, no main-process change. `BroadcastDialog.tsx` is the modal (mode select, Enter checkbox, live "Send to N terminals" count); a `WorkspaceTabs` button and the `Ctrl+Shift+Enter` handler in `App.tsx` toggle it.

## Key files

| File | Responsibility |
|---|---|
| `src/shared/broadcast.ts` | pure `encodeBroadcast` + `terminalPaneIds` |
| `src/renderer/store.ts` | `broadcastInput` action + `broadcastOpen` modal state |
| `src/renderer/components/BroadcastDialog.tsx` | the modal UI |
| `src/renderer/components/WorkspaceTabs.tsx` | `⇉` toolbar button |
| `src/renderer/App.tsx` | `Ctrl+Shift+Enter` shortcut + mounts the dialog |

## Behaviors & edge cases

- Targets the **active** workspace's terminals only; editor/explorer panes are ignored.
- `Send` is disabled / a no-op when there are zero terminals.
- `ptyWrite` is fire-and-forget; an unknown pane id is harmless.
- Paste vs Keystrokes matters for TUIs (e.g. editors, Claude Code) that special-case bracketed paste; Keystrokes is the default.

## Testing

- **Unit:** `tests/shared/broadcast.test.ts` (paste wrapping, keys raw, newline→CR, trailing-Enter placement; `terminalPaneIds` filtering).
- **e2e:** `tests/e2e/broadcast.spec.ts` — two terminals in a workspace, broadcast `echo …`, assert both terminals echo it.

## Related

- [Architecture](../architecture.md) · [Workspaces](workspaces.md)
