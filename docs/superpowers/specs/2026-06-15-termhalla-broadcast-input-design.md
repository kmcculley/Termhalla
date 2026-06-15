# Termhalla — Broadcast Input to All Terminals — Design Spec

**Date:** 2026-06-15
**Status:** Approved (autonomous batch; recommended options chosen)
**Builds on:** Phase 1 terminals + workspace model, all merged to `main`.

## 1. Summary

Send a block of text to **every terminal** in the active workspace at once — either as a
**paste** (bracketed-paste, for apps that treat pastes specially) or as **keystrokes**
(raw bytes, "as if typed"), with an optional trailing Enter. Useful for running the same
command across many shells/SSH sessions.

## 2. Decisions (recommended)

| Decision | Choice |
|---|---|
| Trigger | A toolbar button (`⇉` "Broadcast") in the workspace tab bar + a `Ctrl+Shift+Enter` shortcut, opening a modal. |
| Modes | **Paste** (wrap in bracketed-paste `ESC[200~ … ESC[201~`) and **Keystrokes** (raw bytes). |
| Trailing Enter | A checkbox "Send Enter after" (default on) — appends `\r`. |
| Target | All **terminal** panes in the **active** workspace (editors/explorers ignored). |
| Transport | Reuse `api.ptyWrite(id, data)` per terminal; **no new IPC**. |
| Persistence | None (runtime action). |

## 3. Architecture & data flow

```
Ctrl+Shift+Enter / toolbar ⇉  ──►  BroadcastDialog (modal)
   text + mode(paste|keys) + enter?  ──►  store.broadcastInput(text, mode, enter)
        for each terminal pane id in active workspace:  api.ptyWrite(id, encoded)
```

A pure helper `encodeBroadcast(text, mode, enter)` builds the byte string; the store
action enumerates terminal panes and writes to each PTY. No main-process changes.

## 4. Pure core (testable)

`encodeBroadcast(text: string, mode: 'paste' | 'keys', enter: boolean): string` —
- normalize newlines in `text` to `\r` (terminals expect CR for Enter);
- `mode === 'paste'` → `\x1b[200~` + normalized + `\x1b[201~`; `mode === 'keys'` → normalized;
- if `enter`, append `\r` (outside the bracket wrapper for paste).

`terminalPaneIds(ws: Workspace): string[]` — the ids of panes whose `config.kind === 'terminal'`
(stable order via `Object.keys(ws.panes)`). Pure, unit-tested.

## 5. Store

- `broadcastInput(text, mode, enter)` — `const ws = workspaces[activeId]`; for each id in
  `terminalPaneIds(ws)` call `api.ptyWrite({ id, data: encodeBroadcast(text, mode, enter) })`.
  No-op when no active workspace or no terminals.
- `broadcastOpen: boolean` + `setBroadcastOpen(open)` — modal visibility.

## 6. UI

- **`BroadcastDialog.tsx`** (renderer): a modal (mirrors `SshConnectionForm`/`CommandPalette`
  styling) with a `<textarea data-testid="broadcast-text">`, a mode toggle
  (`data-testid="broadcast-mode"`, Paste|Keystrokes), an "Send Enter after" checkbox
  (`broadcast-enter`), a target count line ("Send to N terminals"), and `Send`
  (`broadcast-send`) / `Cancel`. `Send` calls `broadcastInput` then closes.
- A toolbar button in `WorkspaceTabs` (`data-testid="broadcast-button"`, `⇉`) toggles the modal.
- Global `Ctrl+Shift+Enter` (in `App`) toggles the modal (guarded like the existing `Ctrl+K`).

## 7. Error handling

- No active workspace / zero terminals → `Send` is a no-op (and the dialog shows "0 terminals").
- `ptyWrite` is fire-and-forget; a dead pane id is harmless (main ignores unknown ids).

## 8. Testing

- **Unit (vitest):** `encodeBroadcast` (paste wrapping, keys raw, newline→CR, trailing Enter
  placement) and `terminalPaneIds` (filters non-terminals; empty when none).
- **e2e (Playwright):** open a workspace with two terminals, open the broadcast modal, type
  `echo hi`, Send (keystrokes + Enter) → assert **both** terminals' `.xterm-rows` contain `hi`.

## 9. Non-goals

- No live "mirror every keystroke" broadcast mode (modal send only).
- No cross-workspace broadcast (active workspace only).
- No per-terminal include/exclude selection (all terminals).
