# 0004 — Orky status awareness — Traceability (Phase 3, plan)

REQ → TASK matrix, the human-readable rendering of `traceability.json`. Every REQ (REQ-001…REQ-022) maps
to ≥1 TASK — the `traceability-plan` gate enforces this. `TEST` columns are empty by design; phase 4
(test design) fills them.

| REQ | Summary | TASK(s) | Files (primary) |
|---|---|---|---|
| REQ-001 | Canonical `ORKY_PHASES` + gate N/M (provenance anchor) | TASK-001 | `src/shared/orky-status.ts`, `src/shared/types.ts` |
| REQ-002 | `openBlockingCount` (open ∧ CRITICAL/HIGH ∨ contract_violation), total | TASK-003 | `src/shared/orky-status.ts` |
| REQ-003 | Stall: finished-wins, active-feature-only, 120s, injected `now` | TASK-004 | `src/shared/orky-status.ts` |
| REQ-004 | Per-feature map into terminal-status model, actionable `detail` | TASK-005 | `src/shared/orky-status.ts` |
| REQ-005 | needs-human set = human-review ∨ open escalation ∨ stalled | TASK-005 | `src/shared/orky-status.ts` |
| REQ-006 | Gate failure → `failed`/`lastExit:failure`, separate from needs-human | TASK-005, TASK-017 | `src/shared/orky-status.ts`, `src/renderer/components/PaneTile.tsx` |
| REQ-007 | Deterministic single-chip selector (order-independent tiebreaks) | TASK-006, TASK-007 | `src/shared/orky-status.ts` |
| REQ-008 | Chip label `feature · phase · gate N/M · ●k open` (no capping) | TASK-007, TASK-016 | `src/shared/orky-status.ts`, `PaneToolbar.tsx`, `PaneTile.tsx`, `OrkyPopover.tsx` |
| REQ-009 | Workspace tab-badge roll-up (any needsHuman in any Orky pane) | TASK-018 | `src/renderer/components/tab-badge.ts` |
| REQ-010 | `chip-status.ts` extended additively for the Orky variant | TASK-008 | `src/shared/chip-status.ts` |
| REQ-011 | OrkyTracker: bounded, debounced, race-safe, disposable | TASK-009, TASK-012 | `src/main/orky/orky-tracker.ts`, `register-orky.ts`, `register.ts` |
| REQ-012 | Auto-bind on `.orky/` cwd; clean teardown emits cleared | TASK-010, TASK-011, TASK-012, TASK-015 | `find-orky-root.ts`, `ipc-contract.ts`, `register-orky.ts`, `OrkyWatcher.tsx`, `App.tsx` |
| REQ-013 | IPC wiring follows the existing contract pattern | TASK-011, TASK-012, TASK-013, TASK-014 | `ipc-contract.ts`, `types.ts`, `register-orky.ts`, `register.ts`, `preload/index.ts`, `runtime-slice.ts`, `store/types.ts`, `App.tsx` |
| REQ-014 | Orky status precedence over byte-status for border + badge | TASK-017 | `src/renderer/components/PaneTile.tsx` |
| REQ-015 | Read files, do not spawn `node` per poll | TASK-009 | `src/main/orky/orky-tracker.ts` |
| REQ-016 | Tab-badge opt-in respected; never hides failure styling | TASK-018 | `src/renderer/components/tab-badge.ts` |
| REQ-017 | Strictly read-only: zero `.orky/` writes | TASK-009 | `src/main/orky/orky-tracker.ts` |
| REQ-018 | No new persisted schema; `SCHEMA_VERSION` unchanged | TASK-001 | `src/shared/types.ts` |
| REQ-019 | Robust to missing/partial/malformed Orky state (totality) | TASK-002, TASK-009 | `src/shared/orky-status.ts`, `src/main/orky/orky-tracker.ts` |
| REQ-020 | Popover lists all non-Idle features, ranked; portalled focus/hover | TASK-016 | `src/renderer/components/OrkyPopover.tsx`, `src/renderer/index.css` |
| REQ-021 | Determinism of the pane roll-up mapper (pure, order-independent) | TASK-007 | `src/shared/orky-status.ts` |
| REQ-022 | Documentation reconciled + data-provenance note (doc-drift) | TASK-019 | `docs/features/orky-status.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` |

## Coverage check

22 / 22 REQs covered; 0 uncovered. 19 TASKs (TASK-001…TASK-019). Pure-logic + types first
(TASK-001..008, 010), then the main tracker (TASK-009), IPC (TASK-011..013), renderer wiring
(TASK-014..015), chrome (TASK-016..018), docs (TASK-019).
