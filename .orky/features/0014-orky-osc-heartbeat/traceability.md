# 0014 — Orky OSC heartbeat parse + render (read) — Traceability (Phase 4, RE-PLAN, ESC-002 revision + doc-sync closeout)

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

**Doc-sync closeout (this revision):** the Gatekeeper CLI's mechanical `traceability` gate token (used at
the doc-sync gate, stricter than the plan-phase `traceability-plan` token) requires EVERY REQ-NNN found in
`02-spec.md` to trace to at least one TEST-ID — it has no "documentation-only, exempt from unit test"
allowance. REQ-015 and REQ-016's acceptance criteria are concrete, file-content-checkable facts, so two
real structural tests were added to `tests/main/orky-osc-structural.test.ts` — **TEST-042** (REQ-015) and
**TEST-043** (REQ-016) — bringing the suite to **43 TESTs total (TEST-001…TEST-043)**. Both docs
(`docs/features/orky-osc-heartbeat.md`, `CHANGELOG.md [Unreleased]`) were already correct from this
iteration's doc-sync pass, so both new tests pass immediately (regression guards, not driving new
implementation).

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
| REQ-015 | Scope: Termhalla parser/renderer only; Orky-side emission is now REAL/shipped (no longer "dark in production") | TASK-008 | **TEST-042** | `docs/features/orky-osc-heartbeat.md`, `.orky/features/0014-orky-osc-heartbeat/02-spec.md`, `tests/main/orky-osc-structural.test.ts` |
| REQ-016 | Cross-repo contract documented prominently + drift caveat; CLAUDE.md link; CHANGELOG entry | TASK-008 | **TEST-043** | `docs/features/orky-osc-heartbeat.md`, `CLAUDE.md`, `CHANGELOG.md`, `tests/main/orky-osc-structural.test.ts` |
| REQ-017 | No persistence, no writes, no `SCHEMA_VERSION` bump | TASK-001, TASK-005, TASK-008 | TEST-038, TEST-039 | `src/main/status/orky-osc-parser.ts`, `src/shared/orky-status.ts`, `src/shared/types.ts`, `docs/features/orky-osc-heartbeat.md` |

## Coverage check

- 17/17 REQs have ≥1 TASK; **17/17 REQs have ≥1 TEST** (REQ-015/REQ-016 closed by TEST-042/TEST-043,
  added at doc-sync — see below).
- 8 TASKs total (TASK-001…TASK-008); see `03-plan.md` for full descriptions, file lists, dependencies,
  and the sequencing diagram.
- **43 TESTs total (TEST-001…TEST-043)**; see `04-tests.md` for the per-file breakdown, the ESC-002
  revision notes, the doc-sync closeout notes, and design notes.

## REQ-015 / REQ-016 — now unit-tested (doc-sync closeout)

Both were previously treated as documentation-only deliverables (the cross-repo ADR-026 contract block +
drift caveat + scope correction in `docs/features/orky-osc-heartbeat.md`, the CLAUDE.md link, the
CHANGELOG entry), verified only at the doc-sync gate per `02-spec.md`'s own Definition of Done. That split
is incompatible with the Gatekeeper CLI's mechanical `traceability` gate token for this profile, which
requires every REQ-NNN in the spec to trace to at least one TEST-ID with no doc-only exemption. Both REQs'
acceptance criteria are in fact concrete, file-content-checkable facts (specific literal strings/patterns
across specific files), so real structural tests were added:

- **TEST-042** (`tests/main/orky-osc-structural.test.ts`) — REQ-015: asserts `02-spec.md` and the feature
  doc state the emission is real/shipped and opt-in (`config.heartbeat.osc`, `ADR-026`), state the
  corrected "no longer dark in production" framing, describe the parser-only scope
  (`Termhalla-side only`, `parser + renderer`), and that no file under this repo's own `src/` references
  the separate `C:/dev/Orky` repo path.
- **TEST-043** (`tests/main/orky-osc-structural.test.ts`) — REQ-016: asserts the feature doc contains the
  exact ADR-026 wire prefix (`\x1b]9999;`), the full payload schema field set (`v`, `feature`, `phase`,
  `gate`, `needsHuman`, `reason`, `action`), names the defining source file
  (`src/main/status/orky-osc-parser.ts`), cites `ADR-026`, states the parser-only/opt-in scope, and carries
  the cross-repo drift caveat; that `CLAUDE.md`'s "Where things live" table links to the feature doc; that
  `CHANGELOG.md [Unreleased]` mentions the OSC heartbeat feature; and that neither the feature doc nor
  `CHANGELOG.md` contains the superseded `8888`/`orky=`/`key=value` contract markers.

Both tests pass immediately against the already-correct docs from this iteration's doc-sync pass (they are
regression guards for already-completed doc work, not tests driving new implementation). No `src/` file
was touched to make them pass.
