# Per-Project Notepad

> A collapsible right-side notes drawer scoped to a project (git root, else cwd), tracking the focused pane, persisted in an app-global `notes.json`.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-17-per-project-notepad-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-17-per-project-notepad.md)

## What it does

Each project gets a durable plain-text notepad — a right-side drawer (320 px wide) that tracks the focused pane's project and remembers text across restarts. The drawer opens via a 📝 button in the status bar or the **Ctrl+Shift+N** keybinding.

Notes are keyed by **project key** (git repo root, else cwd), not by pane or workspace. Switching between panes instantly shows each project's note without a reload. A fresh app launch with no focused pane shows an empty "Focus a terminal in a project to take notes." state until a pane is clicked.

## Data flow

```
focused pane
       │
       ▼
resolveProjectKey(state, focusedPaneId)      (pure: git root ?? cwd)
       │  non-empty → store.setNotesProject(key)   [sticky: empty ignored]
       ▼
notesProjectKey (renderer state, per-window)
       │
       ▼
NotesPanel (renders notes[notesProjectKey])
       │  onChange → store.setNote(key, text)
       │               ├─ updates notes map (instant UI)
       │               └─ scheduleNotesSave (debounced 500 ms)
       ▼
api.notesSet(key, text)  →  notes:set IPC (invoke — rejects on a failed disk write)
       │
       ▼
NotesStore.set(key, text)  →  notes.json  (returns write success; sync flush on close)
```

Since the 2026-07-17 quality-audit batch (Finding 6), `notes:set` is an **invoke**: the renderer
un-dirties a key only after its write resolves with the written text still current, so a failed
(or edit-raced) write keeps the key in the dirty set and the next flush retries it. A failure
streak surfaces exactly one error toast (the `makeSaveOutcome` gate in
`src/renderer/store/save-outcome.ts`, shared with the workspace autosave and quick-save writers).

On app init, `api.notesLoad()` is called in the same `Promise.all` as `loadQuick`/`draftsLoad`; the result populates `store.notes`. On `beforeunload`, `flushNotes()` does a synchronous best-effort write.

## Project-key resolution

`resolveProjectKey` in `src/shared/project-key.ts` is a pure function:

1. If `gitStatus[paneId]?.root` is non-empty, return it (git wins — multiple panes in the same repo share one note).
2. Else return the pane's live cwd (`cwds[paneId]`), if known.
3. Else return the persisted cwd from the workspace pane config (covers the brief window before the first OSC cwd signal arrives).
4. Else return `''` (no project).

### Keep-last-project stickiness

`setNotesProject(key)` is called only when `key` is non-empty. This means:

- Focusing a non-terminal pane (editor, explorer) → key stays on the last project.
- Focusing a terminal with no cwd yet → key stays on the last project.
- Only focusing a terminal that resolves to a real project key updates the drawer.

`notesProjectKey` is per-window renderer state (not persisted), so on a fresh launch the drawer starts with `null` and shows the empty state until a pane is focused.

## Persistence

`NotesStore` (`src/main/persistence/notes-store.ts`) mirrors `DraftStore`:

| Behavior | Detail |
|---|---|
| File | `notes.json` in Electron `userData`; holds `Record<projectKey, string>` |
| Load | `readFile` + JSON parse; any error or non-object → returns `{}` (never throws) |
| Set | Updates the in-memory map and writes (`atomicWriteSync`); returns whether the write reached disk — the invoke handler rejects on `false` so the renderer retries (never throws into the editing path) |
| Prune | A key whose text is empty or whitespace-only is **deleted** from the map before writing — cleared notes do not linger |
| Flush | `writeFileSync`, best-effort, called on `win.on('close')` to cover app-close where renderer cleanups don't run |

The renderer maintains a **dirty-key set** via a debounced `notesSave` (same pattern as `quickSave`, 500 ms debounce). Every project edited in the current session is saved, even across rapid project switches — `setNote` always schedules a save for the project whose note just changed.

## Drawer UI and toggle

The workspace content area in `App.tsx` is wrapped in a flex row: `[workspace area flex:1] [NotesPanel width:320]`. The workspace area keeps its `position: relative` so all-mounted, `visibility: hidden` workspace hosts are unaffected (load-bearing — see CLAUDE.md gotcha: never unmount inactive workspaces).

### Panel layout

- **Header:** project name (basename of `notesProjectKey`) + a close `✕` button (`notes-close`).
- **Body (normal):** a full-height `<textarea>` (`notes-textarea`) bound to `notes[notesProjectKey] ?? ''`; `onChange` → `setNote`. Monospace, themed via CSS vars (`--mono`, `--fg`, `--panel`).
- **Body (empty state):** when `notesProjectKey` is `null`, a muted "Focus a terminal in a project to take notes." hint replaces the textarea.

### Toggle

| Method | Action |
|---|---|
| 📝 button in StatusBar (`notes-toggle`) | Calls `setNotesOpen(!notesOpen)` |
| **Ctrl+Shift+N** (`toggle-notes` command) | Same, dispatched in App's keydown switch |

The `toggle-notes` keybinding is in the General group in `src/shared/keybindings.ts` and is rebindable from Settings → Keybindings.

## Multi-window behavior

| Aspect | Behavior |
|---|---|
| Note content | Shared via the main `NotesStore` — same `notes.json` for all windows |
| `notesOpen` | Per-window renderer state (not persisted, not shared) |
| `notesProjectKey` | Per-window renderer state — each window tracks its own focused pane |

All windows read and write through the same `notes:load`/`notes:set` IPC channel; a note typed in window A is immediately visible in window B when that window opens the drawer (it loads on open from the store, which was populated at init).

## Key files

| File | Responsibility |
|---|---|
| `src/shared/project-key.ts` | Pure `resolveProjectKey` — git root → cwd → persisted cwd → `''` |
| `src/main/persistence/notes-store.ts` | `NotesStore`: load/set/flush; prunes empty keys; mirrors `DraftStore` |
| `src/main/ipc/register-notes.ts` | `notes:load` (invoke) + `notes:set` (send); `flush()` on `win.on('close')` |
| `src/shared/ipc-contract.ts` | `CH.notesLoad`/`CH.notesSet`; `notesLoad()`/`notesSet()` on `TermhallaApi` |
| `src/preload/index.ts` | Expose `notesLoad` (invoke) and `notesSet` (send) |
| `src/renderer/store/notes-slice.ts` | `setNotesOpen` / `setNotesProject` / `setNote` |
| `src/renderer/store/types.ts` | `notes`/`notesOpen`/`notesProjectKey` in `State`; `scheduleNotesSave` in `SliceDeps` |
| `src/renderer/store.ts` | `notesSave` debounce; compose `createNotesSlice`; init load; flush |
| `src/renderer/App.tsx` | Flex-row wrapper; `{notesOpen && <NotesPanel />}`; `toggle-notes` keydown case |
| `src/shared/keybindings.ts` | `toggle-notes` (Ctrl+Shift+N, General group) |
| `src/renderer/components/NotesPanel.tsx` | Drawer + project-tracking effect + textarea + empty state |
| `src/renderer/components/StatusBar.tsx` | 📝 toggle button (`notes-toggle`) |
| `tests/shared/project-key.test.ts` | Unit: git root preferred; cwd fallback; persisted cwd fallback; no-pane → `''` |
| `tests/main/notes-store.test.ts` | Unit: set+load round-trip; empty prunes key; corrupt file → `{}` |
| `src/renderer/store/notes-slice.test.ts` | Unit: `setNote` updates map + schedules save; `setNotesProject` sets key; `setNotesOpen` toggles |
| `tests/e2e/notepad.spec.ts` | E2E: type note in git repo, relaunch, note persists; second terminal in different dir shows empty note |

## Non-goals (v1)

- **Plain text only** — no rich text, no Monaco editor, no Markdown rendering.
- **One note per project** — no multiple notes, no titles, no tabs within a project.
- **No search index** — notes are stored and displayed but not indexed; a searchable output-history feature (Feature 2) would integrate notes if/when it ships.
- **Not in workspace JSON or templates** — notes are app-global and project-keyed; copying a workspace does not copy its associated notes.
- **No reordering, no labels** — a project has exactly one note.

## Testing

- **`tests/shared/project-key.test.ts`** (vitest, pure) — git root preferred over cwd; cwd fallback when no git status; persisted-cwd fallback when no live cwd; `''` for null paneId or unknown pane.
- **`tests/main/notes-store.test.ts`** (vitest, pure) — `set` + reload round-trips text; empty/whitespace text prunes the key; corrupt `notes.json` → `{}` (same pattern as `draft-store.test.ts`).
- **`src/renderer/store/notes-slice.test.ts`** (vitest, slice harness) — `setNote` updates the map and calls `scheduleNotesSave`; `setNotesProject` sets the key; `setNotesOpen` toggles the drawer flag.
- **`tests/e2e/notepad.spec.ts`** (Playwright/Electron) — launches the app; adds a terminal, `cd`s into a temp git repo, opens the drawer via 📝, types a note; kills and relaunches with the same `--user-data-dir`; asserts the note persists; splits a second terminal in a different (non-git) directory, focuses it, asserts the drawer shows an empty note for the new project. Follows conventions from `tests/e2e/cwd.spec.ts` (temp `--user-data-dir`, `killTree`, debounce-flush waits, `workers: 1`).

## Related

- [Architecture](../architecture.md) — main/preload/renderer layering; the zustand store + autosave pattern; `userData` persistence files.
- [Decisions](../decisions.md) — no secrets persisted; pure core + thin impure shell; app-global vs workspace-scoped stores.
- [Git status](git-status.md) — provides `gitStatus[paneId].root`, which `resolveProjectKey` uses as the primary project key.
- [CWD awareness](cwd-awareness.md) — provides `cwds[paneId]`, the fallback project key.
- [Editor explorer](editor-explorer.md) — shares the `userData` persistence model (`DraftStore` → `NotesStore`).
