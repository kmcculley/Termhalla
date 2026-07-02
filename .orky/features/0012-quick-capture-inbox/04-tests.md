# 0012 — Quick-capture new-work inbox — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (**revision 2** — REQ-001…REQ-014, the
ESC-001 review-gate loopback) and `03-plan.md` (TASK-001…TASK-012; **TASK-002 — the delegated F7
frozen-pin supersession — is executed HERE**, per the 0006 TASK-013 precedent and CONV-019). All
test files below are **FROZEN once the tests gate passes (ADR-009)** — the implementer makes them
pass without editing them.

## Revision 2 (ESC-001 loopback) — what this phase added

The review gate escalated ESC-001 (2 blocking contract violations + 4 spec-origin MEDIUMs); the
human decision looped back to spec, which was amended to revision 2 (NEW **REQ-014**; amended
REQ-002/004/006/009/011/012/013). This tests-phase re-entry pins the new/amended contracts RED
before the fix implementer, continuing the TEST-NNN sequence from the repo maximum **TEST-506** at
**TEST-507**, running through **TEST-528** (22 new ids: 18 vitest + 4 Playwright e2e). New/changed
files this re-entry:

| File | New TEST ids | Kind | Pins |
|---|---|---|---|
| `tests/main/orky-cli-runner-spawn-failure.test.ts` (new) | TEST-507…511 | vitest (mock+real) | REQ-014/FINDING-009: a spawn-class execFile error (string errno — the child never ran) resolves `timedOut:false` → DEFINITE `cli-error`/`cli-unparseable`, NEVER `cli-timeout`; the REAL oversized-argv boundary (507) + a mocked string-errno callback (508); a genuine wall-clock timeout stays `cli-timeout` and the numeric-exit branch is byte-preserved (509/510/511 — deliberately GREEN retained-behavior fences). `tests/main/orky-cli-runner.test.ts` stays FROZEN byte-preserved. |
| `tests/shared/orky-action-validate-projectroot-flaglike.test.ts` (new) | TEST-512…518 | vitest | REQ-013/FINDING-011: `projectRoot` joins the `rejectFlagLike`-guarded set in ALL FOUR validators; field-specific message, fires before other field checks, pairwise-distinct (CONV-001), no false positive on OS-absolute roots (518 — GREEN retained). The frozen `orky-action-validate.test.ts` stays byte-preserved. |
| `tests/renderer/orky-capture-structure-rev2.test.ts` (new) | TEST-519…524 | vitest (structural) | REQ-002/FINDING-012 hint testid + copy class (the EIGHTH non-error testid); REQ-002/FINDING-017 textarea max-height + error overflow clamp; REQ-014/FINDING-019 the invoke catch synthesizes `ipc-failure` (no F7 kind) + the indeterminate copy branch; REQ-009/FINDING-013 the detached FAILURE routes through an `error`-kind `pushToast`; REQ-001/FINDING-021 the CommandPalette `currentCwd` useMemo carries the TEST-495 collision comment. |
| `tests/e2e/orky-capture.spec.ts` (extended) | TEST-525…528 (+ header/stub) | Playwright | REQ-009 per-errorKind RENDER vectors via the stub's `mode.json` (FINDING-014): http-refusal → `cli-error` distinct from feedback-disabled + control-plane mention + a draft-edit clears the region (FINDING-008) + a generic exit-2 cli-error (525); `cli-timeout` via `delayMs > 15s` → indeterminate copy + duplicate warning (526); close-mid-flight → exactly ONE dispatch + the detached FAILURE's `error`-kind toast enqueued even with toasts OFF (527, FINDING-013); failure → change-to-a-DIFFERENT-root clears the region (528, FINDING-008). TEST-504 now also asserts the hint (EIGHT non-error testids). |

**Sanctioned prose repairs (CONV-008, this phase):** the e2e header's StrictMode mechanism claim
(`orky-capture.spec.ts:3-6`) is corrected to state the suite drives the PRODUCTION bundle under
`out/` where StrictMode is compiled out/inert — its dispatch counts measure the real shipped
lifecycle but NOT StrictMode semantics; the structural TEST-489 pin is the StrictMode guard
(REQ-006/REQ-012 rev-2, FINDING-018). The "FINDING-004 / StrictMode" note below is corrected in the
same spirit.

## The test designer is a different actor from the implementer

No production code (`src/`) was written by this phase — only test files, `docs/features/orky-action-dispatch.md`'s
emit-flow prose (TASK-002's doc half, sanctioned), this document, and `traceability.json`.

## Harness constraint honored (the 0009 precedent)

`vitest.config.ts` is `environment: 'node'`, no jsdom — a React component lifecycle cannot be
mounted in the `npm test` gate. Component/store REQs are therefore pinned the repo's established
three ways:

1. **Plain-object slice tests** (the F6 registry-slice harness) — `orky-capture-slice.test.ts`.
2. **Structural source scans** over LITERAL greppable text (testids/aria/imports/handler placement)
   — `orky-capture-structure.test.ts` (rev-1) + `orky-capture-structure-rev2.test.ts` (rev-2).
   Implementers MUST keep every spec-pinned literal greppable.
3. **e2e against the REAL (production) tree** (`tests/e2e/orky-capture.spec.ts`, NOT in the
   `npm test` gate; real keyboard vectors per the F6 TEST-372 lesson) — including a **stub Orky
   feedback CLI** seeded into `ORKY_PLUGIN_DIR` that logs its received argv and answers with the
   real v0.28.0 `submit` shapes across the FULL result universe (file receipt / disabled refusal /
   http refusal / exit-2 internal error / a `delayMs` timeout knob).

**FINDING-004 / StrictMode (corrected per FINDING-018):** REQ-006/REQ-012's StrictMode acceptance is
satisfied by (a) the STRUCTURAL pin that `api.orkySubmitWork(` lives in a /submit/i-named event
handler and appears inside NO `useEffect` callback in any F12 file (TEST-489 — the one property that
makes effect-double-dispatch impossible under StrictMode's mount→unmount→remount). NO harness in this
repo runs React's development build: the unit harness is `environment:'node'` (cannot mount a
component), and the e2e drives the PRODUCTION bundle under `out/`, where StrictMode's double
invocation is compiled out/inert. The e2e zero/one dispatch counts (TEST-504/505/527) measure the
REAL shipped lifecycle but NOT StrictMode semantics — no artifact claims otherwise. The one
StrictMode-active tree (`npm run dev`) is guarded by the TEST-489 structural pin alone (recorded).

**D4 pre-selected-root path (REQ-004, honestly scoped per FINDING-022):** `openOrkyCapture(root)` has
NO shipped caller until F10. *Verified NOW:* the slice seam (TEST-481/482) + the structural
target/skip-picker pins (TEST-484/486 class: `picking` initializes from `initialRoot === null`,
`OrkyRootPicker` rendered only under `picking`). *Explicitly INHERITED by F10's e2e (named
deferral):* the four render/dispatch clauses (form-direct render of a mixed-case root; byte-equal
dispatched `projectRoot`; untracked pre-selected root → `root-not-allowed`; change-root still opens
the picker) — no shipped harness can drive `initialRoot != null` today; **F10's spec MUST inherit
them as e2e vectors in the same change that ships the first real `openOrkyCapture(root)` caller.**

## TASK-002 — the F7 frozen-pin supersession log (CONV-019, REQ-011/REQ-013) — SEVEN entries

All amendments below were made by the TEST-DESIGNER, in THIS feature's change, never during
implementation. Per REQ-011 rev-2 (executing FINDING-020/FINDING-007) the inventory is **SEVEN**:
six assertion-level dispatcher amendments + one prose-only validate-suite repair (entry 7). Each
amended pin carries an in-file supersession note naming feature 0012 and REQ-013; intent preserved.

| Pin | File | Amendment |
|---|---|---|
| TEST-237 | `tests/main/orky-action-dispatcher.test.ts` | enabled fixture: emit http-mode success → `submit` file-mode receipt; still asserts `{ok:true, feedback:'enabled', dispatched:true}` |
| TEST-238 | same | disabled fixture: emit exit-0 `{ok:true,mode:'noop'}` → submit's REAL exit-1 `{ok:false,mode:'noop',error:<ADR-027 refusal>}`; still the DISTINCT feedback-disabled non-dispatch, `calls == ['submit']`, gatekeeper NEVER called |
| TEST-293 | same | serialization fixture keyed `'submit'` with the file-mode receipt; the normalizeProjectRoot fallback-queue-key intent untouched |
| TEST-267 | same | `'submit'` joins the REQUIRED hard-coded literal set (five); forbidden set (incl. enable-feedback/disable-feedback) byte-unchanged; `'emit'` stays required (doResolveEscalation) |
| header `:37/:41` argv map + the TEST-267 describe title | same (prose only) | submitWork line updated to the `submit --json` argv; the scope-guard describe title now says five hard-coded subcommands (CONV-008 honesty; no assertion touched) |
| TEST-298 | `tests/main/orky-action-dispatcher-codex-001-regression.test.ts` | internal-error vector re-expressed as submit's exit 2 + `{error:'disk full'}` → cli-error carrying "disk full" verbatim, NEVER feedback-disabled (the FINDING-CODEX-001 invariant survives byte-for-byte) |
| TEST-300 | same | genuine-disabled vector re-expressed as the exit-1 refusal shape → still the DISTINCT feedback-disabled outcome, `calls == ['submit']` |
| **entry 7 — TEST-290 prose + suite scope comment** *(prose-only, FINDING-020/FINDING-007)* | `tests/shared/orky-action-validate.test.ts:38-44` (scope comment) + `:324` (TEST-290 it-title) | both now name the `--json` item element for submitWork (resolveEscalation keeps `--payload`); **ASSERTIONS BYTE-UNTOUCHED** — TEST-290 stays green and the `--`-acceptance safety property carries over identically |

**Also in this same change (sanctioned by TASK-002):** `docs/features/orky-action-dispatch.md`'s
submitWork emit-flow prose now describes the `submit`/local-inbox path and the complete refusal
universe. The frozen docs test (`tests/docs-feature-0007.test.ts:26`) pins only lowercase literals
— all kept.

## REQ-011 — CONV-023 argv-pin grep (run REPO-WIDE over `tests/**`, this phase)

Pattern `work\.request|--payload|--type` run repo-wide (never a sweep of already-known files); the
full hit universe is classified — any unclassified hit fails the gate:

- **legitimate resolveEscalation emit pins (STILL-LIVE — REQ-013 amends only doSubmitWork):**
  `orky-action-dispatcher.test.ts:180` (emit argv assertion), `:39` (header comment, updated),
  `orky-action-dispatcher-submit.test.ts:259` (`--payload` survives for resolveEscalation),
  `docs-feature-0012.test.ts:84` (`feedback emit --type decision` doc pin).
- **F12 submit-path pins (this feature's own):** `orky-action-dispatcher.test.ts:41,:221,:705`,
  `orky-action-dispatcher-submit.test.ts:81,85,113,118,126,128,131,138`, the new
  `orky-cli-runner-spawn-failure.test.ts` (`work.request` inside the oversized item),
  `orky-capture.spec.ts:58,:179` (stub receipt + item.kind).
- **mechanism-agnostic runner byte-preservation vector:** `orky-cli-runner.test.ts:70-73`
  (`--payload` as an injection-safe argv element — frozen, mechanism-neutral).
- **prose (entry 7, repaired):** `orky-action-validate.test.ts:42,:324` (name `--json` for
  submitWork, `--payload` for resolveEscalation; assertions untouched).

No `SCHEMA_VERSION`/`toBe(7|8)` sweep is needed (F12 persists nothing). The
`rg "no renderer UI consumes|no renderer consumer"` sweep over `src/**`,`docs/**`,`CLAUDE.md`,
`.orky/baseline/**` yields ONLY the byte-unchanged, still-true registry-mutation line at
`.orky/baseline/architecture.md:118` (FINDING-006 allowlist — the ipc-contract orkyAction claim was
retired by TASK-011). `orky-action`/`orkyaction` matches no F12 testid literal; `orkyAction` matches
no F9_FILE (verified).

## RED-state verification (tests gate evidence)

Full `npm test` at re-entry design time: **1294 passed, 14 failed** — the 14 being EXACTLY the
intended rev-2 REDs, no unexpected regression:

- **RED, module/behavior not yet built (REQ-013/FINDING-011):** TEST-512…517 — the four validators
  do not yet reject a `--`-prefixed `projectRoot` (TEST-518 GREEN: legitimate OS-absolute roots are
  already accepted — the no-false-positive fence).
- **RED, runner classification (REQ-014/FINDING-009):** TEST-507 (the shipped runner REJECTS on the
  real oversized argv — the never-reject contract is broken for the spawn class), TEST-508 (a
  string-errno callback error is mapped to `timedOut:true`). TEST-509/510/511 GREEN — the genuine
  timeout, abort, and numeric-exit branches are byte-preserved fences.
- **RED, renderer rev-2 structure:** TEST-519 (no hint line), TEST-520 (no textarea max-height / no
  error overflow clamp), TEST-521 (the catch assigns `'cli-error'`, not `ipc-failure`), TEST-522 (no
  `ipc-failure` in the indeterminate branch), TEST-523 (no `error`-kind `pushToast`; the detached
  outcome is dropped silently), TEST-524 (the CommandPalette useMemo carries no TEST-495 comment).
- **e2e (TEST-525…528 + amended 504):** not in the `npm test` gate; RED by construction (the rev-1
  tree ships no hint, drops the detached outcome, never clears the failure on edit/root-change, and
  does not render the http/timeout distinctions this suite drives).
- **Retained GREEN:** every rev-1 F12 suite (TEST-469…506) and every upstream frozen suite
  (`orky-action-result*`, audit/queue, keybinding/palette, TEST-282/433/434/362/363/290, etc.).

## Coverage (every REQ-001…REQ-014 has ≥1 TEST — see `traceability.json`)

- REQ-001 → 495/497-501/504/**524**
- REQ-002 → 481/484/485/504/506/**519**/**520**
- REQ-003 → 481/486/487/504/505/**528**
- REQ-004 → 481/482/505 (four render clauses inherited by F10's e2e — FINDING-022)
- REQ-005 → 488/489/504
- REQ-006 → 482/489/495/504/505
- REQ-007 → 490/504/505/506
- REQ-008 → 491/504/506
- REQ-009 → 492/506/**522**/**523**/**525**/**526**/**527**/**528**
- REQ-010 → 471/493/504
- REQ-011 → 487/494/502/503 + the SEVEN supersessions (237/238/267/293/298/300 + entry-7 prose)
- REQ-012 → 483/494/496/**527**
- REQ-013 → 469-480 + amended 237/238/267/293/298/300 + **512-518** (projectRoot flag-like)
- REQ-014 → **507**/**508**/**509**/**510**/**511** (runner) + **521**/**522** (renderer ipc-failure)
