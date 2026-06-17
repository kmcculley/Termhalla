# Git status on the pane chip — design

**Date:** 2026-06-17
**Feature:** Roadmap feature 3 — surface branch + dirty/ahead-behind state for any pane
whose cwd is a git repo, inline on the pane chip, with full detail in a popover.

## Goal

Reuse the existing live per-pane cwd signal to show, on each terminal pane's toolbar, a
compact git indicator (branch name + a dirty dot) for panes sitting in a git working tree.
Full detail (upstream, ahead/behind, staged/unstaged/untracked counts) lives in a popover.
Non-repo, remote/SSH, and error cases degrade silently to no chip.

This is a read-only status surface. No git actions (commit/checkout/stage) in v1.

## Architecture

Mirrors the cloud-status service (`src/main/cloud/`): all privilege in main, abortable and
`unref()`'d child processes, signature-based dedup so we only push on real change.

```
pty:cwd (existing) ──▶ GitStatusService.setCwd(paneId, cwd, sshTarget?)
                          │  resolve git root (cached per cwd)
                          │  non-repo / SSH / remote → push null, no watch
                          ▼
                       probe: git -C <root> status --porcelain=v2 --branch
                          │
        ┌─────────────────┼──────────────────────────┐
   .git fs-watch     command-idle re-probe        initial probe
   (chokidar on       (StatusEngine idle/exit      on cwd change
    HEAD/index/refs)   signal, debounced)
                          ▼
                  git:status push  ──▶ store.gitStatus[paneId] ──▶ chip + popover
```

### New files

| File | Purpose |
|---|---|
| `src/main/git/parse-status.ts` | **Pure.** Parse `git status --porcelain=v2 --branch` → `GitStatus`. |
| `src/main/git/git-root.ts` | **Pure-ish.** Resolve repo root for a cwd (`git rev-parse --show-toplevel`), `null` if not a repo. |
| `src/main/git/git-status-service.ts` | Impure shell: per-root watch + probe, abort/unref, dedup, push. |
| `src/main/ipc/register-git.ts` | Wire service callback → `send(CH.gitStatus, …)`; subscribe to cwd + idle signals; tear down on window closed. Composed by `register.ts`. |
| `src/renderer/components/GitPopover.tsx` | Positioned popover (portals to body), read-only detail. |
| `tests/main/parse-status.test.ts` | Unit fixtures. |
| `tests/main/git-root.test.ts` | Unit (if pure parsing present). |
| `tests/e2e/git-status.spec.ts` | End-to-end. |

### Touched files

| File | Change |
|---|---|
| `src/shared/ipc-contract.ts` | Add `CH.gitStatus = 'git:status'`; add `onGitStatus(cb)` to `TermhallaApi`. |
| `src/shared/types.ts` | Add `GitStatus` interface. (No schema-version bump — runtime-only, not persisted.) |
| `src/main/ipc/register.ts` | Compose `register-git`. |
| `src/main/ipc/register-pty.ts` | Expose the cwd + command-idle signals to the git service (callback wiring). |
| `src/preload/*` | Expose `onGitStatus` on `window.api` (follows existing push-event pattern). |
| `src/renderer/api.ts` | Consume `onGitStatus`. |
| `src/renderer/store.ts` | Add `gitStatus: Record<string, GitStatus | null>` to initial state + `setGitStatus` setter (slice). |
| `src/renderer/store/internals.ts` | Add `gitStatus` to `clearPaneRuntime`. |
| `src/renderer/App.tsx` | Subscribe `api.onGitStatus((id, g) => s().setGitStatus(id, g))`. |
| `src/renderer/components/PaneToolbar.tsx` | Render the git chip + wire popover toggle. |
| `src/renderer/components/PaneTile.tsx` | Add `data-git-branch` attribute for e2e. |

## Data model

```ts
// src/shared/types.ts
export interface GitStatus {
  root: string            // absolute repo root
  branch: string          // 'main' | '(detached)' | short sha when detached
  upstream: string | null // e.g. 'origin/main', or null when no upstream
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  dirty: boolean          // staged + unstaged + untracked > 0
}
```

Renderer store: `gitStatus: Record<string /*paneId*/, GitStatus | null>`.
`null` means "probed, no git here" (chip hidden); absence means "not yet probed".

## Probe & watch internals

### Single probe call

`git -C <root> status --porcelain=v2 --branch` yields, in one call:

- `# branch.head <name>` → `branch` (literal `(detached)` when detached; then use `# branch.oid` short sha for display)
- `# branch.upstream <ref>` → `upstream` (absent ⇒ `null`)
- `# branch.ab +X -Y` → `ahead` / `behind` (absent when no upstream)
- entry lines: `1`/`2` (changed/renamed, staged vs unstaged via the two-char XY field), `u` (unmerged), `?` (untracked) → `staged` / `unstaged` / `untracked` counts

`parse-status.ts` is a pure function `parseStatus(stdout: string): Omit<GitStatus, 'root'>`;
the service attaches `root`.

### Watch

- One chokidar watcher **per repo root**, reference-counted by the set of panes currently in
  that root. Created on first pane entering the root; disposed when the last pane leaves
  (cwd change away, or pane close).
- Targets inside `.git`: `HEAD`, `index`, `refs/`, `MERGE_HEAD`, `FETCH_HEAD`. Ignore
  `.git/objects` and `.git/logs` to avoid churn.
- Watch events fire a **debounced** (~150 ms) re-probe for the root.
- Follows the session-identity race pattern: after the debounce/await, re-check the root is
  still referenced before pushing, so a concurrent leave supersedes cleanly.

### Command-idle re-probe

`StatusEngine` already detects when a foreground command completes (the idle/exit signal
behind needs-input). Add one consumer: on idle for a pane whose cwd is in a repo, fire a
debounced re-probe for that pane's root. This closes the unstaged-working-tree-edit gap that
a `.git`-only watch cannot see.

### Coalescing & dedup

- Per-root `refreshing` guard (as in cloud service): a burst of watch events + an idle signal
  collapse into at most one in-flight `git` call per root.
- Signature dedup: compute a string signature of each pane's resulting `GitStatus` (or
  `null`); only `send` when it changed.

### Lifecycle / shutdown

- Shared `AbortController`, re-armed on `stop()`; passed to every `execFile`.
- Probe timeout 8 s (matches cloud).
- All children `.unref()`'d so a slow `git` never blocks `app.close()` / the e2e suite.
- `stop()` wired to `win.on('closed')`; aborts in-flight probes and closes all watchers.

## UI

### Chip (`PaneToolbar.tsx`)

A new button immediately left of the cwd `📁` button, rendered only when
`gitStatus[paneId]` is non-null:

- clean: ` main` (branch name, muted)
- dirty: ` main ●` (trailing dot, accent color)
- detached: ` ⎇ a1b2c3d`

Clicking toggles `GitPopover`. Uses the existing `toggle('git')` menu-state machinery in
`PaneTile` alongside `proc`/`cwd`.

### Popover (`GitPopover.tsx`)

Same pattern as `ProcessPopover`: absolutely positioned, `onClick` stops propagation, and
**`createPortal` to `<body>`** (mosaic-tile overlay gotcha — a `position: fixed`/absolute
child of a tile mis-positions and intercepts no clicks otherwise). Content:

- branch (and detached sha if applicable)
- upstream + `↑ahead ↓behind` (omit if no upstream)
- `staged / unstaged / untracked` counts

Read-only. No buttons in v1.

### e2e hook

`PaneTile` adds `data-git-branch={gitStatus?.branch ?? ''}` to the tile element, mirroring
`data-cwd`, so e2e can assert on it via CSS selector.

## Error handling & edge cases

- `git` not on PATH, not a repo, or any probe/parse error → push `null` (chip hidden).
  Git errors are never surfaced to the user.
- SSH/remote pane (spawn spec has an SSH target) → push `null`, no watch, no probe.
- Probe timeout / abort on shutdown → no push beyond the abort; no crash.
- Repo deleted out from under a pane → next watch event/probe fails → `null`, chip disappears.
- Worktrees: `--show-toplevel` + `-C root` resolve linked worktrees correctly.
- Submodules: status is **not** recursed in v1 (parent repo status only).

## Testing

### Unit (vitest, the bulk of coverage)

`tests/main/parse-status.test.ts` — `parseStatus` against porcelain-v2 fixtures:

- clean repo on a branch with upstream, no ahead/behind
- dirty: mix of staged, unstaged, untracked → correct counts + `dirty: true`
- detached HEAD → `branch: '(detached)'` + short sha surfaced
- ahead/behind parsing (`# branch.ab +2 -1`)
- no upstream → `upstream: null`, no `ab` line
- untracked-only → `dirty: true`, `untracked > 0`, `staged == unstaged == 0`

`tests/main/git-root.test.ts` — only if there is pure parsing to test (e.g. interpreting
`rev-parse` output / error); the `execFile` itself is exercised via e2e.

### E2E (Playwright, one spec)

`tests/e2e/git-status.spec.ts`:

1. Launch app; create a temp dir, `git init`, initial commit (via the terminal or test setup).
2. `cd` into it from a terminal pane; assert the tile's `data-git-branch` becomes the branch.
3. Write a file + run a command in the pane; assert the dirty dot (chip text) appears.
4. `cd` to a non-repo temp dir; assert the git chip disappears (`data-git-branch` empties).

Follows `tests/e2e/cwd.spec.ts` conventions (temp `--user-data-dir`, `killTree` on teardown,
generous timeouts, `workers: 1`).

## Non-goals (v1)

- No git actions from the popover (commit, checkout, stage, push/pull).
- No submodule recursion.
- No git status for remote/SSH panes.
- No full-working-tree fs-watch (the idle re-probe covers the unstaged-edit gap cheaply).
- Not persisted — runtime-only, recomputed on launch from live cwd.
