# Git Status on Pane Chip

> A compact branch indicator (branch name + dirty dot) on each terminal pane's toolbar for panes sitting in a git working tree, with full detail in a popover.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-17-git-status-pane-chip-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-17-git-status-pane-chip.md)

## What it does

For every terminal pane whose cwd is inside a git working tree, Termhalla shows a compact git chip in the pane toolbar: the current branch name (or short sha when HEAD is detached), and a `●` dot when the working tree is dirty. Clicking the chip opens a read-only popover with the upstream ref, ahead/behind counts, and staged/unstaged/untracked file counts.

Non-repo panes, SSH/remote panes, and any pane where `git rev-parse` fails receive no chip — the feature degrades silently.

This is a **read-only status surface only**. No git actions (commit, stage, checkout, push/pull) are available in v1.

## Data flow

```
pty:cwd (existing signal)
       │
       ▼
GitStatusService.setCwd(paneId, cwd)
       │  resolve git root via git rev-parse --show-toplevel
       │  non-repo / error → push null (no chip)
       ▼
  per-root chokidar watch   +   StatusEngine command-idle signal
  (.git/HEAD, index, refs)      (debounced, per pane's root)
       │                               │
       └───────────┬───────────────────┘
                   ▼
     git -C <root> status --porcelain=v2 --branch
                   │  parseStatus(stdout) → GitStatus
                   │  dedup via content signature
                   ▼
        git:status IPC push (main → renderer, pane-scoped)
                   │
                   ▼
      store.gitStatus[paneId]
                   │
          ┌────────┴────────┐
          ▼                 ▼
      PaneToolbar       GitPopover
      (chip: branch     (upstream, ahead/behind,
       + dirty dot)      staged/unstaged/untracked)
```

On `clearPaneRuntime` (pane close / workspace close), the pane's entry is dropped from the `gitStatus` map.

## Dual refresh trigger — why both are needed

The `.git` filesystem watch targets only files inside `.git`: `HEAD`, `index`, `refs/`, `MERGE_HEAD`, `FETCH_HEAD` (objects/ and logs/ are excluded to avoid churn). This catches:

- commits and amends (HEAD moves)
- staging / unstaging (index updates)
- branch checkouts and merges (HEAD + refs)
- `git fetch` (FETCH_HEAD)

It **cannot** see ordinary working-tree file edits that have not yet been staged — those only change the working tree, not anything inside `.git`. A file you edit with an editor leaves `git status` dirtier than the index reflects, but nothing inside `.git` changes until you `git add` it.

The command-idle re-probe fills this gap: whenever the `StatusEngine` signals that a foreground command finished in a pane whose root is tracked, the service fires a debounced re-probe for that root. A typical workflow — edit a file in `$EDITOR`, exit, return to the shell — triggers the idle signal and refreshes the unstaged count without requiring a full-working-tree fs-watch.

Together the two triggers give prompt updates for index changes (watch) and working-tree edits after any shell command (idle re-probe), at low cost.

## Probe and watch internals

### Single probe call

`git -C <root> status --porcelain=v2 --branch` yields, in one call:

- `# branch.head <name>` → `branch` (literal `(detached)` when detached; then `# branch.oid` short sha is used for display and `detached: true` is set)
- `# branch.upstream <ref>` → `upstream` (absent → `null`)
- `# branch.ab +X -Y` → `ahead` / `behind` (absent when no upstream)
- entry lines `1`/`2` (changed/renamed) carry a two-char XY field distinguishing staged from unstaged; `?` lines → `untracked` count

`parse-status.ts` is a pure function `parseStatus(stdout): Omit<GitStatus, 'root'>`. The service attaches `root`.

### Per-root ref-counted watch

One chokidar watcher per repo root, ref-counted by the set of panes currently in that root. Created when the first pane enters a root; disposed when the last pane leaves (cwd change or pane close). Watch events fire a debounced (~150 ms) re-probe. Follows the session-identity race pattern: after the debounce/await the service re-checks the root is still referenced before pushing, so a concurrent leave supersedes cleanly.

### Coalescing and dedup

A per-root `probing` guard collapses bursts of watch events and a concurrent idle signal into at most one in-flight `git` call per root. Results are deduped by content signature (`sigOf`) so the `git:status` channel only fires on real change.

### Lifecycle / shutdown

- Shared `AbortController`, re-armed on `stop()`, passed to every `execFile`.
- Probe timeout 8 s (matches the cloud-status service).
- All children `.unref()`'d so a slow `git` never blocks `app.close()` or the e2e suite.
- `stop()` wired to `win.on('closed')`; aborts in-flight probes and disposes all watchers.

## UI

### Chip (`PaneToolbar.tsx`)

Rendered only when `gitStatus[paneId]` is non-null, immediately left of the 📁 cwd button:

- clean branch: ` main` (muted)
- dirty branch: ` main ●` (trailing dot in accent color)
- detached HEAD: ` ⎇ a1b2c3d`

Clicking toggles `GitPopover` via the existing `toggle('git')` menu-state machinery in `PaneTile`.

### Popover (`GitPopover.tsx`)

Same pattern as `ProcessPopover`/`CwdMenu`: a `position: absolute` child of the `position: relative` tile (no body portal — the mosaic-tile portal gotcha applies to `position: fixed` overlays like `PaneContextMenu`/`Modal`, not these toolbar-anchored popovers). Content:

- branch name (and detached sha if applicable)
- upstream ref + `↑ahead ↓behind` (omitted when no upstream)
- staged / unstaged / untracked file counts

Read-only — no action buttons in v1.

### e2e attribute

`PaneTile` stamps `data-git-branch={gitStatus?.branch ?? ''}` on the tile element (mirroring `data-cwd`) so Playwright tests can assert on git state via CSS attribute selector.

## Key files

| File | Responsibility |
|---|---|
| `src/main/git/parse-status.ts` | Pure `parseStatus` — porcelain-v2 stdout → `Omit<GitStatus, 'root'>` |
| `src/main/git/probe.ts` | `resolveGitRoot` + `runGitStatus` — `execFile`, AbortSignal, `unref()`, 8 s timeout |
| `src/main/git/git-status-service.ts` | Per-root watch factory, ref-count, debounce, dedup, abort-on-stop, push |
| `src/main/ipc/register-git.ts` | Wires cwd + idle signals, routes `git:status` push, tears down on window close |
| `src/shared/types.ts` | `GitStatus` interface (runtime-only, not persisted) |
| `src/shared/ipc-contract.ts` | `CH.gitStatus` (`git:status`) channel + `onGitStatus` API method |
| `src/renderer/store/internals.ts` | `gitStatus` in `clearPaneRuntime` |
| `src/renderer/store.ts` | `gitStatus: Record<string, GitStatus \| null>` map + `setGitStatus` setter |
| `src/renderer/components/PaneToolbar.tsx` | Git chip rendering + popover toggle |
| `src/renderer/components/GitPopover.tsx` | Read-only detail popover |
| `tests/main/parse-status.test.ts` | Pure unit fixtures for `parseStatus` |
| `tests/e2e/git-status.spec.ts` | End-to-end: git init → cd in → dirty → cd out |

## Behaviors and edge cases

- **Non-repo / error.** Any failure in `git rev-parse --show-toplevel` (not a repo, git not on PATH, path doesn't exist) pushes `null` — no chip, no watch, no probe. Git errors are never surfaced to the user.
- **SSH / remote pane.** A remote cwd is not a valid local path; `rev-parse` fails → `null`. The feature naturally degrades without any explicit SSH-target threading.
- **Linked worktrees.** When `.git` is a *file* (not a directory), the chokidar watch is attached to that file's target rather than the canonical `.git/` directory. Depending on the worktree layout the watch may be less precise — some index/ref updates may not trigger the watch. The command-idle re-probe covers the gap: after any shell command completes the status is re-probed regardless.
- **Submodules.** `git status` is not recursed in v1; the chip shows the parent repo's status only.
- **Abort + unref shutdown.** A slow `git status` child that is neither abortable nor `unref()`'d blocks `app.close()` and hangs the e2e suite. `runGitStatus` `unref()`s the child and passes an `AbortSignal`; `GitStatusService.stop()` (wired to `win.on('closed')`) aborts in-flight probes. See [decisions: Long-lived child processes must be abortable + unref'd](../decisions.md).
- **Burst coalescing.** A rapid sequence of file saves (each updating the index) produces multiple watch events; the per-root `probing` guard ensures at most one `git status` call is in flight per root at a time.
- **Not persisted.** `GitStatus` is runtime-only and does not bump `SCHEMA_VERSION`. On app restart the status is recomputed from the live cwd on first probe.

## Non-goals (v1)

- No git actions from the popover (commit, stage, checkout, push, pull).
- No submodule recursion — parent repo status only.
- No git status for SSH/remote panes.
- No full working-tree fs-watch — the command-idle re-probe covers the unstaged-edit gap cheaply.
- Not persisted — runtime-only, recomputed from live cwd on launch.

## Testing

- **`tests/main/parse-status.test.ts`** (vitest, pure) — `parseStatus` against porcelain-v2 fixtures: clean branch with upstream, dirty (staged + unstaged + untracked → correct counts + `dirty: true`), detached HEAD (`detached: true` + short sha), ahead/behind parsing, no upstream → `upstream: null`, untracked-only → `dirty: true`.
- **`tests/e2e/git-status.spec.ts`** (Playwright/Electron) — launches the app; creates a temp dir, `git init`, initial commit via the terminal; `cd`s into it; asserts `data-git-branch` equals the branch; writes a file and runs a command; asserts the dirty dot appears; `cd`s to a non-repo dir; asserts the chip disappears. Follows `tests/e2e/cwd.spec.ts` conventions (temp `--user-data-dir`, `killTree` teardown, generous timeouts, `workers: 1`).

## Related

- [Architecture](../architecture.md) — main/preload/renderer layering and the push-event → store → UI pattern this mirrors.
- [Decisions](../decisions.md) — abortable+unref'd children; no secrets persisted; pure core + thin impure shell.
- [CWD awareness](cwd-awareness.md) — the `pty:cwd` signal that feeds `GitStatusService.setCwd`.
- [Status engine](status-engine.md) — the command-idle signal that triggers the working-tree re-probe.
- [Cloud status](cloud-status.md) — the cloud-status service this mirrors (abortable execFile children, signature dedup, stop-on-closed).
- [AI session awareness](ai-session-awareness.md) — sibling pane-scoped awareness pipeline (signal → service → store → UI).
