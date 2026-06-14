# Termhalla Phase 3 — Editor & Explorer Panes — Design Spec

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phases 1 (terminal workspace) and 2 (status engine), both merged to master.

## 1. Summary

Add the two remaining pane types — a **Monaco code editor** and a **live file
explorer** — to the existing tiled-workspace shell. The editor opens, edits, and
saves real files with per-file tabs; the explorer browses a directory tree that
reflects on-disk changes live and opens files into the editor. All privileged
filesystem work happens in the main process behind typed IPC, preserving the
Phase 1 security posture.

## 2. Decisions (from brainstorming, 2026-06-14)

| Decision | Choice |
|---|---|
| Editor file model | **Tabs inside an editor pane** (VS Code-style editor group). One Monaco model per open file; open-from-explorer adds a tab to the focused editor pane. |
| Save & external changes | **Explicit save (Ctrl+S)** + per-tab dirty dot. On-disk change to a **clean** tab → silent reload; to a **dirty** tab → non-blocking "reload / keep mine" bar. |
| Explorer scope | **Browse + open, read-only**, live-updating via chokidar. No file mutations this phase. |

## 3. Pane model & persistence

`PaneConfig` (currently an alias for `TerminalConfig`) becomes a discriminated
union on `kind`:
```ts
interface EditorConfig   { kind: 'editor';   files: string[]; activePath?: string }
interface ExplorerConfig { kind: 'explorer'; root: string }
type PaneConfig = TerminalConfig | EditorConfig | ExplorerConfig
```
- `WorkspaceView.renderTile` switches on `config.kind` →
  `TerminalPane | EditorPane | ExplorerPane`.
- Serialization is generic (already implemented), so the new configs persist
  automatically. `SCHEMA_VERSION` bumps to **3**; migrate 2→3 is identity; v2
  (terminal-only) workspaces still load. The existing `migrate` guard rejects
  versions newer than supported.
- **Restore semantics:** an editor pane re-opens its `files` **fresh from disk**
  (unsaved edits are not preserved across restart — consistent with the
  no-process-resurrection philosophy used for terminals). An explorer pane
  re-roots at `root` and re-establishes watches. Tree expansion state is not
  persisted (tree starts at the root).

## 4. Main-process filesystem layer

New privileged modules under `src/main/fs/`, reached over IPC (same pattern as the
PTY/status layers). The renderer only ever sees typed results.

- `fs:read(path)` → `{ content: string, tooLarge: boolean }`. Reads utf8; refuses
  files over a ~50 MB cap (`tooLarge: true`, no content) and rejects binary files
  (detected via NUL-byte sniff).
- `fs:write(path, content)` → writes utf8; returns the new `mtimeMs`.
- `fs:readDir(path)` → `[{ name, path, isDir }]`, directories first then files,
  each alphabetical.
- `fs:stat(path)` → `{ size, mtimeMs, isDir }`.
- **`WatchManager`** (chokidar): `fs:watch(id, path)` starts a watcher
  (non-recursive for directories — `depth: 0`), `fs:unwatch(id)` stops it; events
  are forwarded to the renderer as `fs:change(id, { event, path })` where `event`
  ∈ `add | unlink | change | addDir | unlinkDir`. The explorer watches each
  **expanded directory**; the editor watches each **open file**. One channel
  serves both.
- Native pickers: `dialog:openFolder()` and `dialog:openFile()` → `string | null`
  via Electron `dialog`.

## 5. Editor pane (Monaco)

`EditorPane` renders a tab strip (the `files` array) above one Monaco editor
instance.

- **Per-file models:** each open file has its own Monaco model (per-file undo
  history + dirty state); switching tabs swaps the active model. Language is
  inferred from the extension via a pure `languageForPath` map.
- **Dirty tracking:** a tab is dirty when its model content differs from the
  last-saved content; a dot marks it. **Ctrl+S** writes the active file via
  `fs:write` and clears dirty. Closing a dirty tab prompts (save / discard /
  cancel).
- **External changes:** the pane watches each open file (`fs:watch`). On `change`
  for a **clean** tab → silently re-read and update the model. For a **dirty** tab
  → show a non-blocking bar: "Changed on disk — Reload / Keep mine." On `unlink`
  → mark the tab deleted (subtle indicator; content stays editable; saving
  re-creates the file).
- **Large/binary files:** when `fs:read` returns `tooLarge`, the tab shows a
  "file too large to open" notice instead of loading it; binary files are refused
  with a notice. Within the cap, Monaco's built-in large-file handling covers
  performance.
- **Opening files:** an empty editor pane shows an "Open File…" button (native
  picker); the explorer also opens files into an editor pane (§6).

**Monaco integration (primary technical risk):** `monaco-editor` requires its web
workers to be bundled and the renderer CSP relaxed for worker blobs. The plan
configures electron-vite worker handling and adds `worker-src 'self' blob:` (plus
`'unsafe-eval'` only if Monaco requires it) to the renderer CSP — scoped to
Monaco's needs, nothing broader.

## 6. Explorer pane & open-from-explorer

`ExplorerPane` renders a lazy directory tree rooted at `config.root`:
- Top level loads via `fs:readDir(root)`. Expanding a folder reads its children
  and starts a non-recursive `fs:watch` on it; collapsing stops that watch.
- A pure **tree reducer** applies `fs:change` events
  (add / unlink / addDir / unlinkDir) to the in-memory node list, preserving
  dirs-first ordering. This reducer is the unit-tested core.
- Clicking a file calls `openFileInEditor(path)`.
- A new explorer pane prompts for a folder via `dialog:openFolder()`; if the user
  cancels, no pane is created.

**Open-from-explorer rule:** `openFileInEditor(path)` adds the file as a tab to
the workspace's **most-recently-focused editor pane**; if none exists, it creates
one by splitting the explorer pane (`row`). The store tracks `lastEditorPaneId`
(set when an editor pane mounts/gains focus).

## 7. Pane-creation UI

- The empty-workspace state offers three buttons: **New Terminal / New Editor /
  New Explorer**.
- A **"＋ ▾"** menu in the tab strip adds any of the three pane types to the
  active workspace (splitting the focused pane).
- The existing per-pane Split buttons keep their current quick-terminal behavior.
- The store gains `addEditor` / `addExplorer` (and `openFileInEditor`) alongside
  `addTerminal`, all sharing the existing `splitPane` / `addFirstPane` model
  logic.

## 8. Testing & verification

- **Unit (vitest, pure):** `languageForPath` mapping; dirty-state comparison; the
  explorer tree reducer (apply add/unlink/addDir/unlinkDir → assert ordered tree);
  pane-union serialize/deserialize (editor/explorer round-trip; v2 terminal-only
  still loads; schema v3 stamped).
- **Main integration (vitest + temp dirs):** `fs:read/write/readDir/stat` against
  real temp files (incl. the too-large and binary refusals); `WatchManager` —
  create/modify/delete a temp file and assert `change` events fire (await chokidar
  `ready` to avoid flakiness).
- **e2e (Playwright, hermetic launch from Phase 1):** seed a temp dir → open an
  explorer there → tree renders → click a file → opens in editor with correct
  content → edit → dirty dot → Ctrl+S → assert disk content updated → create a
  file in the temp dir externally → explorer shows it live → modify an open clean
  file externally → editor reloads.

## 9. Non-goals (Phase 3)

- No file mutations from the explorer (create / rename / delete / drag-move) —
  deferred.
- No editor language servers, IntelliSense beyond Monaco's built-in
  syntax/bracket features, debugging, or extensions.
- No diff view, search-across-files, or multi-root explorer.
- No preservation of unsaved editor content across app restart.
