# SSH tmux options — design

**Date:** 2026-06-19
**Status:** Approved, ready for planning

## Problem

Termhalla can open an SSH favorite inside a tmux session (`tmuxSession` on
`SshConnection` → `ssh -t user@host tmux new -A -s NAME`, see
[ssh-tmux-auto-attach](2026-06-18-ssh-tmux-auto-attach-design.md)). But that session runs
with whatever the *remote* `~/.tmux.conf` provides, which the user can't control from
Termhalla. In practice this surfaces as a real bug:

- **Scrolling does nothing inside full-screen TUIs (e.g. Claude Code) under tmux.** Claude
  Code is on the alternate screen. When the remote tmux is **not** in mouse mode, tmux does
  not forward wheel events to the inner app and the alternate screen has no scrollback, so
  the wheel moves nothing. Enabling tmux mouse mode lets the wheel reach the app (and
  tmux copy-mode).

The user wants tmux options exposed in the SSH config so Termhalla configures the remote
tmux the way they want, with sensible defaults and tooltips.

## Goal

Let an SSH favorite (one with a tmux session) carry a small set of common tmux options.
On every connect — first launch and every restart, attach or create — Termhalla applies
them via server-global `set -g`, overriding the remote `.tmux.conf`.

### Out of scope

- A global, Settings-level default applied to all connections — per-connection only (YAGNI).
- tmux for non-favorite panes (manually-typed `ssh`).
- The terminal **paste double-bug** — a separate, already-root-caused bug fix tracked on its
  own (custom `Ctrl+V` handler + xterm's native `paste` listener both fire because returning
  `false` from `attachCustomKeyEventHandler` skips `preventDefault`). Not part of this spec.

## The option set

Five options, each a `set -g` (server-global) applied on connect. The three marked **★**
default ON because they directly fix the reported issues; the other two are opt-in.

| Option | tmux command(s) | Default | Tooltip (effect) |
|---|---|---|---|
| **★ Mouse mode** | `set -g mouse on` | ON | Wheel-scroll panes and apps like Claude Code; click to select/resize panes. Fixes "scrolling does nothing". |
| **★ True color (24-bit)** | `set -g default-terminal tmux-256color` · `set -ga terminal-overrides ',*:Tc'` | ON | Full 24-bit color in TUIs (Claude Code, vim). |
| **★ Faster Esc** | `set -g escape-time 10` | ON | Removes the laggy delay after pressing Esc in vim and other TUIs. |
| Scrollback lines | `set -g history-limit N` | unset (omit) | How many lines of scrollback tmux keeps per pane. |
| System clipboard (OSC 52) | `set -g set-clipboard on` | OFF | Let remote programs copy into your local clipboard. |

## Data model (`src/shared/types.ts`)

Extend `SshConnection` (only meaningful when `tmuxSession` is set):

```ts
tmuxOptions?: {
  mouse?: boolean        // default true
  trueColor?: boolean    // default true
  fastEsc?: boolean      // default true
  historyLimit?: number  // default unset → don't emit history-limit
  clipboard?: boolean    // default false
}
```

**Backward-compat rule:** an undefined field resolves to its default
(`mouse ?? true`, `clipboard ?? false`, …). So existing saved tmux favorites — and the
whole `tmuxOptions`-absent case — automatically get the on-by-default options (including
mouse), which fixes scrolling on already-saved connections without re-editing them. A
form save writes explicit booleans, so an intentional opt-out (e.g. mouse off) is
preserved and distinguishable from "never set".

## Command generation (`src/shared/quick.ts`, pure + unit-tested)

`buildSshArgs` appends the resolved options after `tmux new -A -s NAME`, chained with a
`\;` **token** (backslash-semicolon). The remote shell turns `\;` into a literal `;`,
which tmux reads as a command separator (an unescaped `;` would be eaten by the remote
shell instead). `new-session` is emitted first so it starts the server / attaches; the
global `set`s then apply to that server and, being `-g`, to the attached session.

Resulting argv (defaults, session `main`, no scrollback, no clipboard):

```
-t  user@host
tmux new -A -s main
\;  set -g mouse on
\;  set -g escape-time 10
\;  set -g default-terminal tmux-256color
\;  set -ga terminal-overrides ',*:Tc'
```

(rendered one token per word). Notes:

- The `,*:Tc` value is **single-quoted** so the remote shell does not glob the `*`.
- node-pty spawns `ssh.exe` directly (no Windows-side `cmd`/glob), so tokens reach `ssh`
  unmangled; `ssh` joins the post-host args with spaces into the remote command string.
- Session names are already sanitized (`.`/`:`/whitespace → `-`, leading `-` stripped),
  so the session token needs no quoting.

**Known limitation:** if a `set` names an option the remote tmux version rejects, tmux
prints a warning for that command; `new-session` already ran so the session still
attaches. Acceptable — no special handling.

## UI (`src/renderer/components/SshConnectionForm.tsx`)

When the existing "Open in tmux session" checkbox is on, render an indented sub-group
beneath the session-name field:

- Checkboxes: **Mouse** (`conn-tmux-mouse`), **True color** (`conn-tmux-truecolor`),
  **Faster Esc** (`conn-tmux-esc`) — pre-checked; **System clipboard**
  (`conn-tmux-clipboard`) — unchecked.
- Numeric field: **Scrollback lines** (`conn-tmux-history`) — blank means leave at the
  remote default (omit `history-limit`).
- Each control carries a `title` tooltip with the effect text from the option table.

State seeds from `editing?.tmuxOptions` with the same default resolution as the model
(undefined → default). On save, the form writes an explicit `tmuxOptions` object onto the
connection (only when tmux is enabled; cleared/omitted otherwise).

## Testing

- **Unit** (`tests/shared/quick.test.ts`, extending the existing `buildSshArgs` suite):
  - `tmuxOptions` undefined → the three default-on options emitted, no scrollback, no
    clipboard (backward compat).
  - each toggle independently adds/removes its tokens.
  - `historyLimit` emits `set -g history-limit N` only when set.
  - truecolor value is single-quoted; commands are separated by `\;` tokens.
  - no tmux session → no tmux tokens at all (unchanged).
- **e2e** (`tests/e2e/ssh-favorites.spec.ts`): enabling the tmux checkbox reveals the option
  controls; saving persists `tmuxOptions` on the connection (assert via the store / quick
  state). Actual remote tmux behavior is **not** e2e'd — there is no SSH server in CI.
