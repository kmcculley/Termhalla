# Native Orky pane (Orky 0009) — Review Follow-ups (deferred)

Feature `0009-native-orky-pane` shipped after Termhalla's longest F-cycle to date: a spec revised
once pre-gate (FINDING-001…009), a tests-phase fixture loopback (FINDING-010), a seven-lens review
that filed 24 findings (8 blocking) against a green 1229-test implementation, a review→spec→tests
loopback (ESC-001) that rewrote the pane's mount/visibility model and re-derived every gate green,
and a third, narrower mini-loopback (FINDING-035) that added a THIRD hidden host the amended spec
had still missed. See the per-finding records in
`.orky/features/0009-native-orky-pane/findings.json` and the full narrative (including every
loopback's RED/GREEN evidence) in `.orky/features/0009-native-orky-pane/04-tests.md`.

## Review timeline

1. **Spec-gate devils-advocate pass:** filed FINDING-001…009 (7 HIGH/MEDIUM, 2 LOW) against the
   draft spec — an incomplete frozen-guard inventory (a sixth `SCHEMA_VERSION===7` pin missed by
   the draft's grep), a self-contradictory REQ-007/REQ-015 acceptance pair, a closed trigger set
   that could go stale forever on the exact data class the pane exists to add (the root of the
   later FINDING-003 lineage), an unpinned torn-read behavior, an over-broad no-contradiction
   claim across two independently-clocked reads, enumeration-order-dependent cap selection, a
   missing `contract_violation` field in the pinned findings.json shape, a missing split-compass
   creation affordance, and underspecified root-picker boundary states. All 9 resolved in place
   before the tests phase (REQ-002/003/004/005/007/008/009/010/013/014/015 all gained text).
2. **Tests-phase fixture loopback (FINDING-010):** three defects blocked the implement gate
   independent of implementation correctness — a one-character syntax error that silently
   prevented TEST-428…439 from ever executing, and two on-disk fixtures (TEST-397, TEST-401) that
   seeded case-only-distinct directory names (`b-feat`/`B-feat`; 201 `F-NNN`/`f-NNN` pairs) which
   collapse onto ONE physical directory on a case-insensitive filesystem (NTFS/APFS) — silently
   making the pinned properties (a 3-feature sort, `featuresCapped:true` at scale) unreachable.
   Fixed surgically, preserving every pinned property; full suite 1229/1229 green. **Lesson:**
   fixtures that materialize paths on disk run on whatever filesystem hosts CI/dev, where
   case-only-distinct names are the same file — case-sensitivity properties belong in a pure
   in-memory seam instead. Promoted as **CONV-027**.
3. **Seven-lens review of the implementation** (security, performance, quality, ux, determinism,
   devils-advocate, codex-cross-check) against a green 1229-test build: **24 findings**, 8 with
   `contract_violation:true`. The single largest thread was the pane's **mount/visibility model**:
   FINDING-013 (determinism) discovered the amended-in-spec "hidden" boundary named only ONE of
   the renderer's two keep-mounted-but-hidden hosts (the inactive-workspace host was missing
   entirely); FINDING-020 (determinism, HIGH, contract violation) then traced the restore/re-bind
   fetch counts end-to-end and found the mount effect fetched unconditionally on every remount,
   violating REQ-010's pinned trigger counts (0 on a non-stale restore, exactly 1 on a stale
   restore or re-bind — the implementation produced 1 and 2 respectively); FINDING-021
   (determinism) found the payload's row/disclosure/data-feature keys used the NOT-unique
   `status.feature` field instead of the unique dir slug; FINDING-023 (ux, HIGH, contract
   violation) found the root picker's dialog-level key handler was not target-guarded, so Enter on
   a Tab-focused Cancel button committed a pane instead of cancelling; FINDING-024/025 (ux, HIGH,
   contract violations) found REQ-009's mandated gate-`at` timestamp and header stall wording never
   rendered, and the failed-state accent used an undefined `--status-fail` CSS variable that always
   rendered its own novel fallback, unreachable by any theme override; FINDING-028
   (codex-cross-check, MEDIUM, contract violation) found any non-ENOENT stat failure (EACCES/EPERM)
   was misclassified as legitimate absence instead of "torn"; FINDING-029/030 (devils-advocate,
   HIGH, contract violations) found re-bind rendered the PREVIOUS root's held payload under the
   NEW root's identity, and every re-bind issued two fetches, not one; FINDING-032
   (devils-advocate, MEDIUM) found REQ-020's "downstream never sees a non-string binding" guarantee
   covered only the primary workspace loader, not the second persisted instantiation path
   (`quick.json` workspace templates) — a hand-edited template with `root: 42` would crash the
   renderer at `basenameOf`. FINDING-034 merged into FINDING-014; FINDING-017/030 merged into
   FINDING-020; FINDING-022 merged into FINDING-015.
4. **Escalation ESC-001 (human-approved): review→spec→tests loopback.** The blocking findings were
   not implementation bugs alone — several traced back to a spec premise that was simply wrong: the
   draft's amended REQ-010 asserted the renderer had exactly TWO keep-mounted-but-hidden hosts, and
   built the entire mount/fetch trigger model on that count. `02-spec.md` was amended in place
   (REQ-007/009/010/011/012/014/018/019/020 all gained text) to the corrected model — the minimized
   host AND the inactive-workspace host, both hiding via the identical `visibility:hidden` +
   `pointer-events:none` pattern — plus FINDING-021's unique `slug` wire field, FINDING-032's
   every-instantiation-path coercion, FINDING-027's loading-vs-empty compass copy, and FINDING-033's
   documented cross-file read-skew class. `04-tests.md` then added TEST-446…467 (22 ids across 5
   new files) driving every amended acceptance RED against the shipped defects — verified: full
   `npm test` **1248 tests, 1229 passed, 19 failed**, every failure landing on exactly its intended
   defect assertion, nothing else. Implementer fixed all 19 (plus FINDING-011/018/019/023/024/025/
   026/027/028/029/031's addressable half); re-verification closed FINDING-013/020/021/023/024/025/
   026/027/028/029/032/033 and downgraded FINDING-031 from MEDIUM to LOW (the reachable-in-production
   branch is closed; a synthetic-only branch remains — see residuals).
5. **Mini-loopback (FINDING-035, maximized-over — the THIRD hidden host).** Re-verification of the
   FINDING-013 fix by devils-advocate found the amended spec's "exactly two hidden hosts" was
   *itself* still incomplete: `.ws-max` hides every sibling tile with the identical
   `visibility:hidden`/`pointer-events:none` pattern the other two hosts use, but `PaneTile`
   threaded `hidden` from workspace activity alone — an `OrkyPane` sibling of a maximized tile in
   its OWN active workspace sustained a full detail fetch on every own-root notification (up to
   ~3.3/s during a busy run) while the user could not see it. Coordinator-applied, reviewer-specified
   fix: REQ-010 amended to the THREE-host displayed model; `PaneTile` derives a self-excluded
   `maximizedOver` flag from `s.maximized[wsId]` and threads `hidden={wsInactive || maximizedOver}`;
   TEST-468 (`tests/renderer/orky-pane-maximize-hidden.test.ts`) pins both the derivation and the
   threading structurally. Green immediately, same posture as the FINDING-010 tests loopback. **This
   is the spec-premise lesson of the feature**: a spec's enumeration of "every hidden host" was
   wrong TWICE in the same review cycle (first the draft missed the inactive-workspace host
   entirely; then the amendment, written specifically to fix that, missed maximize-over) — the
   defect class is now a standing convention (**CONV-028**) requiring every such gate's OWN tests to
   enumerate every host, not just the ones that existed when the gate was written.
6. **Doc-sync (this pass, 2026-07-02):** reconciled `traceability.json`/`traceability.md` against
   the final 103-test-id, 22-REQ matrix post-three-loopbacks (one gap found and fixed: TEST-468 was
   missing from REQ-010's test list); mechanically verified every one of the 103 referenced TEST ids
   exists as a marker in a real test file; regenerated `traceability.md` in full (REQ/TASK/TEST/Files
   table, was previously a phase-3 planning stub with an empty tests column); updated
   `docs/features/orky-pane.md` to the final three-host displayed model (was written mid-cycle and
   still described two hosts) and to name the `slug` uniqueness discipline (FINDING-021) explicitly
   for row/disclosure/`data-feature` keying; corrected two stale living-doc claims caught by the
   REQ-021-mandated whole-tree grep (CONV-008) — `CLAUDE.md`'s "persisted per-workspace
   (`SCHEMA_VERSION` 7)" phrasing (now distinguishes the historical 0003 migration from the current
   constant, 8) and `docs/features/workspaces.md`'s "all three pane kinds" rename-support claim (now
   names all four, including `orky`); extended `.orky/baseline/architecture.md`'s registry-channel
   note to name the two new F9 read surfaces (`registry:detail`, `registry:rootChanged`) and their
   consumer; filed **FINDING-037** (doc-drift, LOW) for the two pre-existing, undeclared
   `--status-failure`/`--status-needs-input` theme vars TEST-462's repo-wide scan surfaced as a
   byproduct — pre-F9, out of this feature's scope, filed as backlog; promoted **CONV-022 through
   CONV-031** (ten conventions — the most of any feature to date, matching the size of this review
   cycle) from this feature's `propose CONV:` findings.

## Current open-findings residual (non-blocking)

Six pre-existing residuals stay open (not re-litigated by doc-sync) plus the one new doc-drift
finding this pass filed. None is a contract violation; all were reviewed and accepted as deferred
at ship time. Severities are as filed (one downgraded on re-verification, noted).

### MEDIUM

- **`readJsonOnce`'s size bound has a stat/read TOCTOU gap** (FINDING-012,
  `src/main/orky/orky-root-detail.ts:59-69`) — a file small at `stat()` time that grows past
  `MAX_FILE_BYTES` before the immediately-following `readFile()` bypasses the cap. **Recommended
  fix:** open once (`fs.open`), `fstat` the descriptor, enforce the bound against that result, then
  read from the SAME descriptor.
- **Every refresh re-renders the pane TWICE, not once** (FINDING-014, merged with FINDING-034,
  `src/renderer/store/orky-pane-slice.ts:95-104` + `OrkyPane.tsx:49`) — `issue()` patches
  bookkeeping fields (`inFlight`, `pendingRefetch`) into the same store entry the component
  subscribes to, producing a second render pass at issue time that nothing rendered actually
  consumes; REQ-016's "exactly one re-render on settle" acceptance was never encoded as a test (the
  node-env harness cannot count React renders). **Recommended fix:** move fetch-only bookkeeping
  into a slice-closure map beside `generations`, or narrow the component's subscription.

### LOW

- **CONV-011 letter violation: the `generations` Map is never pruned** (FINDING-015, merged with
  FINDING-022, `orky-pane-slice.ts:61`) — behaviorally benign (monotonic, no stale-inheritance
  hazard), growth-only for the renderer's lifetime. **Recommended fix:** prune alongside
  `clearPaneRuntime`'s existing seam.
- **One row's disclosure toggle re-renders the entire feature list** (FINDING-016,
  `OrkyPane.tsx:55,92-174,235`) — no memoized row component; bounded cost, compounds with
  FINDING-014 on busy roots with deep expanded content. **Recommended fix:** extract a
  `React.memo`'d `FeatureRow`.
- **A coalesced follow-up fetch can fire from a hidden pane in a rare mid-flight race**
  (FINDING-031, `orky-pane-slice.ts:91-92`) — **downgraded MEDIUM→LOW on re-verification**: the
  headline branch (a notification-while-hidden follow-up) is fixed (settle's tail converts it to
  `stale:true`, TEST-448); the residual is a synthetic-only branch (membership loss mid-flight —
  nothing in production ever sets `entry.root` to `''`, so this leg is unreachable via real state
  production) whose test (TEST-448's unbound leg) manufactures the precondition by direct state
  mutation. **Recommended fix:** inject a membership predicate into the slice deps, or propagate
  membership loss into the entry, if the synthetic gap is ever made reachable by a future change.
- **The FINDING-020 restore-fetch fix is fragile at both ends of the remount boundary**
  (FINDING-036, `OrkyPane.tsx:75-83` + `main.tsx:5-7` StrictMode) — (a) React's development-only
  StrictMode double effect invocation defeats the merged mount/hidden effect's `wasHidden`
  evidence, so a non-stale restore fetches once in dev where the matrix pins zero (production is
  unaffected; StrictMode doesn't double-invoke there); (b) no real-lifecycle
  minimize-then-restore vector exists anywhere in the suite — the node-env harness has no jsdom, so
  the pin is structural (`TEST-450`) plus slice-seam counts (`TEST-447/423`) plus e2e
  (`TEST-464…466`, not in the `npm test` gate), never a real component remount with a
  `registryDetail` call-count spy. **This residual is explicitly inherited by F10**: any F10 work
  that touches the same mount/hidden effect boundary, or any future migration to jsdom/Activity/
  offscreen APIs, should close it with (i) a `useRef`-captured `wasHidden` classification immune to
  StrictMode re-invocation, and (ii) the missing real-lifecycle vector.

### Doc-drift (new this pass)

- **FINDING-037 (LOW)** — `--status-failure` and `--status-needs-input` are consumed via `var()`
  across several pre-F9 files (`index.css:59,65,311-312`, `DecisionQueuePanel.tsx:158`,
  `StatusBar.tsx:110`) but never declared in `theme.ts`'s var map — they always render their
  hard-coded fallback and no theme override can ever reach them. Discovered as a byproduct of F9's
  `TEST-462` repo-wide theme-var-validity scan, which had to special-case both as "established"
  (referenced-anywhere, not declared-anywhere) to avoid false-positiving on pre-existing,
  out-of-F9-scope code (`04-tests.md`, Scope note 1). Not F9's to fix — backlog item for whichever
  feature next touches `theme.ts`'s declared var map.

## Promoted to conventions

Ten general lessons from this feature's `propose CONV:` findings were promoted to
`.orky/conventions.md` as **CONV-022 through CONV-031** — the largest single-feature promotion to
date, proportionate to the size of this review cycle:

- **CONV-022** (from the REQ-003 six-guard collision) — a frozen test pinning the CURRENT VALUE of
  a shared, legitimately-evolving global must instead pin an invariant scoped to its own feature.
- **CONV-023** (from FINDING-001) — a spec's "exhaustive enumeration" claim must state its exact
  grep pattern and scope.
- **CONV-024** (from FINDING-003) — a detail view keyed on a lossy summary must have an independent
  currency mechanism for what the summary omits.
- **CONV-025** (from FINDING-006) — a cap/truncation over a filesystem enumeration must apply to a
  deterministically-ordered list, never raw enumeration order.
- **CONV-026** (from FINDING-032) — a load-time coercion guarantee must cover EVERY
  deserialization/instantiation path of the persisted shape, not only the primary loader.
- **CONV-027** (from the FINDING-010 loopback) — on-disk test fixtures must not rely on
  case-only-distinct paths.
- **CONV-028** (from FINDING-013 / FINDING-035) — every keep-mounted-but-hidden host must thread
  into every pane-kind visibility gate, and the gate's OWN tests must enumerate all such hosts.
- **CONV-029** (from FINDING-025) — a theme/status CSS variable consumed by a component must be one
  the theme system actually defines, with that token's standard fallback.
- **CONV-030** (from FINDING-023) — a container-level key handler intercepting activation keys must
  target-guard so a nested control's own activation is never suppressed or redirected.
- **CONV-031** (from FINDING-020) — a trigger/count discipline whose boundary is a component
  lifecycle transition must be tested through the real component lifecycle, not only the
  store/slice seam beneath it.

## Resolved in-feature (not deferred)

FINDING-001…009 (spec gate, all 9), FINDING-010 (tests-phase fixture defects), FINDING-011
(leaf-file symlink guard), FINDING-013 (two-host wiring — superseded by the ESC-001 amendment),
FINDING-017/018/019 (quality dedup/reuse findings — shared hooks extracted), FINDING-020
(restore/re-bind fetch-count contract violation, merged with FINDING-017/030), FINDING-021 (unique
`slug` wire field), FINDING-023 (target-guarded picker keyboard handler), FINDING-024 (gate-`at` +
header stall wording), FINDING-025 (theme-var validity), FINDING-026 (Modal's unconditional
deferred refocus yanking the picker's restored focus), FINDING-027 (compass loading-vs-empty
copy), FINDING-028 (errno classification for torn vs. absent), FINDING-029/030 (re-bind
cross-root render + double-fetch), FINDING-032 (template-instantiation coercion), FINDING-033
(documented cross-file read-skew class), FINDING-034 (merged into FINDING-014), FINDING-035
(the third, maximized-over hidden host) — see `findings.json` for each `resolution` field and the
exact fix commit/test evidence.
