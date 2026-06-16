# UI Polish — Phase 2: Feedback & micro-QoL

**Date:** 2026-06-16
**Status:** Design — pending review
**Part of:** UI polish + QoL initiative (Phase 2 of 4). Phase 1 (design tokens) is
merged. Phases 3 (keyboard/a11y + command palette) and 4 (unified Settings) follow.

## Goal

Give discrete user actions visible confirmation (an in-renderer toast system), add a
file-explorer context menu (including recoverable delete + rename), auto-focus the two
passphrase inputs that don't, and fill the missing explorer empty/error states.

## What already exists (do NOT rebuild)

Verified in the current tree:

- **OS notifications** via `api.notify` (`runtime-slice.ts`) — desktop, not in-app. Keep.
- **Workspace-tab context menu** (`WorkspaceTabs.tsx:150`): Rename / Save / Close. Keep.
- **Auto-focus** already on: command palette input, broadcast textarea, schedule textarea,
  SSH-form first field, workspace-rename input.
- **Empty states** already on: command palette ("No matches"), process popover, templates
  menu, EnvManager unlock error ("Incorrect passphrase").
- **Reveal/clipboard IPC**: `revealPath` (`shell:reveal`, uses `shell.openPath` — opens a
  *directory*; on a *file* it would open the file, so it's wrong for "reveal a file"),
  `clipboardWrite` (`clipboard:write`).

## Components

### 1. Toast system (new infra)

**`src/renderer/store/toasts-slice.ts`** — follows the existing slice pattern
(`createToastsSlice({ set, get })`, composed in `store.ts`):
- State: `toasts: Toast[]` where `Toast = { id: string; kind: ToastKind; text: string }`
  and `ToastKind = 'success' | 'error' | 'info'`.
- Actions: `pushToast(text: string, kind?: ToastKind): string` (defaults to `'success'`,
  returns the id), `dismissToast(id: string): void`.
- The slice is pure (no timers). `pushToast` uses `uuid()` for the id (matching other
  slices) and caps the list at the 4 most-recent to bound the stack.

**`src/renderer/components/Toasts.tsx`** — rendered once in `App.tsx`:
- Fixed bottom-right vertical stack (`position: fixed; right/bottom: 12; zIndex` above
  dialogs but the container is `pointer-events: none`, each toast `pointer-events: auto`).
- Each toast: `SURFACE`-style card, a 3px left accent border colored by kind
  (`success` → `--accent`, `error` → `--status-needs`, `info` → `--border`), the text,
  `--shadow-pop`, the `ui-pop-in` animation (Phase 1). Click anywhere on a toast dismisses
  it.
- Auto-dismiss: a small `<ToastItem>` runs `useEffect(() => { const t = setTimeout(() =>
  dismissToast(id), 4000); return () => clearTimeout(t) }, [])`. Timers live in the
  component, not the store, so the store stays pure.

**Wiring (at call sites, not inside slices)** — keeps slices side-effect-light and the
human copy next to the UI. `const pushToast = useStore(s => s.pushToast)` then call it
after the action:
- `TemplatesMenu`: save → "Template saved"; delete → "Template deleted".
- `ThemeEditor`: save preset → "Preset saved"; delete preset → "Preset deleted".
  (Theme *apply* stays silent — it has instant visual feedback.)
- `SshConnectionForm`: save → "Connection saved".
- `ScheduleDialog`: add → "Command scheduled"; cancel → "Schedule canceled".
- `EnvManager`: global/terminal var add → "Variable added"; vault create → "Vault created".
- Explorer menu actions (below): copy → "Path copied"; delete → "Moved to Recycle Bin";
  rename success → "Renamed"; any fs error → `pushToast(msg, 'error')`.

### 2. Explorer context menu

`ExplorerPane.tsx` gains an `onContextMenu` on each row that opens a small fixed-position
menu (same `SURFACE` + `Z.menu` pattern as `ws-menu`, with a full-screen click-catcher
backdrop). Menu state: `{ entry: DirEntry; x: number; y: number } | null`.

Items (files vs. folders differ slightly):
- **Open** (files only) → `openFileInEditor`.
- **Reveal in File Explorer** → new `api.revealItem(path)` (`shell.showItemInFolder`).
- **Copy path** → `api.clipboardWrite(path)` + toast.
- **Copy relative path** → `api.clipboardWrite(relativeTo(config.root, path))` + toast.
- **Rename** → switches that row to an inline `<input>` (mirrors the workspace-rename
  pattern: `autoFocus`, select-on-focus, Enter commits / Escape cancels / blur commits).
  Commit calls `api.fsRename(oldPath, newPath)` where `newPath` is the sibling path with
  the new basename. On success the chokidar watch already refreshes the tree; on error →
  error toast.
- **Delete** → `window.confirm("Move \"<name>\" to the Recycle Bin?")` then
  `api.fsTrash(path)` → toast "Moved to Recycle Bin". Uses the OS trash (recoverable), not
  a permanent unlink.

**New IPC** (contract → preload → `api.ts` → `register-fs` → `fs/files.ts`):

| Channel const | string | main impl |
|---|---|---|
| `fsRename` | `fs:rename` | `renamePath(old, next)` → `fs.promises.rename` |
| `fsTrash` | `fs:trash` | `shell.trashItem(path)` |
| `fsRevealItem` | `fs:revealItem` | `shell.showItemInFolder(path)` |

`TermhallaApi` additions: `fsRename(oldPath: string, newPath: string): Promise<void>`,
`fsTrash(path: string): Promise<void>`, `fsRevealItem(path: string): Promise<void>`.
`renamePath` lives in `fs/files.ts` beside the other fs ops; `fsTrash`/`fsRevealItem` are
shell calls so they sit directly in `register-fs`.

**New pure helper** — `@shared/paths`:
`relativeTo(root: string, p: string): string` — strips a `root` prefix (handling either
separator and a trailing separator) and returns the remainder; if `p` isn't under `root`,
returns `p` unchanged. Unit-tested.

### 3. Auto-focus

Add `autoFocus` to the EnvManager create-passphrase input (`EnvManager.tsx:73`) and the
unlock-passphrase input (`EnvManager.tsx:85`). (Only one of the two renders at a time, so
there is no focus conflict.)

### 4. Empty / error states

- **ExplorerPane**: when an expanded directory has loaded with zero entries, render a dim
  "Folder is empty" row (indented like its children). Track read failures: `loadDir`'s
  `.catch` sets a `Set<string>` of errored dirs; render "Couldn't read folder" for those
  instead of silently showing empty.
- **EnvManager**: between `unlock` succeeding and `refresh()` resolving (`data === null`
  while `env.unlocked`), show a dim "Loading…" line in the variables section.

## Architecture / where things live

- New: `store/toasts-slice.ts`, `components/Toasts.tsx`.
- Modified: `store.ts` (compose slice), `store/types.ts` (`Toast`, `ToastKind`, slice
  actions on `State`), `App.tsx` (render `<Toasts/>`), `shared/ipc-contract.ts` (3
  channels + 3 `TermhallaApi` methods), `preload/*` (bridge), `renderer/api.ts`,
  `main/ipc/register-fs.ts`, `main/fs/files.ts` (`renamePath`), `shared/paths.ts`
  (`relativeTo`), `components/ExplorerPane.tsx` (context menu + inline rename + empty/error),
  `components/EnvManager.tsx` (autofocus + loading), and the call-site toast wiring.

No changes to persistence/`SCHEMA_VERSION` (toasts are ephemeral, never saved).

## Implementation ordering (two independently-shippable stages)

1. **Renderer-only feedback** — toasts slice + component + `App` render + all non-explorer
   call-site wiring + EnvManager autofocus + EnvManager loading state. Zero IPC, low risk.
2. **Explorer context menu + fs IPC** — the `relativeTo` helper, the 3 new fs channels end
   to end, the context menu, inline rename, delete-to-trash, explorer empty/error states,
   and the explorer toast wiring.

## Testing (TDD per CLAUDE.md)

Pure logic → vitest; UI/IPC → e2e that launches the app.

- **Unit — toasts slice**: `pushToast` appends + returns an id + caps at 4; `dismissToast`
  removes by id.
- **Unit — `relativeTo`**: under-root (both separators), trailing-separator root, exact
  root → `''`, not-under-root → unchanged.
- **Unit — `renamePath`** (`fs/files.ts`): vitest with a `mkdtemp` dir — renames a real
  file, and rejects when the target exists / source missing.
- **e2e — toast**: trigger a discrete action (save a workspace template via the templates
  menu) and assert a `toast` testid appears with the expected text, then auto-dismisses.
- **e2e — explorer context menu**: seed an explorer pane on a temp dir with a file;
  right-click → assert menu; Copy path → assert `clipboard` content via
  `api.clipboardRead`; Rename → inline edit, Enter, assert the tree row + disk reflect the
  new name; Delete → confirm auto-accepted (override `window.confirm`), assert the file is
  gone from disk and the tree.
- **e2e — autofocus**: open EnvManager (no vault) → assert the passphrase input
  `toBeFocused()`.
- Full `npm run typecheck && npm test && npm run build && npm run e2e` green. Run
  `typecheck` WITHOUT piping through `tail` (a Phase-1 lesson: the pipe masked its exit
  code).

## Load-bearing gotchas respected

- **Explorer watch refresh**: rename/trash mutate disk; the existing chokidar watch
  (`WatchManager`) emits `fs:change`, which `ExplorerPane` already applies — so the tree
  updates without manual re-read. Rename within a watched dir is a delete+add pair the
  existing `applyDirChange` handles.
- **Trash, not unlink**: `shell.trashItem` is recoverable; never `fs.unlink` from a menu.
- **Inline-rename focus** mirrors the proven workspace-rename pattern (autoFocus +
  select-on-focus + Enter/Escape/blur) to avoid focus-trap surprises.
- **Toast container is `pointer-events: none`** so it never blocks clicks on the app
  beneath it; only the toast cards themselves capture clicks (to dismiss).

## Risks

- Destructive `fs:trash`/`fs:rename` are the real risk. Mitigations: trash (recoverable)
  not unlink; delete gated by `window.confirm`; rename validated non-empty and no-op when
  unchanged; both covered by e2e on temp dirs. fs errors surface as error toasts rather
  than silent failures.
- `shell.trashItem` in a headless e2e: it moves to the OS Recycle Bin on Windows and
  resolves; the test asserts the source path no longer exists (not the bin contents).
