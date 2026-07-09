# Phase 2 — Review Follow-ups (deferred)

Final review of Phase 2 (2026-06-14) returned **READY WITH MINOR FOLLOW-UPS**.
The two highest-impact items were **fixed** in commit `fbca599`:
- PTY env sanitization (strip Electron-injected vars before spawning shells).
- Extracted + unit-tested the `effectiveStatus` needs-input downgrade.

The items below were judged minor and deferred. Recorded so they aren't lost.

## Minor follow-ups

- ~~**Pane-title needs-input bell ignores the `border` toggle (M-1).**~~ — **DECIDED 2026-07-09**
  (quality/polish batch): intended behavior, kept. The bell rides the needs-input CHANNEL — it is
  already suppressed by the per-pane `needsInput` alert toggle (`effectiveStatus` downgrades the
  state before the tile ever sees it), while `border` governs only the border paint. Muting the
  border for aesthetics must not silently remove the attention affordance; users who want no bell
  turn off the needs-input alert itself.

- ~~**`AppState.schemaVersion` hardcoded to 1 and unvalidated (M-2, carries over from
  Phase 1 M-4).**~~ **RESOLVED** (verified 2026-07-07): app-state now versions on the shared
  `SCHEMA_VERSION` and is validated/migrated on load by `migrateAppState`
  (`src/shared/app-state-model.ts`; Group A #4 of the 2026-07-06 quality audit).

- **bash DEBUG-trap stray `C` flicker (M-3).** `integration-scripts.ts` `__th_preexec`
  guards on `[ "$BASH_COMMAND" = "$PROMPT_COMMAND" ]`, which doesn't match the
  individual `__th_prompt` sub-command, so a stray `C` (brief busy flip, immediately
  cleared by the next `A`) is emitted during bash prompt rendering. **Contained to
  bash** (PowerShell uses a PSReadLine key handler, not a per-command trap). Acceptable
  as a known limitation; refine the guard if bash flicker becomes annoying.

- **Test gaps (M-4).** No e2e asserts the needs-input pane/tab badge is *suppressed*
  when a terminal's toggles are off (the mute e2e only covers the border without a
  needs-input trigger). bash integration is only unit-tested for arg mapping — no
  live-bash e2e (the real-shell e2e is PowerShell-only). OS-notification firing is
  not e2e-tested (hard to assert; reasonable to skip).

## Residual heuristic risk (noted, accepted)

- The anchored `CURSOR_HOME_RE` only suppresses chunks that *begin* with a cursor-home
  redraw, so a program that legitimately starts a line with `\x1b[H` would have that
  chunk skipped for the quiet timer. Rare; acceptable.
