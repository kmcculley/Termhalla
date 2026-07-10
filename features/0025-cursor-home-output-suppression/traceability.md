# Traceability — 0025-cursor-home-output-suppression

| REQ | Tasks | Tests | Files |
|---|---|---|---|
| REQ-001 | TASK-002, TASK-004 | TEST-2501, TEST-2502 | `src/main/status/status-tracker.ts`, `tests/main/status-tracker.test.ts` |
| REQ-002 | TASK-002, TASK-004 | TEST-2503, TEST-2504 | `src/main/status/status-tracker.ts`, `tests/main/status-tracker.test.ts` |
| REQ-003 | TASK-002, TASK-004 | TEST-2505, TEST-2506, TEST-2507 | `src/main/status/status-tracker.ts`, `tests/main/status-tracker.test.ts` |
| REQ-004 | TASK-002, TASK-005 | TEST-2515, TEST-2516 | `src/main/status/status-tracker.ts`, `tests/main/status-tracker.test.ts`, `tests/characterization-status.test.ts` |
| REQ-005 | TASK-002, TASK-004 | TEST-2508 | `src/main/status/status-tracker.ts`, `tests/main/status-tracker.test.ts` |
| REQ-006 | TASK-002, TASK-004 | TEST-2509, TEST-2510, TEST-2511, TEST-2512 | `src/main/status/status-tracker.ts`, `tests/main/status-tracker.test.ts` |
| REQ-007 | TASK-002, TASK-004 | TEST-2513, TEST-2514 | `src/main/status/status-tracker.ts`, `tests/main/status-tracker.test.ts` |
| REQ-008 | TASK-006 | TEST-2541 | `tests/e2e/marker-less-pane.spec.ts`, `tests/fixtures/fake-remote-shell.mjs`, `tests/e2e/status.spec.ts`, `tests/renderer/pane-status-css.test.ts`, `tests/regression-net-0025.test.ts` |
| REQ-009 | TASK-001, TASK-003 | TEST-2521, TEST-2522, TEST-2523, TEST-2524, TEST-2525, TEST-2527 | `src/main/status/needs-input.ts`, `tests/characterization-status.test.ts`, `tests/main/needs-input-classifier.test.ts`, `tests/main/needs-input.test.ts` |
| REQ-010 | TASK-003 | TEST-2524, TEST-2526, TEST-2527 | `tests/characterization-status.test.ts`, `tests/main/needs-input-classifier.test.ts`, `tests/main/needs-input.test.ts` |
| REQ-011 | TASK-007 | TEST-2531, TEST-2532, TEST-2533, TEST-2534 | `CLAUDE.md`, `docs/decisions.md`, `.orky/baseline/architecture.md`, `docs/deferred.md`, `docs/features/status-engine.md`, `CHANGELOG.md`, `tests/docs-feature-0025.test.ts`, `.orky/baseline/inferred-spec.md` |

All 11 requirements have >= 1 task and >= 1 test. This table is REGENERATED from
`traceability.json` (the canonical record) — regenerate rather than hand-edit (FINDING-014).
`.orky/baseline/inferred-spec.md` rides REQ-011 per the ESC-001 arbitration (FINDING-004);
the ESC-002 loopback synced it into traceability.json as well.

## Open issues

None. Every REQ-001..REQ-011 is covered.
