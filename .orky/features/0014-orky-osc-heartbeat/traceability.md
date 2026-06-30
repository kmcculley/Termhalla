# 0014 — Orky OSC heartbeat parse + render (read) — Traceability (Phase 4, test design)

REQ → TASK → TEST matrix, the human-readable rendering of `traceability.json`. `tests` is now filled in
(phase 4 / test design); see [`04-tests.md`](04-tests.md) for the assertion-level catalogue.

| REQ | Summary | TASK(s) | TEST(s) | Files (primary) |
|---|---|---|---|---|
| REQ-001 | OSC marker contract (12-byte prefix, BEL/ST terminator, body grammar) is a defined first-class artifact | TASK-001 | TEST-001, TEST-002, TEST-003 | `src/main/status/orky-osc-parser.ts` |
| REQ-002 | Parser is a 3rd `scanOsc` consumer — reuse, do not reimplement | TASK-001 | TEST-022, TEST-023 | `src/main/status/orky-osc-parser.ts`, `src/main/status/osc-scanner.ts` |
| REQ-003 | Chunk-boundary carry-over preserved exactly (inherited from `scanOsc`) | TASK-001 | TEST-004, TEST-005 | `src/main/status/orky-osc-parser.ts`, `src/main/status/osc-scanner.ts` |
| REQ-004 | Strict, bounded, non-evaluating grammar — reject whole on any violation | TASK-002 | TEST-006..TEST-016, TEST-024 | `src/main/status/orky-osc-parser.ts` |
| REQ-005 | Total, never-throwing tolerance of malformed/partial/garbage input | TASK-003 | TEST-017..TEST-021 | `src/main/status/orky-osc-parser.ts` |
| REQ-006 | Map a heartbeat to `OrkyPaneStatus` by reusing 0004's `orkyPaneStatus` presentation | TASK-004 | TEST-032..TEST-036 | `src/shared/orky-status.ts` |
| REQ-007 | Synthesized feature `detail` is actionable (names feature + reason) | TASK-004 | TEST-037, TEST-038, TEST-039 | `src/shared/orky-status.ts` |
| REQ-008 | Second SOURCE, not a second presentation/type/channel | TASK-006, TASK-007, TASK-008 | TEST-025, TEST-026 | `src/main/status/status-engine.ts`, `src/main/orky/orky-stream-status.ts`, `src/main/ipc/register-pty.ts`, `src/main/ipc/register-orky.ts`, `src/main/services.ts` |
| REQ-009 | Coexistence: filesystem source wins; `orky-tracker.ts` untouched; no duplicate watch | TASK-005, TASK-007, TASK-008 | TEST-027, TEST-028, TEST-040, TEST-041, TEST-042 | `src/shared/orky-status.ts`, `src/main/orky/orky-stream-status.ts`, `src/main/ipc/register-orky.ts`, `src/main/orky/orky-tracker.ts` |
| REQ-010 | Tests use synthetic/golden OSC byte fixtures only — zero live-Orky dependency | TASK-009 | TEST-029 (+ the synthetic-byte property of every other 0014 TEST) | `tests/fixtures/orky-osc-fixtures.ts` |
| REQ-011 | Orky-side emission is OUT OF SCOPE (documented human follow-up) | TASK-010 | — (doc-only; verified at the doc-sync gate, not unit-testable) | `docs/features/orky-osc-heartbeat.md` |
| REQ-012 | Cross-repo contract documented prominently + drift caveat | TASK-010 | — (doc-only; verified at the doc-sync gate, not unit-testable) | `docs/features/orky-osc-heartbeat.md`, `CLAUDE.md`, `CHANGELOG.md` |
| REQ-013 | No persistence, no writes, no `SCHEMA_VERSION` bump | TASK-001, TASK-006, TASK-008 | TEST-030, TEST-031 | `src/main/status/orky-osc-parser.ts`, `src/main/status/status-engine.ts`, `src/main/orky/orky-stream-status.ts` |

## Coverage check

13 / 13 REQs (REQ-001…REQ-013) covered by ≥1 TASK; 11 / 13 REQs have ≥1 unit TEST (REQ-011/REQ-012 are
documentation-only deliverables verified by the doc-sync gate, per `02-spec.md`'s Definition of Done —
no acceptance criterion in either REQ is unit-testable behavior). 42 TESTs (TEST-001…TEST-042) across 3
new test files + 1 fixture helper. 0 REQs uncovered.
