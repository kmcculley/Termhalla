# Phase 3 — Review Follow-ups (deferred)

Final review of Phase 3 (2026-06-14) returned **READY WITH MINOR FOLLOW-UPS**.
The two Important items were **fixed** in commit `27e9391`, plus the deleted-tab
indicator (M5):
- Reloading a file now preserves Monaco undo history (`pushEditOperations`, not
  `setValue`) — a dirty-reload mis-click is recoverable with Ctrl+Z.
- Collapsing an explorer folder recursively tears down expanded descendants'
  watches and state.
- A tab whose file is deleted on disk shows a strikethrough + "(deleted)" marker
  (now e2e-tested).

The items below were judged minor and deferred.

## Minor follow-ups

- **`closePane` doesn't clear `lastEditorPaneId` (M1).** If the closed pane was the
  tracked last-editor, the id dangles. `openFileInEditor` re-validates the id
  (`ws.panes[last]?.config.kind === 'editor'`), so it's harmless — but clearing it
  on close would be tidier.
- **`closePane` always calls `ptyKill` regardless of kind (M2).** A no-op for
  editor/explorer panes (no pty with that id); their fs-watch cleanup rides on the
  React unmount effect rather than `closePane`. Works, but couples correctness to
  unmount timing. Consider routing close cleanup by kind.
- ~~**`AppState.schemaVersion` hardcoded to 1 in `saveAll` (M3, carries over from
  Phase 1/2).**~~ **RESOLVED** (verified 2026-07-07): app-state versions on the shared
  `SCHEMA_VERSION`, validated/migrated on load by `migrateAppState`
  (`src/shared/app-state-model.ts`; Group A #4 of the 2026-07-06 quality audit).
- **fs IPC accepts any absolute path; no sandboxing (M4).** The renderer can ask
  main to read/write any path. **Accepted by design** for a local single-user tool,
  consistent with the existing trust model (the renderer already drives pty spawn
  with arbitrary cwd). contextIsolation + the CSP keep *remote* code from reaching
  this IPC, which is the real threat model. Documented here as a conscious decision.

## Test gaps (noted, accepted)

- The dirty external-change bar (Reload / Keep-mine) has no e2e (the clean-reload
  and deleted paths are covered).
- `tooLarge` / binary tabs aren't e2e'd (unit-tested in `fs-files`).
- The explorer recursive-collapse path (I2 fix) has no dedicated e2e.

## Security note (Monaco CSP)

The renderer CSP was relaxed to `script-src 'self' 'unsafe-eval'` +
`worker-src 'self' blob:` (+ `font-src data:`). `'unsafe-eval'` is genuinely
required by Monaco's worker tokenizer; the relaxation is minimal (no
`'unsafe-inline'` scripts, no remote origins) and `contextIsolation` /
`nodeIntegration:false` are unchanged.
