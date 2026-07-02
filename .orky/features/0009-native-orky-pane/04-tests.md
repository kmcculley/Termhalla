# 0009 — Native OrkyPane pane type — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (REQ-001…REQ-022) and `03-plan.md`
(TASK-001…TASK-020). All test files below are **FROZEN once the tests gate passes (ADR-009)** — the
implementer makes them pass without editing them. Test IDs continue the project-wide TEST-NNN
sequence from the repo maximum **TEST-374** (0006's review-loopback end, verified by repo-wide
grep) at **TEST-375**, running through **TEST-445** (71 ids: 67 vitest + 4 Playwright e2e).

The test designer is a different actor from the implementer (the integrity boundary). No production
code (`src/`) was written by this phase — only test files under `tests/`, this document, the
`traceability.json` update, and the REQ-003/TASK-019 frozen-guard amendments recorded below.

## Harness constraint honored (03-plan.md "Testability constraint")

`vitest.config.ts` is `environment: 'node'`, `include: tests/**/*.test.ts` — no jsdom. Pure modules
and main-process code are driven directly (Electron mocked per the register-registry precedent;
real temp-dir `.orky/` fixtures per the orky-root-engine precedent, including the REAL bytes of
this repo's own `.orky/features/0006-decision-queue-panel/` ledger for REQ-007). Component/store
REQs are pinned two ways: plain-object slice tests (the F6 registry-slice harness pattern) and
source-scan tests over LITERAL greppable testids/aria/import sites (the 0006 pattern — implementers
MUST keep every spec-pinned literal greppable). e2e (`tests/e2e/orky-pane.spec.ts`, NOT in the
`npm test` gate) covers what only a real renderer proves — including REAL keyboard vectors (the F6
TEST-372 loopback lesson: activation is proven with key presses, never only `.click()`).

## Chosen contracts (prose-only in spec/plan — these tests freeze them)

The spec's Public interface block is matched exactly (`OrkyConfig`, `OrkyRootDetailResult` et al.,
`sameProjectRoot`, `isBlockingFinding`, `CH.registryDetail`/`CH.registryRootChanged`,
`registryDetail`/`onRegistryRootChanged`). Where seams were prose-only, this suite pins the
simplest contract consistent with the prose and the codebase's conventions:

1. **`src/main/orky/orky-root-detail.ts`** (TASK-006's sibling-assembler option) exports
   - `assembleOrkyRootDetail(root: string, opts: { now: () => number; retryDelayMs?: number }): Promise<OrkyRootDetailResult>`
     — pure function of (disk bytes, injected clock); `retryDelayMs` defaults 150 (the watcher's own
     stability threshold) and is injectable so the torn-read vectors run fast;
   - `capFeatureSlugs(slugs: string[]): { slugs: string[]; capped: boolean }` — the PURE
     sort-before-cap seam (codepoint sort, then the 200 cap; REQ-008a/REQ-014's shuffle vectors
     drive it directly, mirroring how FINDING-006's determinism demand is testable without mocking
     `readdir`).
2. **`OrkyRegistry`** gains `detail(root: unknown): Promise<OrkyRootDetailResult>` (membership
   validation lives INSIDE it — the addRoot/removeRoot precedent of the registry owning argument
   validation) and `onRootChanged(cb: (root: string) => void): () => void` (rides the EXISTING
   `engine.onStatus` subscription; no new consumer).
3. **`registerRegistry(registry, send, isKnownWindowSender?)`** keeps its signature; it additionally
   registers `ipcMain.handle(CH.registryDetail, …)` (sender-gated: unknown sender → structured
   `{ok:false, errorKind:'unknown-sender'}` and `registry.detail` NEVER invoked) and subscribes
   `registry.onRootChanged(root => send(CH.registryRootChanged, root))`; its disposer removes the
   new handler and unsubscribes.
4. **`src/renderer/store/orky-pane-slice.ts`** exports `createOrkyPaneSlice(deps)` with deps
   `{ set, get, registryDetail, caseFold, updatePaneConfig }` (fold mode derived ONCE via
   `caseFoldFromPlatform(navigator.platform)` at composition and INJECTED — the slice never reads
   ambient platform state), returning `{ fetchOrkyDetail, notifyOrkyRootChanged, setOrkyPaneHidden,
   rebindOrkyPane }` over state `orkyPaneDetail: Record<paneId, { root, detail, error, inFlight,
   pendingRefetch, stale, hidden }>`. `setOrkyPaneHidden` is the displayed/hidden boundary hook the
   `MinimizedPaneHost` wiring drives (REQ-010 T3).
5. **`dispatchAddPane(s, wsId, kind, openFolder, pickOrkyRoot?)`** — the orky branch takes ONE
   injected api-free picker callback (CONV-006, the explorer/`openFolder` pattern); `PaneActions`
   gains `addOrky(wsId, target, dir, root, splitDir?)` mirroring `addExplorer`'s shape.
6. **`SplitMenu`** renders the fourth kind via the existing `kindButton('orky')` template (which
   yields the spec-pinned `split-kind-orky-<paneId>` testid).

## Suite map

| File | TEST ids | REQs | What it pins |
|---|---|---|---|
| `tests/shared/orky-pane-migration.test.ts` | TEST-375…384 | REQ-002, REQ-020, REQ-001, REQ-003 | SCHEMA_VERSION===8; v6/v7 determinism; v8 orky byte-identical round-trip; idempotence fixpoint; v9 rejection; v7 app-state loads; malformed-root coercion (42/absent→''); mixed malformed+well-formed; template/move/minimize opacity; the repo-wide `toBe(7)` residual sweep |
| `tests/shared/orky-pane-same-root.test.ts` | TEST-385…388 | REQ-005 | `sameProjectRoot` equality vectors (win32/posix, trailing/mixed separators, UNC), case-fold iff injected, EQUALITY-not-prefix (`TermhallaX`), module purity + `caseFoldFromPlatform` single-definition reuse |
| `tests/shared/orky-status-blocking.test.ts` | TEST-389…391 | REQ-007, REQ-013, REQ-015 | `isBlockingFinding` vectors incl. the `contract_violation` OR-branch (open-MEDIUM+cv TRUE, resolved-cv FALSE); `openBlockingCount` equivalence over generated vectors AND the real 0006 ledger; delegation source assertion |
| `tests/main/orky-root-detail.test.ts` | TEST-392…399 | REQ-007, REQ-014, REQ-013 | REAL-0006-bytes payload field-by-field (gates canonical order, tokens/evidence/external, findings FILE order + shared predicate, escalations verbatim, activeFeature basename, computedAt = injected clock); synthetic unrecorded/external/resolved-escalation; malformed totality; tz-safety; same-clock determinism; codepoint (not locale) feature sort; engine-aggregate no-contradiction UNDER the same clock + the popover-omission pin; assembler imports the shared pipeline (no local predicate/localeCompare) |
| `tests/main/orky-root-detail-bounds.test.ts` | TEST-400…408 | REQ-008, REQ-014, REQ-013 | `capFeatureSlugs` 100-shuffle determinism; 201-dir sorted survivor set + warn; torn-`state.json` repaired-before-retry succeeds; stays-torn → `skippedFeatures` + coverage invariant (never silently shorter); torn `findings.json` → `findingsUnreadable` with gates/escalations intact + garbage `active.json` → null; oversized → skip with NO retry wait + warn; symlink skip; `orky-missing` naming the path vs empty-tree `ok:true []`; byte-identical tree + no-watcher/no-write source scan |
| `tests/main/register-registry-detail.test.ts` | TEST-409…414 | REQ-006, REQ-022 | exact channel names + the EXACT post-F9 seven-member `registry:*` set (header names the sanctioned amendment path per proposed convention #1); handle() registration + raw-arg delegation; unknown-sender structured rejection with `registry.detail` never invoked; `onRootChanged` → `send(CH.registryRootChanged, root)` bare-string payload; disposer removes handler + unsubscribes (exact removed set); preload invoke/pushChannel bridges + pull-channel-never-broadcast scan |
| `tests/main/orky-registry-detail-membership.test.ts` | TEST-415…419 | REQ-006, REQ-008, REQ-013, REQ-022 | member → `ok:true`; non-member/non-string → `root-not-tracked` NAMING the input; normalized-key (slash + win32-case) membership; no new engine consumer + byte-identical tree + deleted-`.orky/` → `orky-missing`; `onRootChanged` per completed re-read incl. roll-up-invisible findings edit + null-status vanish emit + unsubscribe |
| `tests/renderer/orky-pane-slice.test.ts` | TEST-420…427 | REQ-010, REQ-011, REQ-016, REQ-005, REQ-017, REQ-022 | T1 fetch/settle; 3-notifications-in-flight → ONE coalesced follow-up; other-root notification → zero fetches/zero writes/reference-stable; hidden→stale→restore-fetches-once (and restore-without-stale fetches zero); mid-flight rebind discards the stale settle (latest root wins) + `updatePaneConfig` persistence; failed refresh retains stale-but-valid detail with error surfaced; fold-injected fan-out matching + unbound-never-fetches; `clearPaneRuntime` prunes `orkyPaneDetail` |
| `tests/renderer/orky-pane-structure.test.ts` | TEST-428…439 | REQ-009, REQ-011, REQ-012, REQ-007, REQ-010, REQ-015, REQ-014, REQ-005, REQ-013, REQ-004, REQ-001, REQ-018, REQ-019 | five state testids + `data-root` + unbound copy + native rebind button; row identity/actions-slot/gates/findings/escalations testids; no renderer clock/timer + `phase ??`; no re-derivation + `compareOrkyFeatures` imported + no localeCompare; `caseFoldFromPlatform(navigator.platform)` call path + no `process`; scope-guard sweep over the five F9 files; picker 4-state + no `registryRoots(`; palette/add-pane/PaneKind affordances; `kindButton('orky')` compass; PaneTile/MinimizedPaneHost switches; a11y (no `role="button"`, `aria-expanded`, `tabIndex`, `:focus-visible` coverage); theme-var + hex-fallback scan |
| `tests/renderer/orky-pane-ops.test.ts` | TEST-440 | REQ-004, REQ-001 | `dispatchAddPane('orky')`: picker selection commits `addOrky` with the root VERBATIM; cancel commits nothing; `openFolder` never consulted; explorer path unchanged |
| `tests/docs-feature-0009.test.ts` | TEST-441 | REQ-021 | feature doc content, CLAUDE.md link, CHANGELOG explicit v7→v8 + pane kind, no stale living-doc claims |
| `tests/e2e/orky-pane.spec.ts` | TEST-442…445 | REQ-004, REQ-009, REQ-002, REQ-005, REQ-001, REQ-011, REQ-018 | palette→picker→bound pane rendering BOTH rows (incl. popover-omitted clean-done); relaunch round-trip (saved file `schemaVersion: 8`, root byte-verbatim); unbound state naming the root + KEYBOARD Tab/Enter re-bind; keyboard-ONLY creation + Escape-commits-nothing |

## RED-state verification (tests gate evidence)

Full `npm test` run at design time (SCHEMA_VERSION still 7; no F9 production code):

- **All 46 new vitest defect-pinning tests fail** — module-not-found for the four not-yet-existing
  modules (`orky-pane.ts`, `orky-root-detail.ts`, `orky-pane-slice.ts`, the two components),
  assertion failures for the missing exports/channels/branches. No test fails for a harness or
  syntax reason.
- **Deliberately GREEN new tests (already-true invariants, kept as regression pins):** TEST-376,
  TEST-379, TEST-380 (existing migration behavior that MUST stay byte-identical), TEST-383 (the
  kind-generic machinery already treats configs as opaque — the REQ-001 claim exercised), TEST-384
  (the residual sweep — true as of this change, enforced from now on), and TEST-441's
  no-stale-claim guard.
- **The six re-pinned frozen guards are RED** (they now pin `SCHEMA_VERSION === 8` while the
  constant is still 7) — CORRECT: they go green in the same implementation change that lands
  TASK-003's bump, exactly like 0003's own TEST-001 ran red before its 6→7 bump.
- **The three DISCOVERED amendments (below) are GREEN now and stay green** after F9 lands
  (open-form).
- Everything else in the suite is green (`registry-no-renderer-ui.test.ts` TEST-362/363 pass
  byte-unchanged, as the spec requires).

## REQ-003 / TASK-019 — frozen point-in-time-guard supersession log (CONV-019)

All amendments below were made by the TEST-DESIGNER, in the SAME change that introduces F9's suite,
never during implementation. Each amended file carries an in-file supersession note naming feature
0009 and REQ-003.

### The spec's definitive six (REQ-003's inventory, FINDING-001)

| Guard | File:line (pre-amendment) | Owner | Amendment |
|---|---|---|---|
| TEST-344 | `tests/renderer/decision-queue-panel-structure.test.ts:26-27` | F6 REQ-001/REQ-017 | Closed `PaneConfig` union regex re-expressed OPEN-FORM (three original members must head the union; later `*Config` members may append) + an explicit no-decision-queue-config scan; `SCHEMA_VERSION` re-pinned `7 → 8`. Still FAILS on removal of an original member (regex head) or an injected decision-queue kind (the pane-ops/types scans). |
| TEST-001 | `tests/shared/minimize-persistence.test.ts:25` | 0003 REQ-009 | Bare `toBe(7)` re-pinned to `toBe(8)`; title + note record 0003's 6→7 as historical fact and 0009 as the sanctioned bump. The v6→v7 migration semantics tests are untouched. |
| TEST-020 | `tests/shared/orky-status.test.ts:405` | 0004 REQ-018 | Re-pinned to `toBe(8)` + note ("0004 persisted nothing" is historical fact its remaining assertions capture). |
| TEST-087 | `tests/main/orky-registry-store.test.ts:107` | F5 REQ-013 | Re-pinned to `toBe(8)` + note; the `version:1` own-file invariant untouched. |
| TEST-038 | `tests/main/orky-osc-structural.test.ts:177` | 0014 REQ-017 | Re-pinned to `toBe(8)` + note. |
| TEST-008 | `tests/main/quick-store-toasts.test.ts:42` | 0001 REQ-007 | Re-pinned to `toBe(8)` + note (its own header already anticipated later bumps). |

### DISCOVERED at test design — three additional point-in-time collisions (same trap class, missed by the spec's SCHEMA_VERSION-targeted grep; amended under the SAME CONV-019 protocol, flagged for the coordinator)

The spec's FINDING-001 grep targeted the pinned literal (`toBe\(7\)`), union pins, and
kind-enumeration sweeps — it did not sweep for closed-set pins over the **`registry:*` channel
family** or the **registrar's fake-registry surface**, all three of which REQ-006/REQ-022's two
mandated channels break deterministically:

| Guard | File:line (pre-amendment) | Owner | Collision | Amendment |
|---|---|---|---|---|
| TEST-069 | `tests/shared/registry-ipc-contract.test.ts:26` | F5 REQ-022 | `expect(registryValues.length).toBe(5)` — a closed COUNT of the registry:* family | Open-formed to `arrayContaining` of F5's five (their exact values stay pinned in TEST-068); the exact post-F9 set is pinned in F9's own TEST-409, whose header names the sanctioned amendment path for the NEXT extension (proposed convention #1). Green before and after F9. |
| TEST-358 | `tests/renderer/app-queue-wiring.test.ts:42-45` | F6 REQ-003/REQ-017 | `toEqual([exactly F5's five])` | Open-formed to `arrayContaining`; title re-scoped to F6's still-true intent ("F6 itself added no IPC"). Green before and after F9. |
| TEST-133…138 (surface) + TEST-138 (assertion) | `tests/main/register-registry.test.ts:36-48, 103-105` | F5 REQ-008…REQ-022 | The fake registry lacks `onRootChanged`/`detail` (the registrar's unconditional `registry.onRootChanged(...)` call would crash EVERY test in the file), and TEST-138 pins the disposer's removed-handler set CLOSED (four members) | `makeFakeRegistry` gains tolerant `detail`/`onRootChanged` members (unused by the current registrar — green today); TEST-138's removed set open-formed to `arrayContaining` of the F5 four; the exact post-F9 removed set is pinned in F9's TEST-413. |

### REQ-003 residual acceptance

TEST-384 encodes the repo-wide `toBe\(7\)` sweep over `tests/**` (`.test.ts` + `.spec.ts`) as a
standing guard: zero hits outside the two documented unrelated literals
(`tests/renderer/pane-focus-seq.test.ts:30` — a focus-sequence counter;
`tests/shared/orky-status.test.ts:99` — `ORKY_AUTONOMOUS_PHASES.length`), and those two must still
exist. Verified green at design time.

## No new absence-of-consumer guard (REQ-013's explicit instruction)

Recorded per the spec: F9 is itself the `registry:detail` consumer, so CONV-019's naming rule has
no new absence guard to bind — none is frozen. REQ-013's read-only scope is enforced positively
instead (TEST-408, TEST-418, TEST-433, plus the e2e byte-identical invariant inside TEST-418's
fixture assertions and the `.orky/`-untouched checks).

## Coverage confirmation

Every REQ-001…REQ-022 carries ≥1 TEST in `traceability.json` (updated in this change). REQ-003's
`tests` array lists the six amended guards + TEST-384 + the three discovered amendments' ids
(TEST-069, TEST-358, TEST-138).

## Loopback: FINDING-010 (tests-phase fixture defects, fixed at the implement gate)

Three phase-4 defects blocked the implement gate independent of implementation correctness; fixed
surgically with every test's pinned property preserved:

1. `tests/renderer/orky-pane-structure.test.ts:184` — one-character syntax error (`] as const {`
   missing the closing paren before the block) prevented TEST-428…439 from ever executing. Fixed
   to `] as const) {`; all 12 tests now run and pass against the existing implementation,
   confirming the implementer's out-of-band mirrored evidence.
2. TEST-397 (`tests/main/orky-root-detail.test.ts`) — the fixture seeded case-only-distinct dirs
   (`b-feat`/`B-feat`) that collapse into ONE physical directory on case-insensitive NTFS/APFS.
   Re-fixtured with codepoint-distinct names (`B-feat`, `a-feat`, `b2-feat` → expected
   `['B-feat','a-feat','b2-feat']`); the pinned property — deterministic codepoint sort with
   uppercase before lowercase, never localeCompare — is unchanged.
3. TEST-401 (`tests/main/orky-root-detail-bounds.test.ts`) — same trap at scale: 201 case-colliding
   seeds (`F-NNN`/`f-NNN`) materialized as only 101 physical dirs, so `featuresCapped:true` was
   unreachable. Re-fixtured with 201 genuinely distinct slugs (`f-000`…`f-200`; codepoint-last
   `f-200` is the dropped survivor). The sort-before-cap survivor-set property is intact, and the
   mixed-case ordering property remains pinned in memory by the pure-seam twin TEST-400 (noted in
   the fixture comment).

Lesson: fixtures that materialize paths on disk run on whatever filesystem hosts CI/dev — names
that differ only by case are the same file there, so case-sensitivity properties belong in pure
in-memory seams (TEST-400), not on-disk trees.

propose CONV: On-disk test fixtures MUST NOT rely on case-only-distinct paths; any
case-sensitivity property must be exercised through a pure in-memory seam instead.

## Loopback 2 — ESC-001 review→spec→tests (2026-07-02): the amended contracts pinned RED

Executed against the AMENDED `02-spec.md` (ESC-001 resolution: FINDING-013/020/031's corrected
displayed/mount model + trigger×state matrix, FINDING-021's wire `slug`, FINDING-032's
every-instantiation-path coercion, FINDING-027's compass loading copy, FINDING-024's gate-`at` +
header-stall acceptance, FINDING-025's theme-var validity guard, FINDING-028's non-ENOENT
unreadability, FINDING-029's re-bind clearing/root-guard, FINDING-033's documented skew class).
TEST ids continue from the repo max **TEST-445** → **TEST-446…TEST-467** (22 ids: 19 vitest + 3
Playwright e2e).

### New files

| File | TEST ids | REQs | What it pins (RED driver) |
|---|---|---|---|
| `tests/renderer/orky-pane-hidden-hosts.test.ts` | TEST-446…450 | REQ-010, REQ-011, REQ-017 | 446: STRUCTURAL — workspace activity threads into OrkyPane's `hidden` (PaneTile passes `hidden={…}` or the pane derives from `activeId`; FINDING-013). 447: slice call-counts — hidden pane sustains 0 fetches through N≥3 notifications, activation fetches 1 iff stale (GREEN retention: the slice seam is already correct; the defect is the wiring 446 pins). 448: settle-while-hidden converts `pendingRefetch`→`stale`, issues nothing; unbound-at-settle dropped (FINDING-031). 449: re-bind = exactly 1 fetch AND clears the held detail/error so the previous root's payload is never renderable as the new root's, incl. after a FAILED new-root fetch (FINDING-029). 450: STRUCTURAL — the mount/bind effect consults the surviving entry via `getState()` (the spec-pinned CONV-021 mechanism; FINDING-020's restore-remount discipline). |
| `tests/renderer/orky-pane-display-contract.test.ts` | TEST-451…456 | REQ-009, REQ-012, REQ-010, REQ-004, REQ-018 | 451: gate rendering consumes the carried `.at` (FINDING-024), renderer-clock ban re-asserted. 452: header carries the payload's stall wording (`'stalled'` discrimination; FINDING-024). 453: rows/keys/disclosure/`data-feature` key on `.slug`, bans `s.feature` keying (FINDING-021). 454: held payload root-guarded — ≥2 `sameProjectRoot(` sites + `detail.root` read (FINDING-029). 455: SplitMenu distinguishes `registrySnapshot === null` loading wording from the held-`[]` empty wording (FINDING-027). 456: picker activation keys are `e.target`-guarded, Escape stays dialog-wide (FINDING-023). |
| `tests/main/orky-root-detail-statfail.test.ts` | TEST-457…458 | REQ-008 | Non-ENOENT fs failures (EACCES/EPERM) on EXISTING files are UNREADABLE, never absence (FINDING-028): 457 state.json → `skippedFeatures` + coverage invariant, ENOENT control stays a non-feature; 458 findings.json → `findingsUnreadable:true` with gates intact, absent-findings control stays false. The fs seam mocks `stat`+`open`+`readFile` for the marked paths so the pin holds for any read strategy (incl. a future fd-based FINDING-012 fix) — the contract is errno classification. |
| `tests/shared/orky-pane-template-coercion.test.ts` | TEST-461 | REQ-020 | `workspaceFromTemplate` on a hostile template (`root: 42` / root absent) instantiates unbound (`''`), no throw, no dropped pane; well-formed sibling verbatim (FINDING-032 — the second persisted instantiation path). |
| `tests/renderer/theme-var-validity.test.ts` | TEST-462…463 | REQ-019 | 462: the GENERALIZED theme-var validity scan, REPO-WIDE over `src/renderer/**/*.{ts,tsx,css}` — every `var(--x…)` must be an established token (theme.ts's var-map keys ∪ names appearing in index.css). 463: F9-scoped status-token fallback byte-match (`--status-needs`→`#ff8f00`, `--status-failure`→`#c62828`, `--status-busy`→`#1e88e5`) + no unknown `--status-*` name (FINDING-025). |

### Amended phase-4 files (every touch + reason, CONV-019 discipline)

| File | Change | Reason |
|---|---|---|
| `tests/main/orky-root-detail.test.ts` | TEST-392 gains `expect(slugOf(f)).toBe(REAL_SLUG)` (+ a tolerant `slugOf` accessor so the suite type-checks pre-amendment); NEW TEST-459 (duplicate-`feature`-field fixture → two entries, distinct slugs byte-equal to dir names) and TEST-460 (total payload order: feature codepoint + slug codepoint tiebreak, deterministic across reads) added in a new describe. Header notes the amendment. | The amended REQ-007/REQ-014 wire shape carries `slug` (FINDING-021) — TEST-392's "field-by-field" claim must include it; the duplicate-feature and tiebreak vectors are new amended acceptance. TEST-392 goes RED by design (the shipped payload has no `slug`); TEST-393…399 stay green untouched. |
| `tests/e2e/orky-pane.spec.ts` | NEW TEST-464 (picker FULL keyboard matrix: Enter on Tab-focused Cancel commits NOTHING; Enter on a Tab-focused NON-default option commits THAT option), TEST-465 (compass→orky→direction→picker→Escape commits nothing AND leaves focus on the split trigger — CONV-020 close-half end-to-end, the FINDING-026 class), TEST-466 (background-workspace churn → activation refresh renders the new feature — REQ-010/REQ-022's healing half). Appended; TEST-442…445 byte-untouched. | FINDING-023's real keyboard behavior and FINDING-026's close-time focus are only observable in a real renderer; TEST-466 covers the amended DoD's background-workspace e2e line. NOTE: e2e is not in the `npm test` gate, so these are design-time RED-by-construction against the shipped defects (464: the container handler commits `memberRoots[sel]`; 465: `Modal`'s deferred `refocusActivePane` yanks focus to the terminal), not run-verified in this loopback. |
| `tests/docs-feature-0009.test.ts` | NEW TEST-467: the feature doc must record the accepted cross-FILE read-skew class and its notification-driven healing. TEST-441 untouched (still green). | The amended REQ-008 (FINDING-033) makes this doc content MANDATORY ("REQ-021's feature doc MUST record this property and its healing mechanism"). RED until doc-sync adds it. |

Untouched by design: `tests/renderer/orky-pane-slice.test.ts` (TEST-420…427 remain valid and green
under the amended spec — the new settle-while-hidden / re-bind-clear branches are pinned as NEW ids
TEST-448/449 rather than edits, so the retained pins' green state stays legible),
`tests/renderer/orky-pane-structure.test.ts`, `tests/main/orky-root-detail-bounds.test.ts`, and all
other features' frozen files (no finding required touching any).

### RED/GREEN verification (tests gate evidence, 2026-07-02)

Full `npm test`: **1248 tests — 1229 passed, 19 failed**, the failures being EXACTLY the intended
defect pins and nothing else (fail set: orky-pane-hidden-hosts 4, orky-pane-display-contract 6,
orky-root-detail-statfail 2, orky-root-detail 3 [amended TEST-392 + new TEST-459/460],
theme-var-validity 2, orky-pane-template-coercion 1, docs-feature-0009 1 [TEST-467]). Every failure
was inspected: each fails on the pinned defect's own assertion (e.g. TEST-448 "spy called 2 times",
TEST-457 "[] to equal ['eacces-feat']", TEST-461 "root stays 42"), never a harness error.
Deliberately GREEN new pin: TEST-447 (the slice seam's hidden counts are already correct — the
FINDING-013 defect lives in the WIRING, which TEST-446 pins RED). All previously-green suites,
including every other feature's frozen tests, pass unchanged (1229 = the pre-loopback green count:
TEST-392 moved green→intended-RED, TEST-447 added green).

### Scope notes and non-pins (recorded for the coordinator)

1. **TEST-462's establishment rule, stated honestly:** "established" = named in `theme.ts`'s
   emitted var map OR appearing anywhere in `index.css`. A stricter declared-only rule was tried
   first and FAILS on pre-existing non-F9 tokens: `--status-failure` (referenced index.css:59,65)
   and `--status-needs-input` (DecisionQueuePanel.tsx:158, StatusBar.tsx:110, index.css:311-312)
   are never DECLARED anywhere — they always render their fallbacks and no theme override can reach
   them. The spec itself designates `--status-failure` as THE token F9 must use (REQ-019), so the
   scan must accept it; the two undeclared-but-established tokens are flagged here as an upstream
   (F5/F6-era) observation, outside F9's diff. Under the established-name rule the repo-wide scan
   was verified green on ALL non-F9 files; its only offender is F9's dead `--status-fail`.
2. **FINDING-011 (leaf-file lstat) — NOT pinned:** the amended REQ-008 mandates only the
   feature-DIR symlink skip; no leaf-file symlink discipline is spec-mandated, and inventing a pin
   would freeze an unmandated design. If the implementer takes the cheap fix per ESC-001, it lands
   untested-by-freeze (or the spec gains it in a later amendment).
3. **FINDING-014/034 (REQ-016 one-render-on-settle) — NOT pinned:** REQ-016's acceptance is a
   component render-count, which the node-env harness cannot observe, and the amended spec pins no
   slice-level bookkeeping seam for it (both sanctioned fixes — closure-map bookkeeping vs a
   narrower component subscription — are slice-invisible in opposite ways). Pinning entry-reference
   counts would forbid one sanctioned fix. Remains a documented residual per ESC-001.
4. **FINDING-016 (memo'd row) / FINDING-015 (generations pruning) — NOT pinned:** implementation
   hygiene, no spec-pinned observable; ESC-001 allows them as documented residuals.
5. **Component-lifecycle limits:** the REAL remount fetch-count vectors (REQ-010's "driven through
   the real component lifecycle") cannot execute under the node harness (no jsdom; `.test.ts` only).
   Per the coordinator's direction they are pinned as (a) the spec-named structural mechanisms
   (TEST-446/450), (b) slice-seam call counts for every drivable matrix cell (TEST-447/448/449 +
   retained TEST-420…424), and (c) e2e behavior (TEST-464…466, not in the npm gate). If the harness
   ever gains jsdom, the matrix's remount vectors should be re-encoded as real mounts.

propose CONV: A keep-mounted-but-hidden host added ANYWHERE in the renderer (minimized host,
inactive-workspace host, future overlay hosts) MUST thread its hiding into every pane-kind runtime
gate that keys on effective visibility — and the gate's tests MUST enumerate all such hosts, not
the one that existed when the gate was written.

## Loopback 3 (FINDING-035, maximized-over host)

Coordinator-applied, reviewer-specified (devils-advocate re-verification): the amended REQ-010 gained the THIRD keep-mounted-but-hidden host (maximized-over via .ws-max); TEST-468 (tests/renderer/orky-pane-maximize-hidden.test.ts, new file) structurally pins PaneTile's self-excluded maximized-over derivation and the two-term hidden threading. Fix: one selector + one condition in PaneTile.tsx. Green immediately (post-implementation loopback, same posture as Loopback 1).
