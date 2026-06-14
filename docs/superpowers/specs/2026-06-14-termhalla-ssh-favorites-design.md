# Termhalla — SSH + Favorites/Recents — Design Spec

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phases 1–3 + CWD awareness, all merged to `main`.

## 1. Summary

Launch terminals straight into SSH of a remote server, and provide a global
**favorites/recents** layer — saved SSH connections, recent connections, and
favorite + recent working directories — reached through a **Ctrl+K command
palette**. This is sub-project B of the post-launch roadmap.

## 2. Decisions (from brainstorming, 2026-06-14)

| Decision | Choice |
|---|---|
| SSH model | **Saved connections form + recents.** A "New SSH connection" form (name/host/user/port/identity) creates a reusable named connection; launching pushes it into recents. No passwords stored — `ssh` prompts in the terminal. |
| Launch surface | **Ctrl+K command palette** — fuzzy/substring list of connections + favorite/recent dirs; Enter launches. |
| Recent directories | **Auto from visited cwds** (via the existing cwd tracking), deduped, capped ~20, home excluded. Favorite dirs are user-pinned (★). |

## 3. Data model & persistence

A new **app-global** store (favorites/recents are not per-workspace), persisted to
`quick.json` in `userData`, read/written in main via IPC (same pattern as the
workspace store):
```ts
interface SshConnection {
  id: string
  name: string
  host: string
  user: string
  port?: number          // default 22
  identityFile?: string  // path to a private key; optional
}
interface QuickStore {
  connections: SshConnection[]   // saved SSH connections (the library / favorites)
  recentConnections: string[]    // connection ids, most-recently-used
  favoriteDirs: string[]         // user-pinned (★) directories
  recentDirs: string[]           // MRU, deduped, capped ~20, home excluded
}
```
**No secrets are stored** — only host/user/port and an identity-file *path*.
Authentication happens interactively in the terminal via `ssh`.

## 4. SSH terminal mechanism

An SSH terminal is a normal terminal pane with a launch override. `TerminalConfig`
gains an optional, self-contained field:
```ts
launch?: { command: string; args: string[]; title: string }
connectionId?: string   // optional, links back to the saved connection for display
```
- When `launch` is present, `PtyManager.spawn` runs `command` with `args` (e.g.
  `ssh -p <port> -i <identity> user@host`) instead of a discovered shell, and
  **skips shell-integration injection** (a remote shell can't run our scripts).
- The launch is **self-contained in the config**, so a saved workspace
  **restores the SSH terminal by reconnecting fresh** (no process resurrection;
  `ssh` re-prompts for auth). cwd is irrelevant (remote); spawn cwd = home.
- A pure **`buildSshArgs(connection)`** helper builds the argv (port only when not
  22; `-i` only when an identity file is set), unit-tested.

**Scope note:** SSH terminals have no integration → status is heuristic-only and
live cwd is not tracked (the directory is remote), consistent with cmd.

## 5. Command palette

A renderer overlay component `CommandPalette`, toggled with **Ctrl+K**
(Esc closes), keyboard-driven (↑/↓ to move, Enter to launch). A single input
substring-filters a merged list (no fuzzy-match dependency):
- **Saved SSH connections** (🔌, recent-first) → Enter spawns an SSH terminal in
  the active workspace (split the focused pane, or first pane when empty).
- **Favorite dirs** (★) and **recent dirs** (⏱) → Enter spawns a local terminal
  `cwd`'d there.
- Pinned actions: **"New SSH connection…"** (opens the form) and **"Pin current
  directory"** (★ the focused terminal's cwd).
- Per-entry secondary controls (on the selected/hovered row): edit/delete a
  connection, unpin a favorite dir.

## 6. Connection form

A modal `SshConnectionForm`: **name, host, user, port (default 22), identity file**
(with a **Browse…** button using the existing `dialog:openFile`). **Save** adds or
updates the connection; **Save & Connect** also launches it. Validation: host and
user are required.

## 7. Recents auto-tracking

- **Directories:** the existing `setCwd` flow also pushes the directory into
  `recentDirs` (MRU, dedup, cap ~20, skip the home directory). A pure
  `pushRecent(list, value, cap)` helper encapsulates the MRU logic.
- **SSH:** launching a connection pushes its id to `recentConnections` (MRU,
  dedup).
- Both persist to `quick.json` (debounced).

## 8. Testing & verification

- **Unit (vitest, pure):** `buildSshArgs` (port/identity variations); `pushRecent`
  (add, dedup-to-front, cap, home-exclusion); the palette substring filter;
  `quick.json` (de)serialize.
- **Main integration:** `QuickStore` read/write against a temp `userData`.
- **e2e (Playwright, hermetic):** open the palette (Ctrl+K) → create a connection
  via the form → assert it appears in the palette → launch a **seeded recent
  directory** → a local terminal opens with `data-cwd` = that dir. Launching a
  connection is asserted to spawn a terminal pane running the `ssh` command
  (actual SSH auth is not e2e'd — no server available).

## 9. Non-goals (this sub-project)

- No password/secret storage or an in-app key agent (ssh handles auth).
- No import of `~/.ssh/config` (could be a later addition).
- No remote cwd/status integration for SSH sessions (heuristic status only).
- No fuzzy-match library (substring filter only).
- No SFTP/file transfer or port-forwarding UI.
