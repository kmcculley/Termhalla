# 0012 — Quick-capture new-work inbox — Plan (Phase 3)

**Status:** plan drafted from the FROZEN `02-spec.md` (REQ-001…REQ-013, 13 REQs, revision 1).
TASK-IDs below are stable — never renumber. TASK numbering restarts at TASK-001 per feature (the
repo convention — 0005/0006/0007 each restart their own TASK-001, so 0012 does too).

## The core shape

Three independent surfaces, sequenced so the ONE main-process change (REQ-013) and its designed
test-pin supersessions land before any renderer work that depends on `OrkyActionResult` shapes:

1. **The single main-process amendment (REQ-013)** — F7's `doSubmitWork` switches its hard-coded
   invocation from `emit` to `submit`. This is the FIRST task: every renderer result-handling task
   (success/failure branches, `feedback-disabled` discrimination) is written against the shapes
   this amendment produces, not the pre-existing `emit` shapes.
2. **Renderer chrome** — one new store slice (`orky-capture-slice.ts`, open/root/no-op-reinvoke),
   one new component (`OrkyCaptureModal.tsx`, the ONLY `orkySubmitWork(` call site), one additive
   change to the shared `OrkyRootPicker` (optional `ariaLabel`/`heading`/`z`), and the palette/
   keybinding registration (the F6 `toggle-orky-queue` precedent).
3. **Frozen-guard bookkeeping** — the SIX F7 dispatcher pins REQ-013's `emit → submit` switch
   supersedes (TEST-237/238/293/298/300/267) plus the resulting emit-flow prose staleness in
   `docs/features/orky-action-dispatch.md` and the dispatcher's own header comment are bundled into
   ONE delegated, phase-4-owned marker task (TASK-002) — the 0006 TASK-013 precedent: a
   traceability anchor for REQ-011/REQ-013 that is explicitly NOT implemented during the build
   phase. The broader REQ-011 stale-claim sweep (`ipc-contract.ts`'s no-consumer comment, `CLAUDE.md`,
   `.orky/baseline/architecture.md`, new feature docs) is a separate, normal implementer task
   (TASK-011) — it edits prose outside the frozen test/doc-staleness pair TASK-002 anchors.

## Architecture fit (brownfield — `.orky/baseline/` present)

Reuses, does not reinvent:

- The already-bridged `orkyAction:submitWork` write path (F7, `orky-action-dispatcher.ts`,
  `orky-action-validate.ts`, `orky-action-result.ts`) — F12 adds no IPC/preload/main-process
  surface beyond REQ-013's in-place amendment (D2/REQ-005).
- `OrkyRootPicker` (F9) — additive-only optional props, never forked (D3/REQ-003); the shared
  `useOpenFocusRestore`/`useRegistryLoadState` hooks it already rides.
- `Modal.tsx`'s existing modal→modal handoff and collapsed-focus microtask refocus (D3) — the
  picker→form sequence rides this substrate verbatim, no new modal-stacking mechanism.
- The F6 `toggle-orky-queue` invocation precedent: `COMMANDS`/`DEFAULT_BINDINGS`/`resolveBindings`/
  `matchShortcut`/`isValidRebind` (`keybindings.ts`), `buildCommandItems()` (`quick.ts`),
  CommandPalette's chrome-before-`activeId`-guard activate switch, App's keydown switch's
  no-`activeId`-needed case pattern.
- The established `pushToast` chokepoint (CONV-004) and `--status-failure`/CONV-029 token set — no
  new toast/color mechanism.
- CONV-019's designed-retirement protocol (already exercised by 0006 TASK-013) for the six frozen
  dispatcher pins REQ-013 supersedes.

## No new IPC / no new preload / no new main-process module (D2/REQ-005/REQ-013)

This plan touches exactly one existing `src/main/` file
(`src/main/orky/orky-action-dispatcher.ts`, in-place amendment only) and otherwise stays within
`src/shared/`, `src/renderer/`, `tests/**`, and docs. It adds no `CH.*` constant, no
`ipcMain.handle`, no `preload/index.ts` line (beyond the REQ-011 comment edit), no
`orkyResolveEscalation`/`orkyRecordHumanGate`/`orkyDriveStatus` call, and no write under any
`.orky/` tree from the renderer.

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| F7 dispatcher amendment (`emit`→`submit`, disabled-outcome discrimination, header comment) | `src/main/orky/orky-action-dispatcher.ts` | edit |
| F7 dispatcher frozen-pin supersessions (six pins) + `orky-action-dispatch.md` emit-flow staleness | `tests/main/orky-action-dispatcher.test.ts`, `tests/main/orky-action-dispatcher-codex-001-regression.test.ts`, `docs/features/orky-action-dispatch.md` | **owned by the test-designer at phase 4 — see TASK-002** |
| Keybinding registration | `src/shared/keybindings.ts` | edit |
| Palette entry | `src/shared/quick.ts` | edit |
| `OrkyRootPicker` additive props | `src/renderer/components/OrkyRootPicker.tsx` | edit |
| Capture store slice (open/root/draft-adjacent state, entry points) | `src/renderer/store/orky-capture-slice.ts` (new), `src/renderer/store.ts`, `src/renderer/store/types.ts` | new/edit |
| Capture modal component (form, picker handoff, submit gesture, result handling, keyboard matrix) | `src/renderer/components/OrkyCaptureModal.tsx` | new |
| App-level host + keydown case | `src/renderer/App.tsx` | edit |
| Command-palette wiring/verification | `src/renderer/components/CommandPalette.tsx` | edit (or no-diff verification) |
| Scope-guard verification pass | (review only — TASK-010) | — |
| Stale-claim sweep + docs | `src/shared/ipc-contract.ts` (comment), `docs/features/orky-action-dispatch.md` (no-consumer line only — the emit-flow prose itself is TASK-002's), `docs/features/quick-capture-inbox.md` (new), `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` | new/edit |

## Determinism / injection contract

- `openOrkyCapture(root?)` is the ONE store-level entry point both the palette/chord path and
  (later, F10) the pane "inject" action call — no capture logic may live where only one caller can
  reach it (D4).
- The `orkySubmitWork(` call is issued synchronously from the submit gesture's event handler only
  — never from a `useEffect` — a structural constraint TASK-007 must satisfy so the StrictMode
  vectors (REQ-006/REQ-012) are even testable at phase 4.
- The disabled-outcome discrimination (`exitCode === 1 && parsed.ok === false && parsed.mode ===
  'noop'`) lives ONLY in `doSubmitWork` (TASK-001) — the renderer (TASK-007) keys exclusively on
  the returned `ok`/`dispatched`/`errorKind` fields, never re-deriving from `exitCode`/`data`.

---

## Tasks

### TASK-001 — F7 dispatcher amendment: `doSubmitWork` rides `feedback submit`
**Satisfies:** REQ-013 · **Files:** `src/main/orky/orky-action-dispatcher.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** in-place amendment only, no new file/module;
  `mapCliRunToResult` (`orky-action-result.ts`) stays BYTE-UNCHANGED; `orky-action-validate.ts`
  diff stays EMPTY; `resolveEscalation`'s own `emit` invocation untouched (TEST-297/299 stay
  green); `'submit'` joins the hard-coded literal set, never becomes request-selectable
- Change the single hard-coded invocation to `['submit', '--app', projectRoot, '--json',
  JSON.stringify(item)]`, `item = {kind:'work.request', title, ...(detail!==undefined?{detail}:{}),
  ...(phase!==undefined?{phase}:{}), ...(feature!==undefined?{feature}:{})}` — one JSON argv
  element via the `--json` branch (title/detail never travel as raw argv).
- Add the disabled-outcome discrimination: `run.exitCode === 1` with parsed stdout
  `{ok:false, mode:'noop'}` → the DISTINCT `{ok:false, path:'feedback', feedback:'disabled',
  dispatched:false, errorKind:'feedback-disabled', error, exitCode}` (error contains the CLI's
  refusal verbatim, context may be prepended). Every other nonzero-exit/parseable-stdout shape
  (http refusal, validation refusal, exit-2 internal error) flows through the EXISTING
  `mapCliRunToResult` generic `cli-error` path unchanged — no new special-casing beyond the one
  disabled discrimination.
- Update this file's own header comment (`:17-35`) describing `submitWork`'s CLI invocation —
  in the SAME change, since it is the file this task already edits (CONV-008). Do not touch
  `docs/features/orky-action-dispatch.md` here — that update is bundled with the frozen-pin
  supersessions in TASK-002.
- Audit record (`titleLength`/`detailLength` only) stays untouched — no new fields, no raw text.

### TASK-002 — F7 frozen-pin supersession + emit-flow prose staleness (delegated, phase 4)
**Satisfies:** REQ-011, REQ-013 · **Files:** `tests/main/orky-action-dispatcher.test.ts`,
  `tests/main/orky-action-dispatcher-codex-001-regression.test.ts`,
  `docs/features/orky-action-dispatch.md`
**Depends on:** TASK-001 · **Order:** N/A — **explicitly NOT an implementation-phase task**
- This task exists ONLY to give REQ-011/REQ-013 a traceability anchor at the plan level, per the
  0006 TASK-013 precedent. It is not implemented during the build phase; no implementer should
  touch these frozen test files or the doc's emit-flow prose during TASK-001/003…011.
- **Owner and timing:** the test-designer, at phase 4 (`04-tests.md`), in the SAME change that
  introduces this feature's own test suite (CONV-019, `conventions.md:91-95` — F12 is the designed
  first consumer of the `submitWork` dispatch path, so this supersession is a recorded retirement,
  never a silent implementation-time edit).
- **Required outcome (recorded here so the gatekeeper can check it lands):** exactly the SIX
  enumerated pins from the spec's "F7 frozen-pin supersession inventory" are amended
  intent-preservingly — TEST-237 (enabled fixture: `emit` success shape → `submit` file-mode
  receipt), TEST-238 (disabled fixture: emit's exit-0 no-op → submit's real exit-1 refusal, still
  asserting the distinct `feedback-disabled` outcome), TEST-293 (serialization fixture keyed on
  `'submit'`), TEST-298 (internal-error vector re-expressed on the submit path, never
  `feedback-disabled`), TEST-300 (the genuine-no-op vector's replacement shape), TEST-267 (`'submit'`
  joins the required hard-coded literal set) — plus the `:37` header-comment argv-map assertion
  update. No other frozen test in the inventory (TEST-239/252/268/291/292/294/297/299 and the whole
  additive-safe list) is touched.
- ALSO in this same change: update `docs/features/orky-action-dispatch.md`'s emit-flow description
  of `submitWork` (it states submitWork rides `feedback emit` / writes an outbox `work.request`
  EVENT — false after TASK-001) to describe the `submit`/local-inbox path instead. The frozen docs
  test (`tests/docs-feature-0007.test.ts:26`) pins only the lowercase literal `submitwork`, so this
  edit touches no frozen assertion.
- If the implementer's diff (TASK-001, TASK-003…011) lands before this retirement, the OLD pins
  will fail (by design — still frozen, still asserting the emit-era shapes) until this phase-4
  change lands in the same commit as the new suite. Expected sequencing, not a plan defect.

### TASK-003 — Command + rebindable chord registration
**Satisfies:** REQ-001 · **Files:** `src/shared/keybindings.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** `findConflict(DEFAULT_BINDINGS, mod+shift+u,
  'capture-orky-work') === null`; no change to `resolveBindings`/`matchShortcut`/`isValidRebind` or
  any existing `COMMANDS` entry — purely additive
- Add `CommandId` member `'capture-orky-work'` and `Shortcut` variant
  `{ type: 'capture-orky-work' }`.
- Add to `COMMANDS`: `{ id: 'capture-orky-work', label: 'Capture Orky work item', category:
  'General', defaultChord: { mod: true, shift: true, key: 'u' } }` — verified non-conflicting
  against every existing default chord (decision #1's rationale: `o`/`n`/`w`/`i`/`c` all collide or
  are reserved; `u` does not).

### TASK-004 — Command-palette entry
**Satisfies:** REQ-001 · **Files:** `src/shared/quick.ts`
**Depends on:** TASK-003 · **Order:** 2 · **Constraints:** label/id sourced from `COMMANDS`
  (TASK-003), never duplicated inline; search terms cover `capture orky work idea inbox`
- Add `'capture-orky-work'` to the `PaletteAction` union.
- Add a `buildCommandItems()` entry ("Capture Orky work item…") invoking `openOrkyCapture()` (no
  argument — the picker-first flow).

### TASK-005 — `OrkyRootPicker` additive props
**Satisfies:** REQ-003 · **Files:** `src/renderer/components/OrkyRootPicker.tsx`
**Depends on:** — · **Order:** 1 · **Constraints:** additive, default-preserving ONLY; every F9
  call site renders byte-identical DOM with props omitted; no string entering the file matches
  TEST-433's banned set (`orkyAction`, mutation symbols, `child_process`, `orkyWatch`); no change
  breaks TEST-434's pinned literals (testids, `registryError`, `/track/i` empty copy, `Escape`,
  `not.toContain('registryRoots(')`)
- Add optional props `ariaLabel?: string` (default: existing
  `"Bind Orky pane to a tracked project"`), `heading?: string` (default: existing visible header
  `"Bind to a tracked Orky project"`), `z?: number` (default: existing `Z.palette`) — name/heading
  MUST be configurable together in this same change (FINDING-005: accessible name and visible copy
  can never diverge).
- No other change to this file — the four mutually-distinct states, CONV-030 key handling, and the
  `useRegistryLoadState`/`useOpenFocusRestore` substrate stay untouched.

### TASK-006 — Capture store slice: open/root state, no-op reinvoke, close/reset
**Satisfies:** REQ-002, REQ-003, REQ-004, REQ-006, REQ-012 · **Files:**
  `src/renderer/store/orky-capture-slice.ts` (new), `src/renderer/store.ts`,
  `src/renderer/store/types.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** no persistence (session-scoped, discarded on
  close — D1 "no persistent UI"); no per-pane keyed map (CONV-011 n/a per REQ-012); no IPC
- State: `orkyCaptureRequest: { root: string | null } | null` (`null` = closed; `{root: null}` =
  picker-first flow; `{root: <string>}` = pre-selected/form-direct flow — D4).
- `openOrkyCapture(root?: string): void` — if already open, NO-OP (preserves in-flight/draft state
  per REQ-006, never resets); if closed, opens with `{root: root ?? null}`.
- `closeOrkyCapture(): void` — resets to `null` unconditionally (discards whatever draft/root state
  the modal was carrying) — the SOLE reset chokepoint TASK-007 calls on every close path (cancel,
  Escape, backdrop, success, unmount-mid-flight settle-drop).
- This slice does NOT own the typed title/detail draft or in-flight/error state — those are
  component-local to `OrkyCaptureModal` (TASK-007) per decision #8 ("draft lives only while the
  modal is open," never a cross-render-tree concern); this task's state is exactly what both
  callers (the chord/palette path here, and F10's future "inject" call) need to agree on: is
  capture open, and for which root.

### TASK-007 — `OrkyCaptureModal` component: form, picker handoff, submit gesture, result handling, keyboard matrix
**Satisfies:** REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010,
  REQ-011, REQ-012 · **Files:** `src/renderer/components/OrkyCaptureModal.tsx` (new)
**Depends on:** TASK-001 (result shapes this task branches on), TASK-005 (picker props),
  TASK-006 (slice) · **Order:** 3 · **Constraints:** the ONLY `api.orkySubmitWork(` call site in
  the feature; testid namespace `orky-capture*` (never containing `orky-action`/`orkyaction`);
  theme-var-only styling (CONV-029, `--status-failure`/`#c62828` for failure); dispatch issued
  synchronously from the gesture handler, never a `useEffect`
- **Flow (D1/D3):** no pre-selected root → render `OrkyRootPicker` first (capture-specific
  `ariaLabel`/`heading`, TASK-005's new props) → on select, render the form with that root; a
  pre-selected root (REQ-004) skips straight to the form. `orky-capture-change-root` reopens the
  SAME picker; cancelling it returns to the form with the prior root intact; cancelling the
  INITIAL picker calls `closeOrkyCapture()` with zero dispatch.
- **Form (REQ-002):** `orky-capture` card (`role="dialog"`, `aria-modal`, /capture/i aria-label),
  labelled `orky-capture-title` (autofocused via `useOpenFocusRestore`), labelled
  `orky-capture-detail` (optional), `orky-capture-target` (verbatim root string) +
  `orky-capture-change-root`, `orky-capture-submit` (disabled while title empty/whitespace-only or
  in-flight), `orky-capture-cancel`, and `orky-capture-error` (mounted ONLY on `ok:false`, carrying
  `data-error-kind`).
- **Request build (REQ-005/REQ-010):** exactly `{ projectRoot: <root, byte-verbatim>, title:
  <verbatim> }` plus `detail` iff the textarea is non-empty — no trim, no rewrite, no added keys,
  no client-side length/character gate beyond the submit-enablement rule.
- **Gesture/single-flight (REQ-006):** the `orkySubmitWork` call sits inside the submit
  button/Enter/`mod+Enter` handler, reading current draft/root via `getState()` at event time
  (CONV-021); single-flight guard disables further submit gestures until the promise settles;
  re-invoking `openOrkyCapture` while open is TASK-006's no-op, so this component never needs to
  guard against a reset mid-flight.
- **Keyboard matrix (REQ-007):** Escape closes (discard, zero dispatch) from anywhere; Enter in
  title submits iff valid+idle; Enter in detail is a newline only; Enter/Space on a focused button
  is that button's own activation (CONV-030 target-guarded — container handlers never intercept a
  focused native control); `mod+Enter` submits from anywhere in the form; Tab order title → detail
  → change-root → submit → cancel.
- **Result handling (REQ-008/REQ-009):** success (`ok:true && dispatched:true`) → `closeOrkyCapture()`
  + `pushToast` success-kind copy ("Captured — queued in `<root>`'s Orky inbox for triage.");
  failure (`ok:false`) → keep modal open, title/detail/root intact, re-enable submit, render
  `orky-capture-error` with F7's `error` VERBATIM, per-kind copy: `feedback-disabled` distinct (no
  enable affordance), `cli-timeout` indeterminate wording + duplicate-retry warning, all others
  generic verbatim. Keyed ONLY on `ok`/`dispatched`/`errorKind` — never `exitCode`/`data`/
  `mapCliRunToResult` re-import.
- **Lifecycle (REQ-012):** zero IPC on mount (picker renders from the held registry snapshot);
  unmount mid-flight drops the settled result without dispatching/retrying/warning; every vector
  above additionally holds under `<StrictMode>`'s mount→unmount→remount (FINDING-004) — zero
  mount-time dispatch, exactly one gesture-time dispatch, no double-count across the remount.

### TASK-008 — App-level host + keydown dispatch case
**Satisfies:** REQ-001, REQ-006 · **Files:** `src/renderer/App.tsx`
**Depends on:** TASK-003, TASK-006, TASK-007 · **Order:** 4 · **Constraints:** app-level chrome
  hosted beside the existing `OrkyRootPicker` host (`App.tsx:186-190`), not inside any
  `.mosaic`/workspace-host subtree; the keydown case reads no `activeId`
- Host `<OrkyCaptureModal/>` app-level (mirrors the existing picker host).
- Extend App's window-keydown dispatch switch with `case 'capture-orky-work': openOrkyCapture();
  break;` — placed alongside the `'toggle-orky-queue'` precedent (`:140`), needing no `activeId`
  guard, so the chord works with zero active workspace.

### TASK-009 — Command-palette wiring / verification
**Satisfies:** REQ-001 · **Files:** `src/renderer/components/CommandPalette.tsx`
**Depends on:** TASK-004 · **Order:** 3 · **Constraints:** activation MUST be handled BEFORE the
  `if (!activeId) return` guard (the `toggle-orky-queue` precedent, `:62-66`); if the palette
  already derives its activation list/switch fully from `COMMANDS`/`buildCommandItems()`, this task
  is a no-diff verification step — confirm and record which is true during implementation
- Wire (or verify already-covered) the `'capture-orky-work'` activation to call `openOrkyCapture()`
  ahead of the `activeId` guard, matching the F6 precedent exactly.

### TASK-010 — Scope-guard verification pass (placement, testid namespace, write-surface)
**Satisfies:** REQ-005, REQ-011 · **Files:** (verification only — reviews the diff produced by
  TASK-001, TASK-003…009)
**Depends on:** TASK-001, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009 · **Order:** 5 ·
  **Constraints:** structural/grep verification, not a new test file (phase 4's job)
- Confirm: no `CH.*` constant added; no `ipcMain.handle`/`preload/index.ts` edit beyond the REQ-011
  comment; no F12 file references `orkyResolveEscalation`/`orkyRecordHumanGate`/`orkyDriveStatus`/
  `child_process`/`execFile`/`fsWrite`; exactly one `orkySubmitWork(` call site (in
  `OrkyCaptureModal.tsx`); no F9_FILE (`orky-pane.ts`, `OrkyPane.tsx`, `OrkyRootPicker.tsx`,
  `orky-pane-slice.ts`, `orky-root-detail.ts`) contains the literal `orkyAction` outside the
  additive props TASK-005 introduced; no F12 renderer file matches
  `RegistryMutationResult|registryRoots\(|registryAddRoot\(|registryRemoveRoot\(`; no F12 testid
  contains `orky-action`/`orkyaction`; `SCHEMA_VERSION` unchanged; the only `src/main/` diff is
  TASK-001's in-place amendment.
- Confirm no whole-file content-freeze test is proposed for any shared multi-owner file this feature
  touches (`keybindings.ts`, `quick.ts`, `OrkyRootPicker.tsx`, `App.tsx`, `store.ts`/`store/types.ts`)
  — CONV-012; phase 4 pins F12's OWN additions structurally, not the shared file wholesale.
- This is a review checklist executed once the functional tasks land — it produces no new shipped
  file, only a pass/fail confirmation feeding the implementation gate.

### TASK-011 — Stale-claim retirement sweep + documentation
**Satisfies:** REQ-011 · **Files:** `src/shared/ipc-contract.ts` (comment only),
  `docs/features/orky-action-dispatch.md` (no-consumer line only — its emit-flow prose is TASK-002's),
  `docs/features/quick-capture-inbox.md` (new), `CLAUDE.md`, `CHANGELOG.md`,
  `.orky/baseline/architecture.md`
**Depends on:** TASK-001, TASK-007, TASK-010 · **Order:** 6 (last) · **Constraints:** repo-wide grep
  for `no renderer UI consumes|no renderer consumer` over `src/**`, `docs/**`, `CLAUDE.md`,
  `.orky/baseline/**`; the registry-mutation no-consumer line
  (`.orky/baseline/architecture.md:117-118`) is an explicit ALLOWLIST entry and MUST stay
  byte-unchanged — this task edits every OTHER phrasing of the orkyAction-class claim, never that
  line
- Update `ipc-contract.ts:178-179`'s now-false "no renderer UI consumes these yet" comment to name
  F12 as the first (submitWork-only) consumer.
- Update the `orkyAction`-no-consumer echo at its "still true after F12" boundary: sweep `docs/**`,
  `CLAUDE.md`, `.orky/baseline/**` for every OTHER phrasing of the same claim class and update each
  — never only the one enumerated comment.
- New `docs/features/quick-capture-inbox.md`: document the capture flow (chord/palette invocation,
  picker→form sequencing, the `openOrkyCapture(root?)` entry point F10 will later call, result
  honesty keying, the F7 `submit`-path grounding).
- `CHANGELOG.md [Unreleased]`: record the quick-capture modal and the F7 `emit → submit` dispatcher
  amendment.
- `.orky/baseline/architecture.md`: reconcile any general "no renderer UI consumes orkyAction"
  phrasing beyond the allowlisted registry-mutation line.

---

## Sequencing summary

```
TASK-001 (F7 dispatcher amendment: emit -> submit)
  └─ TASK-002 (six frozen-pin supersessions + emit-flow doc staleness) [phase 4, delegated]
  └─ TASK-007 (OrkyCaptureModal: form/gesture/result handling)   [needs 001, 005, 006]
        └─ TASK-008 (App.tsx host + keydown case)                     [needs 003, 006, 007]
              └─ TASK-010 (scope-guard verification)                  [needs 001, 005-009]
                    └─ TASK-011 (stale-claim sweep + docs)             [needs 001, 007, 010]
TASK-003 (keybinding registration)          [independent]
  ├─ TASK-004 (palette entry)               [needs 003]
  │     └─ TASK-009 (palette wiring/verification) [needs 004]
  └─ TASK-008 (needs 003, 006, 007)
TASK-005 (OrkyRootPicker additive props)    [independent]
  └─ TASK-007 (needs 001, 005, 006)
TASK-006 (capture store slice)              [independent]
  ├─ TASK-007 (needs 001, 005, 006)
  └─ TASK-008 (needs 003, 006, 007)
```

## Complexity flags

- **REQ-011** (frozen-guard compatibility + stale-claim retirement) spans 4 tasks (TASK-002,
  TASK-005, TASK-007, TASK-010, TASK-011) — inherent to the REQ covering both a delegated
  test-phase supersession AND several structural placement constraints enforced across every
  renderer file; no single task could own the whole REQ without conflating implementation-phase
  code with the phase-4-owned test retirement.
- **REQ-013** spans TASK-001 (the code) and TASK-002 (its designed test-pin supersessions +
  doc-staleness fix, delegated) — deliberately NOT one task, per CONV-019's protocol that a
  designed retirement is recorded and executed at the tests phase, never folded into the
  implementation diff.
- **REQ-006** (gesture-tying/single-flight, including StrictMode vectors) spans TASK-006 (the
  no-op-reinvoke guard) and TASK-007 (the gesture-handler dispatch + single-flight disable) — the
  slice and the component each own a distinct half of the invariant (open-state idempotency vs.
  dispatch idempotency).

## Risk notes

1. **TASK-002 is a boundary marker, not deliverable code.** Do not let an implementer "helpfully"
   edit `tests/main/orky-action-dispatcher.test.ts`,
   `tests/main/orky-action-dispatcher-codex-001-regression.test.ts`, or
   `docs/features/orky-action-dispatch.md`'s emit-flow prose during TASK-001/003…011 — REQ-011/
   REQ-013 are explicit that this happens at phase 4, in the test-designer's own change, or not at
   all during implementation. Until that phase-4 change lands, the six enumerated pins are EXPECTED
   to fail against TASK-001's diff — this is designed sequencing (CONV-019), not a defect.
2. **Draft state lives in the component, not the slice (TASK-006/007 boundary).** Keeping
   title/detail/in-flight/error local to `OrkyCaptureModal` (rather than lifting it into the store)
   keeps the slice's public surface exactly what F10's future "inject" caller needs
   (`openOrkyCapture(root?)`/`closeOrkyCapture()`) and nothing more — a deliberate minimal-surface
   choice, not an oversight.
3. **Palette wiring (TASK-009) may be a no-diff task**, mirroring 0006 TASK-011's own note — if the
   palette already derives its full command list/activation switch from `COMMANDS` automatically,
   this task becomes a verification step, confirmed during implementation.
4. **No new IPC, preload, or main-process module is proposed anywhere in this plan** beyond
   TASK-001's in-place amendment — any implementer surfacing a need for one during build is a scope
   escalation to raise, not a silent addition (REQ-005).

## Open issues (under-specified REQs)

None. Every REQ-001…REQ-013 maps to ≥1 TASK (see `traceability.md` / `traceability.json`).
REQ-011/REQ-013 additionally map to TASK-002, a deliberately delegated, non-implementation-phase
task boundary — not an uncovered requirement. The spec is frozen at 13 REQs.

### TASK-012 — Result-honesty completion: runner spawn-failure distinction + renderer ipc-failure copy (REQ-014)

*Added at the ESC-001 review loopback (coordinator, per the rev-2 spec).* Distinguish string-errno
spawn failures from genuine timeouts in `src/main/orky/orky-cli-runner.ts` (the :34-35 catch-all —
timedOut:true reserved for the elapsed-time class; spawn failures resolve timedOut:false so the
byte-unchanged mapper surfaces them as definite cli-error/cli-unparseable), and the renderer invoke
catch in OrkyCaptureModal synthesizes the renderer-scoped ipc-failure indeterminate copy. Depends:
TASK-001, TASK-007. Satisfies REQ-014 (with REQ-009 vectors).
