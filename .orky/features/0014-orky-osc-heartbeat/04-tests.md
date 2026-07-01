# 0014 — Orky OSC heartbeat parse + render (read) — Test design (Phase 4, RE-PLAN)

**Status:** tests rewritten end-to-end against the REAL ADR-026 wire contract and verified RED. The spec
[`02-spec.md`](02-spec.md) is FROZEN at **17 REQs** (REQ-001…REQ-017, spec iteration 3, ESC-002's targeted
REQ-009 correction); the plan [`03-plan.md`](03-plan.md) defines **8 TASKs** (TASK-001…TASK-008, plan
iteration 2, correcting TASK-005's `kind` derivation to match). These tests are **FROZEN once the tests
gate passes (ADR-009)** — the implementer makes them pass without editing them.

**Doc-sync closeout (this revision):** the Gatekeeper CLI's mechanical `traceability` gate token (used at
the doc-sync gate) requires every REQ-NNN found in `02-spec.md` to trace to at least one TEST-ID — there is
no "documentation-only, exempt from unit test" allowance, regardless of what this doc previously said about
REQ-015/REQ-016. Two real structural tests, **TEST-042** and **TEST-043**, were added to
`tests/main/orky-osc-structural.test.ts` to close that gap — see "Doc-sync closeout: TEST-042/TEST-043"
below. The suite is now **43 TESTs total (TEST-001…TEST-043)**.

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
| `tests/main/orky-osc-structural.test.ts` | Source-text / structural assertions — REQ-002 (`scanOsc` reuse shape), REQ-004 (no `eval`/`Function` in the decode path, structural half), REQ-012 (no new `orky:*` IPC channel, no forked `OrkyPaneStatus`-equivalent interface), REQ-013 (`orky-tracker.ts`'s public `OrkyTracker` API contract — `watch`/`unwatch`/`dispose` signatures — and its lack of any `chokidar`/`node:fs`/0014-module dependency, pinned via a structural check, not a byte hash — see "TEST-035 loopback" below; parser/bridge start no `.orky/` filesystem watch), REQ-014 (no 0014 test/fixture file depends on a live process/network), REQ-017 (`SCHEMA_VERSION` unchanged; no filesystem-write API surface), **REQ-015/REQ-016 (doc-sync closeout, this revision — see below)**. TEST-005, TEST-006, TEST-009, TEST-031, TEST-035, TEST-036, TEST-037, TEST-038, TEST-039, **TEST-042, TEST-043**. |
| `tests/shared/orky-heartbeat-status.test.ts` | `orkyHeartbeatToPaneStatus`/`selectOrkyPaneStatus` — REQ-009 (reuse of 0004's `orkyPaneStatus` presentation with the NEW derived-`kind` mapping, since ADR-026's wire no longer carries `kind`/`openBlocking`/`failed` — **gate-based done-detection only, per ESC-002/spec iteration 3**), REQ-010 (actionable `detail`), REQ-011 (app-loop → cleared shape, mapper half), REQ-013 (fs-wins precedence via `selectOrkyPaneStatus`). TEST-023, TEST-024, **TEST-040 (new)**, TEST-025 (reworded), **TEST-041 (new)**, TEST-026…TEST-028, TEST-030, TEST-032…TEST-034. |

**43 TESTs total (TEST-001…TEST-043).** See `traceability.md` / `traceability.json` for the full
REQ→TASK→TEST matrix.

## Doc-sync closeout: TEST-042/TEST-043 (REQ-015/REQ-016)

`02-spec.md`'s own Definition of Done routed REQ-015 and REQ-016 to "Docs/integration, verified at the
doc-sync gate" and this doc originally recorded them as not unit-testable, mirroring how the equivalent
doc-only REQs in the prior (superseded) REQ numbering were handled. That framing turned out to be
incompatible with the Gatekeeper CLI's mechanical `traceability` gate token for this profile: it requires
**every** REQ-NNN id found in `02-spec.md` to trace to at least one TEST-ID in `traceability.json`, with no
"documentation-only" carve-out. Running the gate at doc-sync failed with `traceability gaps: REQ-015: no
TEST; REQ-016: no TEST`.

Both REQs' acceptance criteria are, in fact, concrete and file-content-checkable (specific literal strings
and patterns across specific files), so real tests were written rather than loosening the gate or
mis-tagging documentation as a test. They were added to `tests/main/orky-osc-structural.test.ts` — the
established home for this feature's cross-file structural/frozen-content-assertion checks (matching
TEST-035's frozen-content-check pattern — now a structural source-shape assertion, see the "TEST-035
loopback" section below — and TEST-037's cross-file content-grep pattern):

- **TEST-042** (REQ-015 — scope: Termhalla parser/renderer only; Orky-side emission is real/shipped)
  asserts that both `02-spec.md` and `docs/features/orky-osc-heartbeat.md`:
  - contain `config.heartbeat.osc` (states the emission is opt-in) and cite `ADR-026`;
  - state the corrected framing — "no longer ... dark in production" — rather than a bare, unqualified
    "out of scope"/"dark" claim about the current state (regex spans a markdown line-wrap, since the doc
    wraps "dark in\nproduction" across two lines);
  - describe the parser-only scope (`Termhalla-side only` in the spec, `parser + renderer` in the doc);

  and that no file under this repo's own `src/` (`orky-osc-parser.ts`, `orky-status.ts`, and the
  fs/stream bridge if present) references the separate `C:/dev/Orky` repo path — the only mechanical
  cross-repo-touch check this suite can make from inside this repo (it cannot literally probe the other
  repo's git history).
- **TEST-043** (REQ-016 — cross-repo contract documented prominently + drift caveat) asserts that
  `docs/features/orky-osc-heartbeat.md`:
  - contains the exact ADR-026 wire prefix `\x1b]9999;` (as it appears in the doc's fenced code blocks);
  - contains every field of the payload schema (`` `v` ``, `` `feature` ``, `` `phase` ``, `` `gate` ``,
    `` `needsHuman` ``, `` `reason` ``, `` `action` ``);
  - names the defining source file (`src/main/status/orky-osc-parser.ts`) and cites `ADR-026`;
  - restates the parser-only/opt-in scope and carries a cross-repo drift caveat (matches `/drift/i` and
    `/cross-repo/i`);

  that `CLAUDE.md`'s "Where things live" table links to the feature doc
  (`[orky-osc-heartbeat](docs/features/orky-osc-heartbeat.md)`); that `CHANGELOG.md`'s `[Unreleased]`
  section (sliced out by matching from `## [Unreleased]` to the next `## [` heading) mentions "OSC
  heartbeat"; and that **neither** the feature doc nor `CHANGELOG.md` contains the superseded contract
  markers (`]8888;orky=`, `orky=<body>`, or the bare `8888` token) — deliberately not the bare word `orky`,
  which legitimately appears throughout this codebase and would false-positive.

Both `docs/features/orky-osc-heartbeat.md` and `CHANGELOG.md`'s `[Unreleased]` section were already
rewritten to the real ADR-026 contract by this iteration's doc-sync pass, so **TEST-042 and TEST-043 both
pass immediately** — they are regression-guard/closing tests for already-completed documentation work, not
tests driving new implementation. No file under `src/` was modified to make them pass; the one fix made
while writing TEST-042 was to the test's own regex (matching across the doc's markdown line-wrap), never to
the doc content.

## TEST-035 loopback (post-merge of sibling feature 0005-cross-project-orky-registry)

**Status update, superseding the "frozen sha256 hash" framing used throughout this document's earlier
sections (including design note 6 below) — TEST-035 is no longer a byte-hash check.** After this feature's
implementation was already complete, sibling feature `0005-cross-project-orky-registry` legitimately
refactored `src/main/orky/orky-tracker.ts` (extracting a shared `OrkyRootEngine` so 0004's per-pane tracker
and 0005's cross-project registry share one chokidar watcher per `.orky/` root instead of duplicating it).
That refactor changed every byte of the file without changing the public contract REQ-013 actually cares
about, so the frozen sha256 hash went RED against a legitimate, unrelated change — a false positive in the
hash approach itself, not a regression in this feature.

A fresh `orky:test-designer` dispatch rewrote TEST-035 to assert a **structural contract** on
`orky-tracker.ts`'s source text instead of a content hash: it still exports `OrkyTracker`, still exposes
`watch(id, cwd): Promise<...>` / `unwatch(id): void` / `dispose(): void` with the expected signatures, and
still imports no `chokidar`/`node:fs` and references neither `orky-osc-parser` nor `orky-stream-status` (the
real invariant REQ-013 exists to protect — that 0014 hasn't crept into or duplicated 0004's/0005's
filesystem-watch responsibility). No `src/` file was touched to make the rewritten test pass; the
implementation was already correct against the new structural assertions. See the "TEST-035" test body in
`tests/main/orky-osc-structural.test.ts` for the full rationale recorded alongside the assertions.

Verification (targeted 3-file run, immediately after adding TEST-042/TEST-043):

```
npx vitest run tests/main/orky-osc-parser.test.ts tests/main/orky-osc-structural.test.ts tests/shared/orky-heartbeat-status.test.ts
  -> Test Files  3 passed (3)
     Tests  43 passed (43)
```

Full repo suite:

```
npm test
  -> Test Files  119 passed (119)
     Tests  798 passed (798)
```

(796 pre-existing + TEST-042 + TEST-043 = 798, all green — the two pre-existing, environment-dependent
failures noted in the "RED verification" section below, from `tests/main/find-orky-root.test.ts` and
`tests/main/orky-tracker.test.ts`, are no longer failing in this run's sandbox — unrelated to this feature
either way.)

## REQ-015 / REQ-016 — traceability history (superseded framing, kept for context)

The original framing below ("not unit-testable") reflected `02-spec.md`'s Definition of Done and is kept
here for historical context; it has been **superseded** by the doc-sync closeout above, which added
TEST-042/TEST-043. `traceability.json` now records `REQ-015: ["TEST-042"]` and `REQ-016: ["TEST-043"]`.

> Both are documentation deliverables (the ADR-026 contract block + drift caveat + scope correction in
> `docs/features/orky-osc-heartbeat.md`, the CLAUDE.md link, the CHANGELOG entry). `02-spec.md`'s
> Definition of Done routes them to "Docs/integration" verified at the **doc-sync gate** (TASK-008), not a
> unit test. Note the REQ numbers that are doc-only SHIFTED in this re-plan: the prior iteration's doc-only
> REQs were REQ-011/REQ-012 (under the old 13-REQ numbering); under the new 17-REQ ADR-026 spec they are
> **REQ-015/REQ-016** — REQ-011 and REQ-012 are now both unit-testable behavioral/structural requirements
> (the app-loop liveness tick, and the no-new-type/channel constraint respectively).

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
6. **REQ-013's "`orky-tracker.ts` hasn't grown 0014's watch responsibility" acceptance was originally
   pinned with a frozen sha256 hash** (TEST-035) of the file's current UTF-8 text. That hash was replaced,
   in a later loopback cycle (see "TEST-035 loopback" above), with a structural check on `OrkyTracker`'s
   public API surface (`watch`/`unwatch`/`dispose` signatures, still exported class, no `chokidar`/
   `node:fs`/0014-module references) after a legitimate refactor in sibling feature
   `0005-cross-project-orky-registry` changed the file's bytes without changing that contract, which the
   byte-hash could not distinguish from a real regression. The structural check is intentionally still
   strict about the public contract REQ-013 cares about, but no longer false-positives on unrelated,
   contract-preserving refactors of the file.
7. **Some structural assertions are pre-implementation PASSES, not failures** — this is correct, not a
   bug, and was true of the prior iteration's structural suite too (see RED verification below): the
   structural REQs (002, 004's structural half, 012, 013, 014, 017) describe properties that were ALREADY
   true of the (still-on-disk, stale-contract) implementation before this re-plan — `scanOsc` reuse, no
   `eval`, no new IPC channel, the `orky-tracker.ts` public-API/import-boundary check, `SCHEMA_VERSION`,
   no write API. They are
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
10. **(New, doc-sync closeout) TEST-042/TEST-043 assert against DOCUMENT CONTENT, not source code** — the
    same category of structural test this file already uses for TEST-035 (frozen source hash) and TEST-037
    (cross-file content grep), just applied to `02-spec.md`/`docs/features/orky-osc-heartbeat.md`/
    `CLAUDE.md`/`CHANGELOG.md` instead of `.ts` source. Both regexes intentionally tolerate markdown
    line-wraps (`[\s\S]{0,N}` gaps, `\s+` inside multi-word literal phrases) since prose in these docs
    wraps at ~100 columns and a literal contiguous-line match would be fragile against reformatting that
    does not change meaning.

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

Both the RED state above (ESC-002 revision) and this revision's doc-sync closeout have since been resolved
by implementation + doc-sync passes that are complete as of TEST-042/TEST-043's addition: the full targeted
3-file suite and the full `npm test` run are both **fully green** (see "Doc-sync closeout" verification
above).
