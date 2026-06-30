# 0014 — Orky OSC heartbeat parse + render (read) — Test design (Phase 4)

**Status:** tests written and verified RED. The spec [`02-spec.md`](02-spec.md) is FROZEN at **13 REQs**
(REQ-001…REQ-013); the plan [`03-plan.md`](03-plan.md) defines 10 TASKs. These tests are **FROZEN once
the tests gate passes (ADR-009)** — the implementer makes them pass without editing them.

The test designer is a different actor from the implementer (the integrity boundary): no production code
(`src/main/status/orky-osc-parser.ts`, the `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus` additions to
`src/shared/orky-status.ts`, or any wiring) was written or touched while designing this suite.

## Files written

| File | Role |
|---|---|
| `tests/fixtures/orky-osc-fixtures.ts` | Synthetic/golden OSC byte fixture helper (TASK-009 / REQ-010) — `ORKY_OSC`, `buildOrkyMarker`/`buildOrkyMarkerFromPairs`/`wrapOrkyBody`, `WORKED_EXAMPLE_FIELDS`/`WORKED_EXAMPLE_MARKER`/`WORKED_EXAMPLE_HEARTBEAT`. Pure byte-string builders; no process/network/filesystem access, and does not import the (not-yet-implemented) parser module — a true golden fixture independent of the implementation. |
| `tests/main/orky-osc-parser.test.ts` | Behavioral coverage of `OrkyOscParser` — REQ-001 (contract worked example + cross-prefix rejection), REQ-003 (chunk-boundary carry-over), REQ-004 (strict bounded grammar, via `push()` only — `decodeHeartbeat` is not exported), REQ-005 (total/never-throwing tolerance). TEST-001..TEST-021. |
| `tests/main/orky-osc-structural.test.ts` | Source-text / structural assertions — REQ-002 (`scanOsc` reuse shape), REQ-004 (no `eval`/`Function` in the decode path), REQ-008 (`OrkyPhase`/`OrkyReason` imported not forked; no new `orky:*` IPC channel), REQ-009 (`orky-tracker.ts` byte-for-byte unchanged via a frozen sha256 hash; the parser starts no filesystem watch), REQ-010 (no 0014 test imports `child_process`/network APis), REQ-013 (`SCHEMA_VERSION` unchanged; no filesystem-write API surface). TEST-022..TEST-031. |
| `tests/shared/orky-heartbeat-status.test.ts` | `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus` — REQ-006 (reuse of 0004's `orkyPaneStatus` presentation, incl. the FINDING-DA-007 null/clean-done chip guard for a STREAM-sourced heartbeat), REQ-007 (actionable `detail`), REQ-009 (fs-wins precedence). Builds `OrkyHeartbeat` object literals by hand (per `03-plan.md`'s TASK-004 note: "type-only dep on TASK-001 — pure shared code, no runtime dependency on the parser file"), so this file's RED/GREEN state is independent of the parser's. TEST-032..TEST-042. |

42 TESTs total (TEST-001…TEST-042). See `traceability.md` / `traceability.json` for the REQ→TASK→TEST
matrix.

## REQ-011 / REQ-012 are not unit-testable

Both are documentation deliverables (the cross-repo contract doc, the CLAUDE.md link, the CHANGELOG
entry, the explicit "Orky-side emission is out of scope" statement). `02-spec.md`'s Definition of Done
routes them to "Docs/integration" verified at the **doc-sync gate** (TASK-010), not a unit test. No
TEST-ID is assigned to either; `traceability.json` records `"tests": []` for both, which is correct (not
a coverage gap) per the spec's own verification-approach split.

## Design notes / chosen test shapes

1. **REQ-004 is tested only through `OrkyOscParser.push()`.** `02-spec.md`'s "Public interface" section
   exports only `ORKY_OSC`, `OrkyHeartbeat`, and `OrkyOscParser` — `decodeHeartbeat` is an internal
   implementation function (`03-plan.md` TASK-002 lists it under "Files", not under the spec's public
   surface). Every grammar-violation fixture is therefore fed through a full marker (`buildOrkyMarker`/
   `wrapOrkyBody` + `push()`), asserting `[]` on the public API rather than calling a private function
   directly. This also means the implementer is free to choose `decodeHeartbeat`'s exact internal
   signature.
2. **REQ-003's "every byte offset" acceptance is satisfied by one parameterized test (TEST-004)** that
   loops `i` from `0` to `len` inclusive and splits the worked-example marker at `i`, covering splits
   inside the prefix, inside the body, and immediately before the terminator in a single assertion
   sweep — rather than three separate hand-picked split-point tests, which would be a strict subset of
   what the loop already proves.
3. **REQ-006/REQ-007/REQ-009's mapper tests do not depend on the parser.** They construct
   `OrkyHeartbeat`-shaped object literals directly (`hb()` helper in
   `orky-heartbeat-status.test.ts`), decoupling this file's pass/fail state from
   `orky-osc-parser.ts`'s implementation progress — exactly the decoupling `03-plan.md` calls out for
   TASK-004 ("no runtime dependency on the parser file"). The worked-example BUSY case still goes through
   `WORKED_EXAMPLE_HEARTBEAT` from the shared fixture file, so the REQ-001 contract example and the
   REQ-006 mapping example stay pinned to the identical literal values (no copy-drift).
4. **REQ-009's "`orky-tracker.ts` is unchanged" acceptance is pinned with a frozen sha256 hash**
   (TEST-027) of the file's current UTF-8 text, captured before any 0014 code was written
   (`aba940393d50df9e658c0930aadfd136287984f89e63713d423c3d45a93aa526`). This is the simplest structural
   guarantee available pre-implementation: any byte-level edit to `orky-tracker.ts` — even a
   no-functional-change reformat — fails this FROZEN test, which is intentionally strict (REQ-009
   explicitly forbids editing this file's "status derivation").
5. **Some structural assertions are pre-implementation PASSES, not failures** — this is correct, not a
   bug. TEST-026 (no new `orky:*` IPC channel), TEST-027 (the `orky-tracker.ts` hash), and TEST-030
   (`SCHEMA_VERSION === 7`) currently hold true because nothing has been implemented yet; they are
   regression guards for invariants that the implementation MUST NOT break, not behaviors the
   implementation has yet to add. Per-file RED status only requires ≥1 failing assertion in that file,
   which all three files have (see RED verification below).
6. **REQ-002/REQ-004/REQ-008/REQ-009/REQ-013's structural checks read source text defensively**
   (`tryRead` returns `null` on `ENOENT` rather than crashing module load), so each assertion fails with
   a clear, individually-attributed message ("expected null not to be null") instead of one opaque
   "failed to load file" suite-level error — better diagnostics for the implementer once the gate runs
   again post-implementation.
7. **REQ-010's "no live-Orky dependency" is additionally self-checked** (TEST-029): a small meta-test
   reads the OTHER 0014 test/fixture files' source text and asserts none contains
   `child_process`/`execFile`/`spawn(`/`fetch(`/`node:net`/`node:http(s)`. (It intentionally excludes
   itself from that scan — its own forbidden-pattern regex literals would otherwise trivially
   self-match their own source text, a false positive caught and fixed during RED verification; see
   below.)

## RED verification

```
npx vitest run tests/main/orky-osc-parser.test.ts tests/main/orky-osc-structural.test.ts tests/shared/orky-heartbeat-status.test.ts
  → Test Files  3 failed (3)
    Tests  17 failed | 4 passed (21)

npm test (full repo suite)
  → Test Files  3 failed | 116 passed (119)
    Tests  17 failed | 759 passed (776)
  exit code: 1
```

The **3 failed files are exactly the 3 new 0014 test files**; all 116 pre-existing test files stay GREEN
(no unrelated breakage — the baseline-fit section's "purely additive" claim holds at the test level too).
Representative failure messages:

- `tests/main/orky-osc-parser.test.ts` fails to even load: `Failed to load url
  ../../src/main/status/orky-osc-parser ... Does the file exist?` — the module doesn't exist yet (the
  expected RED signal for a brand-new file).
- `tests/shared/orky-heartbeat-status.test.ts`: every test throws `TypeError: orkyHeartbeatToPaneStatus is
  not a function` / `selectOrkyPaneStatus is not a function` — `src/shared/orky-status.ts` exists (feature
  0004) but doesn't export either symbol yet.
- `tests/main/orky-osc-structural.test.ts`: 6 of 10 tests fail with `expected null not to be null` (the
  source-read helper returns `null` because `orky-osc-parser.ts` doesn't exist) — TEST-022, TEST-023,
  TEST-024, TEST-025, TEST-028, TEST-031. The other 4 (TEST-026, TEST-027, TEST-029, TEST-030) currently
  PASS, as expected per design note 5 above.

A pre-fix iteration of TEST-029 (REQ-010's self-check) initially failed on a false positive — the test's
own `FORBIDDEN` regex array (containing the literal pattern `/child_process/`) was included in the list
of files it scanned, so it matched its own source text. Fixed by removing the structural test file from
its own scan list; re-verified GREEN-on-the-correct-assertion (and still part of the file's overall RED
status via the other 6 failing tests in that file).
