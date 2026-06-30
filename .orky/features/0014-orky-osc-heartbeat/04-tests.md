# 0014 — Orky OSC heartbeat parse + render (read) — Test design (Phase 4, RE-PLAN)

**Status:** tests rewritten end-to-end against the REAL ADR-026 wire contract and verified RED. The spec
[`02-spec.md`](02-spec.md) is FROZEN at **17 REQs** (REQ-001…REQ-017, frozen 2026-06-30T21:14:18); the
plan [`03-plan.md`](03-plan.md) defines **8 TASKs** (TASK-001…TASK-008). These tests are **FROZEN once
the tests gate passes (ADR-009)** — the implementer makes them pass without editing them.

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

## Files written

| File | Role |
|---|---|
| `tests/fixtures/orky-osc-fixtures.ts` | Synthetic/golden OSC byte fixture helper (REQ-014) — `ORKY_OSC = '\x1b]9999;'`, `BEL`/`ST`, `wrapOrkyPayload`/`buildOrkyMarker` (JSON-payload builders), the worked examples (`APP_LOOP_*`, `AWAITING_HUMAN_*`, plus `BUSY_*`/`DONE_*` from REQ-009's acceptance examples), and malformed/edge-case payload constants (`MALFORMED_JSON_MARKER`, `NON_OBJECT_JSON_MARKERS`, `EMPTY_PAYLOAD_MARKER`) for REQ-008. Pure byte-string builders; no process/network/filesystem access. Does NOT import the not-yet-rewritten parser module — a true golden fixture independent of the implementation (it imports only the pre-existing, Electron-free `ORKY_PHASES` from `@shared/orky-status`, feature 0004, to compute the app-loop heartbeat's default `gateM`). |
| `tests/main/orky-osc-parser.test.ts` | Behavioral coverage of `OrkyOscParser` — REQ-001 (ADR-026 worked example + cross-prefix rejection + the literal-`;`-in-`reason` case), REQ-003 (chunk-boundary carry-over), REQ-004 (thin-client verbatim mapping, behavioral half), REQ-005 (forward-compat on `v`/unknown fields), REQ-006 (bounded carry-over ceiling, FINDING-SEC-001), REQ-007 (UTF-8 byte-length payload cap, FINDING-CODEX-001), REQ-008 (strict-but-tolerant JSON validation, total/never-throws), REQ-011 (app-loop heartbeat decode, parser half). TEST-001…TEST-022, TEST-029. |
| `tests/main/orky-osc-structural.test.ts` | Source-text / structural assertions — REQ-002 (`scanOsc` reuse shape), REQ-004 (no `eval`/`Function` in the decode path, structural half), REQ-012 (no new `orky:*` IPC channel, no forked `OrkyPaneStatus`-equivalent interface), REQ-013 (`orky-tracker.ts` byte-for-byte unchanged via a frozen sha256 hash; parser/bridge start no `.orky/` filesystem watch), REQ-014 (no 0014 test/fixture file depends on a live process/network), REQ-017 (`SCHEMA_VERSION` unchanged; no filesystem-write API surface). TEST-005, TEST-006, TEST-009, TEST-031, TEST-035, TEST-036, TEST-037, TEST-038, TEST-039. |
| `tests/shared/orky-heartbeat-status.test.ts` | `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus` — REQ-009 (reuse of 0004's `orkyPaneStatus` presentation with the NEW derived-`kind` mapping, since ADR-026's wire no longer carries `kind`/`openBlocking`/`failed`), REQ-010 (actionable `detail`), REQ-011 (app-loop → cleared shape, mapper half), REQ-013 (fs-wins precedence via `selectOrkyPaneStatus`). TEST-023…TEST-028, TEST-030, TEST-032…TEST-034. |

**39 TESTs total (TEST-001…TEST-039).** See `traceability.md` / `traceability.json` for the full
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
   (`AWAITING_HUMAN_HEARTBEAT`/`BUSY_HEARTBEAT`/`DONE_HEARTBEAT`/`APP_LOOP_HEARTBEAT` in
   `tests/fixtures/orky-osc-fixtures.ts`), decoupling `tests/shared/orky-heartbeat-status.test.ts`'s pass/
   fail state from `orky-osc-parser.ts`'s implementation progress — exactly the decoupling `03-plan.md`
   calls out for TASK-005 ("type-only dep on TASK-001 — pure shared code, no runtime dependency on the
   parser file"). The fixture heartbeat shapes are pinned to the SAME literal field values the REQ-001
   parser-level tests assert, so there is no copy-drift between "what the parser decodes" and "what the
   mapper is fed."
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
   key=value grammar and the mapper still passes wire fields straight through instead of deriving `kind`.
8. **REQ-014's "no live-Orky dependency" is self-checked** (TEST-037): a structural test reads the OTHER
   3 new/rewritten 0014 files' source text and asserts none contains `child_process`/`execFile`/`spawn(`/
   `fetch(`/`node:net`/`node:http(s)`. It deliberately excludes `orky-osc-structural.test.ts` itself from
   the scan list (its own forbidden-pattern regex literals would otherwise trivially self-match — the
   same false-positive class the prior iteration's TEST-029 hit and fixed).

## RED verification

```
npx vitest run tests/main/orky-osc-parser.test.ts tests/main/orky-osc-structural.test.ts tests/shared/orky-heartbeat-status.test.ts
  -> Test Files  2 failed | 1 passed (3)
     Tests  21 failed | 18 passed (39)

npm test (full repo suite)
  -> Test Files  2 failed | 117 passed (119)
     Tests  21 failed | 773 passed (794)
  exit code: 1
```

The **2 failed files are exactly the 2 new/rewritten 0014 files with behavioral coverage**
(`tests/main/orky-osc-parser.test.ts`, `tests/shared/orky-heartbeat-status.test.ts`);
`tests/main/orky-osc-structural.test.ts` passes in full pre-implementation (design note 7, above —
correct, not a gap, since its assertions are all structural regression guards already true today). All
117 pre-existing test files stay GREEN — no unrelated breakage; the baseline-fit section's "purely
additive" claim holds at the test level too.

Representative failure messages (all 21 failing tests, every one because the on-disk implementation still
speaks the superseded 8888/key=value contract):

- `tests/main/orky-osc-parser.test.ts` TEST-001/002/003/004/007/008/010/011/012/013/022/029: `push(...)`
  on a `\x1b]9999;{...}\x07`-shaped marker returns `[]` instead of the expected decoded heartbeat — the
  parser's `ORKY_OSC` constant and `decodeHeartbeat` still target the old `\x1b]8888;orky=...` key=value
  grammar, so every ADR-026-shaped marker fails to match the prefix at all.
- `tests/main/orky-osc-parser.test.ts` TEST-014/015: `MAX_PENDING_BYTES`/`MAX_PAYLOAD_BYTES` import as
  `undefined` (`TypeError: expected value must be number or bigint, received "undefined"`) — these named
  exports do not exist yet on the stale module.
- `tests/main/orky-osc-parser.test.ts` TEST-016/017: same `undefined`-constant failure (`NaN` arithmetic)
  for the same reason.
- `tests/shared/orky-heartbeat-status.test.ts` TEST-023/024/026/027/028: `orkyHeartbeatToPaneStatus`
  still expects the OLD `OrkyHeartbeat` shape (`kind`/`openBlocking`/`failed` carried on the wire) rather
  than deriving `kind` from `needsHuman`/`phase`/`gateN`/`gateM` per ADR-026, so feeding it the new
  ADR-026-shaped heartbeat object literals (no `kind` field) produces a mismatched/empty roll-up instead
  of the expected `needs-input`/`busy` shapes.

This confirms the suite is RED for the correct reason — it tests not-yet-implemented ADR-026 behavior,
not a syntax/import error (every new/rewritten module under test loads successfully; the failures are
all `AssertionError`/`TypeError`-on-`undefined`-constant, never a module-resolution failure).
