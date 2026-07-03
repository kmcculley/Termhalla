# 0010 — Inline actions in OrkyPane — Plan (Phase 3)

**Status:** plan drafted from the FROZEN `02-spec.md` (REQ-001…REQ-009, 9 REQs). TASK-IDs below are
stable — never renumber. TASK numbering restarts at TASK-001 per feature (0005/0006/0007/0009
precedent). This is a REUSE/COMPOSITION feature: F8's shared action layer
(`OrkyEntryActions`/`useOrkyEntryActions`/the pure core/`launchTerminalAt`) and F12's rooted
`openOrkyCapture(root)` are consumed, never forked. F10 adds zero new IPC channels, zero new
preload methods, zero `src/main/**` code, and zero direct `.orky/` writes. The diff is: one shared-
component behavioral fix (CONV-046, lands in `orky-entry-actions.tsx` — its second real mount
context), one pane-side mount + target construction, one pane-header inject affordance, and a
scheduled frozen-guard/doc-boundary correction pass.

## The core shape

Three layers, sequenced so the shared surface and its behavioral fix land BEFORE anything in
`OrkyPane.tsx` composes it, and the frozen-guard/doc boundary work lands LAST (it reads the
finished diff):

1. **Shared-component fix (F8 surface, co-owned per CONV-012)** — the CONV-046 mode-flip disarm in
   `orky-entry-actions.tsx` (REQ-006). This is the one piece of new BEHAVIOR in the feature; every
   other task is composition. It must land first because both the queue mount (existing) and the
   pane mount (new, this feature) depend on it holding.
2. **Pane-side composition** — the per-row `OrkyEntryActions` mount with target construction sourced
   from the pane's already-held detail (REQ-001/REQ-002/REQ-008), the pane-header inject affordance
   calling F12's `openOrkyCapture(root)` (REQ-003), and the structural read-only-except-via-F7/F12
   scope guard the diff must satisfy by construction (REQ-004). REQ-005 (cross-instance single-
   flight) and REQ-007 (tile-context UX) are not separate code paths — they are inherited for free
   from F8's shared `busy`/`stopPropagation`/`useOpenFocusRestore` machinery once the mount is wired
   per REQ-001/REQ-002; this plan verifies rather than reimplements them.
3. **Boundary/verification pass** — the REQ-009 frozen-guard inventory disposition (TEST-433's
   intent-supersession header amendment, delegated to the test-designer at phase 4 exactly like
   0009's TASK-019 precedent) and the REQ-009 doc-sync correction (`docs/features/orky-pane.md`,
   `OrkyPane.tsx`'s own header comment) — both scheduled here as boundary markers, not implemented
   during TASK-001…TASK-005.

## Testability constraint (carried from 0009, unchanged)

Per the repo's `vitest.config.ts` (`environment: 'node'`, no jsdom): the shared-component fix
(TASK-001) is exercised by the existing F8 node-harness pattern (structural pins over the component
source + the frozen core/loopback suites); the pane composition (TASK-002/003) is exercised via
source-scan tests over `OrkyPane.tsx` (grepping the pinned `OrkyEntryActions` import, the target
expression, the `openOrkyCapture(` call site, and the ABSENCE of `api.orky`/`registryDetail`
literals) plus e2e for every rendered claim (row slot contents, escalation-id agreement, the inject
form, the cross-instance pending/refusal vector, the CONV-046 flip). This is a planning constraint
on HOW code is written, not a new task.

## Baseline / architecture fit

- `.orky/baseline/architecture.md`'s read-only phrasings (verified 2026-07-02, lines 31/87/91/119/
  135) describe main-process/IPC read surfaces F10 does not falsify (F10's write is renderer-side
  via F7/F12) — no baseline correction is required (spec decision #6/FINDING-006). Only the two
  named REQ-009 doc pins (`docs/features/orky-pane.md:8-9`, `OrkyPane.tsx:13-14`) are in scope.
- F8's `orky-entry-actions.tsx` is extended, not forked: this is its designed second mount context
  (D5) — the same module, the same pure core, the same module-scope single-flight registry.
- F9's `OrkyPane.tsx` reserved slot (`orky-pane-row-actions`, F9 REQ-012) and already-fetched
  `orkyPaneDetail[paneId]` payload (escalations WITH ids) are consumed as-is — no new fetch trigger,
  no new detail shape.
- F12's `openOrkyCapture(root?: string)` (`orky-capture-slice.ts:27-30`) and app-level
  `OrkyCaptureModal` host (`App.tsx:209`) are consumed as-is — F10 is their designed first rooted
  caller.

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| CONV-046 mode-flip disarm fix | `src/renderer/components/orky-entry-actions.tsx` | edit |
| Pane row-actions mount + target construction | `src/renderer/components/OrkyPane.tsx` | edit |
| Pane-header inject affordance | `src/renderer/components/OrkyPane.tsx` | edit |
| Scope-guard verification pass | verification only — reviews the diff from TASK-001…TASK-003 | n/a |
| Frozen-guard supersession (TEST-433 header amendment) | `tests/renderer/orky-pane-structure.test.ts` | **owned by the test-designer at phase 4 — see TASK-005** |
| Doc/comment boundary correction | `docs/features/orky-pane.md`, `src/renderer/components/OrkyPane.tsx` (header comment), `CHANGELOG.md` | edit |

## No new IPC / no new surface (REQ-004)

This plan adds ZERO `CH.*` constants, ZERO preload methods, ZERO `src/main/**` edits, ZERO
`child_process`/`execFile`/`ipcRenderer` references, and ZERO direct `.orky/` writes. The
`orkyAction:*` channel set stays exactly 0007's four. Every write-capable action reachable from the
pane routes through F7's bridges (via the shared `orky-entry-actions` module, unchanged ownership),
F12's `openOrkyCapture`/`OrkyCaptureModal`, or the store's existing `launchTerminalAt`.

---

## Tasks

### TASK-001 — CONV-046: mode-flip disarm fix in the shared `OrkyEntryActions` component
**Satisfies:** REQ-006 · **Files:** `src/renderer/components/orky-entry-actions.tsx`
**Depends on:** — · **Order:** 1 · **Constraints:** co-owned per CONV-012; MUST keep every F8 frozen
  pin green (TEST-598: no new testid; TEST-599: the disarm effect dispatches nothing; TEST-601: no
  `from './OrkyPane'` import); MUST NOT touch TEST-602 (queue-mount no-`escalationId` pin — lives in
  a different file, untouched by this fix); the whole frozen `orky-entry-actions-structure`/`-core`/
  `-loopback` suites MUST pass byte-unchanged unless a pin is superseded per REQ-009 (none expected)
- Add a mode-keyed disarm effect: when `target.reason` changes while `answerOpen` is `true`, reset
  `answerOpen` to `false` and clear the typed decision/evidence state — the mode-keyed twin of the
  existing FINDING-020 disarm-on-success effect (`orky-entry-actions.tsx:319-325`). The effect body
  dispatches nothing and calls no `api.orky*`/`commitPane` (TEST-599's structural ban).
- No new testid is introduced (TEST-598); the fix is a state-reset side effect keyed on
  `target.reason`, not a new rendered surface.
- Record F8's open `FINDING-022` (`.orky/features/0008-queue-answer-resume-actions/findings.json:
  297-308`) as fixed-by-F10 in the findings ledger update this task's change carries.
- Verify (both mounts, at this task's own review, ahead of TASK-002/003 depending on it): with the
  answer form open on an `escalation` target and `target.reason` flipped to `'human-review'` with no
  gesture, the form unmounts, the typed text clears, and `document.activeElement` does not move into
  any form field.

### TASK-002 — Mount `OrkyEntryActions` per feature row, keyed on the pane's own row identity, sourced from the already-held detail
**Satisfies:** REQ-001, REQ-002, REQ-008 · **Files:** `src/renderer/components/OrkyPane.tsx`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** no `registryDetail` call of its own; no
  `api.orky*` reference anywhere in the file (frozen TEST-607 one-owner sweep stays green); no new
  fetch trigger, no `Date.now()`/`new Date(`/`setInterval` addition (T1/T2/T3 discipline unchanged,
  REQ-008)
- Import `OrkyEntryActions` from `./orky-entry-actions`. Inside `featureRow`, replace the empty
  `<span data-testid="orky-pane-row-actions" .../>` (`OrkyPane.tsx:167`) with the same span wrapping
  a mounted `<OrkyEntryActions target={...} />` — the testid literal and row position are unchanged
  (F9's identity/keying, REQ-008, is untouched).
- Target construction, computed inline from `f` (the row's already-in-scope `OrkyFeatureDetail`) and
  the pane's own `root`, per resolved decision #2 byte-for-byte:
  `{ projectRoot: root, featureSlug: f.slug, reason: f.status.reason, ...(openEscalationId ? { escalationId: openEscalationId } : {}) }`
  where `openEscalationId` is `f.escalations.find(e => e.status === 'open')?.id` filtered to a
  non-empty string (array order, mirroring `orky-entry-actions-core.ts:155-162`'s own selection
  rule) — sourced from `f.escalations`, the SAME array the row already renders
  (`OrkyPane.tsx:201-212`), never a new pull, never `status.detail` free text, never fabricated.
- No pane-side pre-check, re-derivation, or wrap-with-dispatch around anything `OrkyEntryActions`
  itself decides (mode routing, honesty classification, single-flight busy) — `OrkyPane.tsx` (and
  every other F9/F10 file) contains no `api.orky*` action-bridge call of its own.
- This task is where REQ-005 (cross-instance single-flight) and REQ-007 (tile-context UX: CONV-041
  stopPropagation, CONV-042 focus-on-open, CONV-043 Enter-submits, CONV-044 disarm-on-success, no
  fixed-width assumption) are INHERITED, not implemented — they are properties of the shared
  component TASK-001 preserves and this task mounts unmodified. No task-specific code addresses
  them; TASK-004 verifies them holding in the pane context.

### TASK-003 — Pane-header inject affordance, opened pre-targeted via F12's `openOrkyCapture(root)`
**Satisfies:** REQ-003 · **Files:** `src/renderer/components/OrkyPane.tsx`
**Depends on:** — (independent of TASK-001/002; touches a different region of the same file) ·
  **Order:** 2 · **Constraints:** rendered ONLY on a bound member pane (never in the `unbound`
  branch); the gesture calls `openOrkyCapture(root)` and nothing else — no picker step, no draft
  seed, no `api.*` call of its own
- Add a native `<button data-testid="orky-pane-inject">` to the pane header (the bound-branch
  header row at `OrkyPane.tsx:239-259`), calling `useStore.getState().openOrkyCapture(root)` (or the
  hooked store action, consistent with the file's existing `useStore(s => s....)` call style) from
  its `onClick` handler — the pane's `root`, BYTE-VERBATIM, no re-casing/re-slashing.
  Accessible name/tooltip matches `/capture|inject|work/i` and MUST NOT match
  `/submitted|saved|written/i`; testid contains neither `orky-action` nor `orkyaction` (frozen
  TEST-282 stays green).
- Re-invocation while capture is already open relies on the slice's shipped reference-stable no-op
  (`orky-capture-slice.ts:28`) — no client-side guard added around it.
- No import of `OrkyCaptureModal` or any capture-form logic into this file — the modal stays
  app-hosted (`App.tsx:209`) and this button's only job is to call the store action.

### TASK-004 — Scope-guard + cross-instance + tile-UX verification pass
**Satisfies:** REQ-004, REQ-005, REQ-007 · **Files:** verification only — reviews the diff from
  TASK-001…TASK-003
**Depends on:** TASK-001, TASK-002, TASK-003 · **Order:** 3
- Confirm: no new `CH.*` constant, no preload addition, no `src/main/**` change, no
  `child_process`/`execFile`/`ipcRenderer` reference in any F10-touched file; `OrkyPane.tsx` contains
  no `orkyAction`, `orkySubmitWork`, `registryDetail`, or registry-mutation literal; no `useEffect`
  span in `OrkyPane.tsx` references `api.orky`, `openOrkyCapture(`, `launchTerminalAt(`, or
  `commitPane` (every dispatch/capture-open/pane-commit is gesture-only — the TEST-599 technique
  applied to the pane, REQ-004); `(read('src/shared/ipc-contract.ts').match(/'orkyAction:\w+'/g)).length === 4`
  still holds.
- Confirm the cross-instance vector (REQ-005): with a queue mount and a pane mount of the same
  `(projectRoot, featureSlug)`, a flight started on one mount renders shared `dq-action-pending` on
  BOTH, the non-initiating mount's `dq-action-preview`/answer-submit refuse while busy, and after
  settle the non-initiating mount returns to idle (no phantom result, no stuck pending) — this is a
  read of frozen TEST-585/TEST-608/TEST-615 continuing to hold plus one new e2e two-mount scenario
  spanning the pane, not new production code.
- Confirm the tile-context UX vector (REQ-007) holds inside a mosaic row: CONV-041/042/043/044 at
  the pane, no fixed pixel width added to the region/slot, `:focus-visible` covers every F10 surface
  including the inject button.
- Produces no new shipped file — a pass/fail confirmation feeding the implementation gate (0006
  TASK-012 / 0009 TASK-018 precedent).

### TASK-005 — Frozen-guard supersession boundary (delegated to the test-designer, phase 4)
**Satisfies:** REQ-009 · **Files:** `tests/renderer/orky-pane-structure.test.ts` (TEST-433's header/
  describe amendment; also hosts TEST-429, presence-pin, no assertion change needed there)
**Depends on:** — · **Order:** N/A — **explicitly NOT an implementation-phase task**
- This task exists ONLY to give REQ-009 a traceability anchor at the plan level; no implementer
  amends `orky-pane-structure.test.ts` (or any other frozen guard) during TASK-001…TASK-004.
- **Owner and timing:** the test-designer, at phase 4 (`04-tests.md`), in the SAME change that
  introduces F10's own suite — the F8 TEST-353 precedent (CONV-019's protocol).
- **Required outcome (recorded here so the gatekeeper can check it lands):** TEST-433's describe
  block is re-expressed so `OrkyPane.tsx` may compose the shared action region and the rooted
  capture opener while still containing no raw CLI/mutation/dispatch call of its OWN, with a note
  naming F10 — every existing assertion in it stays byte-unchanged (none of the four banned
  literals — `orkyAction`/`child_process`/`execFile`/`registry*`/`orkyWatch` — is tripped by
  `OrkyEntryActions`/`orky-entry-actions`/`openOrkyCapture`). A `tests/**` grep with the pattern
  `orky-pane-row-actions|OrkyEntryActions|openOrkyCapture|orky-entry-actions|F10` (case-insensitive)
  yields exactly the 14 files the spec's REQ-009 dispositions and no other — a new hit file is a new,
  un-dispositioned guard that stops the tests-phase change until dispositioned.
- If TASK-001…TASK-004 land before this retirement, TEST-433 stays green throughout (its literal
  assertions are unaffected — only its describe-level INTENT comment is stale until phase 4 renames
  it) — expected sequencing, not a defect.

### TASK-006 — Documentation reconciliation: retire the stale strict-read-only claims
**Satisfies:** REQ-009 · **Files:** `docs/features/orky-pane.md`, `src/renderer/components/OrkyPane.tsx`
  (header comment, lines 13-14), `CHANGELOG.md`
**Depends on:** TASK-001, TASK-002, TASK-003, TASK-004 · **Order:** last
- `docs/features/orky-pane.md:8-9` — rewrite the "Strictly READ-only: no `.orky/` write, no CLI, no
  `orkyAction:*` call, no registry mutation" claim to the true post-F10 scope: the pane composes the
  shared F8 action layer and the F12 rooted capture opener; it owns no dispatch/capture/CLI/mutation
  logic of its own. Retire any future-tense "F10 will…" phrasing in the same file.
- `OrkyPane.tsx:13-14` — re-express the header comment's "Strictly READ-only (REQ-013): no action
  affordance, no mutation call" claim to name the composed surface, consistent with the doc rewrite
  above.
- Run the two CONV-008 sweep patterns over `docs/**`, `CLAUDE.md`, source comments, and (pattern 2
  only) `.orky/baseline/`: (1) stale future-tense `F10 will|future call` (case-insensitive); (2)
  `read.?only|no action affordance|no mutation call` (rg -i). Correct every pattern-(2) hit that
  describes the OrkyPane/Orky write surface; leave noise hits (editor read-only mode, historical
  superpowers plans, the still-true preview-button "read-only preview" title, the baseline's
  main-process read-surface hits per FINDING-006) alone. Verified pin-free 2026-07-02 (neither
  `docs-feature-0009.test.ts` nor `docs-feature-0012.test.ts` matches either phrase) — both
  corrections are pin-free; confirm `TEST-503` and `docs-feature-0008.test.ts` stay green through
  the change.
- `CHANGELOG.md [Unreleased]`: record the pane-inline-actions composition (mount + inject + the
  CONV-046 shared fix).

---

## Sequencing summary

```
TASK-001 (CONV-046 shared-component fix)         [independent — must land before 002/003 rely on it]
  ├─ TASK-002 (row mount + target construction)   [needs 001]
  └─ TASK-003 (header inject affordance)          [independent of 001's internals; ordered same wave]
        └─ TASK-004 (scope-guard + cross-instance + tile-UX verification)  [needs 001, 002, 003]
              └─ TASK-006 (docs reconciliation)   [needs 001, 002, 003, 004]
TASK-005 (frozen-guard supersession)              [phase 4, test-designer — not sequenced with the above]
```

## Complexity flags (REQs spanning >3 tasks)

- None. Every REQ in this feature maps to at most 2 implementation tasks plus, where applicable, the
  TASK-004 verification pass — the smallest-plan constraint holds because this is a composition
  feature: REQ-005 and REQ-007 in particular are inherited properties of TASK-001/TASK-002 rather
  than independently-coded seams, so they need no fan-out task of their own beyond verification.

## Risk notes

1. **TASK-001 must genuinely precede TASK-002/003 landing in a reviewable state** — mounting
   `OrkyEntryActions` in the pane before the CONV-046 fix lands would give the pane mount the SAME
   focus-theft defect F8 recorded as FINDING-022; the plan orders the shared fix first specifically
   so the pane's first mount is already correct, never a follow-up patch.
2. **TASK-005 is a boundary marker, not deliverable code** — no implementer may amend
   `orky-pane-structure.test.ts` or any other frozen guard during TASK-001…TASK-004; REQ-009 is
   explicit that the TEST-433 supersession happens at phase 4, in the test-designer's own change.
3. **The 14-file REQ-009 inventory is closed as of the spec's 2026-07-02 verification** — if the
   phase-4 grep (TASK-005) turns up a 15th hit, that is a new, un-dispositioned guard: stop and
   raise it to the coordinator rather than silently dispositioning it inside the tests-phase change.
4. **No production behavior change to the queue mount is intended by TASK-001** beyond the disarm
   fix itself — if any F8 frozen pin (TEST-598/599/601/602/585/588/591/615, or the e2e
   TEST-608/612) trips, that is a finding for the tests phase, not a silent scope change here.

## Open issues (under-specified REQs)

None. Every REQ-001…REQ-009 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). REQ-009
maps to TASK-005 (delegated, non-implementation) plus TASK-006 (the doc-sync half it also names) —
not an uncovered requirement. The spec is frozen at 9 REQs.
