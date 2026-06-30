# 0002 — Traceability matrix (REQ → TASK → TEST → files)

Machine-checkable source: `traceability.json`. The `traceability` gate requires every REQ to map to
≥1 TASK and to ≥1 **existing** `TEST-NNN` marker (the id appears in a real test's `describe`/`test`
name). Reconciled at phase 7 (doc-sync) to the shipped code and tests: the `tests` arrays now cite
only markers that exist in the repo (TEST-001..024 — the phantom `TEST-025` was dropped from REQ-014,
see below), and `files` reflect the actual diff.

| REQ | Tasks | Tests | Files (actual) |
|---|---|---|---|
| REQ-001 — Record button removed from the toolbar | TASK-006 | TEST-018 | `src/renderer/components/PaneToolbar.tsx` |
| REQ-002 — Record start/stop in the pane context menu (terminal-only) | TASK-007 | TEST-019, TEST-020 | `src/renderer/components/PaneContextMenu.tsx` |
| REQ-003 — Two split buttons collapsed into one `split-${paneId}` | TASK-006 | TEST-006 | `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneTile.tsx` |
| REQ-004 — One combined popover, portalled to `<body>` | TASK-003, TASK-006 | TEST-007, TEST-009 | `src/renderer/components/SplitMenu.tsx`, `src/renderer/components/PaneTile.tsx` |
| REQ-005 — Compass always offers all four directions | TASK-003 | TEST-005, TEST-008 | `src/renderer/components/SplitMenu.tsx` |
| REQ-006 — Kind selector, Terminal default, Explorer gated on cwd | TASK-003 | TEST-009, TEST-010 | `src/renderer/components/SplitMenu.tsx` |
| REQ-007 — Kind + direction commits the split with correct geometry | TASK-001, TASK-002, TASK-003 | TEST-002, TEST-005, TEST-011, TEST-012, TEST-021, TEST-022 | `src/shared/workspace-model.ts`, `src/renderer/store.ts`, `src/renderer/components/SplitMenu.tsx` |
| REQ-008 — `splitPane` before/after; persisted shape unchanged | TASK-001 | TEST-001, TEST-002, TEST-003, TEST-004, TEST-005 | `src/shared/workspace-model.ts`, `src/shared/types.ts` |
| REQ-009 — Direction threaded through plumbing; legacy sites unaffected | TASK-002 | TEST-001, TEST-005, TEST-012 | `src/renderer/store/internals.ts`, `src/renderer/store.ts`, `src/renderer/store/types.ts`, `src/renderer/store/pane-ops.ts` |
| REQ-010 — Compass fully keyboard-operable; default highlight = right | TASK-004 | TEST-013, TEST-014, TEST-015 | `src/renderer/components/SplitMenu.tsx` |
| REQ-011 — ARIA roles/labels for directions and kinds | TASK-005 | TEST-016 | `src/renderer/components/SplitMenu.tsx` |
| REQ-012 — New chrome paint-only, scoped to chrome testids | TASK-003, TASK-006, TASK-007 | TEST-017 | `src/renderer/components/SplitMenu.tsx`, `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneContextMenu.tsx`, `src/renderer/index.css` |
| REQ-013 — Concrete testid contract | TASK-003, TASK-006, TASK-007 | TEST-006, TEST-007, TEST-018 | `src/renderer/components/SplitMenu.tsx`, `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneContextMenu.tsx` |
| REQ-014 — Affected e2e specs updated; portal guarantee retained | TASK-008 | TEST-021, TEST-022, TEST-023 | `tests/e2e/split-menu.spec.ts`, `tests/e2e/pane-actions.spec.ts`, `tests/e2e/split-helper.ts`, `tests/e2e/smoke.spec.ts`, `tests/e2e/broadcast.spec.ts`, `tests/e2e/ui-polish.spec.ts`, `tests/e2e/notepad.spec.ts`, `tests/e2e/persistence.spec.ts`, `tests/e2e/run-commands.spec.ts`, `tests/e2e/workspace-templates.spec.ts`, `tests/e2e/recording.spec.ts` |
| REQ-015 — Documentation updated (doc-drift) | TASK-009 | TEST-024 | `CHANGELOG.md`, `docs/features/workspaces.md`, `CLAUDE.md` |

**Coverage:** all 15 requirements (REQ-001..REQ-015) map to ≥1 task and to ≥1 existing `TEST-NNN`
marker. Uncovered: none.

**Test files (where the cited markers live):**
- TEST-001..005 → `tests/shared/split-direction.test.ts` (the before/after + `splitDirToLayout`
  units; NOT `tests/shared/workspace-model.test.ts`, which the frozen `02-spec.md` REQ-008 acceptance
  names — this matrix is authoritative for the gate. See FINDING-DOC-002.)
- TEST-006..017 → `tests/e2e/split-compass.spec.ts`
- TEST-018..020 → `tests/e2e/pane-record-menu.spec.ts`
- TEST-021, TEST-022 → `tests/e2e/split-menu.spec.ts` (rewritten to the new contract, REQ-014)
- TEST-023 → `tests/e2e/pane-actions.spec.ts` (maximize test updated, REQ-014)
- TEST-024 → `tests/docs-feature-0002.test.ts` (CHANGELOG doc guard)

**TEST-025 dropped (FINDING-DOC-001).** `04-tests.md` originally recorded the REQ-014 loop-back
reconciliation (smoke/broadcast/ui-polish/notepad/persistence/run-commands/workspace-templates via
`tests/e2e/split-helper.ts`, recording via `pane-menu-record`) as a synthetic `TEST-025`, but no test
file carries that marker and `tests/` is frozen, so the id is unverifiable by the gate. The
reconciliation genuinely happened and those specs are real; REQ-014 remains covered by the existing
TEST-021/022/023 markers. The phantom id was removed rather than faked.

**Task → REQ (inverse, sanity check):**
- TASK-001 → REQ-007, REQ-008
- TASK-002 → REQ-007, REQ-009
- TASK-003 → REQ-004, REQ-005, REQ-006, REQ-007, REQ-012, REQ-013
- TASK-004 → REQ-010
- TASK-005 → REQ-011
- TASK-006 → REQ-001, REQ-003, REQ-004, REQ-012, REQ-013
- TASK-007 → REQ-002, REQ-013
- TASK-008 → REQ-014
- TASK-009 → REQ-015
