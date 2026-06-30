# 0004 — Orky status awareness — Traceability (Phase 3, plan iteration 2)

REQ → TASK matrix, the human-readable rendering of `traceability.json`. Every REQ (REQ-001…REQ-029) maps
to ≥1 TASK — the `traceability-plan` gate enforces this. `TEST` columns track the re-opened phase-4 suite;
several frozen tests change under the gate-based model (see plan "Notes for the test-designer").

| REQ | Summary | TASK(s) | Files (primary) |
|---|---|---|---|
| REQ-001 | Canonical `ORKY_PHASES` + `ORKY_AUTONOMOUS_PHASES` + gate N/M (provenance anchor) | TASK-001 | `src/shared/orky-status.ts`, `src/shared/types.ts` |
| REQ-002 | `openBlockingCount` (open ∧ CRITICAL/HIGH ∨ contract_violation), total | TASK-003 | `src/shared/orky-status.ts` |
| REQ-003 | Stall: finished-wins, active-only, 120s, off the LIVE phase (`activePhase`) | TASK-004 | `src/shared/orky-status.ts` |
| REQ-004 | Per-feature map, gate-based, non-active-never-busy, gate-sourced `lastActivityAt` | TASK-005 | `src/shared/orky-status.ts` |
| REQ-005 | needs-human from GATES (autonomous through doc-sync passed ∧ human-review pending) ∨ escalation ∨ stall | TASK-005 | `src/shared/orky-status.ts` |
| REQ-006 | Gate failure → RENDERED failure treatment (CSS precedence over idle `!important`) + non-color affordance, separate from needs-human | TASK-005, TASK-017 | `src/shared/orky-status.ts`, `src/renderer/components/PaneTile.tsx`, `PaneToolbar.tsx`, `src/renderer/index.css` |
| REQ-007 | Deterministic single-chip selector (order-independent tiebreaks) | TASK-006, TASK-007 | `src/shared/orky-status.ts` |
| REQ-008 | Chip label `feature · phase · gate N/M · ●k open` (live phase, no capping) | TASK-007, TASK-016 | `src/shared/orky-status.ts`, `PaneToolbar.tsx`, `PaneTile.tsx`, `OrkyPopover.tsx` |
| REQ-009 | Workspace tab-badge roll-up (any needsHuman in any Orky pane) | TASK-018 | `src/renderer/components/tab-badge.ts`, `WorkspaceTabs.tsx` |
| REQ-010 | `chip-status.ts` Orky variant + WIRED into the minimized-tray chip | TASK-008 | `src/shared/chip-status.ts`, `MinimizedTray.tsx`, `MinimizedPaneHost.tsx` |
| REQ-011 | OrkyTracker: bounded, debounced, race-safe, disposable, `unwatch` early-return | TASK-009, TASK-012 | `src/main/orky/orky-tracker.ts`, `register-orky.ts`, `register.ts` |
| REQ-012 | Auto-bind on `.orky/` cwd; clean teardown emits cleared | TASK-010, TASK-011, TASK-012, TASK-015 | `find-orky-root.ts`, `ipc-contract.ts`, `register-orky.ts`, `OrkyWatcher.tsx`, `App.tsx` |
| REQ-013 | IPC wiring follows the existing contract pattern | TASK-011, TASK-012, TASK-013, TASK-014 | `ipc-contract.ts`, `types.ts`, `register-orky.ts`, `register.ts`, `preload/index.ts`, `runtime-slice.ts`, `store/types.ts`, `App.tsx` |
| REQ-014 | Orky status precedence over byte-status for border + badge | TASK-017 | `src/renderer/components/PaneTile.tsx` |
| REQ-015 | Read files, do not spawn `node` per poll | TASK-009 | `src/main/orky/orky-tracker.ts` |
| REQ-016 | Tab-badge opt-in respected; never hides failure styling | TASK-018 | `src/renderer/components/tab-badge.ts` |
| REQ-017 | Strictly read-only: zero `.orky/` writes | TASK-009 | `src/main/orky/orky-tracker.ts` |
| REQ-018 | No new persisted schema; `SCHEMA_VERSION` unchanged | TASK-001 | `src/shared/types.ts` |
| REQ-019 | Robust to missing/partial/malformed Orky state (totality) | TASK-002, TASK-009 | `src/shared/orky-status.ts`, `src/main/orky/orky-tracker.ts` |
| REQ-020 | Popover lists busy/needs-input/failed/done-with-open; clean-done EXCLUDED; ranked; portalled focus/hover | TASK-007, TASK-016 | `src/shared/orky-status.ts`, `OrkyPopover.tsx`, `src/renderer/index.css` |
| REQ-021 | Determinism of the pane roll-up mapper (pure, order-independent) | TASK-007 | `src/shared/orky-status.ts` |
| REQ-022 | Documentation reconciled incl. `.orky/baseline/architecture.md` (doc-drift) | TASK-019 | `docs/features/orky-status.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` |
| REQ-023 | Live-phase resolution: `gateFrontier` (non-active) / `active.json.phase` (active) | TASK-020, TASK-004, TASK-005, TASK-009 | `src/shared/orky-status.ts`, `src/main/orky/orky-tracker.ts` |
| REQ-024 | IPC arg validation + per-window sender ownership (claimPane-style) | TASK-021 | `src/main/ipc/register-orky.ts`, `find-orky-root.ts`, `window-manager.ts` |
| REQ-025 | Read-path resource bounds (readdir cap + readFile size cap) + symlink realpath guard | TASK-022 | `src/main/orky/orky-tracker.ts` |
| REQ-026 | `CSS.escape` the popover querySelector paneId | TASK-023 | `src/renderer/components/OrkyPopover.tsx` |
| REQ-027 | chokidar `.json` event filter + per-`.orky/`-root watch/read de-dup | TASK-024 | `src/main/orky/orky-tracker.ts` |
| REQ-028 | Timezone-safe timestamp parsing (treat tz-less as UTC) | TASK-025 | `src/shared/orky-status.ts`, `src/main/orky/orky-tracker.ts` |
| REQ-029 | `ORKY_PHASES` provenance caveat (distinguish Orky's separate 9-entry `PHASE_ORDER`) | TASK-001, TASK-019 | `src/shared/orky-status.ts`, `docs/features/orky-status.md` |

## Coverage check

29 / 29 REQs covered; 0 uncovered. 25 TASKs (TASK-001…TASK-025). Original TASK-001…TASK-019 preserved
(amended in place where a corrected REQ touches them); TASK-020…TASK-025 are the new gate-based /
hardening work. Order: pure foundation + types (TASK-001/002/003/020/025/010), pure mappers
(TASK-004…007), main tracker + hardening (TASK-009/022/024), IPC + ownership (TASK-011/012/021/013),
renderer wiring (TASK-014/015), chrome (TASK-008/016/023/017/018), docs (TASK-019).
