# 0012 — Quick-capture new-work inbox — Traceability

Regenerated from `traceability.json` at doc-sync (phase 7), against **spec revision 2** (the
ESC-001 review-gate loopback: REQ-001…REQ-014). Machine-checkable matrix lives in
`traceability.json`; this file is its human-readable mirror. Every REQ-001…REQ-014 maps to at
least one TASK, at least one real TEST-NNN (verified present as an `it()`/`test()` marker in the
named file), and the file(s) it touches. No REQ is uncovered.

| REQ | Tasks | Tests | Files |
|---|---|---|---|
| REQ-001 — Global invocation: palette + rebindable chord | TASK-003, TASK-004, TASK-008, TASK-009 | TEST-495, 497, 498, 499, 500, 501, 504, 524 | `keybindings.ts`, `quick.ts`, `App.tsx`, `CommandPalette.tsx` |
| REQ-002 — The capture modal shell (+ rev-2 hint line, overflow clamp) | TASK-006, TASK-007 | TEST-481, 484, 485, 504, 506, 519, 520 | `orky-capture-slice.ts`, `OrkyCaptureModal.tsx` |
| REQ-003 — Target selection reuses the F9 picker substrate | TASK-005, TASK-006, TASK-007 | TEST-481, 486, 487, 504, 505, 528 | `OrkyRootPicker.tsx`, `orky-capture-slice.ts`, `OrkyCaptureModal.tsx` |
| REQ-004 — Pre-selected-root entry path (D4, for F10) | TASK-006, TASK-007 | TEST-481, 482, 505 | `orky-capture-slice.ts`, `OrkyCaptureModal.tsx` |
| REQ-005 — Submission exclusively via F7's `submitWork` | TASK-007, TASK-010 | TEST-488, 489, 504 | `OrkyCaptureModal.tsx` |
| REQ-006 — Gesture-tying + single-flight, StrictMode-safe | TASK-006, TASK-007, TASK-008 | TEST-482, 489, 495, 504, 505 | `orky-capture-slice.ts`, `OrkyCaptureModal.tsx`, `App.tsx` |
| REQ-007 — Keyboard matrix (CONV-030 target guards) | TASK-007 | TEST-490, 504, 505, 506 | `OrkyCaptureModal.tsx` |
| REQ-008 — Result honesty ("captured", keyed on ok/dispatched) | TASK-007 | TEST-491, 504, 506 | `OrkyCaptureModal.tsx` |
| REQ-009 — Failure surfacing, per-kind, draft-preserving, detached-outcome honesty | TASK-007 | TEST-492, 506, 522, 523, 525, 526, 527, 528, 529 | `OrkyCaptureModal.tsx`, `orky-capture-structure-rev2.test.ts`, `orky-capture-detached-honesty.test.ts`, `orky-capture.spec.ts` |
| REQ-010 — Payload bounds mirror F7, no re-validation | TASK-007 | TEST-471, 493, 504 | `OrkyCaptureModal.tsx` |
| REQ-011 — Frozen-guard compatibility + stale-claim retirement (SEVEN supersessions) | TASK-002 (delegated), TASK-005, TASK-007, TASK-010, TASK-011 | TEST-487, 494, 502, 503, 237, 238, 267, 293, 298, 300 | `orky-action-dispatcher*.test.ts`, `orky-action-validate.test.ts`, `orky-action-dispatch.md`, `OrkyRootPicker.tsx`, `OrkyCaptureModal.tsx`, `ipc-contract.ts`, `quick-capture-inbox.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` |
| REQ-012 — Lifecycle hygiene, real mount/unmount, close-mid-flight | TASK-006, TASK-007 | TEST-483, 494, 496, 527 | `orky-capture-slice.ts`, `OrkyCaptureModal.tsx` |
| REQ-013 — F7 dispatcher amendment: `submit` not `emit` + `projectRoot` flag-like guard | TASK-001, TASK-002 (delegated) | TEST-469-480, 237, 238, 267, 293, 298, 300, 512-518 | `orky-action-dispatcher.ts`, `orky-action-dispatcher*.test.ts`, `orky-action-dispatch.md`, `orky-action-validate-projectroot-flaglike.test.ts`, `orky-action-validate.ts` |
| REQ-014 — Runner failure classification (spawn=definite vs timeout=indeterminate) + `ipc-failure` | TASK-012, TASK-001, TASK-007 | TEST-507-511, 521, 522 | `orky-cli-runner.ts`, `OrkyCaptureModal.tsx`, `orky-cli-runner-spawn-failure.test.ts`, `orky-capture-structure-rev2.test.ts` |

## Revision history

- **Revision 1 (phase 4, tests-designed):** REQ-001…REQ-013 wired to TEST-469…506 + the six
  frozen-pin supersessions (TASK-002).
- **Revision 2 (ESC-001 review-gate loopback):** NEW REQ-014; TEST-507…528 added across
  REQ-002/003/004/006/009/011/012/013/014 per the spec-revision-2 amendments (spawn-failure
  classification, `ipc-failure`, hint line, overflow clamp, close-mid-flight detached-toast
  reporting, `projectRoot` flag-like guard, CommandPalette locator-collision comment, the seventh
  prose-only frozen-pin supersession).
- **Post-review fix loopback (FINDING-024):** TEST-529 added to REQ-009 — the detached
  close-in-flight toast must carry the failing kind's own honesty class (indeterminate wording for
  `cli-timeout`/`ipc-failure`), not uniform definite copy. New file:
  `tests/renderer/orky-capture-detached-honesty.test.ts`.

## Notes

- **TASK-002** is a delegated, phase-4-owned marker task (the 0006 TASK-013 precedent) — it anchors
  REQ-011's SEVEN frozen-pin supersessions (six assertion-level dispatcher amendments +
  entry-7 prose-only `orky-action-validate.test.ts` scope-comment/it-title repair, per
  FINDING-007/FINDING-020) and the resulting `docs/features/orky-action-dispatch.md` submit-flow
  staleness fix to REQ-013's dispatcher amendment. It is intentionally not implemented during the
  build phase.
- **TASK-010** is a review/verification task (no new shipped file) confirming the write-surface and
  frozen-guard placement constraints hold across the diff.
- **TASK-012** is REQ-014's runner-classification task (`orky-cli-runner.ts`'s spawn-vs-timeout
  split).
- No REQ is left without a TASK or a real, verified TEST. Uncovered REQs: none.
