# Decision-queue panel (Orky 0006) — Review Follow-ups (deferred)

Feature `0006-decision-queue-panel` shipped READY after an eventful cycle: a pre-gate spec revision
that resolved six devils-advocate spec findings (one delegated-human edit), a seven-lens review that
found three HIGH/contract blockers resolved via a review→tests loopback — including a **frozen test
that itself contradicted the frozen spec** — a fix/implement pass, full re-verification, and one
further small loopback for a MEDIUM finding raised by the fix itself. See the per-finding records in
`.orky/features/0006-decision-queue-panel/findings.json` and the full loopback narrative in
`.orky/features/0006-decision-queue-panel/04-tests.md` ("Review loopback (ESC-001)").

## Review timeline

1. **Spec-gate pass (devils-advocate lens), pre-freeze:** filed FINDING-001..006, all resolved in
   place before the spec froze (no loopback needed — these were caught before the tests/implement
   phases began):
   - **FINDING-001 (HIGH):** the spec was unimplementable as written — F5's frozen scope guard
     TEST-070 asserts the ABSENCE of exactly the renderer symbols REQ-003 mandates F6 introduce, with
     no sanctioned retirement path. Resolved by adding REQ-019, which normatively supersedes TEST-070
     at F6's tests phase (never silently during implementation), and by proposing the general
     convention this feature's own repair exemplifies (see "Promoted to conventions" below).
   - **FINDING-002 (HIGH):** REQ-009's normative pane-root matching order (baseline git-root-first)
     contradicted its own acceptance criterion (cwd-first) for a nested-`.orky`-under-git-root
     layout. Resolved: REQ-009 rewritten to mandate cwd-first candidate order — live cwd, then
     persisted `config.cwd`, then git root last — matching the aggregate's own `findOrkyRoot(cwd)`
     binding signal, with an added strict-ancestor-git-root acceptance vector.
   - **FINDING-003 (HIGH):** the pinned `matchPaneRoot` signature relied on `process.platform`, which
     is undefined in Termhalla's contextIsolated renderer main world (a test-green/runtime-broken
     trap — vitest/jsdom define `process`, the packaged renderer does not). Resolved: the fold mode
     is injected explicitly (`opts.caseFold`), derived by the renderer caller via
     `caseFoldFromPlatform(navigator.platform)` (a DOM global present in both runtimes), with
     host-independent `path.win32`/`path.posix` equivalence vectors added.
   - **FINDING-004 (MEDIUM):** no arbitration was pinned for a recovery pull settling AFTER a newer
     push. Resolved: REQ-003 now mandates a monotonic-generation guard (first valid snapshot wins; a
     late pull is discarded), with a stale-late-settling-pull acceptance vector.
   - **FINDING-005 (LOW):** `paneFocusSeq` was specified with no pruning on pane close, a CONV-011
     violation. Resolved: REQ-009 mandates pruning on pane close/workspace removal.
   - **FINDING-006 (MEDIUM):** the FINDING-001 repair (REQ-019) re-created the same trap one feature
     downstream — the NEW narrowed replacement guard would itself freeze an absence-of-consumer
     assertion (the unassigned "track this project" gesture) with no named retiring feature.
     Resolved (delegated-human edit, pre-gate): REQ-019 amended so the replacement guard's header
     must also name its own designated retiring feature.
2. **Seven-lens review, first pass:** fan-out found three HIGH/contract findings, all originating at
   the **tests** phase (the frozen suite itself, not the implementation), plus supporting MEDIUM/LOW
   findings from performance, quality, and determinism (FINDING-012/013/014/015/017/018/019, all
   resolved without a loopback — implementation-level fixes independently verified). Escalation
   triggered on the three contract violations:
   - **FINDING-020 (HIGH, contract, devils-advocate) — the frozen-test-contradicting-frozen-spec
     defect.** Frozen `TEST-324` pinned match-FAILURE fall-through at the `matchPaneRootFromCandidates`
     seam ("first candidate matches nothing → the next candidate is consulted"), but frozen REQ-009
     mandates AVAILABILITY gating ("persisted `config.cwd` WHEN no live cwd is known", "`gitStatus.root`
     ONLY when neither cwd signal exists") — an availability-conditioned signal-preference chain, not
     a try-until-match fallback. The tests phase had pinned the wrong contract; the shipped
     implementation matched the wrong (frozen) test, not the frozen spec. Net effect: a pane that
     `cd`'d out of every member root after the aggregate bound it kept matching via its stale
     persisted `config.cwd`, silently suppressing the REQ-010 fallback affordance.
   - **FINDING-008 (HIGH, contract, ux):** the pane-less "open terminal here" fallback was
     keyboard-dead — the row's bubbling `onKeyDown` caught Enter/Space before the nested native
     button's own default action fired, `preventDefault()`-ing it into a silent no-op — and
     AT-invisible (nested inside a `role="button"` row, a Children-Presentational ARIA role that
     strips descendants from the accessibility tree). (A duplicate filing, FINDING-022 from
     devils-advocate, was merged into this one — concurrent fan-out, same defect.)
   - **FINDING-021 (HIGH, contract, devils-advocate, merges FINDING-007/016):** `buildDecisionQueue`
     validated only 2 of REQ-013's 9 consumed fields (`needsHuman === true`, non-empty `feature`),
     so a feature with a mistyped display field (e.g. `reason: {}`) was BOTH admitted as a queue item
     AND crashed the whole renderer when React tried to render an object as a child; a mistyped
     `lastActivityAt` fed `NaN` into the cross-group rank comparator, degrading the sort to
     insertion order under ECMA-262's NaN-comparator-coercion rule.
3. **Review→tests loopback (ESC-001), delegated-human decision:** resolved via the sanctioned
   test-amendment path (ADR-009) — the test-designer corrects the frozen tests at the TESTS phase,
   the implementer fixes the code afterward:
   - **TEST-324 amended in place** (not deleted — its assertion was simply wrong) to pin the
     corrected contract: a VALID candidate is decisive (match or `null`; never falls through to a
     stale signal). Candidate AVAILABILITY became its own new pinned pure seam,
     `selectPaneCandidates({liveCwd, configCwd, gitRoot}): string[]`, exactly implementing REQ-009's
     when/only-when conditions. TEST-368/369 added (the availability-set vectors and the cd'd-out
     discriminating vector).
   - **TEST-371/372 added** (new file `tests/renderer/decision-queue-loopback.test.ts` plus an e2e
     addition) pinning the row-keydown target-guard, the absence of any `role="button"` in the panel,
     and a behavioral keyboard-activation vector (Tab to the fallback, Enter, terminal spawns).
   - **TEST-373/374 added** deepening REQ-013's per-feature tolerance clause: admitted-shape mistype
     vectors (object reason/phase/detail; non-number `lastActivityAt`) assert zero items, no throw,
     and a well-defined group order.
   - **FINDING-018 (LOW, quality)** — a TS2783-redundant `feature:` pre-assignment in the
     `decision-queue-build.test.ts` fixture — fixed in the same sanctioned touch (value-identical,
     no behavior change).
   - Targeted RED verification before the fix: 7 of 30 tests failed exactly at the three
     corrected/added seams (TEST-324, TEST-368, TEST-369, TEST-371, TEST-373, plus two structural
     TEST-370/372 pins) — the intended defect signal, not noise.
4. **Fix / implement pass:** `selectPaneCandidates` added and wired through the panel
   (`src/shared/decision-queue.ts:220-227`); `matchPaneRootFromCandidates` made decisive on a valid
   candidate (no match-failure fall-through, `:193-202`); the fallback button restructured as a
   native sibling with no `role="button"` ancestor and a target-guarded row keydown
   (`DecisionQueuePanel.tsx:178`); `buildDecisionQueue` gained full consumed-field validation via
   `hasConsumableFields` (`decision-queue.ts:45-55`) plus a NaN-hardened group-sort tie-break.
5. **Re-verification:** all three HIGH/contract findings independently re-verified resolved by their
   filing lenses (ux re-verified FINDING-008; devils-advocate's own re-check covered FINDING-020/021
   structurally); freeze hashes on the untouched portions of the amended files stayed intact; full
   suite green.
6. **Follow-up loopback — FINDING-023 (MEDIUM, ux), a defect introduced BY the FINDING-010 fix:**
   the review had separately found (FINDING-010, MEDIUM) that keyboard-initiated open/close had no
   focus management at all — fixed by moving focus into the drawer's close button on mount and
   restoring it on unmount. But the straightforward "restore on close" fix restored focus
   **unconditionally**, which for this NON-modal drawer yanked focus away from a pane the user had
   just focused via the drawer's own headline click-to-focus gesture while the drawer stayed open —
   splitting the visual focus indicator from where keystrokes actually landed (wrong-shell input in
   a terminal app). Fixed via a small, targeted second loopback: the restore is now conditional on
   focus having actually collapsed out of the removed drawer (`activeElement` fell to `body`/`null`)
   — an intentional focus target the user (or `focusProject`) set while the drawer stayed open is
   never yanked. The implement gate was re-derived PASS after this one-condition change.

## The frozen-test-contradicting-frozen-spec lesson (FINDING-020)

This is worth calling out as its own lesson because it is a different failure class from an
implementation bug: **the test-designer, not the implementer, got the contract wrong**, and the
implementation was internally consistent with the (incorrect) frozen test it was built against — it
shipped green against a suite that was itself the source of the defect. REQ-009 specifies an
**availability-conditioned signal-preference chain** ("use signal B only when signal A is unknown"),
which is a different shape from a **fallback-on-match-failure chain** ("try A; if A doesn't match,
try B") — and TEST-324 pinned the latter shape for a spec that specified the former. The distinguishing
test vector — a candidate that IS available but does NOT match — was simply absent from the original
suite, so nothing forced the two readings apart until devils-advocate's review-phase re-derivation
caught it. The sanctioned repair path (ADR-009's tests-phase amendment, not a silent implementation
edit) is exactly why this was fixable without breaking the frozen/append-only guarantee elsewhere:
TEST-324 was corrected in place, with the correction visible in `04-tests.md`'s "Review loopback"
section rather than lost to history. The general lesson is promoted below as CONV-020.

## Resolved in-feature (not deferred)

- FINDING-001 (HIGH, spec — F5's TEST-070 frozen scope guard blocked REQ-003 with no retirement
  path) — REQ-019 added, superseding TEST-070 at F6's tests phase.
- FINDING-002 (HIGH, spec — REQ-009's git-root-first normative text contradicted its own cwd-first
  acceptance criterion) — REQ-009 rewritten cwd-first, matching the aggregate's own binding signal.
- FINDING-003 (HIGH, spec — pinned matcher signature relied on `process.platform`, undefined in the
  contextIsolated renderer) — fold mode injected explicitly, derived via `navigator.platform`.
- FINDING-004 (MEDIUM, spec — no arbitration for a late-settling recovery pull) — monotonic
  generation guard added to REQ-003.
- FINDING-005 (LOW, spec — `paneFocusSeq` had no pruning model, CONV-011) — pruning on pane
  close/workspace removal added to REQ-009.
- FINDING-006 (MEDIUM, spec — the FINDING-001 repair itself would freeze a new unretirable guard) —
  REQ-019 amended to require the replacement guard name its own retiring feature.
- FINDING-020 (HIGH, contract — frozen TEST-324 pinned the wrong contract shape, contradicting frozen
  REQ-009) — TEST-324 amended in place; `selectPaneCandidates` added; TEST-368/369.
- FINDING-008 (HIGH, contract — pane-less fallback keyboard-dead + AT-invisible) — native sibling
  button, target-guarded row keydown, no `role="button"`; TEST-371/372.
- FINDING-021 (HIGH, contract, merges FINDING-007/016 — admission validated only 2/9 consumed
  fields, enabling a React-child crash and NaN sort poisoning) — full `hasConsumableFields`
  validation + NaN-hardened tie-break; TEST-373/374.
- FINDING-022 (HIGH — duplicate filing of FINDING-008) — merged, no separate fix needed.
- FINDING-007/FINDING-016 — merged into FINDING-021 (same underlying defect, filed by different
  lenses in the same fan-out).
- FINDING-018 (LOW, quality — TS2783-redundant `feature:` pre-assignment in a frozen fixture) —
  dropped per the 0004 sibling fixture's established TS2783-safe pattern, in the same sanctioned
  loopback touch.
- FINDING-019 (LOW, quality — apparently-dead `label?: string` field on `PaletteItem`'s `dir`
  variant) — verified NOT dead (absorbed by frozen TEST-329 reading the un-narrowed union); comment
  corrected to name the actual retirement path.
- FINDING-009 (MEDIUM, ux — queue badge count invisible to AT, `aria-label` override) — the live
  count folded into the toggle's accessible name.
- FINDING-010 (MEDIUM, ux — no focus management on keyboard open/close) — focus moved into the
  drawer on open; restored on close (later refined by FINDING-023, below).
- FINDING-011 (LOW, ux — pane-less rows presented as inert-but-interactive) — inert rows stripped of
  role/tabIndex/hover/cursor; the native fallback button is the sole activation surface.
- FINDING-012 (MEDIUM, performance — `paneFocusSeq` subscribed via a render hook though read only in
  a click handler; unmemoized per-render matching) — read via `getState()` at event time;
  `memberRoots`/`paneMatches` memoized.
- FINDING-013 (LOW, performance — a value-identical push still bumped `snapshotGeneration`,
  notifying every store subscriber) — gated behind a `pullSettled` flag once the recovery pull can
  no longer land.
- FINDING-014 (LOW, ux — item detail line ellipsized with no title/tooltip) — `title` added.
- FINDING-015 — malformed filing artifact, superseded by the complete re-filing (FINDING-018).
- FINDING-017 (LOW, determinism — `applyAssignment`'s move-away path skipped `clearPaneRuntime`,
  leaking `paneFocusSeq` entries for redocked workspaces) — routed through `clearPaneRuntime`.
- FINDING-023 (MEDIUM, ux — the FINDING-010 fix's unconditional focus restore yanked focus from an
  intentional in-drawer-open focus target) — restore made conditional on focus having actually
  collapsed out of the removed drawer.

## Residuals (deferred, non-blocking)

- **FINDING-023's pinning test is deferred to F8.** The conditional-restore fix itself is verified
  and shipped, but no test yet pins the close-time focus behavior end-to-end (open from pane A →
  click a queue item to focus pane B → close the drawer → assert pane B keeps focus and
  `focusedPaneId` agrees). F8 (the feature that attaches one-click actions to these same rows) is
  explicitly the inheriting feature — **its spec must include this pinning test alongside its own
  focus-management tests**, since F8 will add new interactive surfaces to the same rows and is the
  natural point to lock down the panel's full focus contract in one pass.
- **FINDING-009's own residual:** no test asserts the toggle's `aria-label` carries the live count —
  `TEST-365` pins only the visible badge text and `aria-expanded`. Left for a future accessibility
  pass; not contract-violating.
- **FINDING-014's own residual:** the feature/reason/phase line remains ellipsized without a
  `title`, mitigated by the group header's `title={projectRoot}` and the slug's near-front position.
- **REQ-013's "noted latitude"** (from FINDING-021's resolution): an absent `detail` field is
  admitted and renders empty — safe, and deliberately left unpinned by the loopback.
- **The two upstream notes recorded in `02-spec.md` "Open questions"** remain open, as designed:
  pane bindings are not on the wire (a possible future F5 extension), and the "track this project"
  gesture is still unowned (plausibly F13 Settings).

## Promoted to conventions

Three general lessons from this feature's `propose CONV:` findings were promoted to
`.orky/conventions.md` as **CONV-019 through CONV-021**:

- **CONV-019** (from FINDING-001, echoing the spec's own "Baseline fit" proposal) — a frozen scope
  guard test asserting the ABSENCE of a future consumer ("no X consumes Y yet") MUST name the
  feature expected to retire it, and that consumer feature's spec MUST retire/supersede the guard
  atomically in the same change, at the tests phase, never silently during implementation.
- **CONV-020** (from FINDING-010/023) — a non-modal drawer/panel opened via a keyboard command
  (chord or palette entry) MUST move focus into the opened surface on open, and on close MUST
  restore focus to its toggle ONLY IF focus is still inside the panel at close time — never
  unconditionally, and never yanking focus from a surface the user (or the panel's own gesture)
  intentionally focused while the panel stayed open.
- **CONV-021** (from FINDING-012) — store state that a component reads ONLY inside an event handler
  (never to affect rendered output) MUST be read via `getState()` at event time, never subscribed
  with a render hook.
