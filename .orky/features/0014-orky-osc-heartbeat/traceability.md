# 0014 — Orky OSC heartbeat parse + render (read) — Traceability (Phase 4, RE-PLAN, ESC-002 revision)

Spec frozen at **17 REQs (REQ-001…REQ-017)**, ADR-026 wire contract (code `9999`, JSON payload, BEL
terminator) — fully superseding the prior iteration's `8888`/key=value placeholder. Spec iteration 3
applies one further, human-approved correction (ESC-002/FINDING-DA-004): REQ-009's `kind` done-detection
is now **purely gate-based** (`gateN >= gateM`), independent of `phase`'s value.

Phase 4 (this revision) fills in the `tests` columns: **41 TESTs total (TEST-001…TEST-041)**, all
authored against the ADR-026 contract — 39 from the original phase-4 pass, plus **TEST-040/TEST-041**
added in this ESC-002-targeted revision to REQ-009's coverage only. The phase-3 `tests: []` placeholders,
and the prior iteration's `TEST-001…TEST-042` (built against the superseded `8888`/key=value contract),
are gone — see `tests/main/orky-osc-parser.test.ts`, `tests/main/orky-osc-structural.test.ts`,
`tests/shared/orky-heartbeat-status.test.ts`, and `tests/fixtures/orky-osc-fixtures.ts`.

| REQ | Summary | Tasks | Tests | Files |
|---|---|---|---|---|
| REQ-001 | OSC marker contract = ADR-026 verbatim (`\x1b]9999;`, first-`;`-only split, JSON payload, BEL/ST terminator) | TASK-001 | TEST-001, TEST-002, TEST-003, TEST-004 | `src/main/status/orky-osc-parser.ts` |
| REQ-002 | Parser is a 3rd `scanOsc` consumer — reuse, never reimplement the scan loop | TASK-001 | TEST-005, TEST-006 | `src/main/status/orky-osc-parser.ts`, `src/main/status/osc-scanner.ts` |
| REQ-003 | Chunk-boundary carry-over preserved exactly (incl. split inside prefix/payload/pre-terminator) | TASK-001, TASK-002 | TEST-007, TEST-008 | `src/main/status/orky-osc-parser.ts` |
| REQ-004 | Thin client: direct verbatim mapping, no `eval`/dynamic interpretation, never re-derive `drive()` semantics | TASK-004 | TEST-009, TEST-010 | `src/main/status/orky-osc-parser.ts` |
| REQ-005 | Forward-compatible on unknown/missing `v` + unknown fields (deliberate reversal of stale strict policy) | TASK-004 | TEST-011, TEST-012, TEST-013 | `src/main/status/orky-osc-parser.ts` |
| REQ-006 | Bounded carry-over ceiling on no-terminator path (FINDING-SEC-001, security) | TASK-002 | TEST-014, TEST-015 | `src/main/status/orky-osc-parser.ts` |
| REQ-007 | Payload size cap = actual UTF-8 byte length, checked before `JSON.parse` (FINDING-CODEX-001) | TASK-003 | TEST-016, TEST-017 | `src/main/status/orky-osc-parser.ts` |
| REQ-008 | Strict-but-tolerant JSON validation; `push` total, never throws | TASK-004 | TEST-018, TEST-019, TEST-020, TEST-021, TEST-022 | `src/main/status/orky-osc-parser.ts` |
| REQ-009 | Map heartbeat → `OrkyPaneStatus` by reusing 0004's `orkyPaneStatus` (derived `kind`, defaulted `openBlocking`/`failed`) — **done-detection is purely gate-based (`gateN >= gateM`), independent of `phase` (ESC-002/FINDING-DA-004 correction)** | TASK-005 | TEST-023, TEST-024, **TEST-040** (primary done case, real-emitter `phase:"doc-sync"` shape), TEST-025 (phase-independence companion, `phase:null`), **TEST-041** (regression guard: `phase:null` + incomplete gates must NOT be `done`) | `src/shared/orky-status.ts` |
| REQ-010 | Synthesized feature `detail` is actionable (CONV-001) | TASK-005 | TEST-026, TEST-027, TEST-028 | `src/shared/orky-status.ts` |
| REQ-011 | A feature-less (app-loop) heartbeat is a valid liveness tick → cleared `OrkyPaneStatus`, not a failure | TASK-004, TASK-005 | TEST-029, TEST-030 | `src/main/status/orky-osc-parser.ts`, `src/shared/orky-status.ts` |
| REQ-012 | Second SOURCE only — no new pane-status type/presentation/IPC channel | TASK-001, TASK-005 | TEST-031 | `src/main/status/orky-osc-parser.ts`, `src/shared/types.ts`, `src/shared/orky-status.ts` |
| REQ-013 | Coexistence with 0004: filesystem source wins, no regression/duplication of `orky-tracker.ts` | TASK-007 | TEST-032, TEST-033, TEST-034, TEST-035, TEST-036 | `src/main/status/status-engine.ts`, `src/main/orky/orky-stream-status.ts`, `src/main/ipc/register.ts`, `src/main/orky/orky-tracker.ts`, `src/shared/orky-status.ts` |
| REQ-014 | Tests primarily synthetic/golden OSC byte fixtures, zero live-Orky dependency | TASK-006 | TEST-037 | `tests/fixtures/orky-osc-fixtures.ts` |
| REQ-015 | Scope: Termhalla parser/renderer only; Orky-side emission is now REAL/shipped (no longer "dark in production") | TASK-008 | — (doc-only, see below) | `docs/features/orky-osc-heartbeat.md` |
| REQ-016 | Cross-repo contract documented prominently + drift caveat; CLAUDE.md link; CHANGELOG entry | TASK-008 | — (doc-only, see below) | `docs/features/orky-osc-heartbeat.md`, `CLAUDE.md`, `CHANGELOG.md` |
| REQ-017 | No persistence, no writes, no `SCHEMA_VERSION` bump | TASK-001, TASK-005, TASK-008 | TEST-038, TEST-039 | `src/main/status/orky-osc-parser.ts`, `src/shared/orky-status.ts`, `src/shared/types.ts`, `docs/features/orky-osc-heartbeat.md` |

## Coverage check

- 17/17 REQs have ≥1 TASK; **15/17 REQs have ≥1 TEST.** Uncovered-by-design: REQ-015, REQ-016 (see below).
- 8 TASKs total (TASK-001…TASK-008); see `03-plan.md` for full descriptions, file lists, dependencies,
  and the sequencing diagram.
- **41 TESTs total (TEST-001…TEST-041)**; see `04-tests.md` for the per-file breakdown, the ESC-002
  revision notes, and design notes.

## REQ-015 / REQ-016 are not unit-testable

Both are documentation deliverables (the cross-repo ADR-026 contract block + drift caveat + scope
correction in `docs/features/orky-osc-heartbeat.md`, the CLAUDE.md link, the CHANGELOG entry).
`02-spec.md`'s Definition of Done routes them to "Docs/integration" verified at the **doc-sync gate**
(TASK-008), not a unit test. No TEST-ID is assigned to either; this is correct (not a coverage gap) per
the spec's own verification-approach split — consistent with how the prior iteration's REQ-011/REQ-012
(the equivalent doc-only REQs under the old REQ numbering) were also recorded with `tests: []`.
