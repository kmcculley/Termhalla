# Editor & File Explorer

> A tabbed Monaco code editor and a live, chokidar-watched read-only file explorer, with all filesystem work behind typed main-process IPC.

**Status:** Shipped · **Spec:** [phase3 design](../superpowers/specs/2026-06-14-termhalla-phase3-editor-explorer-design.md) · **Plan:** [phase3 plan](../superpowers/plans/2026-06-14-termhalla-phase3-editor-explorer.md)

## What it does

Adds the two non-terminal pane kinds to the tiled workspace shell:

- **Editor pane** — a single Monaco instance with a per-file tab strip. Each open file gets its own model (independent undo history + dirty state). Edit, see a dirty dot, **Ctrl+S** to write, and the pane reacts to on-disk changes (silent reload for clean tabs, a "Reload / Keep mine" bar for dirty ones, a strikethrough "(deleted)" marker when a file is removed). Large and binary files are refused with a notice rather than loaded.
- **Explorer pane** — a lazy, alphabetised (dirs-first) directory tree rooted at a chosen folder. Each expanded directory is watched with chokidar so creates/deletes appear live; collapsing tears the watch down. Clicking a file opens it into an editor pane. Read-only — no file mutations this phase.

Both pane kinds persist in the workspace JSON (`PaneConfig` union, schema v3) and restore on relaunch. Unsaved editor edits also survive a restart — see **Hot-exit** below.

## How it works

**Main-process fs layer (`src/main/fs/`).** `files.ts` exposes pure-ish async helpers: `files.ts:readTextFile` (stats first; returns `{content:'', tooLarge:true}` for files over the 50 MB `MAX_BYTES` cap without reading, throws on `files.ts:isBinary` NUL-byte detection over the first 8000 bytes), `files.ts:writeTextFile` (utf8, returns new `mtimeMs`), `files.ts:readDirectory` (uses `files.ts:sortEntries` — dirs first, then `localeCompare`), and `files.ts:statPath`. `watch-manager.ts:WatchManager` wraps chokidar with a per-id `Map<string, FSWatcher>`; `watch` creates a non-recursive (`depth: 0`, `ignoreInitial: true`, `awaitWriteFinish`) watcher and forwards the five `FsEvent`s (`add | unlink | change | addDir | unlinkDir`) to its `onChange` callback; `unwatch`/`closeAll` close them.

**IPC channels.** Wired in `register.ts:registerHandlers` (verified in `src/shared/ipc-contract.ts`): `fs:read`/`fs:write`/`fs:readDir`/`fs:stat` are `ipcMain.handle` invocations over the `files.ts` helpers; `fs:watch`/`fs:unwatch` are fire-and-forget `ipcMain.on` calls into the `WatchManager`; the manager emits `fs:change` back to the renderer via `safeSend`, and `win.on('closed')` calls `watcher.closeAll()`. Native pickers `dialog:openFolder` / `dialog:openFile` use Electron `dialog.showOpenDialog`, returning `string | null`. The preload exposes these as `api.fsRead/fsWrite/fsReadDir/fsStat/fsWatch/fsUnwatch/onFsChange/openFolder/openFile` on `TermhallaApi`.

**EditorPane (`src/renderer/components/EditorPane.tsx`).** Creates one Monaco editor in a `useEffect` keyed on `paneId` and registers `Ctrl+S` via `addCommand`; on mount/focus it calls `store.registerEditorPane(paneId)` so the store tracks `lastEditorPaneId`. Each open file becomes a `Tab` holding its own `monaco.editor.createModel(...)` (language from `language.ts:languageForPath`), the `saved` baseline string, and flags `tooLarge`/`missing`/`externalChanged`. A tab is dirty when `model.getValue() !== saved`. `openTab` reads via `api.fsRead`, starts a watch keyed `\`${paneId}::${path}\``, and on a `fs:change` for that key: `unlink` → mark `missing`; `change` on a clean tab → re-read and `EditorPane.tsx:applyContent` (which uses `model.pushEditOperations`, **not** `setValue`, so external reloads stay in the undo stack); `change` on a dirty tab → set `externalChanged` to show the reload bar. Tab/active-path changes are persisted through the store's kind-agnostic `updatePaneConfig`.

**ExplorerPane (`src/renderer/components/ExplorerPane.tsx`).** Holds `children: Record<dirPath, DirEntry[]>` and an `expanded` set. `loadDir` calls `api.fsReadDir` and starts a per-directory watch (tracked in `watchedRef`); `toggle`/`collapse` expand/recursively-collapse (collapsing any descendant under the dir prefix unwatches and drops its state). A single `onFsChange` subscription routes each event to the matching directory via the pure reducer `explorer-tree.ts:applyDirChange`, which inserts/removes entries while preserving dirs-first ordering and ignores plain `change` events. Clicking a file calls `store.openFileInEditor(wsId, path)`, which targets the most-recently-focused editor pane (or creates one by splitting).

**Monaco bundling.** `editor/monaco-setup.ts` sets `self.MonacoEnvironment.getWorker` and imports the editor/json/css/html/ts workers via Vite `?worker` suffix (types come from `vite-env.d.ts`'s `vite/client` reference). This requires the relaxed renderer CSP in `src/renderer/index.html`: `script-src 'self' 'unsafe-eval'` (Monaco's tokenizer needs eval) and `worker-src 'self' blob:`.

**Data flow:** explorer click → `openFileInEditor` → store updates the editor pane's `EditorConfig.files`/`activePath` → `EditorPane`'s config effect opens the new tab → `api.fsRead` + `api.fsWatch` → live external-change handling over `onFsChange`.

**Hot-exit (unsaved drafts).** Unsaved buffer content is persisted so it survives an app restart (or crash). A main-process `DraftStore` (`src/main/persistence/draft-store.ts`) keeps a `paneId::path → { content, baseline }` map in `editor-drafts.json` (userData), behind `drafts:load` / `drafts:set` / `drafts:delete` IPC; `EditorConfig` is unchanged so workspace files stay small. The store loads once in `store.init` into `drafts`. On open, `openTab` calls the pure `editor-draft.ts:resolveDraftOnOpen(diskContent, draft)`: with a draft it loads the draft into the model (dirty) and, if the current disk content differs from `draft.baseline`, flags the existing `externalChanged` reload bar — so a file that also changed on disk while closed gets the normal **Reload / Keep mine** choice. `EditorPane` persists the draft debounced (~500 ms) on edit and **deletes** it on Ctrl+S, tab close, and pane close (the editor-create effect's cleanup), and flushes pending drafts on `beforeunload`; the main store also flushes synchronously on window `close`. Because Electron destroys the renderer on app close *without* running React cleanups, session drafts survive on disk — which is what makes restart-restore work — while a genuinely removed pane cleans up its drafts (no orphans).

## Key files

| File | Responsibility |
|---|---|
| `src/main/fs/files.ts` | read/write/readDir/stat; size cap + binary guard; entry sorting |
| `src/main/fs/watch-manager.ts` | per-id chokidar `WatchManager`, non-recursive, forwards `FsChange` |
| `src/main/ipc/register.ts` | wires `fs:*` + `dialog:*` handlers; `closeAll` on window close |
| `src/shared/ipc-contract.ts` | `CH.fs*`/`CH.dialog*` channels and `TermhallaApi` fs methods |
| `src/shared/language.ts` | pure `languageForPath` extension → Monaco language map |
| `src/renderer/editor/monaco-setup.ts` | `MonacoEnvironment` workers via `?worker`; re-exports `monaco` |
| `src/renderer/components/EditorPane.tsx` | tabs, per-file models, dirty, Ctrl+S, external-change reload, draft apply/persist/clear |
| `src/main/persistence/draft-store.ts` | `DraftStore` — unsaved-buffer hot-exit map in `editor-drafts.json` |
| `src/shared/editor-draft.ts` | pure `draftKey` + `resolveDraftOnOpen` (open-time draft/disk resolution) |
| `src/renderer/components/ExplorerPane.tsx` | lazy watched tree, expand/collapse, open-on-click |
| `src/renderer/components/explorer-tree.ts` | pure `applyDirChange` tree reducer |
| `src/renderer/store.ts` | `addEditor`/`addExplorer`/`openFileInEditor`/`lastEditorPaneId`; kind-agnostic `updatePaneConfig` |

## Behaviors & edge cases

- **Too-large / binary guard.** `readTextFile` stats before reading; over `MAX_BYTES` (50 MB) it returns `tooLarge` with no content and the tab shows a "File too large to open." notice. Binary files (NUL byte in the first 8000) throw, and the tab is flagged `missing` (open fails closed).
- **Undo-preserving reload.** External clean-file reloads and the "Reload" button apply content via `pushEditOperations` over the full model range, so a mistaken reload is recoverable with Ctrl+Z — `setValue` (which clears undo) is deliberately avoided.
- **Dirty vs. clean external change.** Clean tab → silent re-read; dirty tab → non-blocking `editor-reloadbar` with **Reload** / **Keep mine** (no data loss without consent).
- **Deleted-file tab state.** An `unlink` marks the tab `missing`; the tab shows strikethrough + "(deleted)" but content stays editable, and saving re-creates the file on disk.
- **Watch keys.** Both panes namespace watches as `\`${paneId}::${path}\`` so one shared `fs:change` channel serves every pane; the editor watches open files, the explorer watches expanded directories. Explorer collapse recursively unwatches descendants.
- **CSP / worker requirement.** Monaco will not run under the default CSP — it needs `script-src 'unsafe-eval'` and `worker-src blob:`, scoped in `index.html`; the `?worker` imports rely on the Vite client types. This is the single biggest integration risk (see plan Task 9).
- **Persistence.** `PaneConfig` is a `kind`-discriminated union (terminal | editor | explorer) at `SCHEMA_VERSION = 3`; v2 terminal-only workspaces still load. Editor panes reopen `files` and **restore unsaved drafts** (hot-exit, above); explorer panes re-root and re-watch; tree expansion state is not persisted.
- **Draft conflict / lifecycle.** A restored draft whose file changed on disk while closed shows the reload bar (the draft's `baseline` vs current disk content drives `externalChanged`). Drafts survive app close but are deleted on save / tab-close / pane-close; too-large files never produce a draft. Not persisted: cursor/scroll position; there is no untitled/new-file buffer to persist (every tab is path-backed).

## Testing

Verified present in `tests/`:

- **Unit (vitest).** `tests/shared/language.test.ts` (extension mapping, case-insensitive, plaintext fallback); `tests/shared/pane-union.test.ts` (editor/explorer config round-trip; v2 terminal-only still loads); `tests/renderer/explorer-tree.test.ts` (`applyDirChange` add/addDir/unlink/unlinkDir ordering, ignore plain `change`, idempotent duplicate add).
- **Main integration (vitest + temp dirs).** `tests/main/fs-files.test.ts` (write/read round-trip, `tooLarge` cap without reading content, binary rejection, dirs-first listing, stat, pure `sortEntries`, `isBinary`); `tests/main/watch-manager.test.ts` (emits an `add` event for a new file in a watched dir; stops emitting after `unwatch`).
- **Hot-exit (vitest).** `tests/shared/editor-draft.test.ts` (`draftKey`; `resolveDraftOnOpen` — passthrough, missing file, dirty vs unchanged baseline, external-change, deleted-with-draft, stale-equals-disk); `tests/main/draft-store.test.ts` (load-missing → `{}`, set/load round-trip, delete, malformed-entry sanitize, sync flush).
- **e2e (Playwright, hermetic seeded launch).** `tests/e2e/editor.spec.ts` — opens a seeded file in Monaco, edits + Ctrl+S writes disk; Ctrl+S after a tab switch; clean external change reloads; deleted file marks the tab. `tests/e2e/explorer.spec.ts` — explorer lists files, opens one into the editor with correct content, and reflects an externally-created file live. `tests/e2e/editor-hot-exit.spec.ts` — an unsaved draft is restored after relaunch (dirty marker shown), and a drafted file changed on disk while closed surfaces the reload bar.

Gaps (accepted, see [phase3 follow-ups](../superpowers/phase3-review-followups.md)): the dirty reload-bar path, `tooLarge`/binary tabs, and explorer recursive-collapse have no dedicated e2e; native dialog wrappers can't be Playwright-driven and are covered by manual acceptance.

## Related

- [Architecture](../architecture.md) — process model, IPC contract, `PaneConfig` union, Monaco CSP
- [Decisions](../decisions.md) — design-record context
- [Phase 3 review follow-ups](../superpowers/phase3-review-followups.md) — deferred minor items + Monaco CSP security note
- Sibling features: [Workspaces](workspaces.md), [CWD awareness](cwd-awareness.md)
