# Terminal redraw on resize (+ manual redraw)

**Status:** Draft for review · 2026-06-18

## Problem

Resizing a terminal frequently garbles the on-screen text — especially with full-screen TUIs
like Claude. The user wants it to **self-correct after a resize**, and also wants a **manual
"redraw" command** as a fallback for cases the auto-fix misses. (Both, per decision.)

## Current behavior (grounding)

- `TerminalPane.tsx:70-80` — a `ResizeObserver` calls `fit.fit()` on every change and `api.ptyResize`
  **only when the grid actually changes** (guards the documented ConPTY-repaint hazard).
- Load-bearing gotchas (CLAUDE.md, must respect):
  - *Avoid redundant PTY resizes* — a no-op resize forces a ConPTY full repaint.
  - *Status tail is ANSI-stripped* (`status-tracker.ts`) so a repaint won't wedge needs-input.
- Per-pane imperative hooks live in `components/terminal-registry.ts` (serializers, focusers) — the
  established place to expose an imperative "redraw this pane" callback to the store/keymap.
- Rebindable commands are data-driven in `shared/keybindings.ts` (`COMMANDS`, `CommandId`,
  `Shortcut`); dispatched in `App.tsx:62-99`.

## Investigation first (systematic-debugging)

The exact garble mechanism is unconfirmed, so implementation **starts by reproducing it** and
identifying the layer before committing to the auto-fix:
- Is Claude on the **alternate screen buffer** (where xterm should not reflow) or the normal buffer?
- Does the garble come from **xterm's reflow** of wrapped lines on width change, or from a
  **ConPTY/TUI repaint** that lands out of order with xterm's fit?
- Repro candidate: run a wrapping TUI, resize narrower→wider, observe.

The fix below is the **plan**; the repro may refine the redraw mechanism.

## Design

### Shared redraw primitive
Add a `redrawers` map to `terminal-registry.ts` (mirrors `focusers`):
- `registerRedrawer(paneId, fn)`, `unregisterRedrawer(paneId)`, `redrawPane(paneId): boolean`.
- `TerminalPane` registers `() => { fit.fit(); term.refresh(0, term.rows - 1) }`.
  - `fit.fit()` re-measures; `term.refresh(0, rows-1)` forces xterm to repaint its rows from the
    buffer (fixes xterm-side render glitches without clearing scrollback).
  - If the repro shows the running **TUI** itself needs to repaint (not just xterm), add a single
    deliberate PTY "nudge": `ptyResize(cols, rows)` once after fit (the app redraws on SIGWINCH /
    ConPTY resize). This is the *one* sanctioned redundant resize — debounced, never per-frame —
    and is safe for the status tail (ANSI-stripped).

### Auto-fix on resize
Debounce the `ResizeObserver`: after resizes stop for ~150ms, call the redraw primitive once.
This avoids per-frame churn (and the redundant-resize hazard) while self-correcting once the user
finishes dragging. Keep the existing per-change `fit.fit()` for live responsiveness; the debounced
redraw is the settle-time correction.

### Manual redraw command
- Add `CommandId` / `Shortcut` `'redraw-terminal'` to `shared/keybindings.ts`, default chord
  **Ctrl+Shift+L** (free; `Ctrl+L` stays the shell's clear). Category "Panes".
- `App.tsx` dispatch: `case 'redraw-terminal': redrawPane(s.focusedPaneId)`.
- Also add a pane-menu / toolbar affordance later if desired (out of scope for v1).

## Testing
- **Unit (pure):** extract the debounce/settle scheduler and test it with an injected timer
  (fires once after the quiet window, coalesces a burst) — mirrors the `requestPaneFocus` test style.
- **Unit:** `redrawPane` returns false with no registered redrawer, invokes it and returns true when present.
- **e2e:** bind/trigger `redraw-terminal` on a focused terminal; assert the app doesn't crash and the
  terminal still shows prior output (no scrollback loss). Asserting "ungarbled pixels" isn't feasible
  in e2e — the garble correction is validated **manually** (documented in the PR), which is why the
  manual command exists as the user-controllable fallback.

## Out of scope / YAGNI
- Rewriting xterm's reflow behavior; switching renderers.
- A redraw button in the toolbar (keybinding + focused-pane is enough for v1).
