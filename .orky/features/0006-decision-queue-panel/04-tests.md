# 0006 — Decision-queue panel — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (REQ-001…REQ-019) and `03-plan.md`
(TASK-001…TASK-014). All test files below are **FROZEN once the tests gate passes (ADR-009)** — the
implementer makes them pass without editing them. Test IDs continue the project-wide TEST-NNN
sequence from where 0014 left off (TEST-001…TEST-300 already used across the repo, verified by grep)
at **TEST-301**, running through **TEST-367** (67 ids: 64 `vitest` + 3 Playwright e2e).
**Extended at the review→tests loopback (ESC-001)** through **TEST-374** — see the
"Review loopback (ESC-001)" section at the end for the sanctioned frozen-test amendments.

The test designer is a different actor from the implementer (the integrity boundary). No production
code (`src/`) was written by this phase — only test files under `tests/`, this document, and the
`traceability.json` update.

## Harness constraint honored (03-plan.md "Testability constraint")

`vitest.config.ts` is `environment: 'node'` with `include: tests/**/*.test.ts` — no jsdom, no `.tsx`
test files. Per the plan and the 0004 precedent, component/store REQs are pinned two ways:

- **Plain-object slice/selector tests** (`tests/renderer/registry-slice.test.ts`,
  `tests/renderer/pane-focus-seq.test.ts`) drive the pure arbitration/memoization seams directly.
  REQ-008's "zero re-renders on a value-identical push" is asserted at its zustand-observable seam:
  the state REFERENCE must not change (no subscribed component can re-render without a reference
  change), and the memoized `queueGroups` result must keep ITS reference ("`buildDecisionQueue` at
  most once per distinct snapshot reference" ⇔ reference-stable derived groups).
- **Source-scan tests** (`decision-queue-panel-structure`, `statusbar-queue-toggle`,
  `app-queue-wiring`, parts of `keybindings-toggle-queue`) grep the components' literal source for
  the spec-pinned testids / aria attributes / selector call sites. Implementers MUST keep those
  literals greppable (the plan's explicit constraint on TASK-008/009/010/011); the one dynamic
  testid, `decision-queue-group-<root>`, is scanned structurally (`decision-queue-group-` template).
- **e2e** (`tests/e2e/decision-queue.spec.ts`, Playwright against `out/`) covers what only a real
  renderer can prove: the packaged-renderer fold-mode trap (`process` undefined in the main world,
  REQ-009), live badge with the drawer closed, drawer-outside-mosaic, the pane-less fallback spawn,
  the `.orky/` byte-identical invariant, and drawer-closed-on-restart.

## Chosen contracts (prose-only in spec/plan — these tests freeze them)

The spec's "Public interface" block is authoritative and matched exactly (`buildDecisionQueue`,
`decisionQueueCount`, `matchPaneRoot`, `caseFoldFromPlatform`, `compareOrkyFeatures`, the store state
names). Where the spec/plan left internal seams prose-only, this suite pins the simplest contract
consistent with that prose and the codebase's conventions (the 0005/0007 precedent):

1. **`matchPaneRootFromCandidates(candidates, roots, opts): string | null`**
   (`src/shared/decision-queue.ts`) — ~~REQ-009's candidate-order rule as a pure seam: the FIRST
   non-empty candidate (order: live cwd → persisted `config.cwd` → `gitStatus.root`, supplied by the
   caller) that matches ANY member root via `matchPaneRoot` decides; later candidates are never
   consulted; no match → `null`.~~ **AMENDED at the review loopback (FINDING-020 — the original
   phrasing pinned match-FAILURE fall-through, contradicting frozen REQ-009's availability gating):**
   the seam skips INVALID candidates (null/undefined/'') only; the FIRST VALID candidate is
   DECISIVE — match or `null`. Candidate AVAILABILITY per REQ-009's when/ONLY-when conditions is a
   separate pinned pure seam, **`selectPaneCandidates`** — see the Review loopback section.
2. **`selectMruPane(panes: {paneId, workspaceIndex}[], focusSeq): {paneId, workspaceIndex} | null`**
   (`src/shared/decision-queue.ts`) — REQ-009's recency pick: highest `paneFocusSeq` wins; panes
   absent from the map rank last; ties break by workspace order then pane-id codepoint; `[]` → null.
3. **`createRegistrySlice(deps: SliceDeps)`** (`src/renderer/store/registry-slice.ts`) — mirrors the
   existing slice-creator pattern (`createNotesSlice`), returning
   `{ setQueueOpen, setRegistrySnapshot(input: unknown), applyRecoveryPull(input, issuedAtGeneration),
   recoveryPullFailed(), queueGroups(), queueCount() }` over state
   `{ registrySnapshot, registryError, queueOpen, snapshotGeneration }`. `setRegistrySnapshot` is the
   ONE ingestion chokepoint (push AND pull route through it); `recoveryPullFailed()` errors only when
   no valid snapshot is held. Loading is DERIVED (`registrySnapshot === null && registryError ===
   null`), never stored.
4. **`clearPaneRuntime`'s cleared-maps result includes `paneFocusSeq`** — TASK-006's "hook the SAME
   pane-removal cleanup site" made testable: the one existing per-pane cleanup call drops the focus
   rank (CONV-011); no second cleanup path exists to drift.
5. **`compareOrkyFeatures`** is the EXPORTED existing `compareFeatures` — pinned functionally
   (identity with `selectChipFeature`'s pick over shuffled fixtures) and structurally (exactly one
   `needsHuman !== ` comparison in `src/shared/orky-status.ts`, none in `decision-queue.ts`).

## Supersession of TEST-070 (REQ-019 — performed here, at the tests phase)

`tests/shared/registry-no-renderer-ui.test.ts` — F5's frozen D1 scope guard **TEST-070 (F5 REQ-021)**,
which asserted NO `src/renderer/` file references the registry aggregate type or ANY `registry:*`
API surface — is **superseded by F6 REQ-019** in this change, by the test-designer, in the same
commit that introduces F6's suite (never silently during implementation). The file was REPLACED with
a NARROWED guard:

- **Retired:** the read-surface prohibitions (`OrkyRegistrySnapshot`, `OrkyRegistryEntry`,
  `onRegistryStatus`, `registryCurrent(`) — F6 is TEST-070's designated retiring feature (named in
  TEST-070's own header) and its REQ-003 mandates exactly these renderer references.
- **Preserved (TEST-362):** the registry MUTATION surface stays forbidden in `src/renderer/`
  (`RegistryMutationResult`, `registryRoots(`, `registryAddRoot(`, `registryRemoveRoot(`) — REQ-017
  still excludes the "track this project" gesture.
- **Self-test (TEST-363):** the narrowed pattern still flags every injected mutation-surface
  reference and permits every read-surface symbol F6 consumes (REQ-019's acceptance).
- **The replacement guard's own designated retiring feature** (named in its header, per the
  convention this feature's Baseline-fit proposes): the first feature to ship a SANCTIONED
  renderer-side registry-mutation consumer — the "track this project" gesture, currently unowned,
  plausibly F13 Settings or a successor. That feature must supersede the guard at ITS tests phase,
  exactly as F6 did here.

This is the ONLY pre-existing test file this phase touches. `tests/main/*`, `tests/shared/*` (rest),
and every characterization test are untouched.

## Test catalogue

| TEST-ID | REQ(s) | File | Assertion |
|---|---|---|---|
| TEST-301 | REQ-004, REQ-015 | `tests/shared/decision-queue-build.test.ts` | Exactly the `needsHuman` features (all three reasons) are items; busy/done/`status:null` contribute none; item `status` is the fixture object verbatim. |
| TEST-302 | REQ-004 | same | A `persisted`-only root with no pane still contributes items; `source` is never filtered. |
| TEST-303 | REQ-004, REQ-013 | same | Total over `null`/`[]`/all-quiet snapshots → `[]`, never throws. |
| TEST-304 | REQ-005 | same | `projectName` = basename of root (posix AND win32 spellings); `projectRoot` verbatim. |
| TEST-305 | REQ-005 | same | Groups order by top-item rank via the shared comparator (escalation < stalled < human-review). |
| TEST-306 | REQ-005, REQ-006 | same | Comparator-equal tops tie-break by root CODEPOINT (`/x/Banana` before `/x/apple` — never localeCompare). |
| TEST-307 | REQ-005 | same | Within-group order = the `needsHuman` prefix of `status.features` VERBATIM (no re-sort). |
| TEST-308 | REQ-005 | same | `compareOrkyFeatures` export ≡ the chip comparator (identity with `selectChipFeature` over 25 shuffles; single definition; imported, not copied). |
| TEST-309 | REQ-006 | same | Deep-equal snapshots and 100 seeded-shuffled entry orders produce ONE (root, feature) order. |
| TEST-310 | REQ-006 | same | Source scan: no `localeCompare`/`Date.now`/`Math.random` in `decision-queue.ts`. |
| TEST-311 | REQ-007 | same | `decisionQueueCount` = sum of items across groups; 0 for empty/null builds. |
| TEST-312 | REQ-013 | same | Garbage entries / mistyped features contribute nothing, throw nowhere, never break well-formed siblings (CONV-002). |
| TEST-313 | REQ-009 | `tests/shared/decision-queue-match.test.ts` | Equality matches incl. trailing separators, both path flavors, both fold modes. |
| TEST-314 | REQ-009 | same | A pane path beneath a root matches at a segment boundary; returns the member root verbatim. |
| TEST-315 | REQ-009 | same | Sibling-prefix spellings do NOT match, in both directions (`TermhallaX` vs `Termhalla`; `Term` vs `Termhalla`). |
| TEST-316 | REQ-009 | same | UNC roots: beneath `\\server\share\proj` matches; the UNC sibling does not. |
| TEST-317 | REQ-009 | same | Drive-letter root `C:\` contains any path on the drive and matches itself. |
| TEST-318 | REQ-009 | same | Mixed `/`-vs-`\` spellings match WITHOUT case folding (slash-fold unconditional). |
| TEST-319 | REQ-009 | same | Case-divergent spellings match with `caseFold:true`, not with `caseFold:false` (win + posix). |
| TEST-320 | REQ-009 | same | Longest containing member root wins, regardless of roots order (nearest-ancestor semantics). |
| TEST-321 | REQ-009 | same | Total: no member / empty inputs → `null`, never throws. |
| TEST-322 | REQ-009 | same | `caseFoldFromPlatform`: `'Win32'` → true; `'MacIntel'`/`'Linux x86_64'`/`''` → false. |
| TEST-323 | REQ-009 | same | Matcher ≡ `normalizeProjectRoot` fold semantics: host-independent vectors via explicit `path.win32`/`path.posix` (both fold modes) + a host-native check against the real function. |
| TEST-324 | REQ-009 | same | **(AMENDED — review loopback, FINDING-020)** `matchPaneRootFromCandidates`: the FIRST VALID candidate DECIDES (match or null); cwd under R2⊂R1 beats `gitStatus.root===R1`; ancestor-outside-set git root never consulted; null/undefined/'' skipped; a valid non-matching candidate NEVER falls through; none → null. |
| TEST-325 | REQ-002 | `tests/shared/keybindings-toggle-queue.test.ts` | `COMMANDS` contains `toggle-orky-queue` with default chord `mod+shift+o` and a queue-naming label. |
| TEST-326 | REQ-002 | same | The chord is conflict-free vs every existing default (`findConflict` null), a legal rebind, not a reserved digit. |
| TEST-327 | REQ-002 | same | `matchShortcut` dispatches Ctrl+Shift+O to `{type:'toggle-orky-queue'}`. |
| TEST-328 | REQ-002 | same | A rebind is honored; an explicit `'none'` unbinds. |
| TEST-329 | REQ-002 | same | `buildCommandItems()` offers the queue toggle; `CommandPalette.tsx` activates it via `setQueueOpen`. |
| TEST-330 | REQ-001, REQ-017 | `tests/renderer/registry-slice.test.ts` | `setQueueOpen` toggles with NO persistence side effect (session-scoped; starts closed). |
| TEST-331 | REQ-003 | same | A valid snapshot is applied: held, error-free, generation incremented. |
| TEST-332 | REQ-008 | same | A deep-equal (`!==`) push keeps the EXISTING state reference (zero re-renders) and still bumps the generation. |
| TEST-333 | REQ-008 | same | A changed snapshot replaces promptly (no over-memoization). |
| TEST-334 | REQ-013 | same | Malformed payload, no prior snapshot → SPECIFIC error text (never bare "error"), no throw. |
| TEST-335 | REQ-013 | same | Malformed payload after a valid snapshot → stale-but-valid data kept, no error shown. |
| TEST-336 | REQ-013 | same | A following valid snapshot clears the error. |
| TEST-337 | REQ-003, REQ-011 | same | Generation guard: the pull applies when first; a STALE pull settling after a push is DISCARDED (data + reference + generation unchanged). |
| TEST-338 | REQ-011, REQ-013 | same | Pull rejection errors ONLY with no held snapshot, with specific text; never disturbs held data or resurrects loading. |
| TEST-339 | REQ-007, REQ-008 | same | `queueGroups`/`queueCount` memoized on snapshot reference; count = `decisionQueueCount(groups)` (one chain); changed push moves badge+list together 3→2. |
| TEST-340 | REQ-011, REQ-012 | same | Slice-level state matrix: loading/empty/error mutually exclusive; push-first ≡ pull-first; count 0 while loading. |
| TEST-341 | REQ-009 | `tests/renderer/pane-focus-seq.test.ts` | `clearPaneRuntime` deletes the closed pane's `paneFocusSeq` key in the SAME cleanup call (CONV-011). |
| TEST-342 | REQ-009 | same | `selectMruPane`: highest focus sequence wins (P2-then-P1 → P1); never-focused ranks last. |
| TEST-343 | REQ-009 | same | Ties break deterministically: workspace order, then pane-id codepoint; empty → null. |
| TEST-344 | REQ-001, REQ-017 | `tests/renderer/decision-queue-panel-structure.test.ts` | Panel testid exists; no PaneKind/PaneConfig variant; `SCHEMA_VERSION` still 7; not referenced by mosaic components. |
| TEST-345 | REQ-011, REQ-012, REQ-013 | same | `decision-queue-loading`/`-empty`/`-error` testids; "nothing needs you" healthy copy; error renders `registryError`. |
| TEST-346 | REQ-005, REQ-015 | same | `decision-queue-group-<root>` template + `decision-queue-item` + `data-project-root`/`data-feature` identity. |
| TEST-347 | REQ-015 | same | Rows render carried `detail`/`reason`/`phase`/`gateN`/`gateM`; `phase ??` null-guard; NO gate-logic import/copy in panel or queue module. |
| TEST-348 | REQ-014 | same | `role="complementary"` + `aria-label` + `setQueueOpen(false)` close; panel never touches `notesOpen` (coexistence by construction). |
| TEST-349 | REQ-014 | same | A `:focus-visible` rule covers the decision-queue chrome with a visible outline, never `outline: none` (CONV-007). |
| TEST-350 | REQ-016 | same | `var(--panel/--fg-dim/--border)` family; hex literals only inside `var()` fallbacks. |
| TEST-351 | REQ-010 | same | `decision-queue-open-terminal` + `data-project-root`; reuses `launchDir`/`commitPane`; no editor deep-link. |
| TEST-352 | REQ-009 | same | No `process` reference in `decision-queue.ts` or the panel; fold mode = `caseFoldFromPlatform(navigator.platform)`; queue module stays node/Electron/api-free. |
| TEST-353 | REQ-017, REQ-003 | same | The feature's three files exist and contain no `registryAddRoot`/`registryRemoveRoot`/`registryRoots(`/`orkyAction`/`child_process`/persistence hook. |
| TEST-354 | REQ-002, REQ-014 | `tests/renderer/statusbar-queue-toggle.test.ts` | `orky-queue-toggle` is a real button with `aria-expanded` and a `setQueueOpen` toggle, joining (not replacing) search/notes. |
| TEST-355 | REQ-002 | same | Tooltip chord derives from `resolveBindings`/`formatChord`; no hard-coded `Ctrl+Shift+O` (CONV-005). |
| TEST-356 | REQ-007 | same | Badge reads the shared `queueCount` selector only (no `buildDecisionQueue`/`decisionQueueCount` call in StatusBar), gated `> 0`. |
| TEST-357 | REQ-003, REQ-011 | `tests/renderer/app-queue-wiring.test.ts` | ONE `onRegistryStatus` subscription + exactly ONE `registryCurrent()` pull, generation-captured, routed through `applyRecoveryPull`/`recoveryPullFailed`. |
| TEST-358 | REQ-003, REQ-017 | same | No new IPC: the `registry:*` channel set is exactly F5's five; no `src/main`/`src/preload` file knows the feature. |
| TEST-359 | REQ-001 | same | `queueOpen && <DecisionQueuePanel` (mounted only while open), chrome sibling of `NotesPanel`, never inside the mosaic subtree. |
| TEST-360 | REQ-002 | same | The shortcut switch dispatches `case 'toggle-orky-queue'` to `setQueueOpen`. |
| TEST-361 | REQ-007, REQ-011 | same | The subscription is app-level: the panel wires no IPC (badge live while the drawer is closed). |
| TEST-362 | REQ-019, REQ-017 | `tests/shared/registry-no-renderer-ui.test.ts` (REPLACED — supersedes TEST-070, F5 REQ-021) | No `src/renderer/` file references the registry MUTATION surface; the read surface F6 consumes is permitted. |
| TEST-363 | REQ-019 | same | Guard self-test: the narrowed pattern still flags every injected mutation-surface reference and permits every read-surface symbol. |
| TEST-364 | REQ-018 | `tests/docs-feature-0006.test.ts` | Feature doc + CLAUDE.md link + CHANGELOG `[Unreleased]` + keybindings doc + no stale "registry has no renderer consumer" claim (ipc-contract.ts comment, baseline architecture.md). |
| TEST-365 | REQ-001, REQ-002, REQ-007, REQ-011, REQ-012, REQ-014, REQ-015 | `tests/e2e/decision-queue.spec.ts` | Status-bar toggle + default chord toggle; `aria-expanded` sync; live badge "1" with the drawer CLOSED; drawer outside every `.mosaic`/workspace-host subtree; item identity. |
| TEST-366 | REQ-009 | same | Clicking a queue item focuses the matching pane in the PACKAGED renderer, where `process` is verified undefined in the main world (the fold-mode trap); matched project shows no fallback affordance. |
| TEST-367 | REQ-010, REQ-017, REQ-004 | same | A persisted pane-less member shows `decision-queue-open-terminal`; activating it creates a workspace + terminal with `cwd === projectRoot`; `.orky/` byte-identical (content + mtime); relaunch starts with the drawer closed. |

## RED verification

Targeted run of the new/replaced vitest files (`npx vitest run <the 10 files>`):

```
 Test Files  9 failed | 1 passed (10)
      Tests  26 failed | 4 passed (30)
exit code 1
```

Full suite (`npm test`):

```
 Test Files  9 failed | 148 passed (157)
      Tests  26 failed | 1086 passed (1112)
exit code 1
```

All 9 failing files are THIS feature's new files; every pre-existing file — including the whole
frozen 0004/0005/0007/0014 suites — stays green. Failures are want-of-correction signals, not test
bugs:

- `tests/shared/decision-queue-build.test.ts`, `tests/shared/decision-queue-match.test.ts`,
  `tests/renderer/pane-focus-seq.test.ts`, `tests/renderer/registry-slice.test.ts` — whole-file RED:
  `Cannot find module '@shared/decision-queue'` / `src/renderer/store/registry-slice` (TASK-001/002/
  003/005/006 not done). TEST-341 additionally requires `clearPaneRuntime` to clear `paneFocusSeq`.
- `tests/renderer/decision-queue-panel-structure.test.ts` (TEST-344…353) —
  `DecisionQueuePanel.tsx`/`decision-queue.ts` do not exist; `index.css` has no decision-queue
  focus-visible rule (TASK-008/009).
- `tests/renderer/statusbar-queue-toggle.test.ts` (TEST-354…356) — StatusBar has no
  `orky-queue-toggle`/badge yet (TASK-010).
- `tests/renderer/app-queue-wiring.test.ts` (TEST-357/359/360/361) — App.tsx has no registry
  subscription, recovery pull, drawer mount, or shortcut case yet (TASK-007).
- `tests/shared/keybindings-toggle-queue.test.ts` (TEST-325/327/328/329) — no `toggle-orky-queue`
  COMMANDS entry or palette item yet (TASK-004/011).
- `tests/docs-feature-0006.test.ts` (TEST-364) — docs not reconciled yet (TASK-014).

The 4 GREEN tests are regression guards for properties that must already hold and KEEP holding —
not want-of-correction signals (same posture 0005 recorded for TEST-070):

- **TEST-326** — `mod+shift+o` is conflict-free against every existing default (pre-verified by the
  spec; must remain true once the entry lands).
- **TEST-358** — the registry channel set is exactly F5's five and no main/preload file references
  the feature (REQ-003's diff-scope guard — true now, must stay true through implementation).
- **TEST-362 / TEST-363** — the NARROWED replacement scope guard (REQ-019's acceptance requires it
  to pass with F6's renderer code present and keep failing on injected mutation references).

The 3 Playwright tests (TEST-365…367) do not run under vitest; they run RED by construction against
`out/` until implemented (the `orky-queue-toggle`/`decision-queue-*` testids do not exist).

## Coverage check

Every REQ-001…REQ-019 acceptance criterion is covered by at least one TEST-ID — see the catalogue
above and `traceability.json` (updated by this phase: every REQ's `tests` array is non-empty).
Code-review-style acceptance criteria ("grep confirms…", "a code assertion confirms…") are covered
as source-scan assertions, matching the 0004 TEST-030 / 0005 TEST-096 precedent. Two acceptance
vectors are e2e-only by nature and covered by TEST-365…367: the packaged-renderer `process`
trap (REQ-009) and the `.orky/` byte-identical full-interaction invariant (REQ-017).

---

## Review loopback (ESC-001) — sanctioned frozen-test amendments

**Provenance:** the review fan-out found three HIGH/contract findings, all tests-phase-origin
(FINDING-008, FINDING-020, FINDING-021), plus LOW FINDING-018. ESC-001 was resolved with a
review→tests loopback (delegated-human decision, 2026-07-01): the test-designer performs the
frozen-test corrections at the TESTS phase — the sanctioned amendment path (ADR-009) — and the
implementer fixes afterwards. The implementation is GREEN against the pre-loopback suite; every
amended/added defect pin below runs RED against it by design.

### Findings addressed

- **FINDING-020 (HIGH, contract)** — frozen TEST-324 pinned match-FAILURE fall-through at the
  `matchPaneRootFromCandidates` seam, contradicting frozen REQ-009's availability gating
  ("config.cwd WHEN no live cwd is known; gitStatus.root ONLY when neither"): a pane that cd'd OUT
  of every member root kept matching via its stale persisted `config.cwd`, suppressing the REQ-010
  fallback. Corrected contract: the seam keeps skip-on-INVALID (null/undefined/'') semantics but a
  VALID candidate is DECISIVE (match or null), and candidate AVAILABILITY is its own new pinned
  pure seam — **`selectPaneCandidates({liveCwd, configCwd, gitRoot}): string[]`** in
  `src/shared/decision-queue.ts`: `[liveCwd]` when a live cwd is known (even if it will not
  match!), `[configCwd]` only when no live cwd, `[gitRoot]` only when neither, `[]` when none. The
  panel must route through it (structural pin) — never a hand-built all-signals array.
- **FINDING-008 (HIGH, contract)** — the pane-less "open terminal here" fallback was
  keyboard-dead (row keydown preventDefault()ed the bubbled Enter/Space into a silent no-op) and
  AT-invisible (nested inside a `role="button"` row — a Children-Presentational role). Pinned
  corrected structure: the row keydown MUST target-guard (`e.target === e.currentTarget` or the
  `!==` early-return equivalent); NO `role="button"` anywhere in the panel — every activation
  surface is a NATIVE `<button>`, the item row stays a generic focusable (`tabIndex={0}`)
  container; plus a behavioral e2e keyboard vector (Tab to the fallback, Enter, terminal spawns).
- **FINDING-021 (HIGH, contract, merges FINDING-007/016)** — `buildDecisionQueue` validated only 2
  of 9 consumed fields (`needsHuman === true`, non-empty `feature`); an admitted feature with
  mistyped consumed fields became an item (object reason/phase/detail = whole-renderer React-child
  crash; missing/non-number `lastActivityAt` = NaN into `compareOrkyFeatures` = implementation-
  defined sort order). TEST-312 was too shallow (entry-level garbage + missing `needsHuman` only).
  Deepened with admitted-shape mistype vectors: no item, no throw, no NaN, ordering well-defined.
- **FINDING-018 (LOW)** — the `feat()` fixture in `decision-queue-build.test.ts` carried a
  TS2783-redundant explicit `feature:` pre-assignment. Dropped per the 0004 sibling fixture
  pattern; verified clean with `npx tsc --noEmit` under the project's compiler options extended to
  the touched test files (exit 0, no diagnostics).

### Frozen-test touches (each sanctioned by ESC-001; no other frozen file touched, no `src/` edit)

1. `tests/shared/decision-queue-match.test.ts` — TEST-324 amended (fall-through vector re-cut to
   valid-candidate decisiveness); TEST-368/369 added. TEST-313…323 retained byte-equivalent.
2. `tests/shared/decision-queue-build.test.ts` — `feat()` fixture TS2783 fix (value-identical);
   TEST-373/374 added. TEST-301…312 retained.
3. `tests/e2e/decision-queue.spec.ts` — TEST-372 added. TEST-365…367 retained byte-equivalent.
4. `tests/renderer/decision-queue-loopback.test.ts` — NEW file (TEST-370/371, source-scan style).

### Loopback test catalogue (continues from TEST-367)

| TEST-ID | REQ(s) | File | Assertion |
|---|---|---|---|
| TEST-324 *(amended)* | REQ-009 | `tests/shared/decision-queue-match.test.ts` | First VALID candidate DECIDES (match or null); invalid skipped; a valid non-matching candidate never falls through to a stale signal. |
| TEST-368 | REQ-009 | same | `selectPaneCandidates` returns EXACTLY the available set: `[liveCwd]` when known (even non-matching); `[configCwd]` only when no live cwd; `[gitRoot]` only when neither; `[]` when none; total on mistyped signals. |
| TEST-369 | REQ-009, REQ-010 | same | Composed selection+match: a cd'd-out pane (live cwd known, outside all roots; stale matching config.cwd) does NOT match → null (the fallback shows); config-only and git-only panes still match. |
| TEST-370 | REQ-009 | `tests/renderer/decision-queue-loopback.test.ts` | Structural: the panel routes candidates through `selectPaneCandidates(`; never feeds `matchPaneRootFromCandidates` a hand-built array literal. |
| TEST-371 | REQ-014, REQ-010 | same | Structural: row keydown target-guards (`target ===/!== currentTarget` literal); NO `role="button"` in the panel (Children-Presentational — strips the nested fallback from the AT tree); the fallback is a native `<button>`; the row keeps `tabIndex={0}`. |
| TEST-372 | REQ-014, REQ-010 | `tests/e2e/decision-queue.spec.ts` | Keyboard-only: Tab reaches the pane-less fallback button; Enter activates it — a terminal spawns at the project root (never a preventDefault()ed silent no-op). |
| TEST-373 | REQ-013 | `tests/shared/decision-queue-build.test.ts` | Admitted-shape features mistyping a consumed field (object reason/phase/detail, string gateN, string/missing lastActivityAt) contribute NO item, throw nowhere; well-formed siblings survive. |
| TEST-374 | REQ-013, REQ-006, REQ-005 | same | Group ordering stays well-defined with mistyped-comparator-field siblings present: no NaN reaches `compareOrkyFeatures`, root-codepoint tie-break survives, ONE order across 100 seeded shuffles (unknown-reason-string record present, its admission unpinned). |

### Loopback RED verification

Targeted run (`npx vitest run` on the two amended shared files + the new structural file):

```
 Test Files  3 failed (3)
      Tests  7 failed | 23 passed (30)
exit code 1
```

Exactly the 7 defect pins are RED — each a want-of-correction signal against the green-shipping
implementation:

- **TEST-324** — `matchPaneRootFromCandidates(['/elsewhere/x', '/repo/app/deep'], ['/repo/app'])`
  returns `'/repo/app'` (match-failure fall-through still implemented) instead of `null`.
- **TEST-368 / TEST-369** — `selectPaneCandidates` is not exported from `@shared/decision-queue`.
- **TEST-370** — the panel does not reference `selectPaneCandidates(` (it hand-builds the
  unconditional three-signal candidate array).
- **TEST-371** — no target guard in the row keydown; `role="button"` present on the item row.
- **TEST-373 / TEST-374** — mistyped admitted-shape features become items; the NaN comparator
  degrades the codepoint tie-break to insertion order.

The 23 retained tests (TEST-301…312 and TEST-313…323, including the retained vectors inside
the amended TEST-324 file) stay GREEN —
regression pins, not want-of-correction signals. Full suite (`npm test`):

```
 Test Files  3 failed | 155 passed (158)
      Tests  7 failed | 1150 passed (1157)
exit code 1
```

Only the 7 intended REDs fail; every other file — including this feature's own pre-loopback suite
and all frozen 0004/0005/0007/0014 suites — is green. The new Playwright TEST-372 does not run
under vitest; it is RED by construction against the shipped panel (the bubbled Enter is
preventDefault()ed before the button's native activation, so the terminal never spawns and the
spawn assertion times out).

### Coverage delta

`traceability.json` updated: REQ-009 += TEST-368/369/370; REQ-010 += TEST-369/371/372;
REQ-013 += TEST-373/374; REQ-014 += TEST-371/372; REQ-005/REQ-006 += TEST-374 (the determinism/
tie-break property it pins). TEST-324 remains under REQ-009 with its amended assertion.
