# Workspace Documents (File menu)

> A native **File** menu turns a workspace into a document: save it to a portable `.thws` file,
> close it, and reopen it later with every pane restored — cwd, SSH session, and Claude resume
> included.

**Status:** Shipped

## What it does

A top-level **File** menu (before Edit):

- **New Workspace** — create a fresh empty workspace tab.
- **Open Workspace…** — pick a `.thws` file; it loads as a new workspace (fresh workspace + pane
  ids, so the same file can be opened while another copy is already open).
- **Reopen Closed Workspace…** — a dialog listing workspaces that still exist on disk but aren't
  open in this window. Reopen one (it comes back with its original identity), or permanently delete
  its record.
- **Save Workspace** — flush the active workspace's live state to its durable form. If the
  workspace is bound to a `.thws` file (opened-from / saved-as one), that file is overwritten too.
- **Save Workspace As…** — pick a `.thws` path, write the active workspace there, and bind it so
  future Saves overwrite it.
- **Exit** — quit (native quit role, so it inherits the before-quit flush).

Opening or reopening restores **every pane exactly as it was saved**: each terminal relaunches at
its saved working directory, reconnects its SSH session, and re-runs `claude --resume` where a
Claude/Codex session was running. Live scrollback/output is **not** preserved — panes relaunch
fresh at their cwd, the same as the app's existing restart-restore.

## Why it mostly already worked

Workspaces were already serializable, versioned documents: `serializeWorkspace(ws)` writes the
`{ schemaVersion, workspace }` envelope, and `saveAll` folds **live** state into each pane on every
save — `applyCwds` (current cwd), `applyResumeAi` (Claude/Codex resume hint), and the SSH `launch`
already living in the pane config. The internal per-workspace store (`userData/workspaces/<id>.json`)
already survived a close. What was missing was purely UX: a File menu, and a way to reopen a closed
workspace or move one in/out of a portable file. A `.thws` file and an internal record are therefore
byte-identical; only the *location* differs. **No `SCHEMA_VERSION` bump** — the document format IS
the existing workspace record.

## How it works

The native menu owns no state — each item just sends a `menu:file-*` push to the focused window
(falling back to the first window when none is focused, so a headless e2e can drive it), mirroring
the `menu:open-settings` idiom. The renderer, which owns live workspace state, performs the action:

- `saveActiveWorkspace` / `saveActiveWorkspaceAs` — `await saveAll()` (flush live state), then, for a
  bound workspace, `writeWorkspaceDoc(path, serializeWorkspace(currentRecord(id)))`. Save-As picks a
  path (`defaultDocName(ws.name)` seeds the filename) and records the binding.
- `openWorkspaceFromFile` — `importWorkspaceDoc(json, uuid(), uuid)` (`src/shared/workspace-doc.ts`):
  deserialize (all validation/migration reused from `deserializeWorkspace`), then re-key every pane
  with fresh ids and remap the `minimized`/`maximized` view-state references through the same id map.
- `reopenClosedWorkspace` — loads the internal record by id and adopts it **without** re-keying, so
  it keeps its identity (if it were still running it would re-adopt its PTYs; after a close the panes
  relaunch fresh).
- `adoptWorkspace` (store closure) — the shared "add a workspace to this window" step: register it,
  derive its persisted view-state into the runtime maps (as `applyAssignment` does), report the
  arrangement to main (so it survives quit→relaunch), and land focus in its first pane.

The `workspaceId→path` binding is persisted separately in `workspace-docs.json`
(`WorkspaceDocStore`, the NotesStore idiom) so Save keeps overwriting the right file across
relaunches — it is config (a path), never a secret.

## Key files

| File | Responsibility |
|---|---|
| `src/main/menu.ts` | the native File submenu (item ids `file-new`/`-open`/`-reopen`/`-save`/`-save-as`/`-exit`) |
| `src/shared/workspace-doc.ts` | `importWorkspaceDoc`, `defaultDocName`, `WORKSPACE_DOC_EXT` (pure) |
| `src/main/ipc/register-workspace-doc.ts` | `.thws` dialogs + read/write + the doc-path store handlers |
| `src/main/persistence/workspace-doc-store.ts` | the persisted `workspaceId→path` binding map |
| `src/main/persistence/store.ts` | `WorkspaceStore.deleteWorkspace` (prune a closed record) |
| `src/renderer/store/workspace-docs-slice.ts` | the File-menu actions (`saveActiveWorkspace(As)`, `openWorkspaceFromFile`, `reopenClosedWorkspace`, `listClosedWorkspaces`, `deleteClosedWorkspace`) + `docPaths`/`reopenOpen` state (`adoptWorkspace` stays a store-root closure, threaded via `SliceDeps`) |
| `src/renderer/components/ReopenWorkspaceModal.tsx` | the Reopen Closed Workspace dialog |
| `src/shared/ipc-contract.ts`, `src/preload/index.ts` | `wsdoc:*` + `ws:delete` channels + `menu:file-*` pushes |

## Behaviors & edge cases

- **Bad input never throws across IPC.** An unreadable/invalid/newer-schema `.thws` surfaces as a
  toast (`readWorkspaceDoc` → null; `importWorkspaceDoc` → caught); a failed write returns `false`
  so the UI never toasts a false "saved". Writes are atomic (a killed mid-write never truncates).
- **Save on an unbound workspace** just flushes the internal record and toasts "Workspace saved" —
  every workspace is always durably autosaved, so Save never nags with a dialog.
- **Reopen list is per-window** — a workspace open in *another* window shows as reopenable here
  (multi-window is an accepted v1 imperfection).
- **Multi-window safe** — dialogs anchor to the invoking window (`senderWin`), not always main.

## Testing

- **Unit:** `tests/shared/workspace-doc.test.ts` (import re-keys ids, remaps view-state, preserves
  cwd/ssh/resumeAi/theme/home, rejects bad/newer input), `tests/main/workspace-doc-store.test.ts`
  (binding persistence + sanitization), `tests/main/menu.test.ts` (File submenu shape + per-item
  send wiring).
- **e2e:** `tests/e2e/workspace-doc.spec.ts` — File menu shape; New adds a tab; Save As writes a
  `.thws` and Open reads it back with the pane restored; close + Reopen restores the tab. Native
  dialogs are hermetic via `TERMHALLA_WSDOC_SAVE_PATH` / `TERMHALLA_WSDOC_OPEN_PATH`.

## Related

- [Workspace tab management](workspace-management.md) · [Workspaces](workspaces.md) · [Architecture](../architecture.md)
