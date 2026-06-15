# Termhalla — Editor Scratch (Untitled) Buffer Persistence — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phase 3 (Monaco editor) and editor hot-exit
(`2026-06-15-termhalla-editor-hot-exit-design.md`), all merged to `main`.

## 1. Summary

An editor pane with no file open currently shows a bare "Open File…" state, but
Monaco still provides an editable untitled model — so users type scratch text into
it. That text is **not tracked, not saveable, and not persisted**: it vanishes on
restart (the hot-exit feature only covers path-backed tabs; untitled buffers were an
explicit non-goal there). This sub-project makes the untitled buffer first-class:
each editor pane gets one managed **Untitled scratch tab** whose content persists
across restart (reusing the hot-exit drafts store) and which **Ctrl+S** converts into
a real file via a Save-As dialog.

## 2. Decisions (from brainstorming, 2026-06-15)

| Decision | Choice |
|---|---|
| Scope | **Scratch + Save As** — persist the untitled buffer AND let Ctrl+S save it to a new file. |
| Count | **One scratch buffer per editor pane** (not multiple untitled tabs). |
| Storage | Reuse the hot-exit `DraftStore`, keyed `paneId::<UNTITLED sentinel>`. **No `EditorConfig`/schema change.** |
| Visibility | The Untitled tab shows when the pane has **no file open** OR the scratch buffer is **non-empty**. |
| Persisted active | When the untitled tab is active, `activePath` persists as `undefined` (the sentinel never enters the workspace JSON). |

## 3. Architecture & data flow

The untitled buffer reuses the existing `Tab` + draft machinery in `EditorPane` by
treating it as a tab whose `path` is a reserved sentinel and whose `saved` baseline
is the empty string:

```
type in Untitled tab ─► onDidChangeContent ─► scheduleDraftPersist(UNTITLED)
                                           ─► persistDraft: non-empty -> draftSet(paneId::UNTITLED, {content, baseline:''})
                                                            empty     -> draftDelete(paneId::UNTITLED)
app start ─► store.drafts (already loaded) ─► EditorPane creates the untitled model from drafts[paneId::UNTITLED]
Ctrl+S on Untitled ─► dialog:saveFile -> fsWrite -> openTab(savedPath) -> clear scratch + its draft
```

Because `saved = ''`, the existing dirty check (`getValue() !== saved`) and
`persistDraft` (delete-when-equals-saved, set-otherwise) work unchanged — non-empty
scratch is "dirty" and persisted; cleared scratch deletes its draft. No new draft
store, IPC, or types are needed for persistence; only the Save-As path adds IPC.

## 4. The UNTITLED sentinel (pure, shared)

In `src/shared/editor-draft.ts`:

- `export const UNTITLED = '<NUL>untitled'` — a sentinel "path" that can never equal
  a real filesystem path (NUL is invalid in paths). Used as the untitled tab's key and
  in `draftKey(paneId, UNTITLED)`.
- `export function isUntitled(path: string): boolean { return path === UNTITLED }`.

These are trivially unit-testable and keep the sentinel definition in one place
shared by the renderer and tests.

## 5. EditorPane behavior

- **Create (editor-create effect, once per pane):** build one untitled model
  (`plaintext`) seeded from `useStore.getState().drafts[draftKey(paneId, UNTITLED)]?.content ?? ''`,
  wire `onDidChangeContent → rerender + scheduleDraftPersist(UNTITLED)`, and store it
  in `tabs.current` under `UNTITLED` with `{ saved: '', tooLarge: false, missing: false }`.
  If the pane has **no files** (`config.files` empty), make `UNTITLED` the active tab.
- **Visibility:** render an "Untitled" tab in the strip when `order.length === 0` OR
  the untitled model is non-empty. A `×` (clear) button appears only when file tabs
  also exist. The tab label is `Untitled` with a ` •` when non-empty.
- **Active / persistence:** `setActiveModel(UNTITLED)` activates the model and persists
  the pane with `activePath` = `undefined` (so the sentinel is never written to the
  workspace JSON). An empty pane restores with the untitled tab active; a pane with
  files restores its file `activePath` as today.
- **Clear (`×` on untitled):** clear the model content (`applyContent(model, '')`),
  `draftDelete(paneId::UNTITLED)`, cancel its debounce timer, and if it was active
  switch to the first file tab.
- **Save (Ctrl+S / Save As):** when the active tab is `UNTITLED`, run **Save As**
  (Section 6) instead of the file-save path.

The existing flush-on-`beforeunload` and the pane-close cleanup already iterate
`tabs.current`, so the untitled tab participates automatically: its draft is flushed
on app close and deleted on genuine pane removal (consistent with hot-exit — survives
app close, cleaned on pane close).

## 6. Save As

- New IPC `dialog:saveFile` (renderer → main, invoke) → `string | null`. Main:
  `dialog.showSaveDialog(win, {})`; returns `r.canceled || !r.filePath ? null : r.filePath`.
  **Test hook:** if `process.env.TERMHALLA_SAVE_PATH` is set, return it instead of
  showing the dialog (mirrors the existing `TERMHALLA_CLAUDE_HOME` hermetic-test
  pattern; native dialogs can't be Playwright-driven).
- Preload `saveFileDialog(): Promise<string | null>`; `TermhallaApi.saveFileDialog`.
- Flow when the active tab is `UNTITLED`:
  1. `const content = untitledModel.getValue()`; `const path = await api.saveFileDialog()`; if null, abort.
  2. `await api.fsWrite(path, content)`.
  3. `draftDelete(paneId::UNTITLED)` + cancel its timer; `applyContent(untitledModel, '')`.
  4. `await openTab(path)` — opens the saved file as a normal tab (re-read equals
     `content`, so it's clean) and makes it active. The now-empty untitled tab hides
     (a file exists).

## 7. Types & IPC

- No new persisted types. `EditorDraft` (from hot-exit) is reused for the untitled
  draft (`baseline: ''`).
- New channel `dialog:saveFile` + `saveFileDialog()` on `TermhallaApi` and the preload.
- `UNTITLED` / `isUntitled` exported from `src/shared/editor-draft.ts`.

## 8. UI

No new components. Additions in `EditorPane`'s tab strip: an `Untitled` tab
(`data-testid="tab-untitled"`, dirty ` •`, optional `data-testid="tab-close-untitled"`).
The content area and the existing too-large / reload bars are unchanged (the untitled
tab is never `tooLarge`/`externalChanged`). A "Save As…" affordance is the existing
Ctrl+S binding plus, optionally, a small button on the untitled tab.

## 9. Error handling

- Save dialog cancelled (`null`) → no-op, scratch retained.
- `fsWrite` failure during Save As → surfaced as today (the write rejects); scratch
  and its draft are retained (delete/clear happen only after a successful write).
- A corrupt/missing untitled draft → empty scratch (same graceful path as hot-exit).
- The untitled tab never participates in fs-watch (`isUntitled` guards), so on-disk
  change handling is unaffected.

## 10. Testing & verification

- **Unit (vitest):** `UNTITLED` is non-empty and `isUntitled` distinguishes it from
  real paths in `tests/shared/editor-draft.test.ts`.
- **e2e (Playwright):**
  - *Scratch persistence (the reported scenario):* seed an editor pane with
    `files: []`, type into the untitled buffer, wait past the debounce, relaunch with
    the same `--user-data-dir` → the scratch text is restored and `tab-untitled` shows
    ` •`. (Also assert `editor-drafts.json` is written mid-session.)
  - *Save As:* launch with `TERMHALLA_SAVE_PATH=<temp file>`, type scratch, press
    `Ctrl+S` → assert the temp file now contains the scratch text and a real file tab
    appears (untitled cleared).

## 11. Non-goals (this sub-project)

- No multiple untitled tabs per pane (one scratch buffer per pane).
- No language selection / syntax for scratch (plaintext until saved).
- No cursor/scroll/selection persistence.
- No change to how file-backed hot-exit drafts work.
