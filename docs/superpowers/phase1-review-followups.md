# Phase 1 — Review Follow-ups (deferred to later phases)

These items surfaced in the final holistic review of Phase 1 (2026-06-13). The
three spec-critical gaps (shell picker, vertical split, auto-save) were **fixed**
in commit `0cd92ad`. The items below were judged genuine but non-blocking and are
deferred. Tracked here so they aren't lost.

## Robustness (Phase 2 hardening)

- **Live cwd capture.** A terminal's `cwd` is serialized but always created as `''`
  (so restore opens in the home dir, not where the shell actually was). Capturing
  live cwd needs shell integration (OSC 7 / OSC 133), which lands in Phase 2's
  status engine — wire cwd capture in at the same time.
- ~~**Dead-pane affordance (M-3).**~~ — **RESOLVED 2026-07-09** (quality/polish batch): an
  exited pane shows a small absolute-positioned overlay (never a box change) with **Restart** —
  a fresh PTY into the same mounted pane via the terminal-registry `respawnPane` hook (ConPTY
  clears the screen as part of attaching; measured) — and **Close pane**. Restart is local-only
  (a remote connection's id-reuse defense refuses a re-seen pane id, 0018 FINDING-004).
  Exercised end-to-end by `tests/e2e/marker-less-pane.spec.ts` TEST-QA13.
- ~~**app-state validation (M-4).**~~ **RESOLVED** (verified 2026-07-07): `migrateAppState`
  (`src/shared/app-state-model.ts`, hardened by the 2026-07-06 quality-audit Group A #4 pass)
  validates shape + `schemaVersion` on load (per-entry `windows[]` normalization, future-version
  rejection) and stamps `SCHEMA_VERSION` on save.
- **PTY env sanitization (M-6).** `PtyManager.spawn` passes the full
  `process.env` to every shell (includes Electron/Node injected vars). Sanitize
  before Phase 2 shell-integration injection, which needs a controlled env.
- **Debounce window-state writes (M-7).** `saveWindowState` fires on every resize
  tick (unthrottled fs I/O on the main thread). Debounce when convenient.

## Phase 2/3 readiness notes (from review)

- **Status engine seam:** PTY bytes already flow through a single `onData`
  callback (`pty-manager.ts` → `register.ts`). Inserting a per-session marker
  parser + state machine there is additive; `PtyManager` will need per-session
  state (tail buffer, last-exit) and a new `pty:status` channel in `CH`.
- **Editor/Explorer panes:** `PaneConfig` is currently a type alias for
  `TerminalConfig`. Phase 3 turns it into a discriminated union on `kind`, and
  `WorkspaceView.renderTile` switches on `pane.config.kind`. The `kind: 'terminal'`
  discriminant is already present, so this is low-friction. The hardened
  `migrate()` guard becomes load-bearing once Phase 3 bumps the schema.
