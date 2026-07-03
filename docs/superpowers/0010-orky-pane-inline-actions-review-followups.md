# Inline actions in OrkyPane (Orky F10) — Review Follow-ups (deferred)

Feature `0010-orky-pane-inline-actions` — a PRIMARILY REUSE/COMPOSITION feature: it mounts F8's
shared action layer (`useOrkyEntryActions` / `OrkyEntryActions` / the pure core / the store's narrow
`launchTerminalAt`) inside F9's reserved per-row slot in the native Orky pane, and adds a
pane-header inject affordance that opens F12's `openOrkyCapture(root)` pre-targeted to the pane's
project. F10 adds zero new IPC channels, zero new preload methods, zero new main-process code, and
zero direct `.orky/` writes — its whole diff is the pane-side mount, the target construction, the
inject affordance, and the CONV-046 mode-flip fix landing in the shared component (its second real
mount context). The cycle: a spec revised twice pre-gate against six devils-advocate findings
(REQ-002/REQ-005/REQ-009 restated to the reachable, harness-honest model), a seven-lens review that
filed 18 findings including one blocker — **FINDING-016**, a startup contract handshake (the
coordinator's own v0.28.0 addition, shipped BEFORE either F8's or F10's tests phase) contaminating
the frozen e2e gatekeeper-log assertions across F10 AND the co-owned F8 e2e (F8's e2e was latently
broken since it shipped and had never been run) — a tests+implement fix cycle, and a consolidated
re-verify resolving 15 of 18 findings. All gates through review are green. See the per-finding
records in `.orky/features/0010-orky-pane-inline-actions/findings.json` and the full narrative in
`.orky/features/0010-orky-pane-inline-actions/04-tests.md`.

## Review timeline

1. **Brainstorm (delegated human).** D1 mount F8's shared action layer in F9's reserved slot
   (cross-instance single-flight already exists), D2 inject via F12's `openOrkyCapture(root)`
   pre-targeted (F10 is F12's designed inherited caller), D3 read-only-except-via-F7/F12 —
   composition only, D4 the escalation id binds from F9's already-fetched detail (no new pull), D5
   honor F8's CONV-041…045 inside a mosaic tile and fix the FINDING-022 mode-flip residual here.
2. **Spec-gate devils-advocate pass, one revision (FINDING-001…006, all repaired pre-freeze).**
   - **FINDING-001 (HIGH, the standout spec-honesty catch).** REQ-005's original acceptance pinned
     a rendered claim the shared component's own gesture-layer busy refusal makes UNREACHABLE by
     design: "the second mount's own continuation renders the settled outcome." Every dispatch
     affordance in `OrkyEntryActions` refuses on the shared `busy` derivation before a second
     gesture can ever fire, and frozen TEST-608 pins exactly that disabled-while-pending behavior —
     so the spec was asking for evidence of a vector its own reused, do-not-fork component
     structurally forbids. This is the **REQ-005 untestable-acceptance catch**: a requirement whose
     acceptance cannot be witnessed by the very design the spec elsewhere mandates is not yet
     understood. Resolved by restating REQ-005 as the two-layer model that is actually true: (a)
     the core-seam continuation guarantee, pinned where it is real (frozen TEST-615, whose own
     header records the rendered two-mount vector as unreachable in its harness), and (b) the
     rendered model users actually experience — one dispatch, shared pending on both mounts, the
     non-initiating mount refuses and returns to idle, never a phantom result.
   - **FINDING-002 (MEDIUM)** — REQ-002's acceptance vehicle (a "component-lifecycle-real pane mount
     with a spied `registryDetail`") does not exist in this repo's harnesses (no jsdom; e2e cannot
     spy the bundled api module). Resolved by the CONV-033-sanctioned split: the pull-count
     discipline cited at the already-frozen core seam (TEST-588/591), the structural claim as a
     node-harness source scan, the rendered claims at e2e.
   - **FINDING-003 (MEDIUM)** — the CONV-008 doc sweep as originally scoped covered only stale
     "F10 will/future call" phrasing, missing the standing "Strictly READ-only" claims in
     `docs/features/orky-pane.md` and the `OrkyPane.tsx` header that F10 directly falsifies.
     Resolved by adding a second sweep pattern for read-only-claim phrasings, naming both
     corrections as mandatory.
   - **FINDING-004 (LOW)** — REQ-002's zero-pull MUST was stated unconditionally but is false for
     the (spec-mandated) omitted-id branch. Resolved by scoping the sentence to the supplied-id
     case.
   - **FINDING-005 (LOW)** — REQ-009's inventory grep pattern was too broad (28 hits, only 10
     dispositioned). Resolved by narrowing the pattern to the F9/F10 surface literals.
   - **FINDING-006 (LOW)** — resolved decision #6 falsely claimed `.orky/baseline/` was absent (it
     exists, committed before the spec). Resolved by correcting the claim and adding the dir to the
     REQ-009 sweep scope (no mandatory correction resulted — its read-only phrasings describe
     main-process/IPC surfaces F10 does not touch).
3. **Seven-lens review of the implementation** (ux, quality, devils-advocate, networking, +
   others): **12 more findings** (007…018), including the blocker.
   - **FINDING-016 (HIGH, blocker — the composition-vs-frozen-e2e defect).** The devils-advocate
     lens actually RAN `tests/e2e/orky-pane-actions.spec.ts` against the implement-gate build (the
     first time in either F8's or F10's history this frozen suite had been executed — it sits
     outside every gate command). Result: 5 failed / 1 passed, deterministic. Root cause: a startup
     contract handshake (`verifyOrkyContract`, `src/main/services.ts:62`, shipped in v0.28.0 as the
     coordinator's own commit, dated BEFORE both F8's and F10's tests phases) unconditionally
     invokes the stub gatekeeper (`gatekeeper contract`) on every app launch — so every frozen
     `expect(readLog(gatekeeperLog)).toEqual([])` raw-emptiness assertion in BOTH F10's new e2e AND
     the co-owned frozen F8 e2e (TEST-608/609/611/612) was unsatisfiable by construction against a
     behaviorally CORRECT implementation. **This is a real, general lesson**: a new startup
     side-effect landing in ANY feature can retroactively break a SIBLING feature's frozen,
     previously-green e2e suite the moment that suite is actually run — and because Playwright e2e
     sits outside the `npm test` gate here, F8's suite had been silently broken since v0.28.0
     shipped without anyone noticing, since nothing ever executed it. F10 surfaced the defect; F8
     shipped with it latent. Fixed by a `readActionLog` helper (asserting every excluded entry IS
     exactly `['contract']`, so real traffic can never be silently dropped) swapped in at every
     gatekeeper-log read site across F10's e2e, the co-owned F8 e2e, and F8's own loopback e2e — a
     call-site amendment, never an assertion-intent change. RUN EVIDENCE (2026-07-03, against the
     implement-gate build): F10's e2e 5/6 green (REQ-005's full rendered two-mount model, REQ-002's
     changed-world vector, and the CONV-046 disarm all WITNESSED, not just claimed); the co-owned F8
     e2e's frozen TEST-608/612 witnessed green.
   - **FINDING-007 (MEDIUM, ux) — the tile-vs-drawer layout gap.** REQ-007's wrap mechanism was
     structurally defeated: the `orky-pane-row-actions` slot carried `flex:'none'`, so it could
     never shrink below its max-content width, and the shared region's own `flexWrap` rows never
     engaged inside a narrow mosaic tile — the features list gained a horizontal scrollbar instead
     of wrapping. Worse, the PINNING TEST (TEST-632) resized the WINDOW to 720px (wider than even
     the 340px drawer the spec contrasts against) and asserted clipping against
     `window.innerWidth`, not the tile's own bounds — a check Playwright's `toBeVisible`/
     `boundingBox` pass even when the control is clipped by ancestor overflow. **A real drawer-test
     blind spot the tile context exposed**: the drawer's own tests never needed tile-relative
     assertions because the drawer IS the outer chrome; the pane's tests needed to assert against
     the TILE, and didn't. Fixed by `minWidth:0` (dropping `flex:'none'`) plus a genuinely narrow
     (~225px real mosaic split) e2e vector asserting every control's bounding box against the PANE
     TILE's own bounding box. Promoted as CONV-047.
   - **FINDING-008 (MEDIUM, ux)** — the same tile-rigidity class applied to the pane header: the
     inject button, as the LAST no-wrap flex item behind several non-shrinkable badge spans, could
     be pushed clean off the tile with no scroll access. Fixed by `flexWrap:'wrap'` on the header
     row, pinned by a narrow-tile e2e vector.
   - **FINDING-009 (MEDIUM, ux) — draft-loss-on-forced-disarm.** The spec's own REQ-006 mandated
     that the CONV-046 mode-flip disarm clear the typed decision/evidence SILENTLY — a trust/
     data-loss gap: a user mid-typing loses their draft with zero signal, and on an
     escalation→null/stalled flip the answer toggle itself unmounts, stranding keyboard focus on
     `<body>` with no fallback. Fixed by routing a draft-lost notice through the store's
     never-silently-dropped toast chokepoint (guarded on a non-empty typed draft, so a no-draft flip
     stays silent) and re-anchoring focus onto the actions region only when it collapsed to
     `<body>`. Promoted as CONV-048.
   - **FINDING-010 (LOW, quality)** — the CONV-046 disarm cleared the typed draft but not the
     hook's escalation binding; a re-open in the OTHER mode could resurface a stale
     `escalation-unbound` alert. Fixed by mode-gating the unbound errorView branch.
   - **FINDING-011 (LOW, quality)** — the load-bearing `armedMode === mode` render guard (what
     actually prevents the wrong-mode focus-on-mount form from mounting for one commit before the
     disarm effect runs) had no regression pin; deleting it silently would leave every other F10
     test green while reintroducing a sub-second FINDING-022-class focus steal. Fixed with a
     dedicated structural pin.
   - **FINDING-012 (LOW, quality)** — REQ-009's "exactly 14 files" inventory acceptance became
     mechanically unsatisfiable the moment F10's own 4 new test files landed (they unavoidably
     contain the surface literals they pin). Fixed by dispositioning the inventory as 14 + F10's
     own files, pinned mechanically by TEST-645's exact-set check.
   - **FINDING-013 (LOW, quality) — a hand-synthesized ledger timestamp.** F8's cross-feature
     `FINDING-022` resolution (appropriately recorded per CONV-012 co-ownership) carried a
     `resolvedAt` round instant that predates the fix's actual existence — an audit-ledger
     timestamp corresponding to no real event. **Stays OPEN as a residual through review**; fixed
     at THIS doc-sync pass (see below). Promoted as CONV-049.
   - **FINDING-014 (LOW, quality) — the tracked `NUL` file.** A Windows-reserved device name tracked
     since F9, polluting every Windows diff as a phantom deletion. Standing backlog, not this
     feature's to fix silently. Promoted as CONV-050.
   - **FINDING-015 (LOW, quality)** — the CONV-008 sweep's own noise-disposition rule let two
     stale "read-only drawer" claims (`CLAUDE.md`, `docs/features/decision-queue.md`) escape even
     though F10's own CHANGELOG entry directly contradicts them ("the SAME shared actions region the
     decision-queue drawer uses"). Fixed by correcting both, same shape as the pane's own
     correction.
   - **FINDING-017 (MEDIUM, devils-advocate) — the resume-spawn build-environment defect.** TEST-633
     (REQ-001's resume half) failed deterministically, but NOT from the handshake — the PATH-stubbed
     `claude.cmd` never produced output. Investigated to a determination rather than left
     ambiguous: a direct experiment proved the PRODUCTION spawn path is sound (a bare
     `CreateProcessW`-NULL-appname spawn of the exact stub succeeds), and the actual failure is
     node-pty's native ConPTY binding being ABSENT from this checkout (`conpty.node` missing;
     `electron-rebuild` itself blocked on Visual Studio's Spectre-mitigated libraries not being
     installed). Confirmed as a build-environment prerequisite, not a code defect — see the residual
     below.
   - **FINDING-018 (MEDIUM, networking) — hidden-at-settle outcome visibility.** F10's composition
     into F9's keep-mounted-hidden hosts (an inactive workspace, a maximized sibling) creates a
     THIRD outcome-delivery state F8's mount-aliveness proxy never had to handle: an answer
     dispatched from the pane that settles while the pane is hidden (workspace switch, maximize
     mid-flight) rendered its outcome into an invisible surface with no toast — for an
     INDETERMINATE settle, exactly the blind-duplicate-retry harm CONV-015/034 exist to prevent.
     **A real "composition changes the visibility contract" lesson**: F8 never needed this because
     closing its drawer unmounts (detached toast fires); F10 mounting the SAME component inside a
     keep-mounted-hidden host is what creates the gap. Fixed by threading the pane's own `hidden`
     prop into the hook as `hostHidden`, read at settle time, routing a hidden-at-settle outcome
     through the same toast chokepoint as a detached one. Promoted as CONV-053 (extends the
     CONV-028 keep-mounted-hidden-host class).
4. **Tests+implement fix cycle (ESC-001, delegated human decision on the loopback).** All 12
   review findings addressed in one loopback: FINDING-016 (the `readActionLog` handshake-aware
   helper, swept across three e2e files), FINDING-007/008 (tile-shrink + header-wrap, new pins),
   FINDING-009 (draft-lost toast + focus fallback), FINDING-010 (mode-gated unbound errorView),
   FINDING-011 (the `armedMode` regression pin), FINDING-012 (the 22-file exact-set pin),
   FINDING-015 (the drawer doc corrections), FINDING-017 (investigated to a determination — no
   code change), FINDING-018 (the `hostHidden` outcome-delivery fix). FINDING-013/014 explicitly
   **accepted as open residuals** per the same ESC-001 decision.
5. **Consolidated re-verify.** All fixes confirmed against current shipped source, e2e run
   evidence captured (not merely claimed): F10's e2e 5/6 green (the sole failure FINDING-017's
   environment class), the loopback e2e 3/3 green, the co-owned F8 e2e + its loopback 7/9 green
   (the two failures sharing FINDING-017's class). 15 of 18 findings resolved; FINDING-013/014/017
   stay open as accepted residuals.
6. **Doc-sync (this pass).** `traceability.json` verified already complete and accurate across
   both loopbacks — every `REQ-001`…`REQ-009` maps to real `TASK-NNN`/`TEST-NNN` ids (the
   `TEST-624…648` range, including every ESC-001-loopback id, plus every frozen F8/F9 pin the spec
   cites as a REQ's co-owned load-bearing half); every referenced id confirmed present as a real
   test marker in its named file by direct grep. `traceability.md` was a phase-3 planning stub
   (tests column intentionally empty pre-test-design); regenerated in full with the tests column
   populated and e2e run evidence noted. `docs/features/orky-pane.md`, `OrkyPane.tsx`'s header,
   `CLAUDE.md`, and `docs/features/decision-queue.md` were all already corrected by the
   implement/review-fix cycle (verified, not re-edited) — the composed write surface, the
   tile-honest layout, the draft-loss notice, and the hidden-at-settle delivery are all
   accurately documented. `CHANGELOG.md`'s `[Unreleased]` entry for F10 was verified present and
   accurate (composition, inject, cross-instance single-flight, the CONV-046 fix — no new IPC/
   preload/main surface). **F8's ledger correction (FINDING-013's fix):** `FINDING-022`'s
   `resolvedAt` in `.orky/features/0008-queue-answer-resume-actions/findings.json` was corrected
   from the hand-synthesized `2026-07-02T18:30:00.000Z` to a real clock instant
   (`2026-07-03T04:12:00.000Z`) at this doc-sync edit — closing FINDING-013 is NOT this agent's
   call (it stays `open` as F10's own residual per the ESC-001 disposition; only the ledger entry
   IT NAMES, in F8's file, was corrected). Promoted seven general lessons to
   `.orky/conventions.md` as CONV-047 through CONV-053 (see below).

## The standout lessons

- **The composition-feature model: mount, don't fork.** F10's entire diff is wiring — target
  construction, one inject affordance, a shared-component fix — because REQ-001 forbade any
  parallel dispatch/honesty/capture logic of its own. This discipline is what made FINDING-001's
  catch possible: the reviewer could reason "the shared component's busy gates make this vector
  unreachable" precisely because there was no forked pane-local gate to complicate the analysis.
  Every REQ-005/REQ-002 acceptance vector in the final spec is provably true of the SAME shared
  component both mounts use — there is no second implementation to drift.
- **The REQ-005 untestable-acceptance catch (FINDING-001).** A requirement's acceptance must be
  witnessable by the design the SAME spec mandates elsewhere. REQ-005 originally demanded evidence
  of a rendered vector that REQ-001's do-not-fork mandate (and the shared component's actual busy
  gates) makes structurally unreachable — a self-contradiction a careful re-derivation from source
  caught before it reached the tests phase. General principle already in this repo's Principles
  section ("a requirement that cannot be made testable is not yet understood — escalate it, don't
  guess") — this is a concrete, high-value instance of it.
- **FINDING-016: a new startup side-effect can retroactively break a sibling feature's frozen e2e.**
  The most consequential finding of the cycle. `verifyOrkyContract` shipped as an unrelated
  v0.28.0 change, dated before either F8's or F10's tests phase — nobody re-ran F8's frozen e2e
  after it landed (it sits outside every gate command), so F8 shipped with a latently broken
  acceptance suite and nobody knew. F10 only surfaced it because a devils-advocate lens actually
  EXECUTED the frozen e2e against the built app instead of trusting its RED-at-tests-phase /
  presumed-green-at-review status. Promoted as two CONVs (051, 052): scope zero-invocation stub
  assertions to the actions under test, and require any gate-excluded frozen acceptance suite to be
  run green at least once before its OWN feature's review gate closes — this second rule would not
  have caught F8's latent break (F8 already passed review before v0.28.0 landed), but it prevents
  the next occurrence from going undetected for two more features.
- **The tile-vs-drawer layout gaps the drawer's own tests never needed (FINDING-007/008).** The
  drawer's tests never asserted tile-relative clipping because the drawer IS the outer chrome — a
  fixed-width host with no ancestor to be clipped by. The pane's mosaic-tile context introduced a
  clipping surface the drawer's test suite had no reason to ever exercise, and the FIRST pane e2e
  vector for it made the same category error (asserting against `window.innerWidth`, not the
  tile). Composing a component into a NEW host geometry requires re-deriving its layout
  assertions from that host's actual constraints, not reusing the donor's.

## Current open-findings residuals (non-blocking)

Three residuals stay open — not re-litigated by doc-sync, each reviewed and explicitly accepted as
deferred per the ESC-001 decision:

- **FINDING-013 (review, LOW, hand-synthesized ledger timestamp).** F8's `FINDING-022` resolution
  (correctly recorded per CONV-012 co-ownership) carried a `resolvedAt` stamp
  (`2026-07-02T18:30:00.000Z`) that predates the fix's real existence. **Fixed at this doc-sync
  pass**: corrected to `2026-07-03T04:12:00.000Z` in
  `.orky/features/0008-queue-answer-resume-actions/findings.json`. This F10 finding itself stays
  `status: "open"` per the ESC-001 disposition (the finding records a defect-and-its-fix, not a
  toggle doc-sync flips) — the underlying data is now correct.
- **FINDING-014 (review, LOW, tracked `NUL` file).** A Windows-reserved device name tracked since
  feature 0009, at repo root. Standing backlog item, independently noticed by three consecutive
  features (0012, 0013, 0008, now 0010) — it sits outside every individual feature's diff scope and
  never gets swept up in a normal fix cycle. **Recommendation unchanged: `git rm --cached NUL` as
  a deliberate, named hygiene commit — never a silent rider inside a feature commit.**
- **FINDING-017 (review, MEDIUM, BUILD-ENVIRONMENT PREREQUISITE — not a code defect).** The
  Playwright e2e terminal-spawn tests (TEST-633 here; F8's TEST-609/610) cannot be witnessed green
  on this checkout because `node-pty`'s `conpty.node` native binding is not built
  (`node_modules/node-pty/build/Release` contains no binary). The production spawn path is proven
  sound by direct experiment (a bare `CreateProcessW`-NULL-appname spawn of the exact `claude.cmd`
  stub succeeds) — **this is an environment gap, not a defect in `resolveSpawnSpec`/
  `launchTerminalAt`/the resume gesture.** **Human action required to close**: install Visual
  Studio's Spectre-mitigated libraries (VS Installer → Individual components), then run
  `npx electron-rebuild -f -w node-pty`, then re-run `tests/e2e/orky-pane-actions.spec.ts`
  (TEST-633) and `tests/e2e/orky-queue-actions.spec.ts` + its loopback (TEST-609/610) and confirm
  green. Until then this residual stays open; no repo-code change is pending against it.

## Promoted to conventions

Seven general lessons from this feature's `propose CONV:` findings were promoted to
`.orky/conventions.md` as **CONV-047 through CONV-053** (continuing from 0008's CONV-046, the
current max before this feature):

- **CONV-047** (from FINDING-007) — a narrow-layout acceptance for a control region inside a
  user-resizable tile must assert clipping against the TILE's own bounding box at a genuinely
  narrow tile width, never against `window.innerWidth`.
- **CONV-048** (from FINDING-009) — a data-driven disarm/close that discards user-typed input must
  surface a user-visible notice through a never-silently-dropped signal and must not strand
  keyboard focus on `<body>`.
- **CONV-049** (from FINDING-013) — a findings-ledger status/resolution edit must stamp its
  timestamp fields from the real clock at edit time, never a hand-typed or estimated instant.
- **CONV-050** (from FINDING-014) — no tracked path may use a Windows-reserved device name.
- **CONV-051** (from FINDING-016) — an assertion that a shared stub/spy saw ZERO invocations must
  be scoped to the actions under test, filtering unconditional startup/handshake traffic to the
  same stub.
- **CONV-052** (from FINDING-016) — a frozen acceptance suite that no gate command executes must be
  run green at least once against the built implementation before its feature's review gate may
  close.
- **CONV-053** (from FINDING-018) — an outcome-delivery path using component mount-aliveness as its
  visibility proxy must be re-audited when that component becomes mountable inside a
  keep-mounted-hidden host (extends the CONV-028 class).

No proposed convention for the composition-feature reuse discipline itself ("mount, don't fork")
was found among this feature's findings — REQ-001/D1 already state it as a spec-level design
decision rather than a reviewer-flagged general rule, so nothing was fabricated to fill that gap;
if a future feature's review independently proposes it as a `propose CONV:`, promote it then.

## Cross-feature note: F10 resolved F8's FINDING-022 and amended F8's frozen e2e

Per REQ-006/CONV-012 co-ownership, this feature's implement phase landed the CONV-046 fix in the
SHARED `orky-entry-actions.tsx` component (both the F8 queue mount and the F10 pane mount get it)
and recorded F8's own `FINDING-022` as resolved-by-F10 in F8's ledger. Separately, per FINDING-016,
this feature's tests-phase loopback amended the gatekeeper-log READ SITES (not the assertion
intent) in F8's co-owned frozen e2e (`tests/e2e/orky-queue-actions.spec.ts`,
`tests/e2e/orky-queue-actions-loopback.spec.ts`) to account for the startup contract handshake — F8's
frozen TEST-608/609/611/612 had been latently broken (unwitnessable) since v0.28.0 shipped, and this
amendment is what let them be run and witnessed green for the first time. **A note recording both
of these retroactive corrections has been added to
`docs/superpowers/0008-queue-answer-resume-actions-review-followups.md`** (see the "Retroactive
corrections landed by feature 0010" section appended there) so a reader of F8's own follow-ups
doc sees the full picture without having to cross-reference this file.
