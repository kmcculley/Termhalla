# 0010 — Inline actions in OrkyPane — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (REQ-001…REQ-009) and `03-plan.md`
(TASK-001…TASK-006; TASK-005 — the frozen-guard supersession — is executed IN this change, as the
plan delegates). All test files below are **FROZEN once the tests gate passes (ADR-009)** — the
implementer makes them pass without editing them. Test IDs continue the project-wide TEST-NNN
sequence from the repo maximum **TEST-623** (verified by repo-wide grep) at **TEST-624**, running
through **TEST-637** (14 ids: 8 vitest + 6 Playwright e2e).

The test designer is a different actor from the implementer (the integrity boundary). No
production code (`src/`) was written by this phase — only test files under `tests/`, this
document, the `traceability.json` update, and the REQ-009/TASK-005 frozen-guard amendment
recorded below.

## Harness constraint honored (03-plan.md "Testability constraint")

`vitest.config.ts` is `environment: 'node'`, `include: tests/**/*.test.ts` — no jsdom, and the
Playwright `*.spec.ts` e2e files are NOT in the `npm test` gate. The pane composition and the
CONV-046 fix are therefore pinned two ways (CONV-031/CONV-033, exactly as the spec's acceptance
splits them): source-scan tests over LITERAL greppable source text for the structural halves, and
`tests/e2e/orky-pane-actions.spec.ts` for every rendered claim (row-slot contents, escalation-id
agreement, the inject form, the cross-instance pending/refusal model, the mode-flip disarm with
its focus claim — never a production-build StrictMode claim). Every NEW vitest pin is ANCHORED on
an F10 source marker (the `OrkyEntryActions` import/mount, the `orky-pane-inject` testid, the
`status === 'open'` selection, the disarm effect, the doc corrections) so the whole new suite runs
genuinely RED today rather than green-by-absence.

## COMPOSITION discipline — what is deliberately NOT re-pinned here

F10 is reuse/composition. This suite pins the WIRING and reuses F8's frozen pins as REQ halves —
**byte-unchanged is a REQUIREMENT for all of these, not an expectation**:

| Frozen pin | Where | Load-bearing for |
|---|---|---|
| TEST-588, TEST-591 | `tests/renderer/orky-entry-actions-core.test.ts:191,:274` | REQ-002's count halves (supplied-id zero display pulls; exactly ONE submit-time verify pull) |
| TEST-585, TEST-615 | `orky-entry-actions-core.test.ts:126`, `orky-entry-actions-loopback.test.ts:78` | REQ-005(a) — core-seam dedupe + continuation fan-out, no busy pre-check |
| TEST-608, TEST-612 | `tests/e2e/orky-queue-actions.spec.ts:211-213,:367` | REQ-005(b)'s disabled-while-pending gates; REQ-002's fixture-rewrite technique (reused at the pane mount by TEST-635) |
| TEST-607, TEST-602, TEST-598/599/601/604/605 | `orky-entry-actions-structure.test.ts` | REQ-001's one-renderer-owner sweep; the queue mount's no-escalationId pin; the F8 pins the REQ-006 edit must keep green (CONV-012 co-ownership) |
| TEST-428/429/430/453/454, e2e TEST-442 | `orky-pane-structure.test.ts`, `orky-pane-display-contract.test.ts`, `orky-pane.spec.ts:87-92` | REQ-008's F9 read-contract survival |
| TEST-494, TEST-501, TEST-503, TEST-613/614, TEST-282, TEST-353 | capture/keybindings/docs suites | REQ-004/REQ-009 compatibility constraints |

## Suite map

| File | TEST ids | REQs | What it pins |
|---|---|---|---|
| `tests/renderer/orky-pane-actions-structure.test.ts` (new) | TEST-624…629 | REQ-001, REQ-002, REQ-003, REQ-004, REQ-007, REQ-008 | 624: the `OrkyEntryActions` import + mount INSIDE the reserved `orky-pane-row-actions` span, the decision-#2 target (`projectRoot: root`, `featureSlug: f.slug`, `reason: f.status.reason`, conditional-spread `escalationId`, never `null`/`undefined`-supplied), no `api.orky`, no mode/flight re-derivation. 625: no `registryDetail`/api import; the id from `.escalations.find(… status === 'open' …)` filtered to a non-empty string; no free-text extraction; no hard-coded `ESC-` literal. 626: native `orky-pane-inject` button, `openOrkyCapture(root)` gesture-tied and unrewritten, honest /capture\|inject\|work/ copy (never /submitted\|saved\|written/), no `OrkyCaptureModal`/`orkySubmitWork`/`orkyCaptureRequest`, TEST-282-safe testids. 627: banned-literal sweep (orkyAction/orkySubmitWork/CLI/ipcRenderer/registry-mutation/commitPane/electron/node-builtins), `orkyAction:*` count === 4, NO useEffect span reaches `api.orky`/`openOrkyCapture(`/`launchTerminalAt(`/`commitPane`. 628: exactly ONE `fetchOrkyDetail(` call site, no clock/poll in OrkyPane/slice, row keying + slot + `data-escalation-id` survive. 629: no fixed `width:`/340 in the populated slot region, no row-level pointer handler, the shared `stopPropagation` boundary survives, the `orky-pane` `:focus-visible` rule covers buttons and never `outline: none` |
| `tests/renderer/orky-entry-actions-modeflip.test.ts` (new) | TEST-630 | REQ-006 | the mode-keyed disarm effect exists in the SHARED component (a useEffect referencing reason/mode containing `setAnswerOpen(false)` + `setDecision('')` + `setEvidence('')`), its body dispatches/launches/toasts/focuses NOTHING, the module's data-testid set is EXACTLY F8's twelve (no new surface), the TEST-615 no-pre-check regex still holds, and F8's FINDING-022 is recorded non-open naming F10/0010 in the F8 ledger |
| `tests/docs-feature-0010.test.ts` (new) | TEST-631 | REQ-009 | the two MANDATORY CONV-008 corrections: `docs/features/orky-pane.md` retires /strictly read-?only/, /no action affordance/, /no mutation call/ and states the composed scope (composes + OrkyEntryActions/shared action + `openOrkyCapture` + owns-nothing-of-its-own), no /f10 will\|future call/; the `OrkyPane.tsx` header likewise (plus the stale "deliberately EMPTY" slot comment); CHANGELOG `[Unreleased]` records mount + PRE-TARGETED inject + the CONV-046 mode-flip fix (both anchors verified absent today — genuinely RED) |
| `tests/renderer/orky-pane-structure.test.ts` (AMENDED — TASK-005) | TEST-433 (intent superseded), TEST-429 (comment only) | REQ-009 | see the supersession log below — every assertion byte-unchanged, suite GREEN |
| `tests/e2e/orky-pane-actions.spec.ts` (new; NOT in the `npm test` gate) | TEST-632…637 | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008 | 632: the composition end-to-end — per-row mode routing (done row: NO answer), zero dispatch on mount/expand/open, `dq-action-answer-target` EQUALS the row's first-open `data-escalation-id` (ESC-007, never resolved ESC-001), CONV-041 (disclosure untouched, focus kept), CONV-042 (open lands focus in the input), CONV-043 (Enter dispatches once; whitespace refuses), CONV-044 (success disarms; re-open empty), ONE pinned emit argv keyed (pane root, dir slug) with the byte-verbatim payload, narrow-tile (720px real resize) visibility/operability with bounding-box clipping checks. 633: resume FROM the pane — ONE terminal tile at the pane's root, PATH-stubbed `claude.cmd` proves CWD + `/orky:resume`, ZERO api.orky dispatches. 634: inject — form-direct (no `orky-root-picker`), pre-targeted `orky-capture-target` = pane root, F12's title focus, submit argv `projectRoot` strictly the pane's root, honest label, save/relaunch-untracked → unbound offers NO inject. 635: the refusal vectors — structural id beats the free-text-named ESC-999 (the row's own escalation text proves the free text), null-id first-open rides the shared honest refusal (`escalation-unbound`, submit disabled, EMPTY logs), changed-world via the TEST-612 fixture-rewrite (refuses /changed\|re-?open/, ESC-010 never substituted, EMPTY logs). 636: the HONEST two-mount model — queue-mount flight → shared pending on BOTH regions, pane preview + pre-opened pane submit DISABLED mid-flight, argv log EXACTLY 1, queue renders the result, pane renders NEITHER result NOR error, returns idle re-enabled. 637: CONV-046 — fixture flip escalation→human-review with forms open (drafts typed) on BOTH mounts → both form regions unmount, focus NOT moved into any field, zero dispatch; an explicit re-open mounts the FRESH empty verdict form and only THAT gesture moves focus |

## Supersession log (REQ-009 / TASK-005 — executed in THIS change, CONV-019)

1. **TEST-433 (`tests/renderer/orky-pane-structure.test.ts`) — INTENT SUPERSEDED, assertions
   byte-unchanged, suite GREEN.** The describe title "read-only scope guard (REQ-013)" is
   re-expressed to "scope guard — the F9 files own no raw CLI/mutation/dispatch call; the
   READ-ONLY intent is SUPERSEDED by feature 0010 (REQ-013; CONV-019)" with a supersession note
   naming F10/0010, TASK-005, the TEST-353 precedent, and the named handoff in
   `orky-capture-structure.test.ts:264-265`. Every banned literal, loop, and assertion in the
   test body is byte-unchanged (verified: the amended suite passes against today's tree; neither
   `OrkyEntryActions`, `orky-entry-actions`, nor `openOrkyCapture` contains a banned substring).
2. **TEST-429 (same file) — comment-only update** (the spec's explicit MAY): the "reserved,
   F9-EMPTY trailing slot (D4/F10)" inline comment now reads "the reserved trailing slot (D4) —
   POPULATED by feature 0010's OrkyEntryActions mount". The assertion is byte-unchanged.
3. **File header** — an `[AMENDED at feature 0010's tests phase …]` block records both edits and
   the byte-unchanged guarantee (the F8 amendment-note precedent).
4. **No other frozen guard is amended.** The REQ-006 edit is expected to keep the whole F8
   `orky-entry-actions-structure`/`-core`/`-loopback` suites and e2e TEST-608/612 byte-green —
   verified possible by design (the disarm is a state-reset effect: no dispatch, no testid, no
   pre-check); if the implementer trips one anyway, that is a loopback finding, never a silent
   edit (ADR-009).

**Inventory re-run (the REQ-009 stated pattern,
`orky-pane-row-actions|OrkyEntryActions|openOrkyCapture|orky-entry-actions|F10`, rg -i over
`tests/**`, 2026-07-02 after this change):** exactly the spec's 14 dispositioned files **plus the
four F10-OWNED files this phase adds** (`orky-pane-actions-structure.test.ts`,
`orky-entry-actions-modeflip.test.ts`, `docs-feature-0010.test.ts`, `orky-pane-actions.spec.ts`)
— self-owned suite files, not un-dispositioned guards. No 15th pre-existing hit appeared.

## Coverage (REQ → tests; **bold** = new, plain = frozen-reused byte-unchanged)

| REQ | Tests |
|---|---|
| REQ-001 | **TEST-624**, **TEST-632**, **TEST-633**; TEST-607 |
| REQ-002 | **TEST-625**, **TEST-632**, **TEST-635**; TEST-588, TEST-591, TEST-612 |
| REQ-003 | **TEST-626**, **TEST-634** |
| REQ-004 | **TEST-627**, **TEST-632**, **TEST-633**, **TEST-634**; TEST-433 (amended), TEST-494 |
| REQ-005 | **TEST-636**; TEST-585, TEST-608, TEST-615 |
| REQ-006 | **TEST-630**, **TEST-637**; TEST-598, TEST-599, TEST-601 (byte-green constraints) |
| REQ-007 | **TEST-629**, **TEST-632**; TEST-438 |
| REQ-008 | **TEST-628**, **TEST-632**; TEST-428, TEST-429, TEST-430, TEST-442, TEST-453, TEST-454 |
| REQ-009 | TEST-433 (amended header — the supersession itself), **TEST-631**; TEST-503, TEST-613, TEST-614 (compatibility) |

## RED-state verification (tests gate evidence, 2026-07-02)

`npm test` (full vitest gate, 199 files): **3 failed | 196 passed; 10 tests failed | 1398 passed**
— the failures are EXACTLY the new F10 pins, each failing on its F10 anchor:

- `orky-pane-actions-structure.test.ts` — 6 failed (TEST-624…629): no `OrkyEntryActions`
  import/mount, no `status === 'open'` selection, no `orky-pane-inject`, no composed surface, no
  populated slot in today's `OrkyPane.tsx`.
- `orky-entry-actions-modeflip.test.ts` — 1 failed (TEST-630): no mode-keyed disarm effect exists
  (the FINDING-022 defect is live) and FINDING-022 is still `status: 'open'` in the F8 ledger.
- `docs-feature-0010.test.ts` — 3 failed (TEST-631): both strict-read-only claims still in the
  tree; the CHANGELOG has no 0010 entry (the /pre-?targeted\|pre-?selected/ and
  /conv-046\|mode[- ]?flip/ anchors verified absent from today's `[Unreleased]`).

The amended `orky-pane-structure.test.ts` passes (TEST-428…439 all green — the supersession
changed no assertion), and every frozen co-owned suite passes byte-unchanged:
`orky-entry-actions-structure/-core/-loopback`, `decision-queue-panel-structure`,
`orky-capture-structure` (TEST-494), `keybindings-capture-orky-work` (TEST-501),
`docs-feature-0008` (TEST-613/614), `docs-feature-0012` (TEST-502/503),
`orky-pane-display-contract` (TEST-453/454).

e2e (`orky-pane-actions.spec.ts`, excluded from the vitest gate by design): RED by construction —
the shipped tree renders an EMPTY `orky-pane-row-actions` slot (no `dq-action-*` element in any
pane row) and no `orky-pane-inject`. Its only TypeScript diagnostics under `npm run typecheck`
are the pre-existing repo-wide e2e DOM-lib class (identical errors in `decision-queue.spec.ts`,
`minimize-resume.spec.ts`, `orky-action-dispatch.spec.ts` today) — no new error class.

## Loopback — ESC-001 review→tests (2026-07-02): the 7-lens findings pinned

Executed per the ESC-001 decision in `state.json` (1 blocker FINDING-016 + MEDIUMs 007/008/009/017/018
+ LOWs 010/011/012/013/014/015). TEST ids continue from the repo max **TEST-637** → **TEST-638…TEST-648**
(11 ids: 8 vitest + 3 Playwright e2e). New pins live in NEW files; frozen files were amended ONLY
where a contract genuinely changed, each with a CONV-019 supersession note (inventory below).

### New files

| File | TEST ids | Finding / REQ | What it pins (state today) |
|---|---|---|---|
| `tests/renderer/orky-pane-actions-loopback.test.ts` | TEST-638…640 | 007/REQ-007, 008/REQ-003, 018/REQ-005 | 638: the `orky-pane-row-actions` slot is SHRINKABLE — no `flex:'none'`, `minWidth: 0` (so the shared region's own flexWrap engages in a narrow tile) — **RED** (the shipped slot is `flex:'none'`). 639: the header row hosting `orky-pane-inject` declares `flexWrap:'wrap'` (inject wraps to a second line instead of clipping off-tile) — **RED**. 640: OrkyPane threads its OWN `hidden` prop into the region mount and `deliver()` treats hidden-at-settle like detached-at-settle (store toast chokepoint) — **RED** (deliver consults only `aliveRef`). |
| `tests/renderer/orky-entry-actions-modeflip-loopback.test.ts` | TEST-641…643 | 011/REQ-006, 009/REQ-006, 010/REQ-006 | 641: the LOAD-BEARING `armedMode === mode` render guard on BOTH form conditions + `setArmedMode(` exactly once, inside toggleAnswer, in no effect — **GREEN by design** (the guard shipped; this is its missing regression pin — deleting it now FAILS here even though TEST-630/637 settle identically). 642: the disarm routes a draft-lost notice through `pushToast` guarded on a non-empty draft, with the never-suppressed `'error'` kind, and a focus FALLBACK exists for the escalation→null flip (forms' `fallbackSelector` or a collapse-guarded re-anchor) — **RED**. 643: no stale failed binding survives the flip (disarm resets the binding OR the `escalation-unbound` errorView branch is mode-gated) — **RED**. |
| `tests/docs-feature-0010-loopback.test.ts` | TEST-644…645 | 015/REQ-009, 012/REQ-009 | 644: CLAUDE.md's drawer row + `docs/features/decision-queue.md` stop claiming a read-only/never-invokes-CLI drawer and name the composed write-capable region (F6's own files still own no dispatch; docs-feature-0006:29 still needs SOME true read-only phrase to survive, e.g. the read-only preview) — **RED**. 645: the REQ-009 inventory made MECHANICAL — the stated CONV-037 pattern over `tests/**` must hit EXACTLY the enumerated 22 files (14 spec-dispositioned + 4 F10 phase-4 + 4 loopback; see the re-run below) — **GREEN by construction**, its value is failing on the next un-dispositioned hit. |
| `tests/e2e/orky-pane-actions-loopback.spec.ts` (NOT in the `npm test` gate) | TEST-646…648 | 007+008, 009, 018 | 646: a genuinely NARROW TILE (two rightward editor splits of a 900px window → ~225px tile), containment asserted against the PANE TILE's own bounding box — never `window.innerWidth` (the FINDING-007 lesson) — for every `dq-action-*` control AND `orky-pane-inject`, plus a zero-horizontal-scroll-debt check (`scrollWidth <= clientWidth+1`) on the features list, closed and with the form open — **RED, run-verified**: fails deterministically (3/3) on "orky-pane-inject must not be clipped off the tile's right edge". 647: the escalation→null flip (reason null: escalation resolved, four gates, no stall — the toggle unmounts WITH the form) with a typed draft → the draft-lost toast renders WITH TOASTS NOT ENABLED (pins the never-suppressed kind end-to-end) AND focus does not fall to `<body>` — **RED, run-verified** (no toast today). 648: an answer dispatched from the pane settling AFTER a workspace switch (keep-mounted-hidden host) surfaces the outcome toast — **RED, run-verified** (no toast today; the outcome renders only into the hidden pane). All three read the gatekeeper log handshake-aware from birth. |

### Frozen-file amendments (CONV-019; every touch + reason)

1. **FINDING-016 (the blocker) — the startup contract handshake vs. raw gatekeeper-log emptiness.**
   `verifyOrkyContract` (src/main/services.ts:62, v0.28.0, commit 0dc4c54 — SHIPPED before both
   tests phases) invokes `gatekeeper contract` unconditionally at boot with `ORKY_PLUGIN_DIR` set,
   so every raw `expect(readLog(gatekeeperLog)).toEqual([])` / gatekeeper argv-count assertion was
   unsatisfiable against a behaviorally CORRECT implementation. Amendment (identical in all three
   files, header note + per-title `[AMENDED — FINDING-016]` tag): a `readActionLog` helper asserts
   every excluded entry IS exactly `['contract']` (nothing else is ever dropped) and returns the
   log without them; every gatekeeper-log read swapped to it. Intent preserved verbatim — "empty
   until a gesture" now reads "nothing but the startup handshake until a gesture".
   - `tests/e2e/orky-pane-actions.spec.ts` (F10-owned): 9 read sites, TEST-632/633/635/636/637
     tagged (TEST-634 reads only the feedback log — byte-unchanged).
   - `tests/e2e/orky-queue-actions.spec.ts` (F8, co-owned per CONV-012): 7 read sites,
     TEST-608/609/611/612 tagged (TEST-610 reads no stub log). The work order named 608/612; 609
     and 611 carry the IDENTICAL defect class (gatekeeper argv-count assertions) and were amended
     in the same sweep rather than left latently broken.
   - `tests/e2e/orky-queue-actions-loopback.spec.ts` (F8): 2 read sites, TEST-620 tagged.
   - Swept for the same pattern, NOT amended: `orky-capture.spec.ts` seeds NO gatekeeper stub (its
     own header already notes the handshake tolerates the absence; its `readLog` sites are all
     feedback), `orky-notify.spec.ts` / `orky-pane.spec.ts` / `orky-status.spec.ts` /
     `orky-action-dispatch.spec.ts` / `decision-queue.spec.ts` read no gatekeeper argv log.
2. **FINDING-009 — TEST-630 (`tests/renderer/orky-entry-actions-modeflip.test.ts`, F10-owned).**
   The original pin BANNED `pushToast` and `.focus(` in the disarm body — mandating silent draft
   destruction and the stranded-focus defect. Amendment (header note + title tag): exactly those
   two bans removed; the dispatch-purity bans (api.orky/commitPane/launchTerminalAt), the
   exact-testid-set pin, the no-pre-check regex, and the FINDING-022 bookkeeping are byte-unchanged.
   The removed bans are replaced by REQUIREMENTS in TEST-642 (draft-guarded, never-suppressed
   notice; collapse-guarded fallback) and by e2e TEST-647.
3. **No other frozen file is touched.** TEST-608/612's assertion BODIES (the REQ-002/REQ-005
   load-bearing pins) are unchanged beyond the readActionLog swap; TEST-585/588/591/615 and every
   other co-owned suite pass byte-unchanged (verified in the full run below).

### FINDING-017 determination (investigate → state which)

**Neither a production-code defect nor a test-stub artifact: a BUILD-ENVIRONMENT defect.** Two
experiments, both reproducible on this machine (Windows 11 26200):

1. **The production spawn path is sound.** node-pty's conpty backend calls
   `CreateProcessW(nullptr, "<file> <args>", …)` (conpty.cc:413 — NULL lpApplicationName). A
   direct .NET `Process`/`UseShellExecute=false` spawn (the same CreateProcessW-NULL-appname
   semantics) of the exact stub `claude.cmd /orky:resume` **succeeds**: exit 0, `CWD=C:\dev\Termhalla`,
   `ARGS=/orky:resume` logged. Windows resolves `.cmd` via the implicit cmd.exe path when
   lpApplicationName is NULL — direct `pty.spawn` of a resolved `.cmd` is a working design;
   `resolveSpawnSpec`/`launchTerminalAt` need no change, and F8's REQ-014 contract stands.
2. **The actual failure: node-pty's native binding is MISSING from this checkout.** Run under the
   app's own Electron with the repo's module resolution, `pty.spawn` throws
   `MODULE_NOT_FOUND: Cannot find module '../build/Release/conpty.node'`
   (node_modules/node-pty/build/ contains only config.gypi — node-pty ships no prebuilts and the
   repo's postinstall is patch-package only). PtyManager catches, prints `[failed to launch …]`
   into the pane, and the tile still commits — EXACTLY TEST-633's witnessed shape (toHaveCount(2)
   passes; claude-log.txt never appears). This breaks EVERY terminal spawn in the current checkout,
   not just resume: the same run of the amended F8 suite fails TEST-609 (claude spawn) AND TEST-610
   (a plain PowerShell terminal via openTerminalAt) with the identical class.
3. **The rebuild is itself blocked on this machine:** `npx electron-rebuild -f -w node-pty` fails
   with MSB8040 (Spectre-mitigated libraries not installed in VS 2022 Community; node-pty's
   binding.gyp sets `SpectreMitigation: 'Spectre'`). Prerequisite for the human: install the
   Spectre-mitigated libs (VS Installer → Individual components) then run
   `npx electron-rebuild -f -w node-pty`.

**Consequence for the pins:** TEST-633 (and F8's TEST-609/610) are CORRECT as written and are kept
byte-unchanged (beyond the FINDING-016 swap); no new code pin exists to write — the corrected
behavior requires zero repo-code change. They MUST be witnessed green after the environment
rebuild before the review gate closes (the FINDING-016 proposed-CONV discipline). No vitest
environment canary was added: it would hard-block the `npm test` gate on a fix outside the repo.

### FINDING-018 determination: pinned (cheap)

F9's host-hidden signal already reaches OrkyPane as its `hidden` prop (both keep-mounted-hidden
hosts drive it — PaneTile's `wsInactive || maximizedOver` and the minimized host). Threading it
into the shared region is an optional prop + one condition in `deliver()` (the queue mount, whose
drawer unmounts on close, supplies nothing and keeps its shipped detached-toast path). Pinned:
TEST-640 (structural) + TEST-648 (rendered). NOT recorded as a residual.

### Accepted residuals / no-pin dispositions

- **FINDING-013** (F8 ledger `resolvedAt` hand-synthesized): a ledger correction for doc-sync —
  nothing executable to pin. The implementer/doc-sync stamps the real edit instant.
- **FINDING-014** (tracked `NUL` file): standing backlog item per ESC-001 — committed deliberately
  as a named hygiene change, never a rider; no pin.
- FINDING-010/012/015 are pinned above (TEST-643, TEST-645, TEST-644) — no residual remains from
  the LOW set except 013/014.

### Inventory re-run (REQ-009 pattern, rg -i over `tests/**`, 2026-07-02 after this change)

**22 files** — the spec's 14 dispositioned + F10's 4 phase-4 suites + this loopback's 4
pattern-hit files (`orky-pane-actions-loopback.test.ts`, `orky-entry-actions-modeflip-loopback.test.ts`,
`docs-feature-0010-loopback.test.ts`, `e2e/orky-pane-actions-loopback.spec.ts`). The amended
`e2e/orky-queue-actions-loopback.spec.ts` deliberately contains no pattern token and stays a
non-hit. FINDING-012's "18" (14+4) was correct pre-loopback; the count is now pinned as the exact
file SET by TEST-645, so it can never silently drift again.

### RED/GREEN verification (loopback evidence, 2026-07-02)

Full `npm test` (202 files): **3 failed | 199 passed; 6 tests failed | 1410 passed** — the
failures are EXACTLY the intended new pins and nothing else:
- `orky-pane-actions-loopback.test.ts` — TEST-638 (flex:'none' present), TEST-639 (no flexWrap),
  TEST-640 (deliver consults only aliveRef).
- `orky-entry-actions-modeflip-loopback.test.ts` — TEST-642 (no pushToast in the disarm),
  TEST-643 (no binding reset, unbound branch not mode-gated).
- `docs-feature-0010-loopback.test.ts` — TEST-644 (both stale read-only claims present).
Deliberately GREEN new pins: TEST-641 (the shipped armedMode guard's regression pin) and TEST-645
(the inventory set). The amended TEST-630 stays green (bans removed, nothing added). Every frozen
co-owned suite (entry-actions structure/core/loopback, TEST-585/588/591/598/599/601/607/615,
orky-pane-structure, capture, docs) passes byte-unchanged.

e2e (outside the vitest gate), run against out/ (2026-07-02 build — tests-only loopback, build
current):
- `orky-pane-actions.spec.ts` AMENDED: **5 passed / 1 failed** (was 1/5 at review) — TEST-632/634/
  635/636/637 now GREEN against the shipped implementation with the handshake accounted; the sole
  failure is TEST-633 on the FINDING-017 environment defect (claude-log.txt never appears; see the
  determination above).
- `orky-queue-actions.spec.ts` + `orky-queue-actions-loopback.spec.ts` AMENDED: **7 passed /
  2 failed** — TEST-608/611/612/620/621/622/623 GREEN; the failures are TEST-609/TEST-610, both
  the same environment class (pty spawn).
- `orky-pane-actions-loopback.spec.ts` NEW: **0/3, RED for exactly the pinned reasons** —
  TEST-646 on the inject-off-tile clipping, TEST-647 on the missing draft-lost toast, TEST-648 on
  the missing hidden-at-settle toast (each deterministic, 3/3 attempts).

New files' `npm run typecheck` diagnostics: the vitest suites are clean; the e2e file's only
diagnostics are the pre-existing repo-wide e2e DOM-lib class (identical to
`orky-queue-actions.spec.ts` today) — no new error class.
