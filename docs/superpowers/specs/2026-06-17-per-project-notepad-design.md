# Per-project notepad — design

**Date:** 2026-06-17
**Feature:** Roadmap feature 6 — a collapsible, auto-saved notes drawer scoped to a project
(git repo root, falling back to cwd), showing the notes for whatever project the focused pane
belongs to, persisted in a dedicated app-global store.

## Goal

Give each project a durable place for context, todos, and snippets that follows the project
rather than a single pane or workspace. The notepad is a right-side drawer; its content is keyed
by a **project key** (git root, else cwd) and tracks the focused pane, sticking to the last
non-empty project when focus lands on a project-less pane. Persisted across restarts.

v1: plain-text notes (auto-growing textarea), one note per project, right-side drawer.

## Architecture & data flow

Notes are app-global and keyed by project. No per-pane/per-workspace coupling.

```
focused pane ─▶ resolveProjectKey(state, focusedPaneId)   (pure: gitStatus root ?? paneCwd)
                  │  non-empty → store.setNotesProject(key)   [sticky: empty is ignored]
                  ▼
   NotesPanel (right drawer, shown when notesOpen) renders notes[notesProjectKey]
                  │  edit → store.setNote(key, text)
                  │           ├─ updates notes map (instant UI)
                  │           └─ scheduleNotesSave (debounced 500ms) → api.notesSet(key, text)
                  ▼
   main NotesStore → notes.json: Record<projectKey, string>   (flush() on window close)
```

### New files

| File | Purpose |
|---|---|
| `src/shared/project-key.ts` | **Pure.** `resolveProjectKey(state, paneId)` → git root, else cwd, else `''`. |
| `src/main/persistence/notes-store.ts` | `NotesStore`: `load`/`set`/`flush`; prunes empty keys. Modeled on `DraftStore`. |
| `src/main/ipc/register-notes.ts` | `notes:load` (invoke), `notes:set` (send); `flush()` on `win.on('close')`. |
| `src/renderer/store/notes-slice.ts` | `setNotesOpen` / `setNotesProject` / `setNote`. |
| `src/renderer/components/NotesPanel.tsx` | The right-drawer panel + project tracking effect. |
| `tests/shared/project-key.test.ts`, `tests/main/notes-store.test.ts`, `src/renderer/store/notes-slice.test.ts` | Unit tests. |
| `tests/e2e/notepad.spec.ts` | End-to-end. |

### Touched files

| File | Change |
|---|---|
| `src/shared/ipc-contract.ts` | `CH.notesLoad='notes:load'`, `CH.notesSet='notes:set'`; `notesLoad()`/`notesSet(key,text)` on `TermhallaApi`. |
| `src/preload/index.ts` | Expose `notesLoad` (invoke) + `notesSet` (send). |
| `src/renderer/api.ts` | (passthrough — already proxies `window.termhalla`.) |
| `src/main/ipc/register.ts` | Compose `registerNotes(win, dir)`. |
| `src/renderer/store.ts` | Load `notes` in `init` (added to the `Promise.all`); add a `notesSave` debounce (mirrors `quickSave`) + `scheduleNotesSave` in `SliceDeps`; flush notes in `beforeunload`; compose `createNotesSlice`; initial state `notes: {}`, `notesOpen: false`, `notesProjectKey: null`. |
| `src/renderer/store/types.ts` | Add `notes`/`notesOpen`/`notesProjectKey` + the 3 actions to `State`; add `scheduleNotesSave` to `SliceDeps`. |
| `src/renderer/App.tsx` | Wrap the workspace content in a flex row with the drawer; dispatch `toggle-notes`. |
| `src/shared/keybindings.ts` | Add `toggle-notes` command (default **Ctrl+Shift+N** — verified free). |
| `src/renderer/components/StatusBar.tsx` | Add a 📝 toggle button (`notes-toggle`). |

## Data model

```ts
// renderer store state
notes: Record<string, string>     // projectKey -> note text (loaded in init)
notesOpen: boolean                // drawer visible (per-window, not persisted)
notesProjectKey: string | null    // current project shown (sticky, per-window)

// actions
setNotesOpen(open: boolean): void
setNotesProject(key: string): void          // called only with a non-empty key (stickiness)
setNote(key: string, text: string): void    // update map + scheduleNotesSave
```

```ts
// src/shared/project-key.ts (pure)
import type { GitStatus, Workspace } from './types'
import { paneCwd } from '...'   // reuse the existing resolver (see note)

export function resolveProjectKey(
  s: { gitStatus: Record<string, GitStatus>; cwds: Record<string, string>; workspaces: Record<string, Workspace> },
  paneId: string | null
): string {
  if (!paneId) return ''
  return s.gitStatus[paneId]?.root ?? paneCwd(s, paneId)
}
```

**Note on `paneCwd`:** it currently lives in `src/renderer/store/internals.ts`, which imports
`../api` (forbidden in unit tests). `paneCwd` itself is pure. To keep `project-key.ts` unit-testable
without pulling in `api`, the plan will either (a) inline the same cwd-fallback logic in
`project-key.ts`, or (b) move the pure `paneCwd` to a shared/api-free module and re-export it from
`internals.ts`. The plan chooses **(a) inline** to avoid touching unrelated call sites — the
fallback is three lines.

## Persistence

`NotesStore` mirrors `DraftStore` (`src/main/persistence/draft-store.ts`):

- File: `notes.json` in Electron `userData`, holding `Record<projectKey, string>`.
- `load(): Promise<NotesMap>` — read + sanitize (non-object or parse error → `{}`).
- `set(key, text): void` — update the in-memory map and persist async; **delete the key when
  `text` is empty/whitespace-only** so cleared notes don't linger.
- `flush(): void` — synchronous best-effort write, called on `win.on('close')` (covers app close,
  where renderer cleanups don't run — same rationale as drafts).

Renderer: `init()` loads notes via `api.notesLoad()` (added to the existing `Promise.all`). A
`notesSave` debounce in `store.ts` (constructed like `quickSave`) reads `notesProjectKey` + `notes`
and calls `api.notesSet(key, text)`; `setNote` calls `scheduleNotesSave`. The `beforeunload`
handler also flushes notes.

This is the user's own plain-text content under `userData` (like editor drafts) — consistent with
the no-secrets-persisted stance.

## UI — `NotesPanel` (right drawer)

In `App.tsx` the workspace content div becomes a flex row:
`[workspace area flex:1][NotesPanel width:320]`. The workspace area keeps its `position: relative`
so the all-mounted, visibility-hidden workspace hosts are unaffected (load-bearing — do not change
how hosts mount/hide). The panel renders only when `notesOpen`.

- **Header:** project name = basename of `notesProjectKey` + a close `✕` (`notes-close`).
- **Body:** a full-height auto-growing `<textarea data-testid="notes-textarea">` bound to
  `notes[notesProjectKey] ?? ''`; `onChange` → `setNote(notesProjectKey, text)`. Monospace, themed
  via CSS vars.
- **Empty state:** when `notesProjectKey` is null → muted "Focus a terminal in a project to take
  notes." (textarea hidden/disabled).
- **Project tracking:** a `useEffect` keyed on `[focusedPaneId, gitStatus, cwds]` computes
  `resolveProjectKey` and calls `setNotesProject(key)` **only when non-empty** — giving the
  "keep last project" stickiness. Lives in `NotesPanel` (runs only while the drawer is open).
- **Toggle:** keybinding `toggle-notes` (Ctrl+Shift+N) dispatched in `App`'s keydown switch
  (`s.setNotesOpen(!s.notesOpen)`), plus a 📝 button in `StatusBar` (`notes-toggle`).

## Error handling & edge cases

- No notes yet for a project → empty textarea; typing creates the entry; clearing to empty deletes
  the key on next save.
- Same project open in multiple panes/workspaces → same notes (keyed by project). Multi-window:
  content shared via the main store; `notesOpen`/`notesProjectKey` are per-window renderer state.
- Corrupt/missing `notes.json` → `load()` returns `{}`.
- Focused pane is non-terminal (editor/explorer) or a terminal with no cwd yet → `resolveProjectKey`
  returns `''`; the tracker ignores it and the drawer keeps showing the last project.

## Testing

### Unit (vitest)
- `tests/shared/project-key.test.ts` — git root preferred over cwd; cwd fallback when no git
  status; `''` when no pane / no project; uses the inlined cwd fallback.
- `tests/main/notes-store.test.ts` — set+load round-trip (temp dir); empty text prunes the key;
  corrupt file → `{}` (mirrors `draft-store.test.ts`).
- `src/renderer/store/notes-slice.test.ts` — `setNote` updates the map and calls
  `scheduleNotesSave`; `setNotesProject` sets the key; `setNotesOpen` toggles (slice-harness
  pattern, like `keybindings-slice.test.ts`).

### E2E (Playwright) — `tests/e2e/notepad.spec.ts`
1. Launch, add a terminal, `cd` into a temp git repo, open the notes drawer (📝 or Ctrl+Shift+N),
   type a note.
2. Save/relaunch (or just relaunch — notes persist independently of workspace save) → the note
   reappears for that project.
3. Open a second terminal in a different temp dir, focus it → the drawer shows that project's
   (empty) notes, confirming per-project scoping.

Follows existing e2e conventions (temp `--user-data-dir`, `killTree`, debounce-flush waits,
`workers: 1`).

## Non-goals (v1)

- No rich text / Monaco / markdown rendering — plain textarea only.
- No multiple notes per project, no titles/tabs within a project's note.
- No search indexing yet (Feature 2, searchable output history, would index notes if/when it ships).
- No per-workspace or per-pane notes — strictly per-project.
- Notes are not part of workspace JSON or templates (they're app-global, project-keyed).
