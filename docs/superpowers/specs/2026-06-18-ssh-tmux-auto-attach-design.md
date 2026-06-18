# SSH tmux auto-attach — design

**Date:** 2026-06-18
**Status:** Approved, ready for planning

## Problem

Termhalla already resumes work across app restarts:

- **Claude sessions** — a pane that had Claude running at last save (`config.resumeAi`)
  auto-types `claude --resume` after the restored local shell goes quiet
  (`TerminalPane.tsx`, output-quiet timer).
- **SSH favorites** — a pane launched from an SSH favorite persists its full launch
  override (`config.launch = { command: 'ssh', args: [...] }`) and re-runs it verbatim
  on restart (`resolveSpawnSpec` runs the launch command with no shell-integration
  injection). So SSH reconnection on restart is already handled by the existing
  launch-restore path.

What is **not** handled: when a user SSHes into a host and attaches a tmux session on
the remote, nothing reattaches that tmux session on reconnect. tmux is invisible to
Termhalla — the remote session lives on the remote host, and the local process tree only
shows `ssh`. The app cannot detect remote tmux the way it detects local Claude.

## Goal

Let an SSH favorite opt into a tmux session by name. On every connect — first launch and
every restart — the pane attaches that session if it exists, or creates it if it does not.

Out of scope: manually-typed `ssh` (typed into a normal shell pane, not via a favorite);
auto-detecting which tmux session a user attached; tmux for non-favorite panes.

## Key insight

Because SSH favorites already persist `launch.args` and the restore path re-runs them
verbatim, baking the tmux command **into the ssh args** (rather than typing it into the
remote shell after connect) makes reattach-on-restart come for free — it rides the
existing SSH restore path. No quiet-timer, no keystroke injection, no remote-shell
sniffing. This is the opposite of the Claude resume mechanism (which must type into a
local shell because `claude --resume` runs locally).

## Mechanism

When a favorite has a tmux session name set, `buildSshArgs` produces:

```
ssh -t [-p PORT] [-i IDENTITY] user@host tmux new -A -s <session>
```

- `-t` forces remote PTY allocation, required to run an interactive program as the ssh
  remote command.
- `tmux new -A -s <session>` is idempotent: attach if `<session>` exists, otherwise
  create it. Correct on both first connect and every reconnect. This single command *is*
  "reattach if previously attached." (`-A` requires tmux ≥ 1.8, 2013.)

## Data model

`SshConnection` (`src/shared/types.ts`) gains one optional field:

```typescript
export interface SshConnection {
  id: string
  name: string
  host: string
  user: string
  port?: number          // default 22
  identityFile?: string  // path to a private key; optional
  tmuxSession?: string   // when set (non-empty), connect via `tmux new -A -s <name>`
}
```

Presence of a non-empty `tmuxSession` = tmux on, with that session name.

- Optional field → existing `quick.json` connection entries deserialize unchanged. No
  migration and no `SCHEMA_VERSION` bump: `tmuxSession` lives in `quick.json`, not the
  versioned workspace / app-state files, and absent = off.
- No secrets introduced; a session name is not sensitive (consistent with the existing
  "no secrets persisted" rule).

## Changes

### 1. `src/shared/types.ts`
Add `tmuxSession?: string` to `SshConnection`.

### 2. `src/shared/quick.ts` — `buildSshArgs`
When `c.tmuxSession` is set (after trim/sanitize, non-empty):
- prepend `-t`
- append `tmux`, `new`, `-A`, `-s`, `<sanitizedSession>` (as separate argv entries —
  node-pty spawns ssh with an argv array, no shell quoting involved)

Sanitize the session name: trim, and strip/replace characters tmux disallows in session
names (`.` and `:`). Decide replacement vs. rejection in the plan; replacing with `-` is
simplest and keeps the field forgiving. If the name sanitizes to empty, treat as tmux off.

Existing arg ordering is preserved: `[-t] [-p PORT] [-i IDENTITY] user@host [tmux new -A -s NAME]`.

### 3. `src/renderer/components/SshConnectionForm.tsx`
Add UI below the identity-file field:
- a checkbox "Open in tmux session"
- when checked, a text input for the session name, defaulting to `main`

The `build()` function writes `tmuxSession` only when the checkbox is on and the name is
non-empty (mirroring how `port`/`identityFile` are spread in conditionally). When editing
an existing connection, initialize the checkbox/name from `editing.tmuxSession`.

Add `data-testid`s consistent with the existing form (`conn-tmux`, `conn-tmux-session`).

### No changes needed
- `launchConnection` (`quick-slice.ts`) already calls `buildSshArgs(conn)` and stores the
  result in `launch.args` — it picks up the tmux args automatically.
- Restore path (`resolveSpawnSpec`, `TerminalPane`) needs nothing: it already re-runs
  `launch` verbatim.

## Behavior / tradeoffs (confirmed with user)

- **Detaching (Ctrl-b d) closes the pane.** tmux runs *as* the ssh remote command, so
  detaching returns from tmux → ssh exits → the pane shows exited. The remote session
  persists; relaunching the favorite or restarting the app reattaches. This is the
  intended model, accepted as a behavior change from "detach drops to a remote shell."
- **tmux not installed / not on remote PATH** → the ssh remote command fails and the pane
  exits with tmux's error. Acceptable; the feature is opt-in per favorite.
- **Editing a favorite's tmux setting does not retroactively change already-open panes**
  (their `launch.args` were frozen at connect time). Matches existing favorite-edit
  behavior; the new setting takes effect on next launch.

## Testing

- **Unit (vitest, pure) — `tests/shared/quick.test.ts`:** extend the existing
  `buildSshArgs` describe block with tmux cases:
  - tmux off (no `tmuxSession`) → unchanged from today.
  - tmux on, plain → `['-t', 'user@host', 'tmux', 'new', '-A', '-s', 'main']`.
  - tmux on with port + identity → `-t` precedes `-p`/`-i`, host before the tmux command.
  - name sanitization (`.`/`:`/whitespace) and empty-after-sanitize → treated as off.
- **e2e (Playwright) — optional, form roundtrip only:** save a connection with tmux
  enabled, reopen the edit form, assert the checkbox + session name are populated. The
  actual remote attach cannot be e2e'd without a live SSH host with tmux; the unit tests
  cover the arg construction that is the entire mechanism.

## Files

| Concern | File |
|---|---|
| `SshConnection` type | `src/shared/types.ts` |
| `buildSshArgs` | `src/shared/quick.ts` |
| Favorite form UI | `src/renderer/components/SshConnectionForm.tsx` |
| Launch (no change) | `src/renderer/store/quick-slice.ts` |
| Restore (no change) | `src/main/pty/spawn-spec.ts`, `src/renderer/components/TerminalPane.tsx` |
| Unit tests | `tests/shared/quick.test.ts` |
| Feature doc to update | `docs/features/ssh-favorites.md` |
