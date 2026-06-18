# Saved Run Commands

> Named, persisted, run-on-click commands (e.g. Test / Build / Watch) for terminal panes, at pane and workspace scope, sent via the existing broadcast path.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-17-saved-run-commands-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-17-saved-run-commands.md)

## What it does

Each terminal pane gains a `▷` toolbar button that opens a **Run commands** modal. The modal lists the workspace's saved commands (visible in every terminal) and the pane's own saved commands. Clicking `▷` next to any command sends it to the terminal and closes the modal. Commands can be added, edited, and deleted from the same modal.

Commands persist with the workspace — they survive app restarts and ride into saved workspace templates. Non-terminal panes (editor, explorer) never show the button.

## Data flow

```
▷ toolbar button  (PaneToolbar → toggle('run'))
       │
       ▼
RunCommandsMenu modal opens
       │  mergeForMenu(ws.runCommands, paneCfg.runCommands)
       │  → workspace entries first, then pane entries
       │
       ├─ Run command  → store.runCommand(paneId, command)
       │                → api.ptyWrite({ id: paneId,
       │                               data: encodeBroadcast(command, 'keys', true) })
       │                → PTY receives keystrokes + CR; dialog closes
       │
       ├─ Add/Edit (pane scope)
       │   → updatePaneConfig(wsId, paneId, { runCommands: next })  [existing action]
       │   → workspace JSON written by debounced autosave
       │
       └─ Add/Edit (workspace scope)
           → setWorkspaceRunCommands(wsId, next)                    [new slice action]
           → workspace JSON written by debounced autosave
```

## Pane scope vs workspace scope

| | Pane scope | Workspace scope |
|---|---|---|
| Persisted on | `TerminalConfig.runCommands` | `Workspace.runCommands` |
| Visible in | This terminal only | Every terminal in the workspace |
| Deleted when | The pane is closed / replaced | The workspace is closed |
| In templates | Yes (deep-copied with the pane config) | Yes (deep-copied with the workspace) |

### Menu ordering (`mergeForMenu`)

`mergeForMenu(wsCmds, paneCmds)` in `src/shared/run-commands.ts` returns workspace entries before pane entries, each tagged with its scope (`'workspace'` or `'pane'`). This keeps the shared commands visually grouped at the top. Within each group, commands appear in insertion order (no reordering UI in v1).

## Persistence

`runCommands?: RunCommand[]` is an optional additive field on both `TerminalConfig` and `Workspace`. `SCHEMA_VERSION` was bumped from 4 to 5.

Because `deserializeWorkspace`'s `migrate` is identity for versions `<= SCHEMA_VERSION` (it only rejects newer schemas), a v4 workspace loads unchanged — `runCommands` is simply `undefined`, treated as an empty list everywhere. New saves write `schemaVersion: 5`. No migration code is needed.

```ts
export interface RunCommand {
  id: string     // uuid, generated at the call site
  label: string  // e.g. "Test"
  command: string  // e.g. "npm test"
}
```

## Send semantics

A run command is "text typed + Enter". It is sent as:

```ts
encodeBroadcast(command, 'keys', true)
```

`'keys'` mode: raw keystrokes, no bracketed-paste markers. The trailing `true` appends a CR. This works in every shell including cmd.exe, which would echo bracketed-paste markers literally. Multi-line commands send line-by-line. There is no per-command send-mode toggle in v1 (the scheduled-commands feature exposes one; run commands deliberately do not, to keep the UI simple).

`store.runCommand(paneId, command)` is a no-op if the pane has no live PTY — defensive, since the button only renders on terminal panes.

## Relationship to scheduled commands

Run commands are the **persisted, manually-triggered** sibling of the **runtime-only, time-triggered** scheduled commands feature. Both share the same send path: `encodeBroadcast` + `api.ptyWrite`. The differences are:

| | Run commands | Scheduled commands |
|---|---|---|
| Trigger | User click | Timer |
| Persisted | Yes (workspace JSON) | No (renderer runtime only) |
| Scope | Pane or workspace | Pane |
| Send mode | `keys` + CR always | Configurable per task |

Neither feature adds new IPC. Both call the existing `api.ptyWrite` over the `pty:write` channel.

## UI

### Toolbar button

A `▷` button (`run-chip-<paneId>`) is placed immediately left of the `⏱` schedule chip, inside the `isTerminal` guard. Clicking toggles `menu === 'run'` via the existing `PaneTile` menu-state machinery.

### Modal (`RunCommandsMenu`)

A centered `Modal` (portaled to `<body>`, same component as `ScheduleDialog` — see [CLAUDE.md gotcha: overlays must portal to `<body>`](../../CLAUDE.md)), with `backdropTestId="run-commands-dialog"`. Contents:

- **"This workspace"** section — lists workspace-scoped commands. Each row: `▷` run button (`run-cmd-<id>`), label (click to load into edit form), `✕` delete button. Empty → muted hint.
- **"This terminal"** section — same for pane-scoped commands.
- **Add/edit form** at the bottom: label input (`run-cmd-label`), command input (`run-cmd-command`), a scope toggle (`run-cmd-scope`, default `pane`), and an **Add** / **Save** button (`run-cmd-add`) disabled until both fields are non-empty. Clicking a command's label loads it into the form for editing; the button becomes **Save**, and the scope dropdown is locked to the scope of the item being edited. **Cancel** resets the form.

Running a command sends it and closes the modal.

## Key files

| File | Responsibility |
|---|---|
| `src/shared/run-commands.ts` | Pure helpers: `addRunCommand`, `updateRunCommand`, `removeRunCommand`, `mergeForMenu`; `MenuEntry` type |
| `src/renderer/store/run-commands-slice.ts` | `setWorkspaceRunCommands` (persists workspace list) + `runCommand` (sends via `encodeBroadcast`) |
| `src/renderer/components/RunCommandsMenu.tsx` | Modal listing, editing, and running saved commands |
| `src/renderer/components/PaneToolbar.tsx` | `▷` button (`run-chip-<paneId>`) |
| `src/renderer/components/PaneTile.tsx` | `PaneMenu` gains `'run'`; renders `RunCommandsMenu` |
| `src/shared/types.ts` | `RunCommand` interface; `runCommands?` on `TerminalConfig` + `Workspace`; `SCHEMA_VERSION = 5` |
| `tests/shared/run-commands.test.ts` | Unit tests for all four pure helpers |
| `tests/e2e/run-commands.spec.ts` | End-to-end: add pane command, run it, add workspace command, split pane, verify it appears, save + relaunch, verify persistence |

## Non-goals (v1)

- **No on-success behavior** (e.g. open-URL on exit 0). Reliably attributing a specific exit code to the command we sent is racy and shell-integration-dependent; deferred to v2.
- No per-command send-mode toggle (paste vs keys).
- No dedicated output drawer — output goes into the owning terminal.
- No project (git-root) scope — pane and workspace only.
- No reordering UI — commands render in insertion order.

## Testing

- **`tests/shared/run-commands.test.ts`** (vitest, pure) — `addRunCommand` appends immutably and treats `undefined` as `[]`; `updateRunCommand` patches by id, no-ops on unknown id; `removeRunCommand` filters by id; `mergeForMenu` returns workspace entries before pane entries with correct scope tags, handles either side `undefined`.
- **`tests/e2e/run-commands.spec.ts`** (Playwright/Electron) — launches the app; adds a pane command `echo run-4242`, clicks Run, asserts `.xterm-rows` contains `run-4242`; adds a workspace command, splits a second terminal, opens its run menu, asserts the workspace command appears; saves the workspace, relaunches, asserts both commands persist. Follows `tests/e2e/schedule.spec.ts` conventions (temp `--user-data-dir`, `killTree`, generous timeouts, `workers: 1`).

## Related

- [Architecture](../architecture.md) — main/preload/renderer layering; the zustand store + autosave pattern.
- [Decisions](../decisions.md) — no new IPC; pure core + thin impure shell.
- [Scheduled commands](scheduled-commands.md) — the runtime-only, timer-triggered sibling; shares `encodeBroadcast`.
- [Workspaces](workspaces.md) — workspace JSON persistence and `SCHEMA_VERSION` migration.
