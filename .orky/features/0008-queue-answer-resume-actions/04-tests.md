# 0008 — One-click answer-escalation + resume on queue entries — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (REQ-001…REQ-015, the Q1/findings-repair
revision) and `03-plan.md` (TASK-001…TASK-011; **TASK-009 — the delegated frozen-guard
supersession — is executed HERE**, per the 0006 TASK-013 / 0012 TASK-002 precedent and CONV-019).
All test files below are **FROZEN once the tests gate passes (ADR-009)** — the implementer makes
them pass without editing them. TEST-NNN ids continue from the repo maximum **TEST-583** at
**TEST-584**, running through **TEST-614** (31 new ids: 24 vitest + 5 Playwright e2e + 2 docs-guard
`it`s under the two docs TEST ids' describes), plus the two CONV-019 amendments (TEST-353,
TEST-366 — ids retained).

## The test designer is a different actor from the implementer

No production code (`src/`) was written by this phase — only test files, the two sanctioned
frozen-guard amendments (TASK-009), this document, and `traceability.json`.

## Harness constraint honored (the 0009/0012 precedent) — and the ONE chosen-contract decision

`vitest.config.ts` is `environment: 'node'`, no jsdom — a React component lifecycle cannot mount in
the `npm test` gate, and **anything importing `src/renderer/api.ts` cannot load under vitest at
all** (it reads `window.termhalla` at module scope — the rule CLAUDE.md and `pane-ops.ts` both
document). REQ-001's acceptance requires `orky-entry-actions.tsx` to contain the `api.orky*`
literals, so that file is untestable as a unit by construction. This phase therefore freezes the
spec-sanctioned helper split (REQ-005 acceptance: *"a source scan of `orky-entry-actions.tsx` (and
its helper, if any)"*):

> **Chosen frozen contract:** `src/renderer/components/orky-entry-actions-core.ts` — an api-free,
> React-free, store-free PURE core exporting `answerModeFor`, `flightKey`, `withSingleFlight`,
> `isInFlight`, `subscribeFlights`, `bindEscalationTarget(target, registryDetail)`,
> `verifyEscalationTarget(target, boundId, registryDetail)` (the `registryDetail` IPC call is
> INJECTED, `() => api.registryDetail(root)` at the composition point — the CLAUDE.md pattern and
> the `orky-pane-slice` precedent), `buildResolveEscalationRequest` / `buildRecordHumanGateRequest`
> / `buildDriveStatusRequest`, and `settleAnswer` / `settlePreview` (the honesty classifier).
> The single-flight registry lives at MODULE SCOPE in this core (one instance per window — the
> REQ-007 "shared seam"); the `.tsx` hook imports and consults it (structurally pinned). The full
> exported shapes are documented in `orky-entry-actions-core.test.ts`'s header. The plan's
> "exactly one new file" phrasing is superseded by this two-file split for testability; every
> REQ-001 scope guarantee is pinned over BOTH files, and the dispatch (`api.orky*`) still lives
> ONLY in `orky-entry-actions.tsx` (TEST-597/TEST-607).

**The REQ-007 two-instance acceptance** ("two `useOrkyEntryActions` instances mounted for the SAME
target … one dispatch, BOTH render pending") is realized as four coordinated pins, since no
harness here can mount two React instances: (1) TEST-585 — two independent consumers of the SAME
`flightKey` share ONE started fn and ONE promise (spy count 1) and both observe pending via
`isInFlight`; (2) TEST-586 — `subscribeFlights` notifies on acquire AND release, the seam that lets
a second mount re-render pending, and the gate releases on settle (resolve AND reject) regardless
of caller state; (3) TEST-600 — the hook is structurally pinned to import/consult exactly this
shared seam (never a per-instance ref); (4) TEST-608 — the real double-gesture single-dispatch
count end-to-end. The F10-pane mount is the SAME module-scope registry by construction (one module
instance per window). Cross-window is honestly out of scope, as the spec itself states.

## Files + TEST ids

| File | TEST ids | Kind | Pins |
|---|---|---|---|
| `tests/renderer/orky-entry-actions-core.test.ts` (new) | TEST-584…596 | vitest (behavioral, pure core) | CONV-039 flightKey (584); shared single-flight one-start/shared-promise/independent-keys (585); release-on-settle + subscription seam (586, REQ-010 half); answerModeFor (587); display-time binding — F10 as-is/zero pulls, F8 first-OPEN in array order, structural id beats `status.detail` free text (588); five unbindable shapes, pairwise-distinct messages, never a fabricated id (589); verify — identity-beats-position, resolved-meanwhile/vanished/pull-fail → /changed\|re-?open/i, never a substituted id (590); pull-count discipline F8=2 distinct fresh pulls vs F10=exactly 1 (591); request builders exact keys/byte-verbatim/evidence-omission (592); success honesty incl. preview next-action + dispatched:false never success (593); answer indeterminate class cli-timeout/cli-unparseable/ipc-failure (594); feedback-disabled distinct + definite kinds verbatim (595); preview safe-retry honesty, no duplicate warning (596) |
| `tests/renderer/orky-entry-actions-structure.test.ts` (new) | TEST-597…607 | vitest (structural) | F7-bridges-only + scope bans + F6 files gain no bridge + orkyAction channel count still 4 (597); dq-action-* namespace complete, no orky-action/orkyaction substring, no enable affordance (598); no api.orky*/commitPane in any useEffect span (599); hook consults the shared core gate (600); answerModeFor routing + exports + import-scoped pane-agnostic bans (601); panel mounts OrkyEntryActions with (projectRoot, featureSlug, reason), NO escalationId, no api.orky of its own (602); REQ-015 structural guard — stopPropagation boundary OR target-guarded row onClick (603); REQ-014 commitPane composition (claude, /orky:resume, cwd, defaultShellId, newWorkspace fallback, getState, no envId, honest copy) (604); catch synthesizes ipc-failure only + detached error-kind pushToast + copy centralized in core (605); focus-visible/native-buttons/no-raw-hex/CONV-029 fallback (606); single-call-site discipline renderer-wide + resume path api.orky-free (607) |
| `tests/e2e/orky-queue-actions.spec.ts` (new) | TEST-608…612 | Playwright (NOT in the `npm test` gate) | answer-an-escalation end-to-end with stub feedback+gatekeeper CLIs (ORKY_PLUGIN_DIR): zero dispatch on mount, ESC-007 (first OPEN, not first array entry) shown before dispatch, whitespace gate, double-Enter single-flight, pinned emit argv + byte-verbatim payload, honest success, preview via `gatekeeper drive` with no mutation claim (608); resume-in-terminal via a PATH-stubbed `claude.cmd` proving cwd=projectRoot + argv `/orky:resume`, one pane per gesture, zero api.orky* calls, honest label (609); REQ-015 pointer isolation on a hasPane row + row-body click still focuses (610); disabled-feedback fallback → `gatekeeper resolve-escalation --id ESC-007 --decision <verbatim>` (611); the display→submit race — re-verification refuses, both stub logs stay EMPTY, /changed\|re-?open/i renders, ESC-009 never substituted (612) |
| `tests/docs-feature-0008.test.ts` (new) | TEST-613…614 | vitest (doc-drift guard) | feature doc (`docs/features/queue-answer-resume-actions.md`) + CLAUDE.md + CHANGELOG (613); the ipc-contract consumer-comment amendment — scoped to the comment region, stale "consumer-less" clause retired, 0008 + the three actions + F10 named, 0012's TEST-503-pinned first-consumer sentence intact, no TEST-503-swept phrasing introduced (614) |
| `tests/renderer/decision-queue-panel-structure.test.ts` (amended) | TEST-353 (retained) | vitest | see supersession log |
| `tests/e2e/decision-queue.spec.ts` (amended) | TEST-366 (retained) | Playwright | see supersession log |

## TASK-009 — the frozen-guard supersession log (CONV-019, REQ-013)

All amendments below were made by the TEST-DESIGNER, in THIS feature's change, never during
implementation. Intent preserved in both.

| Pin | File | Amendment |
|---|---|---|
| TEST-353 | `tests/renderer/decision-queue-panel-structure.test.ts` | The `DecisionQueuePanel.tsx` read-only clause is SUPERSEDED by F8 (the panel now composes the write-capable `OrkyEntryActions`): the describe/it titles and an in-file supersession note now NAME feature 0008 as the retiring consumer (closing the pre-CONV-019 no-named-retirer gap). **Every assertion is byte-equivalent** — the `decision-queue.ts` / `registry-slice.ts` bans stay untouched, and the panel keeps all original bans (the `OrkyEntryActions` mount trips none of them, as the spec verified), so TEST-353 stays GREEN before AND after implementation; the panel's positive mount + api.orky-free discipline is pinned RED in the new TEST-602. A file-header note records the amendment. |
| TEST-366 | `tests/e2e/decision-queue.spec.ts` | `item.click()` (Playwright's CENTER-point click) → `item.click({ position: { x: 12, y: 10 } })` — the row's top-left body padding, clicked EXPLICITLY. Amended pre-emptively: once the actions region mounts inside the row, the center point is layout-dependent and could land in the REQ-015-guarded slot, which deliberately does NOT fire the row's focus-project gesture. The pinned intent (a row-BODY click focuses the matching pane) is unchanged and now layout-robust; the complementary half (an actions-region click must NOT focus the pane) is the new TEST-610. Header + title updated naming feature 0008 / CONV-019. |

**Verified TOLERANT byte-unchanged (the FINDING-001/frozen-guard-inventory check, confirmed by the
full-suite run below):** TEST-344…352 (incl. the `/launchDir|commitPane/` positive pin at
`decision-queue-panel-structure.test.ts` — REQ-014's `commitPane` composition keeps it satisfied,
and TEST-350's raw-hex scan binds any styling the implementer adds INSIDE the panel), TEST-282,
TEST-281, the whole `tests/docs-feature-0012.test.ts` (TEST-502/503 — byte-unchanged; TEST-614 is
scoped to the comment REGION and re-asserts TEST-503's own pins so the additive edit cannot drift),
the F7 dispatcher/validate/result/audit/queue suites, the F9 registry:detail suites, and
`tests/main/spawn-spec.test.ts`. None was edited.

## RED-state verification (tests gate evidence)

Full `npm test` at design time: **1364 passed, 15 failed, 1 failed suite — 195 test files
(192 passed / 3 failed)**. The failures are EXACTLY the intended F8 REDs, no regression:

- **RED, module-not-found (whole suite):** `tests/renderer/orky-entry-actions-core.test.ts`
  (TEST-584…596) — `orky-entry-actions-core.ts` does not exist.
- **RED, structural (11):** TEST-597…607 — `orky-entry-actions.tsx`/`-core.ts` do not exist
  (ENOENT), `DecisionQueuePanel.tsx` mounts no `OrkyEntryActions`, `index.css` has no `dq-action`
  focus-visible rule.
- **RED, docs (4 `it`s under TEST-613/614):** the feature doc does not exist; CLAUDE.md/CHANGELOG
  carry no entry; `ipc-contract.ts` still carries the "remain consumer-less until F8/F10" clause.
- **e2e (TEST-608…612):** not in the `npm test` gate; RED by construction — the shipped tree
  renders no `dq-action-*` element (verified: the testid namespace is new; `grep -r "dq-action"
  src/` is empty).
- **Retained GREEN:** the AMENDED TEST-353 (assertions byte-equivalent — deliberately a green
  recorded retirement, see the log above) and every pre-existing suite (1364 passing incl.
  TEST-344…352, TEST-502/503, TEST-281/282, all F7/F9 suites).

## Scope-guard greps run this phase (CONV-023 — exact patterns, repo-wide)

- `grep -rhoE 'TEST-[0-9]+' tests .orky docs CLAUDE.md` → max **TEST-583** (ids start at 584).
- `grep -rn "dq-action" src/` → empty (the namespace is new; TEST-282/TEST-353 literals
  `orky-action`/`orkyaction` match no F8 testid or file name — enforced forever by TEST-598).
- `grep -rln "orkyResolveEscalation|orkyRecordHumanGate|orkyDriveStatus" src/renderer` → empty
  today (the single-call-site pin TEST-607 is therefore sharp: after F8 exactly ONE owner file).
- The TEST-503 sweep class (`no renderer UI consumes|no renderer consumer`) — nothing in this
  phase's files introduces a match (TEST-614 additionally bans it inside the amended comment).

## Coverage (every REQ-001…REQ-015 has ≥1 TEST — mirrored in `traceability.json`)

- REQ-001 → 597/602/607/608
- REQ-002 → 587/601/608/611
- REQ-003 → 588/589/590/591/608/612
- REQ-004 → 592/608/611
- REQ-005 → 593/596/604/607/608/609
- REQ-006 → 599/608
- REQ-007 → 584/585/586/600/608
- REQ-008 → 593/608/611
- REQ-009 → 594/595/596/605
- REQ-010 → 586/605
- REQ-011 → 591/601/602
- REQ-012 → 606/608
- REQ-013 → 598/613/614 + the amended TEST-353/TEST-366 supersessions
- REQ-014 → 604/609
- REQ-015 → 603/610 + the amended TEST-366 (the row-body half)

**Named deferrals (recorded, honest):** REQ-010's "component unmounted mid-flight" clause cannot be
driven through a real React unmount in any shipped harness (node-env cannot mount; the packaged e2e
drawer-close path needs the implemented region first) — it is pinned by the mechanism halves:
gate-release-on-settle behaviorally (TEST-586), the detached `pushToast(…, 'error')` chokepoint +
copy-centralization structurally (TEST-605), and the never-suppressed error-toast mechanism is
already frozen upstream (`toasts-slice.ts:20`, TEST-527 precedent). REQ-013's "no new
`src/main/**` file" clause is structural-review territory (TASK-010) — the pinnable halves
(channel count still 4, no electron/node imports, no preload literal) ride TEST-597.


---

## LOOPBACK 1 — review → tests (ESC-001, 2026-07-02)

The 6-lens review found one contract blocker + real MEDIUMs; the resolved ESC-001 decision ordered
the fixes pinned RED HERE, before the implementer. Open findings pinned: 008, 009, 011, 012, 013,
016, 017, 019, 020. **FINDING-021 is an ACCEPTED residual (spec-origin verify→write TOCTOU, same
class as the disclosed cross-window one) — deliberately NOT pinned**, recorded per the decision.
TEST ids continue from the repo max **TEST-614** at **TEST-615**, running through **TEST-623**
(5 vitest + 4 Playwright e2e), plus four CONV-019 amendments to frozen files (ids retained).

### New files

| File | TEST ids | Kind | Pins |
|---|---|---|---|
| `tests/renderer/orky-entry-actions-loopback.test.ts` (new) | TEST-615…619 | vitest (in the `npm test` gate) | FINDING-009: core fan-out — a second consumer arriving MID-FLIGHT receives the settled outcome through its own `.then()`, and the hook is BANNED from the `if (isInFlight(key)) return` pre-check that bailed before the continuation attached (615); FINDING-016: useOpenFocusRestore reused + the focus ref on `dq-action-answer-input` (616); FINDING-017: form/onSubmit or input-scoped Enter onKeyDown on the decision input (617); FINDING-019: `role="status"` on `dq-action-result` + `dq-action-pending`, `role="alert"` retained on the error (618); FINDING-008: `launchTerminalAt(cwd, launch)` on the public State, raw `commitPane` OFF it (SliceDeps keeps the injected copy), `resumeInTerminal` rides the narrow action, no useEffect launches (619) |
| `tests/e2e/orky-queue-actions-loopback.spec.ts` (new) | TEST-620…623 | Playwright (NOT in the `npm test` gate) | FINDING-016/017 behavioral: open focuses the input; whitespace Enter dispatches NOTHING; typed-decision Enter → exactly ONE byte-verbatim emit + honest success (620); FINDING-020: the form DISARMS on success — closed + decision cleared; re-open re-binds with an EMPTY input, log still length 1 (621); FINDING-011: opening the answer form clears a stale preview RESULT and a stale cli-unparseable preview FAILURE — the unrelated outcome never masks the active control (622); FINDING-012: drawer closed mid-flight → the detached SUCCESS still rides pushToast (default suppressible kind, toasts enabled via quick.json) with the honest answered/submitted copy — REQ-010's "no outcome is ever silently swallowed" (623) |

### Frozen-file amendments (CONV-019 — supersession notes in each file header + title)

| Pin | File | Amendment |
|---|---|---|
| TEST-593 | `tests/renderer/orky-entry-actions-core.test.ts` | **FINDING-013.** The preview fixture used the UNREAL flattened `data:{next:'run-phase spec'}` — a single pre-joined string the CLI never emits. Re-fixtured to the REAL `gk drive()` shapes (verified against Orky `plugin/gatekeeper/gatekeeper.js:843-904`: `{next:'run-phase', phase}`, `{next:'await-human', reason[, phase]}`, `{next:'retry-phase', phase, failed, attempt}`, `{next:'done'}`); the pinned contract now requires `settlePreview` to render **next + phase + reason** as carried. Retained assertions (answer-success honesty, dispatched:false-never-success, no mutation words) hold on the current code — the amendment is RED exactly on the new phase/reason requirement. |
| TEST-604 | `tests/renderer/orky-entry-actions-structure.test.ts` | **FINDING-008.** Was: the hook composes raw `commitPane`. Now: the hook calls the NARROW `launchTerminalAt(target.projectRoot, {command:'claude', args:['/orky:resume'], title:/orky resume/i})` at gesture time (getState, no envId), and the STORE action owns the composition (`kind:'terminal'`, `defaultShellId`, the F6 workspace-less `newWorkspace` fallback, the INTERNAL `commitPane`, no envId). Honest-copy pins retained verbatim. RED: the current hook calls raw `commitPane` and no `launchTerminalAt` exists. |
| TEST-605 | `tests/renderer/orky-entry-actions-structure.test.ts` | **FINDING-012 (contract blocker).** The original pin covered ONLY the detached FAILURE toast — the exact test-adequacy gap that let the impl drop a detached SUCCESS ("only failures must never be swallowed", contradicting REQ-010's MUST). ADDED: the detached branch routes BOTH classes through `pushToast` — a success call WITHOUT the 'error' kind, carrying `settled.message` (the core-classified copy, honesty class preserved, CONV-034), mirroring F12 `OrkyCaptureModal.tsx:106-108`; suppression stays the STORE's mechanism (`toasts-slice.ts:20`), never a call-site drop. Every original assertion retained (they hold today); the amendment is RED on the missing success channel. |
| TEST-608 | `tests/e2e/orky-queue-actions.spec.ts` | **FINDING-013.** The gatekeeper stub's `drive` answer `{next:'await-human'}` was an under-specified fixture masking the phase/reason drop. Now answers the REAL shape `{next:'await-human', reason:'open escalation', escalations:['ESC-007']}` (gatekeeper.js:850) and the preview assertions additionally require the carried reason to render. All other assertions byte-unchanged. |

### Named realizations + honest deferrals

- **FINDING-009 two-instance post-settle:** no shipped harness can mount two React instances
  (node-env vitest, no jsdom) and F10's OrkyPane — the second mount of the same target — is
  unbuilt, so the rendered two-instance post-settle state is unreachable end-to-end today. Pinned
  as the honest pair that makes the regression impossible: the core fan-out delivers the settled
  outcome to a mid-flight second caller's own continuation (behavioral), and the hook may not
  short-circuit a gesture before its continuation attaches (structural ban on the pre-check +
  unconditional `withSingleFlight(...).then(...)` routing) — TEST-615.
- **FINDING-011 / FINDING-020** are pinned behaviorally in e2e only (TEST-622/621): the
  reset-on-open and disarm-on-success are component-lifecycle behaviors the node harness cannot
  render, and any source-shape pin would over-constrain the realization. RED by construction
  (verified in the reviewed source: `toggleAnswer` never touches `phase`; `answerOpen`/`decision`
  survive a settled success).
- **FINDING-021** (verify→write TOCTOU residual): ACCEPTED residual per ESC-001 — no pin, recorded
  here so the gap stays a documented decision, not an oversight. The upstream fix (gatekeeper
  refusing to resolve a non-open escalation absent `--force`) is filed against Orky.

### Frozen-guard check for the loopback's own additions

- The FINDING-016 fix introduces `useOpenFocusRestore` (a useEffect INSIDE the shared hook's own
  file) — frozen TEST-599 scans only `orky-entry-actions.tsx`'s useEffect spans for
  `api.orky`/`commitPane`; unaffected. TEST-619 extends the same ban to `launchTerminalAt`.
- The FINDING-008 fix removes `commitPane` from the hook — frozen TEST-599's `commitPane` ban
  becomes vacuous there (still green); the panel-structure `/launchDir|commitPane/` positive pin
  reads the PANEL's own F6 source and stays green byte-unchanged; the slice suites consume
  `commitPane` via SliceDeps, which TEST-619 explicitly preserves. **Verified: no frozen pin
  requires `commitPane` on the public State.**
- The FINDING-020 disarm breaks no frozen flow: TEST-608 clicks `dq-action-preview` after the
  success (still present); TEST-611 ends at the success; TEST-612 is the failure path (form stays).
- The FINDING-017 Enter path adds no container-level key handling (input-scoped — CONV-030 clean);
  frozen TEST-608's `submit.focus()` + Enter native-button activation is untouched.

### RED-state verification (loopback gate evidence)

Full `npm test` after the loopback pins: **1390 passed, 8 failed — 196 test files (193 passed /
3 failed)**. The failures are EXACTLY the intended loopback REDs, no regression:

- **TEST-615** — the hook still carries the three `if (isInFlight(key)) return` pre-checks.
- **TEST-616** — no `useOpenFocusRestore`/focus ref exists.
- **TEST-617** — the decision input has no form/onSubmit/onKeyDown Enter path.
- **TEST-618** — `dq-action-result`/`dq-action-pending` carry no `role="status"`.
- **TEST-619** — `commitPane` is still on the public State; no `launchTerminalAt` exists.
- **TEST-593 (amended)** — `settlePreview` renders `next: run-phase` and drops `phase`/`reason`.
- **TEST-604 (amended)** — the hook composes raw `commitPane`; no `launchTerminalAt`.
- **TEST-605 (amended)** — `deliver()` pushes ONLY the error-kind toast; the detached success is
  dropped (the FINDING-012 violation, now pinned).
- **e2e TEST-620…623 + the amended TEST-608 reason assertion:** not in the `npm test` gate; RED by
  construction against the reviewed source (no focus-on-open, dead Enter, form stays armed, phase
  never reset on open, detached success dropped, preview drops the reason) — each verified in
  `orky-entry-actions.tsx`/`-core.ts` before pinning.
- **Retained green:** every pre-loopback suite (1390 passing incl. TEST-584…592, 594…603, 606,
  607, TEST-344…353, TEST-502/503, all F7/F9 suites) — the amendments' retained assertions hold.

### Coverage additions (mirrored in `traceability.json`)

- REQ-001 += 619 · REQ-003 += 622 · REQ-004 += 620/621 · REQ-006 += 617/620 · REQ-007 += 615
- REQ-008 += 618/621/622 · REQ-010 += 623 · REQ-011 += 615 · REQ-012 += 616/617/618/620
- REQ-014 += 619 (files += `src/renderer/store.ts`, `src/renderer/store/types.ts`)
