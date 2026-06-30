# 0014 — Orky OSC heartbeat parse + render (read) — Test design (Phase 4, RE-PLAN)

**Status:** tests rewritten end-to-end against the REAL ADR-026 wire contract and verified RED. The spec
[`02-spec.md`](02-spec.md) is FROZEN at **17 REQs** (REQ-001…REQ-017, spec iteration 3, ESC-002's targeted
REQ-009 correction); the plan [`03-plan.md`](03-plan.md) defines **8 TASKs** (TASK-001…TASK-008, plan
iteration 2, correcting TASK-005's `kind` derivation to match). These tests are **FROZEN once the tests
gate passes (ADR-009)** — the implementer makes them pass without editing them.

## Why this revision exists (re-plan, not an incremental patch)

This feature previously went through tests/implement/review under an EARLIER, now-superseded spec
iteration that invented a placeholder OSC contract (code `8888`, `;`-delimited `key=value` body). That
review hit escalation **ESC-001**, resolved by the human supplying Orky's REAL shipped wire contract
(**ADR-026**: introducer `\x1b]`, code `9999`, single `;` separator splitting on the FIRST `;` only,
single-line compact JSON payload, BEL terminator — MAY also accept ST). `02-spec.md` was fully rewritten
against this real contract (still REQ-001…REQ-017, but the REQ *content* and acceptance criteria changed
substantially). The four test/fixture files this phase touches were **stale** (testing the wrong 8888/
key=value contract) and have been **fully rewritten, not patched**:

- `tests/fixtures/orky-osc-fixtures.ts`
- `tests/main/orky-osc-parser.test.ts`
- `tests/main/orky-osc-structural.test.ts`
- `tests/shared/orky-heartbeat-status.test.ts`

The corresponding implementation (`src/main/status/orky-osc-parser.ts`, the `OrkyHeartbeat` type in
`src/shared/types.ts`, `src/shared/orky-status.ts`'s heartbeat mapper) is ALSO still the old 8888/
key=value version — it has not yet been updated (that's the implement phase's job), so this rewritten
suite currently fails RED for the right reason: it tests the not-yet-implemented ADR-026 behavior.

The test designer is a different actor from the implementer (the integrity boundary): no production code
was written or touched while designing this revision of the suite.

## Iteration 2 of this phase — ESC-002 / FINDING-DA-004 targeted correction (REQ-009 only)

A SECOND, narrower escalation hit at review: **ESC-002**, resolved by the human approving a correction to
REQ-009's done-detection rule. The prior iteration's `kind` derivation read
`hb.phase == null && hb.gateN >= hb.gateM → 'done'`. FINDING-DA-004 proved this rule can **never fire
against the real Orky emitter** — `gatekeeper.js:904`'s `phase: state.phase || d.phase || null` sends
`phase: "doc-sync"`, never `null`, for a genuinely complete feature (`human-review` is a separate external
gate never written into `state.json.phase`). `02-spec.md` iteration 3 corrects REQ-009: done-detection is
now **purely gate-based** (`gateN >= gateM`), completely independent of `phase`'s value. `03-plan.md`
iteration 2 corrects TASK-005's bullet to match: `hb.needsHuman === true ? 'needs-input' : hb.gateN >=
hb.gateM ? 'done' : 'busy'`.

This phase-4 revision makes the **minimal, targeted** correction the new REQ-009 acceptance criteria
demand — only `tests/fixtures/orky-osc-fixtures.ts` and `tests/shared/orky-heartbeat-status.test.ts` are
touched, and only around the REQ-009 done-detection assertions. `tests/main/orky-osc-parser.test.ts` and
`tests/main/orky-osc-structural.test.ts` are **unaffected** (REQ-009 is a mapper-level concern tested
entirely in `orky-heartbeat-status.test.ts`'s fixture-built `OrkyHeartbeat` object literals — the parser
never derives `kind`, REQ-002/REQ-004's parser-side requirements are untouched by this correction; verified
by inspection, no `REQ-009` occurrence exists in either parser-level file).

**Two TESTs added (TEST-040, TEST-041)** — the suite is now **41 TESTs total (TEST-001…TEST-041)**:

- **TEST-040** (new) — the PRIMARY REQ-009 done-case assertion, replacing TEST-025 as the "main" example:
  a complete heartbeat carrying the REAL emitter's shape (`phase: "doc-sync"`, `gate: "8/8"`,
  `needsHuman: false`) maps to `kind === 'done'` with the same clean `idle`/empty roll-up 0004 returns for
  an all-clean project. This is the assertion the OLD buggy `phase == null && gateN >= gateM` rule could
  never satisfy (its `phase` would never be `null` against real output) — so TEST-040 is also the test that
  proves the correction actually fixes FINDING-DA-004's defect, not just rewords it.
- **TEST-025** (retained, reworded) — now explicitly framed as the **phase-independence companion**, not
  the sole/primary done example: the same `gateN >= gateM` complete heartbeat but with `phase: null`
  (`DONE_HEARTBEAT`, unchanged fixture) ALSO yields the identical clean-`done` roll-up — proving the
  gate-based rule fires identically regardless of `phase`'s value, in both directions (TEST-040's
  `"doc-sync"` and TEST-025's `null` are the two REQ-009 acceptance examples verbatim from `02-spec.md`).
- **TEST-041** (new) — the regression guard that would have CAUGHT the old bug's *inverse* edge: a
  heartbeat whose `phase` IS `null` but whose gates are NOT all passed (`gateN < gateM`,
  `BUSY_PHASE_NULL_HEARTBEAT`, a new fixture) MUST map to `kind === 'busy'`, never `'done'` — proving
  `phase` being `null` does not, by itself, trigger `done`; only gate fullness does. (`BUSY_HEARTBEAT`,
  the suite's existing busy-case fixture, already has a non-null `phase: 'implement'`, so it could not
  cover this specific edge — a dedicated `phase: null` + incomplete-gates fixture was needed.)

Two new fixture trios were added to `tests/fixtures/orky-osc-fixtures.ts` (payload + marker + heartbeat,
matching the file's existing convention) to support these: `DONE_DOC_SYNC_PAYLOAD`/`_MARKER`/`_HEARTBEAT`
(the new primary done example) and `BUSY_PHASE_NULL_PAYLOAD`/`_MARKER`/`_HEARTBEAT` (the regression-guard
fixture). The pre-existing `DONE_PAYLOAD`/`DONE_MARKER`/`DONE_HEARTBEAT` (`phase: null`) trio is **kept
as-is** — it is still a valid, spec-mandated acceptance example (the phase-independence proof) — with its
doc-comment updated to clarify it is now the companion case, not the sole done example.

No production code (`src/`) was touched while making this correction — the test designer remains a
different actor from the implementer (the integrity boundary). The implementation on disk still encodes
the OLD `phase == null && gateN >= gateM` rule, so TEST-040 (and only TEST-040, of the REQ-009 cluster)
fails RED for the correct reason; TEST-025 and TEST-041 both happen to also be satisfied by the old buggy
rule's truth table (the old rule is a strict subset of cases the new rule also accepts/rejects identically
for those two specific fixtures), so they pass green pre-implementation — this is expected and is not a
coverage gap: TEST-040 is the one assertion in the whole suite that can only pass under the CORRECTED
gate-based-only derivation, which is exactly its job as the regression-proof for FINDING-DA-004.

## Files written

| File | Role |
|---|---|
| `tests/fixtures/orky-osc-fixtures.ts` | Synthetic/golden OSC byte fixture helper (REQ-014) — `ORKY_OSC = '\x1b]9999;'`, `BEL`/`ST`, `wrapOrkyPayload`/`buildOrkyMarker` (JSON-payload builders), the worked examples (`APP_LOOP_*`, `AWAITING_HUMAN_*`, plus `BUSY_*`/`DONE_*`/`DONE_DOC_SYNC_*`/`BUSY_PHASE_NULL_*` from REQ-009's acceptance examples), and malformed/edge-case payload constants (`MALFORMED_JSON_MARKER`, `NON_OBJECT_JSON_MARKERS`, `EMPTY_PAYLOAD_MARKER`) for REQ-008. Pure byte-string builders; no process/network/filesystem access. Does NOT import the not-yet-rewritten parser module — a true golden fixture independent of the implementation (it imports only the pre-existing, Electron-free `ORKY_PHASES` from `@shared/orky-status`, feature 0004, to compute the app-loop heartbeat's default `gateM`). |
| `tests/main/orky-osc-parser.test.ts` | Behavioral coverage of `OrkyOscParser` — REQ-001 (ADR-026 worked example + cross-prefix rejection + the literal-`;`-in-`reason` case), REQ-003 (chunk-boundary carry-over), REQ-004 (thin-client verbatim mapping, behavioral half), REQ-005 (forward-compat on `v`/unknown fields), REQ-006 (bounded carry-over ceiling, FINDING-SEC-001), REQ-007 (UTF-8 byte-length payload cap, FINDING-CODEX-001), REQ-008 (strict-but-tolerant JSON validation, total/never-throws), REQ-011 (app-loop heartbeat decode, parser half). TEST-001…TEST-022, TEST-029. **Unaffected by this revision's REQ-009 correction.** |
| `tests/main/orky-osc-structural.test.ts` | Source-text / structural assertions — REQ-002 (`scanOsc` reuse shape), REQ-004 (no `eval`/`Function` in the decode path, structural half), REQ-012 (no new `orky:*` IPC channel, no forked `OrkyPaneStatus`-equivalent interface), REQ-013 (`orky-tracker.ts` byte-for-byte unchanged via a frozen sha256 hash; parser/bridge start no `.orky/` filesystem watch), REQ-014 (no 0014 test/fixture file depends on a live process/network), REQ-017 (`SCHEMA_VERSION` unchanged; no filesystem-write API surface). TEST-005, TEST-006, TEST-009, TEST-031, TEST-035, TEST-036, TEST-037, TEST-038, TEST-039. **Unaffected by this revision's REQ-009 correction.** |
| `tests/shared/orky-heartbeat-status.test.ts` | `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus` — REQ-009 (reuse of 0004's `orkyPaneStatus` presentation with the NEW derived-`kind` mapping, since ADR-026's wire no longer carries `kind`/`openBlocking`/`failed` — **gate-based done-detection only, per ESC-002/spec iteration 3**), REQ-010 (actionable `detail`), REQ-011 (app-loop → cleared shape, mapper half), REQ-013 (fs-wins precedence via `selectOrkyPaneStatus`). TEST-023, TEST-024, **TEST-040 (new)**, TEST-025 (reworded), **TEST-041 (new)**, TEST-026…TEST-028, TEST-030, TEST-032…TEST-034. |

**41 TESTs total (TEST-001…TEST-041).** See `traceability.md` / `traceability.json` for the full
REQ→TASK→TEST matrix.

## REQ-015 / REQ-016 are not unit-testable

Both are documentation deliverables (the ADR-026 contract block + drift caveat + scope correction in
`docs/features/orky-osc-heartbeat.md`, the CLAUDE.md link, the CHANGELOG entry). `02-spec.md`'s
Definition of Done routes them to "Docs/integration" verified at the **doc-sync gate** (TASK-008), not a
unit test. No TEST-ID is assigned to either; `traceability.json` records `"tests": []` for both, which is
correct (not a coverage gap). Note the REQ numbers that are doc-only SHIFTED in this re-plan: the prior
iteration's doc-only REQs were REQ-011/REQ-012 (under the old 13-REQ numbering); under the new 17-REQ
ADR-026 spec they are **REQ-015/REQ-016** — REQ-011 and REQ-012 are now both unit-testable behavioral/
structural requirements (the app-loop liveness tick, and the no-new-type/channel constraint respectively).

## Design notes / chosen test shapes

1. **`MAX_PENDING_BYTES`/`MAX_PAYLOAD_BYTES` are required named exports of `orky-osc-parser.ts`** — an
   addition to `02-spec.md`'s literal "Public interface" section, made by the test designer. REQ-006/
   REQ-007 are binding hardening REQs (FINDING-SEC-001/FINDING-CODEX-001) whose acceptance criteria
   explicitly demand the bounded ceiling / byte cap be "asserted directly" rather than merely "no throw"
   — this is the documented lesson from the prior iteration's TEST-021, which asserted only no-throw/
   no-emit over an actually-unbounded buffer and passed green over the defect (`03-plan.md`'s risk note
   2a). Hard-coding a guessed numeric cap in the test would silently drift from whatever value the
   implementer documents at the constant, so the tests import and use the real constants instead
   (`tests/main/orky-osc-parser.test.ts` TEST-014/015 for the ceiling, TEST-016/017 for the payload cap).
2. **The retained internal buffer is read via the `buf` field**, which REQ-002's own acceptance already
   mandates ("a code/structure check confirms it mirrors the Osc133Parser/CwdParser shape — single
   internal buffer") and `tests/main/orky-osc-structural.test.ts` TEST-006 pins structurally (`private buf
   = ''`). This is a TypeScript-only `private` (not a JS `#private` field), so it is a plain runtime
   property — TEST-014 reads `Buffer.byteLength((p as unknown as { buf: string }).buf, 'utf8')` directly
   after pushing several MiB of non-terminating data, rather than asserting only "no throw, emits []"
   (the documented gap in the superseded suite's TEST-021).
3. **REQ-007's UTF-8-vs-`.length` test (TEST-016) is computed dynamically from `MAX_PAYLOAD_BYTES`**, not
   a hard-coded byte count: it builds a `reason` string of `U+1F600` (😀) repeats — 2 UTF-16 code units
   each (`.length`), 4 UTF-8 bytes each — sized so the JSON payload's `.length` stays under the cap while
   its real `Buffer.byteLength(...,'utf8')` exceeds it, then asserts BOTH sanity facts before asserting
   the parser rejects it. TEST-017 isolates the cap boundary itself (ASCII-only, so `.length` ===
   byte-length) — exactly at the cap is accepted, one byte over is rejected.
4. **REQ-003's "every byte offset" acceptance is satisfied by one parameterized test (TEST-007)** that
   loops `i` from `0` to `len` inclusive and splits the worked-example marker at `i` — covering splits
   inside the prefix, inside the JSON payload, and immediately before the terminator in a single
   assertion sweep.
5. **REQ-009/REQ-010/REQ-011(mapper-half)/REQ-013's tests do not depend on the parser.** They build
   `OrkyHeartbeat`-shaped object literals directly via the shared fixtures
   (`AWAITING_HUMAN_HEARTBEAT`/`BUSY_HEARTBEAT`/`BUSY_PHASE_NULL_HEARTBEAT`/`DONE_HEARTBEAT`/
   `DONE_DOC_SYNC_HEARTBEAT`/`APP_LOOP_HEARTBEAT` in `tests/fixtures/orky-osc-fixtures.ts`), decoupling
   `tests/shared/orky-heartbeat-status.test.ts`'s pass/fail state from `orky-osc-parser.ts`'s
   implementation progress — exactly the decoupling `03-plan.md` calls out for TASK-005 ("type-only dep on
   TASK-001 — pure shared code, no runtime dependency on the parser file"). The fixture heartbeat shapes
   are pinned to the SAME literal field values the REQ-001 parser-level tests assert, so there is no
   copy-drift between "what the parser decodes" and "what the mapper is fed."
6. **REQ-013's "`orky-tracker.ts` is unchanged" acceptance is pinned with a frozen sha256 hash**
   (TEST-035) of the file's current UTF-8 text
   (`aba940393d50df9e658c0930aadfd136287984f89e63713d423c3d45a93aa526` — re-verified against the file as
   it stands today, unchanged since the prior iteration's pass). Any byte-level edit to `orky-tracker.ts`
   — even a no-functional-change reformat — fails this FROZEN test, intentionally strict per REQ-013's
   "no regression/duplication" wording.
7. **Some structural assertions are pre-implementation PASSES, not failures** — this is correct, not a
   bug, and was true of the prior iteration's structural suite too (see RED verification below): the
   structural REQs (002, 004's structural half, 012, 013, 014, 017) describe properties that were ALREADY
   true of the (still-on-disk, stale-contract) implementation before this re-plan — `scanOsc` reuse, no
   `eval`, no new IPC channel, the `orky-tracker.ts` hash, `SCHEMA_VERSION`, no write API. They are
   regression guards for invariants the implementation MUST NOT break, not behaviors yet to be added; the
   suite's overall RED status comes entirely from the BEHAVIORAL tests (REQ-001/003/004's behavioral
   half/005/006/007/008/009/010/011), which fail because the parser still decodes the superseded 8888/
   key=value grammar and the mapper still implements the old `phase==null && gateN>=gateM` rule instead of
   the corrected purely-gate-based one.
8. **REQ-014's "no live-Orky dependency" is self-checked** (TEST-037): a structural test reads the OTHER
   3 new/rewritten 0014 files' source text and asserts none contains `child_process`/`execFile`/`spawn(`/
   `fetch(`/`node:net`/`node:http(s)`. It deliberately excludes `orky-osc-structural.test.ts` itself from
   the scan list (its own forbidden-pattern regex literals would otherwise trivially self-match — the
   same false-positive class the prior iteration's TEST-029 hit and fixed).
9. **(New, ESC-002 revision) TEST-040 is deliberately the only REQ-009 assertion guaranteed to fail under
   the OLD buggy rule.** TEST-025 (phase:null companion) and TEST-041 (phase:null regression guard) both
   happen to agree with the old rule's truth table for their specific inputs, so they pass green even
   pre-correction — this is expected, not a coverage gap, and is recorded explicitly above so a future
   reader does not mistake "2 of 3 REQ-009 tests already pass" for an under-tested correction. TEST-040 is
   the assertion whose pass/fail genuinely distinguishes the old rule from the corrected one.

## RED verification

```
npx vitest run tests/main/orky-osc-parser.test.ts tests/main/orky-osc-structural.test.ts tests/shared/orky-heartbeat-status.test.ts
  -> Test Files  1 failed | 2 passed (3)
     Tests  1 failed | 40 passed (41)
```

The single failing test is **TEST-040** (`tests/shared/orky-heartbeat-status.test.ts`), the new PRIMARY
REQ-009 done-case assertion: feeding the real-emitter-shaped `DONE_DOC_SYNC_HEARTBEAT`
(`phase: "doc-sync"`, `gate: "8/8"`, `needsHuman: false`) to `orkyHeartbeatToPaneStatus` currently returns
`kind: 'busy'` (the on-disk `heartbeatKind`'s old `hb.phase == null && hb.gateN >= hb.gateM` rule reads
`phase` and short-circuits to `false` since `"doc-sync" !== null`, falling through to the `busy` default)
instead of the expected `kind: 'done'` clean roll-up. This is RED for exactly the right reason — the
implementation has not yet been corrected per ESC-002 — and is the regression-proof for FINDING-DA-004.

All other 40 tests in the targeted 3 files pass, including TEST-025 (the reworded phase-independence
companion) and TEST-041 (the new inverse regression guard) — both happen to already agree with the old
rule's behavior for their specific inputs (see design note 9 above), which is expected, not a gap.

```
npm test (full repo suite)
  -> Test Files  3 failed | 116 passed (119)
     Tests  3 failed | 793 passed (796)
  exit code: 1
```

Of the 3 failing files, only **1 is attributable to this revision**: `tests/shared/orky-heartbeat-status.test.ts`
(TEST-040, above). The other 2 — `tests/main/find-orky-root.test.ts` (`TEST-025` in THAT feature's own
numbering, unrelated to this feature's `TEST-025`) and `tests/main/orky-tracker.test.ts` (`TEST-031` in
that feature's numbering) — are **pre-existing, environment-dependent failures unrelated to this
revision**, confirmed by `git stash`-ing both files this revision touched
(`tests/fixtures/orky-osc-fixtures.ts`, `tests/shared/orky-heartbeat-status.test.ts`) and re-running: both
failures reproduce identically with this revision's changes entirely absent. Both fail because this
sandbox's `%TEMP%` ancestry (`C:\Users\kevin\AppData\Local\Temp`) happens to resolve as a truthy
`findOrkyRoot` match in the current environment — a sandbox/host artifact, not a regression from this
revision and not something within this phase's scope to fix (these tests belong to feature 0004, not
0014). All 117 *other* pre-existing test files (including the 2 unaffected 0014 files,
`tests/main/orky-osc-parser.test.ts` and `tests/main/orky-osc-structural.test.ts`) stay fully GREEN — no
unrelated breakage from this revision.

This confirms the suite is RED for the correct reason — the targeted REQ-009 correction tests the
not-yet-implemented gate-based-only `kind` derivation, not a syntax/import error (every new/rewritten
module under test loads successfully; the one new failure is an `AssertionError` on the expected vs.
actual `OrkyPaneStatus` shape, never a module-resolution failure).
