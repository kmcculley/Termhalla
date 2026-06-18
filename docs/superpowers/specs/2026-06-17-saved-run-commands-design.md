# Saved per-pane run commands — design

**Date:** 2026-06-17
**Feature:** Roadmap feature 4 — named, persisted, run-on-click commands (e.g. Test/Build/Watch)
for terminal panes, at both pane and workspace scope, run via the existing send-to-terminal path.

## Goal

Give each terminal a small set of saved, named commands the user can run with a click, instead of
re-typing `npm test` twenty times a day. Commands persist with the workspace. Two scopes:
**pane** (this terminal only) and **workspace** (every terminal in the workspace). This is the
persisted, manually-triggered sibling of the existing runtime-only *scheduled commands* feature,
and reuses its send-to-terminal plumbing (`encodeBroadcast` + `api.ptyWrite`).

This is a v1: no on-success behavior (see Non-goals), no per-command send-mode toggle, no side
drawer — output goes into the owning terminal.

## Architecture

No new IPC and nothing new in the main process — this is a shared-types + renderer-store + UI
feature built entirely on existing primitives.

```
RunCommandsMenu  (toolbar ▷ button → menu === 'run')
  ├─ shows workspace commands + this pane's commands  (pure mergeForMenu)
  ├─ Run  → store.runCommand(paneId, command)
  │          → api.ptyWrite({ id: paneId, data: encodeBroadcast(command, 'keys', true) })
  └─ Add / Edit / Delete  (label + command + scope toggle)
       ├─ pane scope       → updatePaneConfig(wsId, paneId, { runCommands })   [existing]
       └─ workspace scope  → setWorkspaceRunCommands(wsId, runCommands)         [new]
                             → both persisted in workspace JSON via debounced autosave
```

### New files

| File | Purpose |
|---|---|
| `src/shared/run-commands.ts` | **Pure.** `RunCommand` type + immutable list helpers + `mergeForMenu`. |
| `src/renderer/store/run-commands-slice.ts` | `setWorkspaceRunCommands` + `runCommand` actions. |
| `src/renderer/components/RunCommandsMenu.tsx` | The toolbar popover (mirrors `ScheduleDialog`). |
| `tests/shared/run-commands.test.ts` | Unit tests for the pure helpers. |
| `tests/e2e/run-commands.spec.ts` | End-to-end. |

### Touched files

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `RunCommand`; `runCommands?: RunCommand[]` on `TerminalConfig` **and** `Workspace`; bump `SCHEMA_VERSION` 4→5. |
| `src/renderer/store.ts` | Compose `createRunCommandsSlice`. |
| `src/renderer/store/types.ts` | Add `setWorkspaceRunCommands` + `runCommand` to `State`. |
| `src/renderer/components/PaneTile.tsx` | `PaneMenu` gains `'run'`; render `RunCommandsMenu`. |
| `src/renderer/components/PaneToolbar.tsx` | Add the `▷` run button. |

## Data model

```ts
// src/shared/types.ts
export interface RunCommand {
  id: string        // uuid
  label: string     // e.g. "Test"
  command: string   // e.g. "npm test"
}

// TerminalConfig gains:
  runCommands?: RunCommand[]   // pane-scoped

// Workspace gains:
  runCommands?: RunCommand[]   // workspace-scoped (shown on every terminal in the workspace)

export const SCHEMA_VERSION = 5   // was 4
```

**Schema:** additive optional fields. `deserializeWorkspace`'s `migrate` is identity for
versions `<= SCHEMA_VERSION` (it only rejects *newer*), so a v4 workspace loads unchanged with
`runCommands` undefined (treated as empty). New saves write `schemaVersion: 5`. No migration code
needed.

### Pure helpers (`src/shared/run-commands.ts`)

```ts
export interface MenuEntry { scope: 'workspace' | 'pane'; cmd: RunCommand }

addRunCommand(list: RunCommand[] | undefined, cmd: RunCommand): RunCommand[]
updateRunCommand(list: RunCommand[] | undefined, id: string, patch: Partial<Omit<RunCommand,'id'>>): RunCommand[]
removeRunCommand(list: RunCommand[] | undefined, id: string): RunCommand[]
mergeForMenu(ws: RunCommand[] | undefined, pane: RunCommand[] | undefined): MenuEntry[]   // workspace entries first, then pane
```

All treat `undefined` as `[]`. `updateRunCommand` is a no-op for an unknown id. `id` generation
(uuid) happens at the call site (the store/component), keeping these helpers pure.

## Send semantics

A run command is "text typed + Enter": sent as `encodeBroadcast(command, 'keys', true)` — raw
keystrokes plus a trailing CR. This runs in every shell including cmd (no bracketed-paste markers
that cmd would echo literally). Multi-line commands send line-by-line. No per-command mode toggle
in v1 (the scheduled-commands feature exposes one; run commands deliberately do not).

`store.runCommand(paneId, command)` is the single send action (parallels `broadcastInput`); it is
a no-op if the pane has no live PTY (defensive — the menu only renders on terminal panes).

## UI — `RunCommandsMenu`

A `▷` toolbar button (`run-chip-<paneId>`), placed left of the `⏱` schedule chip, toggles
`menu === 'run'` and renders a centered `Modal` (same component `ScheduleDialog` uses — portaled
to `<body>`, closes on outside click), with `backdropTestId="run-commands-dialog"`.

Contents:
- **"This workspace"** section — lists workspace commands, each a row: **Run** button
  (`run-cmd-<id>`), the label (click to edit), a delete `✕`. Empty → muted hint.
- **"This terminal"** section — same, for the pane's commands.
- **Add/edit form** at the bottom: label input (`run-cmd-label`), command input
  (`run-cmd-command`), a scope toggle (pane | workspace, default **pane**), and an **Add** button
  (`run-cmd-add`) disabled until both fields are non-empty. Clicking a command's label loads it
  into the form for update and the button becomes **Save** (`updateRunCommand` by id, in the same
  scope). 

Running a command sends it and closes the menu.

## Error handling & edge cases

- Blank label or command → Add/Save disabled; never persists a blank.
- Workspace commands appear in **every** terminal pane's menu in that workspace; pane commands
  only in their own.
- Deleting a pane drops its `runCommands` with the pane (they live in `TerminalConfig`); closing a
  workspace drops its `runCommands` with the workspace. No separate runtime cleanup path (unlike
  the per-pane runtime maps) — these are pure config.
- Templates: `templateFromWorkspace` deep-copies the workspace and pane configs, so both command
  lists ride into saved templates automatically.
- Non-terminal panes never show the button (`isTerminal` gate).

## Testing

### Unit (vitest) — `tests/shared/run-commands.test.ts`
- `addRunCommand` appends immutably; treats `undefined` as `[]`.
- `updateRunCommand` patches the matching id, leaves others, no-ops on unknown id.
- `removeRunCommand` filters by id; no-op on unknown id.
- `mergeForMenu` returns workspace entries before pane entries, each tagged with its scope;
  handles either side `undefined`.

### E2E (Playwright) — `tests/e2e/run-commands.spec.ts`
1. Launch, add a terminal, open the run menu, add a **pane** command `echo run-4242`, click Run,
   assert `.xterm-rows` contains `run-4242`.
2. Add a **workspace** command, split a second terminal, open its run menu, assert the workspace
   command appears there.
3. Save workspace + relaunch, assert both commands persist (menu shows them after restore).

Follows `tests/e2e/schedule.spec.ts` conventions (temp `--user-data-dir`, `killTree`, generous
timeouts, `workers: 1`).

## Non-goals (v1)

- **No on-success behavior** (open-URL on exit 0). Reliably attributing a specific exit code to
  the command we sent is racy and shell-integration-dependent (cmd has no real exit signal); it
  needs its own design and is deferred to v2.
- No per-command send-mode (paste vs keys) toggle.
- No dedicated output drawer — output goes to the owning terminal.
- No project (git-root) scope — pane + workspace only.
- No reordering UI for commands (they render in insertion order).
