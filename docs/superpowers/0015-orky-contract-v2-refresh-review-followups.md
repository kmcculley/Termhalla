# Orky contract v2 refresh (0015) — Review Follow-ups (deferred)

Feature `0015-orky-contract-v2-refresh` shipped after two tests-phase loopbacks (fixture
regeneration moved from implement to tests, per the test-freeze boundary) and one human-resolved
spec loopback (**ESC-001**, Kevin, 2026-07-03, Option A) that re-pinned REQ-105/REQ-108's fixture
and TEST-691 provenance to the producer's **observable contract** (`contract_version: 2`) instead
of a spec-time version literal, extended REQ-107 to cover prose phrasings (the `CLAUDE.md:179`
"(intake…human)" parenthetical), tightened REQ-110's display guard to non-empty resolution, and
added REQ-113 (document the resolution display in `docs/features/orky-pane.md`).

Every **HIGH** finding (FINDING-005/008/012, the CLAUDE.md prose-drift + producer-version
mismatch) and every finding that named a `contract_violation` was **resolved in-feature** via the
ESC-001 descent (TASK-115..TASK-122). See the per-finding records in
`.orky/features/0015-orky-contract-v2-refresh/findings.json`.

The four items below were **deferred, not fixed**, and are tracked here so they are not lost. None
is release-blocking; none is a contract violation.

## Deferred follow-ups

### MEDIUM

- **TEST-691's hard live-version equality has no re-mirror playbook and will break the suite on
  the next contract bump** (FINDING-014, devils-advocate,
  `tests/integration/orky-act-loop.test.ts:135-143` / `02-spec.md:REQ-108`). `TEST-691` asserts
  `contractVersion === EXPECTED_CONTRACT_VERSION` and `note === undefined` against the LIVE
  installed plugin — this feature's own root cause (the plugin shipped three releases,
  0.30.0→0.32.0, in one morning) is guaranteed to recur: the next contract bump (v3), or any
  mixed-fleet machine running a lagging or pre-contract plugin, turns `npm test` red suite-wide for
  work wholly unrelated to Orky. Version-skew polarity is already exhaustively pinned at the unit
  layer (TEST-708/TEST-709), so the hard live-equality assertion adds fleet fragility, not real
  coverage. **Why deferred:** REQ-108/TEST-691 were explicitly out of the ESC-001 amendment's scope
  (the spec banner names FINDING-014 as "out of this amendment's scope — they go to the followups
  doc at doc-sync"), and `tests/integration/orky-act-loop.test.ts` is a frozen suite outside a
  tests-phase re-entry. **Recommended fix (next contract-touching feature or a dedicated
  spec):** either (a) document a re-mirror playbook in `docs/features/orky-status.md` naming
  exactly the surfaces 0015 touched (constant bump, fixture regen, provenance-text reconciliation,
  `finding_resolution`/`producer_tiers` scope review) as a repeatable checklist, or (b) make
  TEST-691 assert the handshake MECHANICS (invocation pins, cache behavior) and tolerate/loudly log
  a live version different from the pin rather than hard-failing on it.

### LOW

- **The new case-insensitive `resolved` check is inlined, not an extracted/unit-testable
  predicate** (FINDING-015, quality, `src/renderer/components/OrkyPane.tsx:230`).
  `fd.status.toLowerCase() === 'resolved'` is written directly in `OrkyPane.tsx`'s render map
  rather than as a small named predicate beside `isBlockingFinding` in `src/shared/orky-status.ts`.
  It duplicates the case-fold idiom `isBlockingFinding` already uses but isn't unit-testable in
  isolation — TEST-715 can only verify it via a source-text regex scan, not a real truth-table unit
  test (mixed case, `null`, non-string). Low impact today (used exactly once); the next consumer of
  finding-resolved-ness will either duplicate the regex or need to extract it retroactively.
  **Recommended fix:** extract `isResolvedFinding(status: string | null): boolean` near
  `isBlockingFinding`, unit-test its truth table directly, and have `OrkyPane.tsx` call it instead
  of inlining the comparison.

- **`orky-action-dispatch.md`'s "catches an in-place upgrade" claim is only true across app
  restarts** (FINDING-016, devils-advocate, `docs/features/orky-action-dispatch.md:176-183` /
  `src/main/orky/orky-contract-handshake.ts:52-56`). `verifyOrkyContract` caches its result per
  located path for the process lifetime (REQ-104 pins this byte-for-byte), so a mid-session
  in-place Orky upgrade (exactly what happened during this feature's own regeneration — 0.30 to
  0.32 within roughly an hour) is invisible until the next app restart; TASK-108 edited this very
  sentence (expected `1`→`2`) without qualifying the claim. **Why deferred:** no code change is
  implied (the caching behavior is a deliberate, spec-pinned binding decision, REQ-104) — this is
  purely a documentation precision gap, and doc-sync verified the sentence is otherwise accurate
  and left it as the human-facing wording pending an explicit doc pass. **Recommended fix:**
  qualify the sentence to "catches an in-place upgrade across app RESTARTS (the result is cached
  once per located path per process lifetime)" — no code change, the binding decision keeps the
  cache.

- **The sibling escalation row still has both defect classes the finding-row fix (FINDING-001/003)
  just closed** (FINDING-017, ux, `src/renderer/components/OrkyPane.tsx:258-267`). The
  resolved-escalation `— decision: …` affix — the very precedent amended REQ-110 cites for the
  finding row's fix — still (a) mirrors only `esc.reason` into the row `title`, so a long reason on
  the nowrap/ellipsis row clips the ENTIRE decision affix with no hover fallback, and (b) guards
  only on `decision !== null`, so an empty-string decision renders a dangling `— decision:` label.
  This predates 0015 (it is 0009/0010-era behavior) and was out of this feature's scope (REQ-110
  names only the finding row), but the descent now leaves two adjacent rows in the same expanded
  pane behaving inconsistently for the identical clipping/empty-string scenario. **Recommended
  fix:** apply the finding-row pattern (CONV-057) to the escalation row: guard on
  `decision !== null && decision !== ''`, compose the affix once, and mirror `reason + affix` into
  the row `title` whenever the affix renders.

## Promoted to conventions

- **CONV-057** (from FINDING-001 / FINDING-011): a single-line truncating row must mirror every
  inline-rendered field into a non-clipped surface (title/tooltip), and tests proving observability
  must not rely on DOM-containment alone.
- **CONV-058** (from FINDING-004 / FINDING-008 / FINDING-010): a provenance pin on regenerated
  external-producer artifacts must key on the producer's observable output contract, recording the
  actual release/commit as a generation-time fact — never a spec-time version literal.

See `.orky/conventions.md` for the full entries.

## Resolved in-feature (not deferred)

- FINDING-001/FINDING-011 (MEDIUM, ux/devils-advocate — resolution affix unreachable when the row
  clips; DOM-containment tests hid the gap) — the row `title` now mirrors claim + full affix
  whenever the affix renders; TEST-722 (structural) + TEST-723 (e2e) pin it.
- FINDING-002 (LOW, ux — unlabeled `resolvedBy` parenthetical) — resolved by spec decision: amended
  REQ-110 makes the attribution label an explicit MAY; deliberately not pinned by tests.
- FINDING-003 (LOW, ux — empty-string `resolution` rendered a dangling `— resolution:` label) —
  display guard tightened to `resolution !== null && resolution !== ''`; TEST-724's F-EMPTY vector
  pins the no-affix rendering.
- FINDING-004/006/010/013 (MEDIUM/LOW, data-provenance/doc-drift/determinism/quality — the
  fixture-provenance record named the stale spec-time plugin version 0.30.0 while the fixtures were
  actually produced by 0.32.0) — resolved at the root via ESC-001: REQ-105/REQ-108 amended to pin
  the producer's observable contract with the release/commit as a generation-time recorded fact;
  TEST-719 re-pinned to a version-agnostic shape; CHANGELOG reworded to lead with 0.32.0/`1c59d74`.
- FINDING-005/012 (HIGH, doc-drift/quality, contract violation — `CLAUDE.md:179`'s "(intake…human)"
  parenthetical was an unreconciled prose mirror the literal-array CONV-023 greps couldn't catch) —
  fixed to "(intake…human-review)"; frozen TEST-720 encodes the prose-phrasing scan going forward.
- FINDING-007 (MEDIUM, doc-drift — `docs/features/orky-pane.md` didn't document the v2 resolution
  display) — new REQ-113 → TASK-121 added the "v2 resolution display" section; TEST-721 pins it.
- FINDING-008 (HIGH, devils-advocate, contract violation — REQ-105/REQ-108's literal 0.30.0 pin was
  already stale at spec freeze) — same ESC-001 fix as FINDING-004/006/010/013.
- FINDING-009 (LOW, doc-drift — `04-tests.md`'s pre-amendment "TASK-103, implementer" phrasing
  contradicted the tests-phase execution record) — reworded in place at doc-sync, marked superseded
  by the amendment banner and execution record; verified no other actor contradiction remains.

## Not applicable / no action

None — every finding in `findings.json` is accounted for above (resolved in-feature or deferred
here).
