# Auto-resume Claude on restart (`claude --resume`)

**Status:** Draft for review · 2026-06-18

## Problem

When Termhalla reopens, terminals that had **Claude** running at last exit should re-launch and
automatically run `claude --resume` (in the same cwd). Decision: **on by default**, with a settings
toggle to disable.

## Current behavior (grounding)

- AI sessions are detected in main from the process tree (`AiSessionTracker`, `classify-ai.ts`) and
  pushed to the renderer as `AiSession { tool: 'claude' | 'codex', label }` via `ai:session`
  → `store.setAiSession` → `aiSessions[paneId]` (`runtime-slice.ts:64`). **Not persisted today.**
- Terminal panes persist as `TerminalConfig` inside `workspaces/<id>.json`
  (`shared/types.ts:85`, `SCHEMA_VERSION = 6`, identity `migrate()` so a new optional field needs no
  migration). Restored via `applyAssignment` → `loadWorkspace` → `TerminalPane` mount → `api.ptySpawn`
  → `register-pty.ts` → `PtyManager.spawn`.
- Prompt-ready signal exists: OSC 133 `A` marker → `status-tracker.ts` sets state `idle`, emitted via
  `pty:status`. (Integrated shells emit markers; `cmd` may not — needs a fallback.)
- `api.ptyWrite({id, data})` → `register-pty.ts` → `pty.write` injects keystrokes into a PTY.
- Boolean app settings follow `recordByDefault`: field on `QuickStore` (`shared/types.ts`),
  normalized in `quick-store.ts`, action in `quick-slice.ts`, checkbox in `GeneralSettings.tsx`,
  persisted to `quick.json`.

## Design

### 1. Persist "was running Claude" per terminal
- Add optional `resumeAi?: AiTool` to `TerminalConfig` (`shared/types.ts`). (Using the tool enum, not
  a bool, leaves room for Codex later; v1 only acts on `'claude'`.)
- **Fold it in at disk-save time** rather than mutating live config on every AI event: when the
  store writes a workspace to disk (`saveAll`/`saveWorkspace`), map each terminal pane's config to
  include `resumeAi: aiSessions[paneId]?.tool` (omitted when none). This keeps live `config` clean
  and avoids autosave churn from runtime AI churn; what lands on disk is "whatever AI was running at
  save time" — which at exit is "what was running when you quit."
- The flush already runs on `beforeunload` (`App.tsx:32-36`) and on autosave, so exit state is captured.

### 2. Settings toggle
- Add `autoResumeClaude?: boolean` to `QuickStore` (default **true** — note: default-on means the
  normalizer treats `undefined` as `true`), `setAutoResumeClaude` action, and a checkbox in
  `GeneralSettings.tsx` ("Resume Claude in restored terminals"). Persisted in `quick.json`.

### 3. Run `claude --resume` once the shell is ready
A general **"run a command when the shell first becomes ready"** one-shot in main (claude-resume is
its first consumer):
- Extend `PtySpawnArgs` with `autoRunOnReady?: string`.
- `TerminalPane` passes `autoRunOnReady: (quick.autoResumeClaude && config.resumeAi === 'claude') ? 'claude --resume' : undefined` to `api.ptySpawn`.
- `register-pty.ts` / `PtyManager`: after spawn, arm a **one-shot** that injects `cmd + '\r'` on the
  pane's **first `idle`** status (OSC 133 `A`), with a **fallback timeout** (~1500ms) for shells
  without markers (`cmd`). Fire once, then disarm. Abortable/cleared on pane exit/close.

Why type it into the shell (not a `launch` override): Claude was started by the user inside their
shell; resuming the same way preserves the shell (so when Claude exits the pane is still a usable
terminal) and runs in the saved `cwd`, where `claude --resume` finds that directory's latest session.

### Edge cases
- Claude not installed on restore → `claude --resume` errors harmlessly in the shell.
- Multiple panes had Claude → each resumes independently, scoped by its own `cwd`.
- Fresh (non-restored) terminals never carry `resumeAi`, so they never auto-run.
- Toggle off → `autoRunOnReady` is undefined → nothing injected.

## Testing
- **Unit (main, pure-ish):** the one-shot arming — injects `cmd\r` on first `idle`; fires exactly
  once; honors the fallback timeout when no marker arrives; no-op when `autoRunOnReady` is empty.
  Inject a fake clock + status source (mirrors the watcher test patterns).
- **Unit:** `quick-store` normalization defaults `autoResumeClaude` to `true`; round-trips false.
- **Unit:** the save-time fold-in maps `aiSessions[pane]` → `config.resumeAi` for terminal panes only.
- **e2e (mechanism, no real Claude):** seed a terminal whose spawn uses `autoRunOnReady: 'echo RESUMED-TOKEN'`;
  assert the token appears in the terminal after the prompt is ready. This validates the injection +
  prompt-ready gating end-to-end; the claude-specific string is derived by the small unit-tested rule.
- **e2e (persistence):** seed a workspace with a terminal `config.resumeAi: 'claude'` + setting on,
  and verify (via the generic mechanism) that a resume command is issued on restore.

## Out of scope / YAGNI
- Codex auto-resume (the field allows it; v1 acts only on Claude).
- Reconstructing the exact prior Claude flags/args — just `claude --resume` in the saved cwd.
- Per-pane (vs global) opt-out.
