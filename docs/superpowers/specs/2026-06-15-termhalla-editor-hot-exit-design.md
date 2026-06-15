# Termhalla — Editor Hot-Exit (unsaved draft persistence) — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phase 3 (Monaco editor + explorer) and the workspace persistence
layer, all merged to `main`.

## 1. Summary

Unsaved editor content is currently lost on app restart: `EditorConfig` persists
only file **paths**, and `EditorPane` reloads each file from disk on open, so any
dirty (unsaved) buffer is gone. This adds **hot-exit**: each dirty editor buffer's
content is persisted continuously and restored on reopen, showing exactly what was
being edited — with the existing "Changed on disk" reload bar handling the case
where the file also changed on disk while the app was closed.

## 2. Decisions (from brainstorming, 2026-06-15)

| Decision | Choice |
|---|---|
| Disk conflict on reopen | **Keep the draft and warn** — restore the draft as the active (dirty) content and, if the file changed on disk, show the existing "Changed on disk" bar (Reload / Keep mine). |
| Save trigger | **Continuously as you type** — debounced (~500ms), like the existing workspace autosave; survives a crash, not just a clean close. |
| Storage location | **Separate drafts store** (`editor-drafts.json`), keyed by `paneId::path`. `EditorConfig` is unchanged so workspace files stay small. |
| Conflict detection | Store the disk `baseline` alongside the draft; on reopen compare disk content to `baseline`. |

## 3. Architecture & data flow

A new main-process **`DraftStore`** persists a map of unsaved buffers to
`editor-drafts.json` in `userData`. The key is `paneId::path` (paneIds are UUIDs
that already persist in the workspace layout, so the key survives restart — the
same scheme the editor already uses for fs-watch ids).

```
edit buffer ──(debounced)──► drafts:set(key, {content, baseline}) ──► DraftStore ──► editor-drafts.json
save / close tab / clean ───► drafts:delete(key) ─────────────────► DraftStore
app start ─────────────────► drafts:load ──► store.drafts ──► EditorPane.openTab applies draft
```

The drafts map is loaded once in `store.init()` (like `quick`). On `openTab`,
`EditorPane` looks up `drafts[key]`; if present it loads `draft.content` into the
Monaco model (instead of disk content), marks the tab dirty, and — if the current
disk content differs from `draft.baseline` — flags the existing `externalChanged`
reload bar.

## 4. What is stored

```ts
export interface EditorDraft {
  content: string    // the unsaved buffer text
  baseline: string   // the disk text the buffer diverged from (the editor's t.saved)
}
```

- `content` is restored into the model.
- `baseline` is only for conflict detection: on reopen, `diskContent === baseline`
  ⇒ the file is unchanged (draft is just dirty); `diskContent !== baseline` ⇒ the
  file changed on disk while closed ⇒ show the reload bar.
- Drafts are bounded by the editor's existing `tooLarge` guard (too-large files are
  not editable, so never produce a draft).

## 5. Pure core (testable)

`resolveDraftOnOpen(diskContent: string | null, draft: EditorDraft | undefined):
{ content: string; dirty: boolean; externalChanged: boolean }`

- No draft ⇒ `{ content: diskContent ?? '', dirty: false, externalChanged: false }`
  (current behavior).
- Draft present ⇒ `content = draft.content`; `dirty = draft.content !== diskContent`;
  `externalChanged = diskContent !== draft.baseline` (true when the file moved on
  disk, including `diskContent === null` for a deleted file).
- If the draft equals disk (`dirty === false`), the caller drops the stale draft.

This keeps the open-time decision pure and unit-testable; `EditorPane` calls it
after its `fsRead`.

## 6. Types & IPC

- `EditorDraft` (above) in `src/shared/types.ts`. No change to `EditorConfig`.
- Channels (`src/shared/ipc-contract.ts`):
  - `drafts:load` (renderer → main, invoke) → `Record<string, EditorDraft>`
  - `drafts:set` (renderer → main, send, `(key: string, draft: EditorDraft)`)
  - `drafts:delete` (renderer → main, send, `(key: string)`)
- Preload: `draftsLoad()`, `draftSet(key, draft)`, `draftDelete(key)`.
- Runtime persistence only; `editor-drafts.json` lives in `userData` beside
  `quick.json` / `app-state.json`.

## 7. Main-process `DraftStore`

`src/main/persistence/draft-store.ts`, mirroring `QuickStore`:

- `load(): Promise<Record<string, EditorDraft>>` — read + parse + sanitize
  (drop malformed entries; an unreadable/missing file ⇒ `{}`).
- `set(key, draft)` — upsert into the in-memory map, then persist.
- `delete(key)` — remove from the map, then persist.
- `flush()` — write the map now (called on window `close`).
- Persistence writes the whole map (it is small; few dirty buffers). The renderer
  throttles `set` calls via debounce, so write frequency stays low.

Wired in `src/main/ipc/register.ts` next to the other stores; `flush()` is added
to the existing `win.on('close', …)` path.

## 8. Renderer wiring (`EditorPane`)

- **Load:** `store.init()` calls `draftsLoad()` into `drafts: Record<string, EditorDraft>`.
- **Open/restore (`openTab`):** after `fsRead`, call `resolveDraftOnOpen(disk, drafts[key])`;
  create the model with the returned `content`; set `t.saved` to the disk content
  (the baseline for future dirty checks); set `externalChanged` from the result. If
  `dirty` is false but a draft existed, `draftDelete(key)`.
- **Edit:** the existing `model.onDidChangeContent` handler additionally schedules a
  per-tab debounced (~500ms) `draftSet(key, { content: model.getValue(), baseline: t.saved })`
  when dirty, or `draftDelete(key)` when the buffer matches `t.saved`.
- **Save (Ctrl+S):** after `fsWrite`, `draftDelete(key)` (now clean).
- **Close tab (`closeTab`):** `draftDelete(key)` (alongside the existing model dispose).
- **Pane unmount:** the existing cleanup additionally `draftDelete`s every open tab's
  key — the pane is being removed, so its drafts should not linger. (App close tears
  down the renderer without running React cleanups, so session drafts survive — the
  intended behavior.)
- **Flush:** the `beforeunload` handler (currently `saveAll` + `flushQuick`) also
  flushes any pending per-tab `draftSet` immediately.

Key format helper: `draftKey(paneId, path) => ${paneId}::${path}` (shared with the
existing fs-watch id scheme).

## 9. UI

No new components. The restored draft renders as the model content with the normal
dirty marker (`•`) on the tab; the conflict case reuses the existing
`editor-reloadbar` (`Changed on disk.` → `Reload` / `Keep mine`).

## 10. Error handling

- Unreadable/missing/corrupt `editor-drafts.json` ⇒ `{}` (no drafts; current
  behavior). Individual malformed entries are dropped on load.
- A draft for a now-deleted file (`diskContent === null`) ⇒ restore the draft content,
  mark dirty + `externalChanged` (the reload bar / deleted state surfaces it); never
  throws.
- `draftSet` / `draftDelete` are fire-and-forget `send`s; a failed write never breaks
  editing.
- Too-large files never produce a draft (guarded upstream by `tooLarge`).

## 11. Testing & verification

- **Unit (vitest, pure):**
  - `resolveDraftOnOpen` — no draft (passthrough); draft + unchanged disk (dirty, no
    conflict); draft + changed disk (dirty + externalChanged); draft + deleted file
    (`null`); draft equal to disk (not dirty).
  - `DraftStore` — load/set/delete round-trip; sanitize drops malformed entries;
    missing file ⇒ `{}`.
- **e2e (Playwright, relaunch):** seed a file, open it, type unsaved text, relaunch
  the app with the **same** `--user-data-dir` (mirroring `persistence.spec.ts`), and
  assert the editor shows the unsaved text with the dirty marker. Conflict variant:
  modify the file on disk between close and reopen and assert the `editor-reloadbar`
  appears.

## 12. Non-goals (this sub-project)

- No cursor/scroll/selection restoration — content only.
- No untitled/new-file buffers (the editor has no new-file flow today; every tab is
  path-backed).
- No pruning of drafts whose `paneId` no longer exists in any workspace (harmless
  orphan leakage; a load-time prune is a noted future cleanup).
- No per-draft files / incremental writes (whole-map write; fine for the few small
  buffers expected).
