# SSH Connections & Favorites

> Launch terminals straight into `ssh`, plus an app-global Ctrl+K palette of saved connections and favorite/recent directories — no secrets stored.

**Status:** Shipped · **Spec:** [2026-06-14 design](../superpowers/specs/2026-06-14-termhalla-ssh-favorites-design.md) · **Plan:** [2026-06-14 plan](../superpowers/plans/2026-06-14-termhalla-ssh-favorites.md)

## What it does

- **Saved SSH connections** — a named library of `name / host / user / port / identity-file path`. Launching one spawns a terminal pane running `ssh`; auth happens interactively in the terminal.
- **Command palette (Ctrl+K)** — a substring-filtered, keyboard-driven overlay merging connections (recent-first), favorite dirs (★), recent dirs (⏱), and the pinned actions *New SSH connection…* and *Pin current directory*.
- **Recents / favorites** — recent directories are auto-tracked from visited cwds (deduped, capped, home excluded); favorite dirs are user-pinned. Both, plus connections and recent connections, live in one app-global store.

This is roadmap sub-project B; it builds on the existing cwd tracking (see [cwd-awareness.md](./cwd-awareness.md)) and workspace model (see [workspaces.md](./workspaces.md)).

## How it works

**Quick store + channels.** Favorites/recents are app-global (not per-workspace), persisted to `quick.json` in `userData` by `quick-store.ts:QuickStore`. `QuickStore.load`/`QuickStore.save` both run the payload through `quick-store.ts:normalizeQuick`, which coerces every field to a valid array — so a corrupt/partial file *or* an untrusted renderer payload always yields a well-formed `QuickStore` (a corrupt/missing file falls back to `EMPTY_QUICK`). Main exposes it over two IPC handlers, `register.ts` (`CH.quickLoad` → `quick:load`, `CH.quickSave` → `quick:save`) plus `CH.homeDir` (`app:homeDir`) for the home-dir exclusion. The renderer caches the store in zustand (`store.ts`) and writes back through a 500 ms debounced `scheduleQuickSave`.

**Launch-override spawn.** An SSH terminal is an ordinary terminal pane whose `TerminalConfig` carries a self-contained `launch?: TerminalLaunch` (`{ command, args, title }`) plus an optional `connectionId` (`types.ts`). `register.ts` threads `launch` through `PtySpawnArgs` into `PtyManager.spawn`, which calls the pure `spawn-spec.ts:resolveSpawnSpec(shell, scriptDir, launch?)`: when `launch` is present it returns `{ file: launch.command, args: launch.args }` verbatim and **skips shell-integration injection** (a remote shell can't run our scripts); otherwise it returns the integrated shell args/env. Because the launch is fully serialized in the config, a restored workspace reconnects fresh — no process resurrection; `ssh` re-prompts. The argv is built by the pure `quick.ts:buildSshArgs` (`-p` only when port is set and not 22; `-i` only when an identity file is set; then `user@host`).

**Renderer palette/form.** `CommandPalette.tsx` (toggled by Ctrl+K in `App.tsx`) renders `quick.ts:buildPaletteItems` → `quick.ts:filterPaletteItems`; Enter calls `store.ts:launchConnection` (spawns `ssh` in the active workspace, pushes the id via `quick.ts:pushRecent`) or `store.ts:launchDir` (local terminal cwd'd there). `SshConnectionForm.tsx` is a modal (name/host/user/port/identity + a **Browse…** button via `dialog:openFile`) with **Save** / **Save & Connect**; host and user are required and the port is range-validated.

## Key files

| File | Responsibility |
| --- | --- |
| `src/shared/quick.ts` | Pure helpers: `buildSshArgs`, `pushRecent`, `nextRecentDirs`, `buildPaletteItems`, `filterPaletteItems`, `PaletteItem` |
| `src/shared/types.ts` | `SshConnection`, `QuickStore`, `EMPTY_QUICK`, `TerminalLaunch`; `TerminalConfig.launch?`/`connectionId?` |
| `src/main/persistence/quick-store.ts` | `quick.json` read/write + `normalizeQuick` sanitization |
| `src/main/pty/spawn-spec.ts` | Pure `resolveSpawnSpec` — launch override vs. shell-integration injection |
| `src/main/pty/pty-manager.ts` | `spawn(... launch?)`, uses `resolveSpawnSpec`, spawn-failure guard |
| `src/shared/ipc-contract.ts` | `quick:load`/`quick:save`/`app:homeDir` channels + API; `PtySpawnArgs.launch?` |
| `src/main/ipc/register.ts` | Quick/homeDir handlers; routes `launch` into `ptySpawn` |
| `src/renderer/store.ts` | Quick state, connection CRUD, pin/unpin, launch actions, `setCwd` recents hook, `flushQuick` |
| `src/renderer/components/CommandPalette.tsx` | Ctrl+K overlay (filter, keyboard nav, per-row edit/delete/unpin) |
| `src/renderer/components/SshConnectionForm.tsx` | Connection modal (Save / Save & Connect, Browse…) |
| `src/renderer/App.tsx` | Ctrl+K binding, renders palette + form, `beforeunload` flush |

## Security

- **Stored** (in `quick.json`, plaintext): connection `name`, `host`, `user`, optional `port`, and the *path* to an identity file. Favorite/recent directory paths and recent-connection ids.
- **Never stored:** passwords, passphrases, private-key material, or any secret. There is no in-app key agent. Authentication is fully delegated to `ssh`, which prompts interactively inside the terminal pane.
- `normalizeQuick` sanitizes on both read and write, so a malformed file or renderer payload cannot inject unexpected shapes into main.
- SSH panes get **no** shell-integration injection (our scripts never reach the remote host), so status is heuristic-only and live cwd is not tracked (the directory is remote) — consistent with `cmd`.

## tmux auto-attach

A favorite can opt into a named tmux session (`tmuxSession` on `SshConnection`). When set,
`buildSshArgs` emits `ssh -t … user@host tmux new -A -s <name>`: `-t` forces a remote PTY and
`tmux new -A -s` attaches the session if it exists or creates it otherwise. Because the launch
override (`{command:'ssh', args}`) is persisted per-pane and re-run verbatim on restart, the
session is reattached automatically on reconnect and on app restart — no extra runtime logic.

Session names are sanitized at arg-build time (tmux forbids `.` and `:`; whitespace and those
characters collapse to `-`). Detaching inside tmux (Ctrl-b d) returns from the remote command,
so ssh exits and the pane closes; the remote session lives on and relaunching the favorite (or
restarting the app) reattaches it.

## Behaviors & edge cases

- **Spawn-failure guard** — a bad launch command (e.g. `ssh` not on PATH) is caught in `PtyManager.spawn`; it writes a `[failed to launch …]` line to the pane, marks/unwinds the status engine, and fires `onExit(id, 1)` instead of crashing main.
- **Edit-prefill remount** — `SshConnectionForm` seeds its `useState` from the edit target once at mount, so `App.tsx` keys it on the target (`connectionFormFor.id` / `'new'` / `'none'`); switching edit targets remounts the form and re-seeds the fields.
- **Recents dedup/cap** — `nextRecentDirs` skips empty input and the home dir, de-dupes case- and trailing-slash-insensitively (most-recent casing wins), and caps at `RECENT_DIR_CAP` (20). Connection MRU uses `pushRecent` capped at `RECENT_CONN_CAP` (20). Deleting a connection also drops it from `recentConnections`.
- **Palette cwd/Pin** — the *Pin current directory* action only appears when a cwd is known (first terminal pane in the active workspace); pinning keeps the palette open to reveal the new ★.
- **Flush on unload** — `App.tsx` registers a `beforeunload` handler that calls `saveAll()` and `store.ts:flushQuick` (clears the debounce timer and saves immediately), so pending favorites/recents are not lost on close.

## Testing

- `tests/shared/quick.test.ts` — pure helpers: `buildSshArgs` (port/identity ordering), `pushRecent` (prepend/dedup/cap), `nextRecentDirs` (dedup, home-exclusion, cap), `buildPaletteItems` (recent-first ordering, favorite-vs-recent dirs, cwd-gated actions), `filterPaletteItems` (substring/empty-query).
- `tests/main/spawn-spec.test.ts` — `resolveSpawnSpec`: launch override runs verbatim with no injection; integrated shell injects args/env; non-integrated shell falls back to its own args.
- `tests/main/quick-store.test.ts` — `QuickStore` against a temp `userData`: empty store when missing, round-trips a saved store, falls back to empty on malformed JSON.
- `tests/e2e/ssh-quick.spec.ts` — hermetic Playwright (temp `--user-data-dir`, seeded `quick.json`): open palette → create a connection via the form → re-open and launch it (asserts an SSH pane titled with the connection name) → launch a seeded recent directory (asserts a local terminal tile with the matching `data-cwd`). Real SSH auth is not exercised.

## Related

- [../architecture.md](../architecture.md) — process model, IPC contract, persistence layout.
- [../decisions.md](../decisions.md) — design-decision log.
- [workspaces.md](./workspaces.md) — workspace/pane model the palette spawns into.
- [cwd-awareness.md](./cwd-awareness.md) — cwd tracking that feeds recent directories.
